"""
Main FastAPI Backend — Amazon Order Tracker
"""
import os
import logging
from datetime import datetime
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from dotenv import load_dotenv

from database.models import init_db, SessionLocal, EmailAccount, Order, OrderStatusHistory
from gmail_client import get_auth_url, exchange_code_for_tokens, fetch_amazon_emails
from email_parser import parse_order_email, detect_currency
from bot.notify import notify_new_order, notify_status_change
from tracker import get_tracking_status, refresh_shipped_orders

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="Amazon Order Tracker", docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

scheduler = AsyncIOScheduler(timezone="UTC")

# Mount frontend static files
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.exists(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


# ─── Pydantic Schemas ──────────────────────────────────────

class OrderUpdate(BaseModel):
    sale_price: Optional[float] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    product_name: Optional[str] = None


# ─── Startup ──────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    init_db()
    logger.info("✅ Database initialized")
    interval = int(os.getenv("SYNC_INTERVAL_MINUTES", "30"))
    
    # 1. المزامنة الآلية السريعة (كل 30 دقيقة)
    scheduler.add_job(sync_all_accounts, "interval", minutes=interval, id="sync_emails", args=[False])
    
    # 2. التدقيق والمراجعة الشاملة بالذكاء الاصطناعي (كل 4 ساعات)
    ai_interval_hours = int(os.getenv("AI_AUDIT_INTERVAL_HOURS", "4"))
    scheduler.add_job(sync_all_accounts, "interval", hours=ai_interval_hours, id="ai_audit_job", args=[True])
    
    # 3. تحديث التتبع لطلبات الشحن
    scheduler.add_job(
        refresh_shipped_orders,
        "interval",
        hours=2,
        id="refresh_tracking",
        args=[SessionLocal],
    )
    scheduler.start()
    logger.info(f"⏰ Scheduler started: Fast sync every {interval}m | AI Audit every {ai_interval_hours}h")


@app.on_event("shutdown")
async def shutdown():
    if scheduler.running:
        scheduler.shutdown()


# ─── Frontend ─────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def serve_frontend():
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse("<h1>Frontend not found</h1>", status_code=404)


# ─── Gmail OAuth ──────────────────────────────────────────

@app.get("/auth/gmail")
@app.get("/api/auth/gmail/login")
async def gmail_auth():
    """بدء عملية تفويض Gmail"""
    url = get_auth_url()
    return RedirectResponse(url)


@app.get("/auth/callback")
@app.get("/api/auth/gmail/callback")
async def gmail_callback(code: str, request: Request):
    """استقبال الكود وإتمام التفويض"""
    try:
        tokens = exchange_code_for_tokens(code)
        email = tokens["email"]

        with SessionLocal() as db:
            account = db.query(EmailAccount).filter_by(email=email).first()
            if not account:
                account = EmailAccount(email=email, display_name=email)
                db.add(account)

            account.access_token = tokens["access_token"]
            account.refresh_token = tokens["refresh_token"]
            account.token_expiry = tokens["expiry"]
            account.is_active = True
            db.commit()

        logger.info(f"✅ Gmail connected: {email}")
        return RedirectResponse("/?connected=true")
    except Exception as e:
        logger.error(f"OAuth error: {e}")
        return RedirectResponse("/?error=auth_failed")


# ─── Email Accounts API ───────────────────────────────────

@app.get("/api/accounts")
async def get_accounts():
    with SessionLocal() as db:
        accounts = db.query(EmailAccount).filter_by(is_active=True).all()
        return [
            {
                "id": a.id,
                "email": a.email,
                "display_name": a.display_name,
                "status": getattr(a, "status", "active") or "active",
                "last_error": getattr(a, "last_error", None),
                "last_synced": a.last_synced.isoformat() if a.last_synced else None,
                "order_count": db.query(Order).filter_by(account_id=a.id).count(),
            }
            for a in accounts
        ]



@app.delete("/api/accounts/{account_id}")
async def delete_account(account_id: int):
    with SessionLocal() as db:
        account = db.query(EmailAccount).filter_by(id=account_id).first()
        if not account:
            raise HTTPException(status_code=404, detail="Account not found")
        db.delete(account)
        db.commit()
    return {"success": True}


@app.post("/api/accounts/{account_id}/sync")
async def manual_sync(account_id: int):
    """فحص يدوي فوري لحساب محدد"""
    with SessionLocal() as db:
        account = db.query(EmailAccount).filter_by(id=account_id).first()
        if not account:
            raise HTTPException(status_code=404, detail="Account not found")
        account_data = {
            "id": account.id,
            "email": account.email,
            "access_token": account.access_token,
            "refresh_token": account.refresh_token,
            "token_expiry": account.token_expiry,
            "last_synced": account.last_synced,
        }

    new_orders = await sync_account(account_data)
    return {"success": True, "new_orders": new_orders}


# ─── Orders API ───────────────────────────────────────────

@app.get("/api/orders")
async def get_orders(
    status: Optional[str] = None,
    account_id: Optional[int] = None,
    limit: int = 100,
    offset: int = 0,
):
    with SessionLocal() as db:
        q = db.query(Order)
        if status:
            q = q.filter(Order.status == status)
        if account_id:
            q = q.filter(Order.account_id == account_id)
        q = q.order_by(Order.order_date.desc(), Order.created_at.desc())
        total = q.count()
        orders = q.offset(offset).limit(limit).all()

        return {
            "total": total,
            "orders": [serialize_order(o) for o in orders]
        }


from fastapi.responses import Response
import csv
import io

@app.get("/api/orders/export")
async def export_orders_csv():
    """تصدير التقارير كملف CSV عالي الجودة يدعم Excel واللغة العربية"""
    with SessionLocal() as db:
        orders = db.query(Order).order_by(Order.order_date.desc()).all()
        
        output = io.StringIO()
        output.write('\ufeff')  # UTF-8 BOM for Excel compatibility
        
        writer = csv.writer(output)
        writer.writerow([
            "م", "رقم طلب أمازون", "اسم المنتج", "سعر الشراء (ر.س)",
            "سعر البيع (ر.س)", "الربح/الخسارة (ر.س)", "الحالة", "البريد الإلكتروني",
            "تاريخ الطلب", "شركة الشحن", "رقم التتبع", "ملاحظات الذكاء الاصطناعي"
        ])
        
        for idx, o in enumerate(orders, 1):
            writer.writerow([
                idx,
                o.amazon_order_id or "",
                o.product_name or "",
                f"{o.purchase_price:.2f}" if o.purchase_price is not None else "",
                f"{o.sale_price:.2f}" if o.sale_price is not None else "",
                f"{o.profit:.2f}" if o.profit is not None else "",
                o.status or "",
                o.to_email or "",
                o.order_date.strftime("%Y-%m-%d") if o.order_date else "",
                o.carrier or "",
                o.tracking_number or "",
                o.notes or ""
            ])
            
        csv_data = output.getvalue()
        return Response(
            content=csv_data,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": "attachment; filename=amazon_orders_report.csv"}
        )


@app.get("/api/analytics")
async def get_analytics(
    period: Optional[str] = "all",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    account_id: Optional[int] = None,
    search: Optional[str] = None
):
    """تحليلات وتعداد المنتجات حسب الفترة الزمنية والبحث"""
    with SessionLocal() as db:
        q = db.query(Order)
        if account_id:
            q = q.filter(Order.account_id == account_id)
        
        now = datetime.utcnow()
        if period == "today":
            q = q.filter(Order.created_at >= now.replace(hour=0, minute=0, second=0))
        elif period == "7days":
            q = q.filter(Order.created_at >= now - timedelta(days=7))
        elif period == "30days":
            q = q.filter(Order.created_at >= now - timedelta(days=30))
        elif period == "month":
            q = q.filter(Order.created_at >= now.replace(day=1, hour=0, minute=0, second=0))
        elif period == "custom" and start_date and end_date:
            try:
                s_dt = datetime.fromisoformat(start_date)
                e_dt = datetime.fromisoformat(end_date)
                q = q.filter(Order.created_at >= s_dt, Order.created_at <= e_dt)
            except Exception:
                pass

        if search:
            q = q.filter(Order.product_name.ilike(f"%{search}%"))

        orders = q.all()

        total_items = len(orders)
        total_spent = sum((o.purchase_price or 0.0) for o in orders)
        status_counts = {}
        products_map = {}

        for o in orders:
            status_counts[o.status] = status_counts.get(o.status, 0) + 1
            
            p_name = o.product_name or "منتج بدون اسم"
            if p_name not in products_map:
                products_map[p_name] = {
                    "product_name": p_name,
                    "product_image": o.product_image,
                    "asin": o.asin,
                    "count": 0,
                    "total_cost": 0.0,
                    "statuses": {},
                    "last_purchased": o.order_date.isoformat() if o.order_date else o.created_at.isoformat()
                }
            
            products_map[p_name]["count"] += 1
            products_map[p_name]["total_cost"] += (o.purchase_price or 0.0)
            st = o.status
            products_map[p_name]["statuses"][st] = products_map[p_name]["statuses"].get(st, 0) + 1

        top_products = sorted(products_map.values(), key=lambda x: x["count"], reverse=True)

        return {
            "period": period,
            "total_items": total_items,
            "total_spent": round(total_spent, 2),
            "unique_products": len(products_map),
            "status_breakdown": status_counts,
            "top_products": top_products
        }


@app.get("/api/orders/{order_id}/track")
async def track_order(order_id: int):
    """تتبع حي لشحنة طلب محدد"""
    with SessionLocal() as db:
        order = db.query(Order).filter_by(id=order_id).first()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")

        result = await get_tracking_status(
            order.tracking_number or "",
            order.carrier or "Amazon",
            order.amazon_order_id,
        )

        # تحديث الحالة لو تغيرت
        new_status = result.get("status")
        if new_status and new_status != order.status and new_status not in ["", "pending"]:
            old_status = order.status
            order.status = new_status
            order.updated_at = datetime.utcnow()
            db.add(OrderStatusHistory(
                order_id=order.id, status=new_status, source="tracking"
            ))
            db.commit()

        return result



@app.get("/api/orders/{order_id}")
async def get_order(order_id: int):
    with SessionLocal() as db:
        order = db.query(Order).filter_by(id=order_id).first()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        return serialize_order(order, include_history=True)


@app.patch("/api/orders/{order_id}")
async def update_order(order_id: int, data: OrderUpdate):
    with SessionLocal() as db:
        order = db.query(Order).filter_by(id=order_id).first()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")

        old_status = order.status

        if data.sale_price is not None:
            order.sale_price = data.sale_price
        if data.notes is not None:
            order.notes = data.notes
        if data.product_name is not None:
            order.product_name = data.product_name
        if data.status is not None and data.status != order.status:
            order.status = data.status
            db.add(OrderStatusHistory(
                order_id=order.id,
                status=data.status,
                source="manual"
            ))

        order.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(order)
        return serialize_order(order)


@app.delete("/api/orders/{order_id}")
async def delete_order(order_id: int):
    with SessionLocal() as db:
        order = db.query(Order).filter_by(id=order_id).first()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        db.delete(order)
        db.commit()
    return {"success": True}


# ─── Stats API ────────────────────────────────────────────

@app.get("/api/stats")
async def get_stats():
    with SessionLocal() as db:
        total_orders = db.query(Order).count()
        total_spent = db.query(Order).filter(Order.purchase_price.isnot(None)).all()
        total_revenue = sum(o.sale_price for o in total_spent if o.sale_price) or 0
        total_cost = sum(o.purchase_price for o in total_spent if o.purchase_price) or 0
        total_profit = total_revenue - total_cost

        by_status = {}
        for status in ["pending", "shipped", "delivered", "cancelled", "returned"]:
            by_status[status] = db.query(Order).filter_by(status=status).count()

        # إحصائيات حسب الإيميل
        accounts = db.query(EmailAccount).filter_by(is_active=True).all()
        by_email = []
        for acc in accounts:
            count = db.query(Order).filter_by(account_id=acc.id).count()
            spent = sum(
                o.purchase_price for o in db.query(Order).filter_by(account_id=acc.id).all()
                if o.purchase_price
            )
            by_email.append({
                "email": acc.email,
                "count": count,
                "spent": round(spent, 2),
            })

        # آخر 30 يوم - الطلبات اليومية
        from sqlalchemy import func
        recent = db.query(
            func.date(Order.order_date).label("day"),
            func.count(Order.id).label("count")
        ).group_by(func.date(Order.order_date)).order_by(func.date(Order.order_date).desc()).limit(30).all()

        return {
            "total_orders": total_orders,
            "total_cost": round(total_cost, 2),
            "total_revenue": round(total_revenue, 2),
            "total_profit": round(total_profit, 2),
            "by_status": by_status,
            "by_email": by_email,
            "recent_days": [{"day": str(r.day), "count": r.count} for r in recent],
        }


@app.get("/api/sync/status")
async def get_sync_status():
    """معاينة حالة المزامنة والنسبة المئوية اللحظية"""
    return sync_state


from fastapi import BackgroundTasks

@app.post("/api/sync")
async def sync_now(background_tasks: BackgroundTasks):
    """مزامنة فورية لكل الحسابات في الخلفية مع قفل التزامن"""
    if sync_state["is_syncing"]:
        return {"success": False, "message": "هناك عملية مزامنة قيد التشغيل بالفعل حالياً", "sync_state": sync_state}
    
    background_tasks.add_task(sync_all_accounts, use_ai_forced=False)
    return {"success": True, "message": "بدأت المزامنة الفورية في الخلفية"}


@app.post("/api/sync/ai")
async def sync_now_ai(background_tasks: BackgroundTasks):
    """مزامنة الذكاء الاصطناعي الشاملة (AI Deep Sync) لكافة الرسائل مع قفل التزامن"""
    if sync_state["is_syncing"]:
        return {"success": False, "message": "هناك عملية مزامنة قيد التشغيل بالفعل حالياً", "sync_state": sync_state}
    
    background_tasks.add_task(sync_all_accounts, use_ai_forced=True)
    return {"success": True, "message": "بدأت المزامنة الذكية الشاملة في الخلفية", "mode": "ai_deep_sync"}


# ─── Core Sync Logic ──────────────────────────────────────

async def sync_all_accounts(use_ai_forced: bool = False) -> int:
    """الدالة الرئيسية لفحص كل الحسابات المربوطة"""
    global sync_state
    if sync_state["is_syncing"]:
        logger.warning("Sync requested while already syncing, skipping.")
        return 0

    mode_str = "AI Deep Sync 🤖" if use_ai_forced else "Standard Sync 🔄"
    logger.info(f"🔄 Starting email sync ({mode_str}) for all accounts...")

    sync_state.update({
        "is_syncing": True,
        "mode": "ai" if use_ai_forced else "standard",
        "total_emails": 0,
        "processed_emails": 0,
        "percent": 0,
        "current_subject": "جاري التحضير...",
        "new_orders_found": 0,
    })

    total_new = 0

    try:
        with SessionLocal() as db:
            accounts = db.query(EmailAccount).filter_by(is_active=True).all()
            accounts_data = [
                {
                    "id": a.id,
                    "email": a.email,
                    "access_token": a.access_token,
                    "refresh_token": a.refresh_token,
                    "token_expiry": a.token_expiry,
                    "last_synced": a.last_synced,
                }
                for a in accounts
            ]

        for acc in accounts_data:
            if not acc["access_token"]:
                continue
            try:
                new_count = await sync_account(acc, use_ai_forced=use_ai_forced)
                total_new += new_count
                with SessionLocal() as db:
                    a = db.query(EmailAccount).filter_by(id=acc["id"]).first()
                    if a:
                        a.status = "active"
                        a.last_error = None
                        db.commit()
            except Exception as e:
                logger.error(f"Error syncing {acc['email']}: {e}")
                with SessionLocal() as db:
                    a = db.query(EmailAccount).filter_by(id=acc["id"]).first()
                    if a:
                        a.status = "auth_error"
                        a.last_error = str(e)
                        db.commit()

        logger.info(f"✅ Sync complete ({mode_str}). New orders: {total_new}")
    finally:
        sync_state["percent"] = 100
        sync_state["is_syncing"] = False

    return total_new


async def sync_account(acc: dict, use_ai_forced: bool = False) -> int:
    """فحص حساب إيميل واحد"""
    after_ts = None
    if acc["last_synced"] and not use_ai_forced:
        after_ts = int(acc["last_synced"].timestamp())

    emails, updated_tokens = fetch_amazon_emails(
        access_token=acc["access_token"],
        refresh_token=acc["refresh_token"],
        expiry=acc["token_expiry"],
        after_timestamp=after_ts,
    )

    global sync_state
    sync_state["total_emails"] += len(emails)
    new_count = 0

    with SessionLocal() as db:
        for idx, email_data in enumerate(emails, 1):
            sync_state["processed_emails"] += 1
            if sync_state["total_emails"] > 0:
                sync_state["percent"] = min(99, int((sync_state["processed_emails"] / sync_state["total_emails"]) * 100))
            sync_state["current_subject"] = email_data.get("subject", "")[:50]

            parsed_list = parse_order_email(email_data, use_ai_forced=use_ai_forced)
            if not parsed_list:
                continue

            for parsed in parsed_list:
                order_id = parsed.get("amazon_order_id")
                if not order_id:
                    continue
                
                parsed_status = parsed.get("status", "pending")
                parsed_product_name = parsed.get("product_name")
                parsed_notes = parsed.get("notes")
                parsed_asin = parsed.get("asin")

                # جلب جميع القطع المرتبطة برقم الطلب هذا فقط
                existing_items = db.query(Order).filter_by(amazon_order_id=order_id).all()

                matched_item = None
                if existing_items:
                    if parsed_asin:
                        for item in existing_items:
                            if item.asin and item.asin.upper() == parsed_asin.upper():
                                matched_item = item
                                break
                    
                    if not matched_item and parsed_product_name:
                        for item in existing_items:
                            if item.product_name:
                                name_a = parsed_product_name.lower().strip()
                                name_b = item.product_name.lower().strip()
                                if name_a in name_b or name_b in name_a:
                                    matched_item = item
                                    break

                if matched_item:
                    # تحديث القطعة الموجودة لعدم تكرارها
                    status_changed = False
                    if parsed_status != matched_item.status and parsed_status != "pending":
                        old_status = matched_item.status
                        matched_item.status = parsed_status
                        status_changed = True
                        db.add(OrderStatusHistory(
                            order_id=matched_item.id,
                            status=parsed_status,
                            source="email"
                        ))
                    
                    if parsed_notes:
                        matched_item.notes = parsed_notes
                    if parsed.get("tracking_number"):
                        matched_item.tracking_number = parsed.get("tracking_number")
                    if parsed.get("carrier"):
                        matched_item.carrier = parsed.get("carrier")
                    if parsed.get("tracking_url"):
                        matched_item.tracking_url = parsed.get("tracking_url")
                    if parsed.get("estimated_delivery"):
                        matched_item.estimated_delivery = parsed.get("estimated_delivery")
                    if parsed.get("purchase_price") is not None:
                        matched_item.purchase_price = parsed.get("purchase_price")
                    if parsed.get("product_image") and not matched_item.product_image:
                        matched_item.product_image = parsed.get("product_image")

                    matched_item.updated_at = datetime.utcnow()
                    db.commit()

                    if status_changed:
                        await notify_status_change(
                            {"product_name": matched_item.product_name, "amazon_order_id": order_id},
                            old_status, parsed_status
                        )
                elif existing_items and not parsed_product_name:
                    # تحديث عام لكل قطع الطلب إذا لم يُحدد اسم منتج في الإيميل
                    for existing in existing_items:
                        status_changed = False
                        if parsed_status != existing.status and parsed_status != "pending":
                            old_status = existing.status
                            existing.status = parsed_status
                            status_changed = True
                            db.add(OrderStatusHistory(
                                order_id=existing.id,
                                status=parsed_status,
                                source="email"
                            ))
                        if parsed_notes:
                            existing.notes = parsed_notes
                        if status_changed or parsed_notes:
                            existing.updated_at = datetime.utcnow()
                            db.commit()
                        if status_changed:
                            await notify_status_change(
                                {"product_name": existing.product_name, "amazon_order_id": order_id},
                                old_status, parsed_status
                            )
                else:
                    # قطعة جديدة تماماً (أو طلب جديد) — حفظ البيانات
                    order = Order(
                        account_id=acc["id"],
                        amazon_order_id=order_id,
                        product_name=parsed_product_name,
                        asin=parsed_asin,
                        product_image=parsed.get("product_image"),
                        product_url=parsed.get("product_url"),
                        purchase_price=parsed.get("purchase_price"),
                        to_email=parsed.get("to_email") or acc["email"],
                        status=parsed_status,
                        order_date=parsed.get("order_date") or datetime.utcnow(),
                        currency=parsed.get("currency") or detect_currency(email_data.get("body", "")),
                        tracking_number=parsed.get("tracking_number"),
                        carrier=parsed.get("carrier"),
                        tracking_url=parsed.get("tracking_url"),
                        estimated_delivery=parsed.get("estimated_delivery"),
                        notes=parsed_notes,
                        email_message_id=email_data.get("gmail_message_id"),
                    )
                    db.add(order)
                    db.commit()
                    db.refresh(order)
                    new_count += 1
                    await notify_new_order({
                        "product_name": order.product_name,
                        "purchase_price": order.purchase_price,
                        "to_email": order.to_email,
                        "amazon_order_id": order.amazon_order_id,
                        "status": order.status,
                    })

        # تحديث وقت آخر مزامنة والتوكن
        account = db.query(EmailAccount).filter_by(id=acc["id"]).first()
        if account:
            account.last_synced = datetime.utcnow()
            if updated_tokens.get("access_token"):
                account.access_token = updated_tokens["access_token"]
                account.token_expiry = updated_tokens.get("expiry")
            db.commit()

    return new_count


# ─── Helpers ──────────────────────────────────────────────

def serialize_order(order: Order, include_history: bool = False) -> dict:
    data = {
        "id": order.id,
        "account_id": order.account_id,
        "amazon_order_id": order.amazon_order_id,
        "product_name": order.product_name,
        "product_image": order.product_image,
        "product_url": order.product_url,
        "asin": order.asin,
        "to_email": order.to_email,
        "purchase_price": order.purchase_price,
        "sale_price": order.sale_price,
        "profit": order.profit,
        "currency": order.currency,
        "status": order.status,
        "status_ar": order.status_ar,
        "order_date": order.order_date.isoformat() if order.order_date else None,
        "estimated_delivery": order.estimated_delivery,
        "tracking_number": order.tracking_number,
        "carrier": order.carrier,
        "tracking_url": order.tracking_url,
        "notes": order.notes,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "updated_at": order.updated_at.isoformat() if order.updated_at else None,
    }
    if include_history:
        data["history"] = [
            {"status": h.status, "changed_at": h.changed_at.isoformat(), "source": h.source}
            for h in order.status_history
        ]
    return data



if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
