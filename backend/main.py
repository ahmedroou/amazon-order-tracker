"""
Main FastAPI Backend — Amazon Order Tracker
"""
import os
import logging
from datetime import datetime
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from dotenv import load_dotenv
import json
import urllib.request

from database.models import init_db, SessionLocal, EmailAccount, Order, OrderStatusHistory, UserBadge
from gmail_client import get_auth_url, exchange_code_for_tokens, fetch_amazon_emails
from email_parser import parse_order_email, detect_currency
from bot.notify import notify_new_order, notify_status_change
from tracker import get_tracking_status, refresh_shipped_orders
from ai_agent import categorize_product, predict_delay, llm_parse_email
from price_monitor import evaluate_user_badges, init_badges

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

# ─── Global Sync State ───────────────────────────────────
sync_state = {
    "is_syncing": False,
    "percent": 0,
    "current_subject": "",
    "total_emails": 0,
    "processed_emails": 0,
    "started_at": None,
    "last_sync": None,
    "new_orders": 0,
}

# Mount frontend static files
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.exists(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


# ─── Download APK Endpoint ───────────────────────────────

@app.get("/app", response_class=HTMLResponse)
@app.get("/download")
async def serve_download_page():
    """صفحة تحميل التطبيق الجديدة"""
    page_path = os.path.join(FRONTEND_DIR, "download.html")
    if os.path.exists(page_path):
        with open(page_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse("<h1>Download page not found</h1>", status_code=404)




# ─── Pydantic Schemas ──────────────────────────────────────

class OrderUpdate(BaseModel):
    sale_price: Optional[float] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    product_name: Optional[str] = None


class ChatRequest(BaseModel):
    message: str
    history: Optional[List[Dict]] = None


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
        # Check if request is likely from mobile
        user_agent = request.headers.get("user-agent", "").lower()
        is_mobile = any(x in user_agent for x in ["android", "iphone", "mobile"])
        if is_mobile:
            return HTMLResponse(f"""<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
            <title>تم الربط</title><style>body{{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a1628;color:#fff}}
            .card{{text-align:center;padding:2rem;border-radius:16px;background:rgba(255,255,255,.08);max-width:340px}}
            .icon{{font-size:4rem;margin-bottom:1rem}}.email{{color:#4fc3f7;font-weight:bold;margin:.5rem 0}}.hint{{color:#aaa;font-size:.85rem;margin-top:1rem}}</style></head>
            <body><div class="card"><div class="icon">✅</div><h2>تم ربط الحساب بنجاح!</h2><p class="email">{email}</p>
            <p>يمكنك الآن إغلاق هذه الصفحة والعودة للتطبيق.</p><p class="hint">اسحب للأسفل في التطبيق لتحديث القائمة.</p></div></body></html>""")
        return RedirectResponse("/?connected=true")
    except Exception as e:
        logger.error(f"OAuth error: {e}")
        user_agent = request.headers.get("user-agent", "").lower()
        is_mobile = any(x in user_agent for x in ["android", "iphone", "mobile"])
        if is_mobile:
            return HTMLResponse(f"""<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
            <title>فشل الربط</title><style>body{{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a1628;color:#fff}}
            .card{{text-align:center;padding:2rem;border-radius:16px;background:rgba(255,255,255,.08);max-width:340px}}
            .icon{{font-size:4rem;margin-bottom:1rem}}</style></head>
            <body><div class="card"><div class="icon">❌</div><h2>فشل ربط الحساب</h2><p>حدث خطأ أثناء تسجيل الدخول. يرجى المحاولة مرة أخرى.</p></div></body></html>""")
        return RedirectResponse("/?error=auth_failed")


class NativeTokenRequest(BaseModel):
    serverAuthCode: str

@app.post("/api/auth/google/token")
async def google_native_token(data: NativeTokenRequest):
    """استقبال الكود من تطبيق الجوال وإتمام التفويض"""
    try:
        tokens = exchange_code_for_tokens(data.serverAuthCode)
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

        logger.info(f"✅ Native Gmail connected: {email}")
        return {"success": True, "email": email}
    except Exception as e:
        logger.error(f"Native OAuth error: {e}")
        raise HTTPException(status_code=400, detail=f"فشل التحقق: {str(e)}")



# ─── Email Accounts API ───────────────────────────────────

class AccountCreate(BaseModel):
    email: str
    display_name: Optional[str] = None


@app.post("/api/accounts")
async def create_account(data: AccountCreate):
    """(مُعطل) منع الإضافة اليدوية - يجب استخدام Google OAuth"""
    raise HTTPException(
        status_code=400, 
        detail="عفواً، تمت إزالة ميزة الإضافة اليدوية. يرجى استخدام زر ربط حساب Gmail لضمان مزامنة الطلبات بشكل صحيح."
    )


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
                "health_status": getattr(a, "health_status", "unknown") or "unknown",
                "health_checked_at": a.health_checked_at.isoformat() if getattr(a, "health_checked_at", None) else None,
                "consecutive_failures": getattr(a, "consecutive_failures", 0) or 0,
                "last_error": getattr(a, "last_error", None),
                "last_synced": a.last_synced.isoformat() if a.last_synced else None,
                "last_order_at": a.last_order_at.isoformat() if getattr(a, "last_order_at", None) else None,
                "order_count": db.query(Order).filter_by(account_id=a.id).count(),
                "has_token": bool(a.access_token),
            }
            for a in accounts
        ]



@app.get("/api/accounts/health")
async def get_accounts_health():
    """صفحة صحة الحسابات — مصنّفة حسب الحالة"""
    from datetime import timezone
    now = datetime.utcnow()
    with SessionLocal() as db:
        accounts = db.query(EmailAccount).all()
        result = []
        for a in accounts:
            last_order = db.query(Order).filter_by(account_id=a.id).order_by(Order.order_date.desc()).first()
            days_since_order = None
            if last_order and last_order.order_date:
                days_since_order = (now - last_order.order_date).days

            # حساب حالة الصحة تلقائياً
            health = getattr(a, "health_status", "unknown") or "unknown"
            failures = getattr(a, "consecutive_failures", 0) or 0
            if not a.is_active:
                health = "inactive"
            elif a.status in ("auth_error", "revoked"):
                health = "revoked"
            elif failures >= 3:
                health = "error"
            elif failures >= 1:
                health = "warning"
            elif days_since_order is not None and days_since_order > 30:
                health = "warning"
            elif a.last_synced:
                health = "healthy"

            result.append({
                "id": a.id,
                "email": a.email,
                "display_name": a.display_name,
                "is_active": a.is_active,
                "health_status": health,
                "status": getattr(a, "status", "active") or "active",
                "last_error": getattr(a, "last_error", None),
                "last_synced": a.last_synced.isoformat() if a.last_synced else None,
                "last_order_at": last_order.order_date.isoformat() if (last_order and last_order.order_date) else None,
                "days_since_order": days_since_order,
                "consecutive_failures": failures,
                "order_count": db.query(Order).filter_by(account_id=a.id).count(),
                "has_token": bool(a.access_token),
                "health_checked_at": a.health_checked_at.isoformat() if getattr(a, "health_checked_at", None) else None,
            })
        # ترتيب: error أولا ثم warning ثم healthy
        order_map = {"revoked": 0, "error": 1, "warning": 2, "unknown": 3, "healthy": 4, "inactive": 5}
        result.sort(key=lambda x: order_map.get(x["health_status"], 3))
        return result


@app.post("/api/accounts/{account_id}/health-check")
async def manual_health_check(account_id: int):
    """فحص صحة حساب محدد يدوياً"""
    with SessionLocal() as db:
        account = db.query(EmailAccount).filter_by(id=account_id).first()
        if not account:
            raise HTTPException(status_code=404, detail="Account not found")

        new_health = "unknown"
        error_msg = None

        if not account.access_token:
            new_health = "revoked"
            error_msg = "لا يوجد token مصادقة — أعد ربط الحساب"
        else:
            try:
                from gmail_client import build_credentials, refresh_if_needed
                from google.auth.exceptions import RefreshError
                creds = build_credentials(
                    account.access_token,
                    account.refresh_token,
                    account.token_expiry
                )
                creds = refresh_if_needed(creds)
                account.access_token = creds.token
                if creds.expiry:
                    account.token_expiry = creds.expiry
                new_health = "healthy"
                account.consecutive_failures = 0
            except Exception as e:
                error_str = str(e).lower()
                if "invalid_grant" in error_str or "revoked" in error_str or "unauthorized" in error_str:
                    new_health = "revoked"
                    account.status = "auth_error"
                else:
                    new_health = "error"
                error_msg = str(e)[:300]
                account.consecutive_failures = (getattr(account, "consecutive_failures", 0) or 0) + 1

        account.health_status = new_health
        account.health_checked_at = datetime.utcnow()
        if error_msg:
            account.last_error = error_msg
        db.commit()

        return {
            "success": True,
            "health_status": new_health,
            "error": error_msg
        }


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


from fastapi.responses import HTMLResponse

@app.get("/share/{share_uuid}", response_class=HTMLResponse)
async def share_page(share_uuid: str):
    """عرض واجهة مشاركة الطلب كصفحة ويب"""
    html_content = f"""
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>تتبع طلب أمازون</title>
        <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
            body {{ font-family: 'Cairo', sans-serif; background-color: #F6F8FA; margin: 0; padding: 20px; color: #1e293b; display: flex; justify-content: center; align-items: center; min-height: 100vh; }}
            .card {{ background: white; border-radius: 16px; padding: 24px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1); width: 100%; max-width: 400px; text-align: center; }}
            .badge {{ display: inline-block; padding: 6px 16px; border-radius: 20px; font-size: 14px; font-weight: bold; margin-bottom: 16px; }}
            .img-place {{ font-size: 60px; margin-bottom: 16px; }}
            h2 {{ margin: 0 0 8px 0; font-size: 18px; line-height: 1.4; }}
            .meta {{ color: #64748b; font-size: 14px; margin-bottom: 24px; }}
            .btn {{ display: inline-block; background: #6366f1; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; margin-top: 10px; width: 100%; box-sizing: border-box; }}
            .footer {{ margin-top: 24px; font-size: 12px; color: #94a3b8; }}
        </style>
    </head>
    <body>
        <div class="card" id="app">
            <div style="color: #6366f1; margin-bottom: 15px;">
                <svg width="40" height="40" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path></svg>
            </div>
            <h3 style="margin-top: 0;">جاري تحميل بيانات الطلب...</h3>
        </div>

        <script>
            async function load() {{
                try {{
                    const res = await fetch('/api/shared/{share_uuid}');
                    if(!res.ok) throw new Error('Not found');
                    const data = await res.json();
                    
                    let bg = '#fef3c7'; let textC = '#d97706';
                    if(data.status === 'delivered') {{ bg = '#dcfce7'; textC = '#15803d'; }}
                    else if(data.status === 'shipped') {{ bg = '#dbeafe'; textC = '#1d4ed8'; }}
                    else if(data.status === 'cancelled') {{ bg = '#fee2e2'; textC = '#b91c1c'; }}
                    
                    document.getElementById('app').innerHTML = `
                        <div class="badge" style="background: ${{bg}}; color: ${{textC}};">${{data.status_ar}}</div>
                        <div class="img-place">📦</div>
                        <h2>${{data.product_name || 'منتج من أمازون'}}</h2>
                        <div class="meta">رقم الطلب: ${{data.amazon_order_id || '---'}}</div>
                        <div style="background: #f8fafc; padding: 16px; border-radius: 8px; text-align: right; margin-bottom: 20px;">
                            <div style="margin-bottom: 8px;"><strong>تاريخ الطلب:</strong> ${{data.order_date ? data.order_date.substring(0,10) : '---'}}</div>
                            <div><strong>شركة الشحن:</strong> ${{data.carrier || 'غير محدد'}}</div>
                        </div>
                        <div class="footer">⚡ تم المشاركة عبر تطبيق Amazon Tracker</div>
                    `;
                }} catch(e) {{
                    document.getElementById('app').innerHTML = `
                        <div style="color: #ef4444; font-size: 40px; margin-bottom: 16px;">❌</div>
                        <h2>عذراً، الرابط غير صالح</h2>
                        <div class="meta">قد يكون الرابط منتهياً أو غير صحيح.</div>
                    `;
                }}
            }}
            load();
        </script>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)

@app.post("/api/orders/{order_id}/share")
async def generate_share_link(order_id: int):
    """توليد رابط مشاركة لطلب"""
    with SessionLocal() as db:
        order = db.query(Order).filter_by(id=order_id).first()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        
        if not order.share_uuid:
            order.share_uuid = str(uuid.uuid4())
            db.commit()
            
        return {"success": True, "share_uuid": order.share_uuid, "share_url": f"/share/{order.share_uuid}"}

@app.get("/api/shared/{share_uuid}")
async def get_shared_order(share_uuid: str):
    """جلب بيانات الطلب للمشاركة (بيانات محدودة للحماية)"""
    with SessionLocal() as db:
        order = db.query(Order).filter_by(share_uuid=share_uuid).first()
        if not order:
            raise HTTPException(status_code=404, detail="Shared link not found or expired")
            
        # Return only safe data (no email, no account info, no purchase price unless needed)
        return {
            "amazon_order_id": order.amazon_order_id,
            "product_name": order.product_name,
            "product_image": order.product_image,
            "status": order.status,
            "status_ar": order.status_ar,
            "order_date": order.order_date,
            "estimated_delivery": order.estimated_delivery,
            "delivery_date": order.delivery_date,
            "carrier": order.carrier,
        }


@app.delete("/api/orders/{order_id}")
async def delete_order(order_id: int):
    with SessionLocal() as db:
        order = db.query(Order).filter_by(id=order_id).first()
        if not order:
            raise HTTPException(status_code=404, detail="Order not found")
        db.delete(order)
        db.commit()
    return {"success": True}
@app.post("/api/orders/cleanup")
async def cleanup_duplicate_orders():
    """تنظيف قاعدة البيانات من الطلبات المكررة التي تحمل نفس amazon_order_id"""
    cleaned_count = 0
    with SessionLocal() as db:
        # Get all orders that have an amazon_order_id
        all_orders = db.query(Order).filter(Order.amazon_order_id != None, Order.amazon_order_id != "").all()
        
        # Group by amazon_order_id
        grouped = {}
        for order in all_orders:
            key = (order.account_id, order.amazon_order_id)
            if key not in grouped:
                grouped[key] = []
            grouped[key].append(order)
            
        for key, orders in grouped.items():
            if len(orders) > 1:
                # Sort by updated_at descending (latest first)
                # Or sort by status to keep the most advanced (delivered > shipped > pending)
                status_weights = {"delivered": 4, "shipped": 3, "out_for_delivery": 2, "pending": 1}
                orders.sort(key=lambda o: (status_weights.get(o.status, 0), o.updated_at or datetime.min), reverse=True)
                
                # Keep the best one
                best_order = orders[0]
                
                # Merge product names from others if missing
                for dup in orders[1:]:
                    if dup.product_name and dup.product_name not in (best_order.product_name or ""):
                        if best_order.product_name:
                            if len(best_order.product_name) < 150:
                                best_order.product_name += " + " + dup.product_name
                        else:
                            best_order.product_name = dup.product_name
                            
                    db.delete(dup)
                    cleaned_count += 1
                    
        db.commit()
    
    return {"success": True, "cleaned_count": cleaned_count}


# ─── Chat Assistant API ──────────────────────────────────────

@app.post("/api/chat")
async def chat_assistant(req: ChatRequest):
    """المساعد الذكي للدردشة"""
    import os
    gemini_key = os.getenv("GEMINI_API_KEY")
    if not gemini_key:
        raise HTTPException(status_code=500, detail="Gemini API Key is missing")

    # جلب السياق لإعطائه للمساعد الذكي
    with SessionLocal() as db:
        orders = db.query(Order).order_by(Order.order_date.desc()).limit(30).all()
        
        # إحصائيات عامة
        total_spent = sum((o.purchase_price or 0.0) for o in db.query(Order).all())
        total_orders = db.query(Order).count()

        # معلومات صحة الحسابات
        accounts = db.query(EmailAccount).all()
        accounts_health_summary = []
        now = datetime.utcnow()
        for a in accounts:
            h = getattr(a, "health_status", "unknown") or "unknown"
            failures = getattr(a, "consecutive_failures", 0) or 0
            last_order = db.query(Order).filter_by(account_id=a.id).order_by(Order.order_date.desc()).first()
            days_since = None
            if last_order and last_order.order_date:
                days_since = (now - last_order.order_date).days
            err_info = f" | خطأ: {a.last_error[:80]}" if a.last_error else ""
            accounts_health_summary.append(
                f"- {a.email} | الحالة: {h} | فشل متتالي: {failures} | "
                f"آخر طلب: {'%d يوم' % days_since if days_since is not None else 'لا يوجد'}{err_info}"
            )

        orders_summary = [
            f"- {o.product_name} | {o.status} | السعر: {o.purchase_price} | رقم أمازون: {o.amazon_order_id}"
            for o in orders
        ]
            
    system_prompt = f"""أنت "الوكيل الذكي" (Smart Agent) لتطبيق تتبع طلبات أمازون. لديك صلاحيات عالية للتحليل المنطقي (Rational Agent)، قراءة بيانات المحفظة، التنبؤ، وتلخيص البيانات.
أجب باللغة العربية بأسلوب احترافي، مباشر، وداعم.

**معلومات عن النظام الحالي ومحفظة المستخدم:**
- إجمالي الطلبات: {total_orders}
- إجمالي المصروفات: {round(total_spent, 2)} ر.س

**حالة حسابات الإيميل المربوطة:**
{chr(10).join(accounts_health_summary)}

**أحدث 30 طلب (تاريخ الشراء):**
{chr(10).join(orders_summary)}

**توجيهات الوكيل الذكي (المهام المطلوبة منك):**
1. **تحليل النفقات الذكي:** إذا سألك المستخدم عن نفقاته، قم بتصنيف الطلبات السابقة (مثلاً: إلكترونيات، كتب، ألعاب، منزل) بناءً على أسمائها، وأخبره إذا كان يصرف الكثير على فئة معينة بطريقة لبقة ومفيدة.
2. **التنبؤ بمواعيد التوصيل:** إذا سألك المستخدم عن موعد وصول طلب (قيد الانتظار أو الشحن)، قم بتحليل تاريخ الطلبات السابقة المشابهة لتخمن "متوسط أيام التوصيل"، وأعطه تاريخاً متوقعاً (مثلاً: "بناءً على طلباتك السابقة المماثلة، عادةً ما يستغرق الشحن 5 إلى 7 أيام، لذا يتوقع وصوله يوم...").
3. **الدقة:** لا تخترع معلومات، إذا لم تكن البيانات كافية للتنبؤ، قل ذلك بوضوح.
4. **تنبيهات الحسابات:** إذا لاحظت أن هناك حساباً فاشلاً (health_status = error/revoked)، نبّه المستخدم فوراً لإعادة ربطه.
"""

    contents = []
    # إدراج السياق كرسالة نظام (أو تعليمات للمستخدم الأول)
    contents.append({"role": "user", "parts": [{"text": system_prompt}]})
    contents.append({"role": "model", "parts": [{"text": "مرحباً، فهمت السياق وسأكون مساعدك الاحترافي."}]})
    
    # إدراج تاريخ المحادثة إذا وجد
    if req.history:
        for msg in req.history:
            role = "user" if msg.get("role") == "user" else "model"
            contents.append({"role": role, "parts": [{"text": msg.get("text", "")}]})
            
    # إدراج رسالة المستخدم الحالية
    contents.append({"role": "user", "parts": [{"text": req.message}]})

    payload = {
        "contents": contents,
        "generationConfig": {"temperature": 0.4}
    }

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_key}"
    headers = {"Content-Type": "application/json"}
    
    try:
        req_obj = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
        with urllib.request.urlopen(req_obj, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            text_response = data["candidates"][0]["content"]["parts"][0]["text"].strip()
            return {"reply": text_response}
    except Exception as e:
        logger.error(f"Chat API Error: {e}")
        raise HTTPException(status_code=500, detail="فشل الاتصال بالذكاء الاصطناعي")

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

        # Gamification Logic
        gamification_title = "متسوق حكيم 🦉"
        if total_cost > 10000:
            gamification_title = "الحوت 🐋"
        elif total_cost > 5000:
            gamification_title = "متسوق ذهبي 🏆"
        elif total_orders > 50:
            gamification_title = "مدمن تسوق 🛒"
        elif total_orders > 10:
            gamification_title = "صائد صفقات 🎯"

        return {
            "total_orders": total_orders,
            "total_cost": round(total_cost, 2),
            "total_revenue": round(total_revenue, 2),
            "total_profit": round(total_profit, 2),
            "by_status": by_status,
            "by_email": by_email,
            "recent_days": [{"day": str(r.day), "count": r.count} for r in recent],
            "gamification_title": gamification_title,
        }


# ─── Accounts Summary API ─────────────────────────────────

@app.get("/api/accounts/summary")
async def get_accounts_summary():
    with SessionLocal() as db:
        # 1. Gmail Accounts
        gmail_accounts = db.query(EmailAccount).all()
        gmail_data = []
        for a in gmail_accounts:
            gmail_data.append({
                "id": a.id,
                "email": a.email,
                "is_active": a.is_active,
                "health_status": getattr(a, "health_status", "unknown"),
                "last_error": a.last_error,
                "last_synced": a.last_synced,
            })
            
        # 2. Amazon Sub-Accounts (grouped by to_email)
        from sqlalchemy import func
        sub_accounts = db.query(
            Order.to_email,
            func.count(Order.id).label("total_orders"),
            func.max(Order.order_date).label("last_order_date"),
            func.sum(Order.purchase_price).label("total_spent")
        ).filter(Order.to_email != None).group_by(Order.to_email).all()
        
        amazon_data = []
        now = datetime.utcnow()
        for row in sub_accounts:
            # Check if active (e.g. last order within 30 days)
            is_active = False
            days_since = -1
            if row.last_order_date:
                days_since = (now - row.last_order_date).days
                if days_since < 45:
                    is_active = True
            
            amazon_data.append({
                "to_email": row.to_email,
                "total_orders": row.total_orders,
                "total_spent": round(row.total_spent or 0.0, 2),
                "last_order_date": row.last_order_date,
                "days_since_last_order": days_since,
                "is_active": is_active,
            })
            
        # Sort Amazon accounts by recent activity
        amazon_data.sort(key=lambda x: x["last_order_date"] or datetime.min, reverse=True)

        return {
            "gmail_accounts": gmail_data,
            "amazon_accounts": amazon_data
        }
@app.get("/api/sync/status")
async def get_sync_status():
    """معاينة حالة المزامنة والنسبة المئوية اللحظية"""
    global sync_state
    return {
        "is_syncing": sync_state.get("is_syncing", False),
        "percent": sync_state.get("percent", 0),
        "current_subject": sync_state.get("current_subject", ""),
        "total_emails": sync_state.get("total_emails", 0),
        "processed_emails": sync_state.get("processed_emails", 0),
        "started_at": sync_state.get("started_at"),
        "last_sync": sync_state.get("last_sync"),
        "new_orders": sync_state.get("new_orders", 0),
    }


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
                # لا يوجد token — تحديث الحالة
                with SessionLocal() as db:
                    a = db.query(EmailAccount).filter_by(id=acc["id"]).first()
                    if a:
                        a.health_status = "revoked"
                        a.last_error = "لا يوجد token مصادقة — أعد ربط الحساب"
                        a.health_checked_at = datetime.utcnow()
                        db.commit()
                continue
            try:
                new_count = await sync_account(acc, use_ai_forced=use_ai_forced)
                total_new += new_count
                with SessionLocal() as db:
                    a = db.query(EmailAccount).filter_by(id=acc["id"]).first()
                    if a:
                        a.status = "active"
                        a.last_error = None
                        a.consecutive_failures = 0
                        a.health_status = "healthy"
                        a.health_checked_at = datetime.utcnow()
                        # تحديث last_order_at
                        last_ord = db.query(Order).filter_by(account_id=a.id).order_by(Order.order_date.desc()).first()
                        if last_ord and last_ord.order_date:
                            a.last_order_at = last_ord.order_date
                        db.commit()
            except Exception as e:
                logger.error(f"Error syncing {acc['email']}: {e}")
                with SessionLocal() as db:
                    a = db.query(EmailAccount).filter_by(id=acc["id"]).first()
                    if a:
                        failures = (getattr(a, "consecutive_failures", 0) or 0) + 1
                        a.consecutive_failures = failures
                        a.last_error = str(e)[:300]
                        a.health_checked_at = datetime.utcnow()
                        err_str = str(e).lower()
                        if "invalid_grant" in err_str or "revoked" in err_str or "unauthorized" in err_str:
                            a.status = "auth_error"
                            a.health_status = "revoked"
                        elif failures >= 3:
                            a.health_status = "error"
                        else:
                            a.health_status = "warning"
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

                # Ensure one unique record per order ID
                existing_item = db.query(Order).filter_by(amazon_order_id=order_id, account_id=acc["id"]).first()

                if existing_item:
                    # تحديث القطعة الموجودة لعدم تكرارها
                    status_changed = False
                    # Only upgrade status, or change if not pending
                    if parsed_status != existing_item.status and parsed_status != "pending":
                        old_status = existing_item.status
                        existing_item.status = parsed_status
                        status_changed = True
                        db.add(OrderStatusHistory(
                            order_id=existing_item.id,
                            status=parsed_status,
                            source="email"
                        ))
                    
                    if parsed_notes:
                        existing_item.notes = parsed_notes
                    if parsed.get("tracking_number"):
                        existing_item.tracking_number = parsed.get("tracking_number")
                    if parsed.get("carrier"):
                        existing_item.carrier = parsed.get("carrier")
                    if parsed.get("tracking_url"):
                        existing_item.tracking_url = parsed.get("tracking_url")
                    if parsed.get("estimated_delivery"):
                        existing_item.estimated_delivery = parsed.get("estimated_delivery")
                    if parsed.get("purchase_price") is not None:
                        existing_item.purchase_price = parsed.get("purchase_price")
                    if parsed.get("product_image") and not existing_item.product_image:
                        existing_item.product_image = parsed.get("product_image")
                    
                    # Merge product names if a new product is detected for the same order
                    if parsed_product_name:
                        current_name = existing_item.product_name or ""
                        if parsed_product_name.lower().strip() not in current_name.lower():
                            if current_name:
                                # Keep it relatively short
                                if len(current_name) < 150:
                                    existing_item.product_name = current_name + " + " + parsed_product_name
                            else:
                                existing_item.product_name = parsed_product_name

                    existing_item.updated_at = datetime.utcnow()
                    db.commit()

                    if status_changed:
                        await notify_status_change(
                            {"product_name": existing_item.product_name, "amazon_order_id": order_id},
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
                        raw_subject=parsed.get("raw_subject") or email_data.get("subject"),
                        email_snippet=parsed.get("email_snippet") or email_data.get("snippet"),
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


# ─── Gamification & Badges API ────────────────────────────

@app.get("/api/gamification/badges")
async def get_user_badges():
    """جلب شارات ونشاط الإنجازات"""
    with SessionLocal() as db:
        evaluate_user_badges(db)
        badges = db.query(UserBadge).all()
        return [
            {
                "id": b.id,
                "badge_key": b.badge_key,
                "title": b.title,
                "description": b.description,
                "icon_svg": b.icon_svg,
                "unlocked": b.unlocked,
                "unlocked_at": b.unlocked_at.isoformat() if b.unlocked_at else None,
                "progress": b.progress,
            }
            for b in badges
        ]


# ─── Helpers ──────────────────────────────────────────────

def serialize_order(order: Order, include_history: bool = False) -> dict:
    cat = order.category or categorize_product(order.product_name)
    
    # Calculate Rational Agent Delay prediction
    is_delayed, delay_reason = predict_delay({
        "status": order.status,
        "order_date": order.order_date,
        "carrier": order.carrier
    }, [])

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
        "category": cat,
        "predicted_delay": is_delayed or getattr(order, "predicted_delay", False),
        "predicted_delay_reason": delay_reason or getattr(order, "predicted_delay_reason", None),
        "lowest_price_seen": getattr(order, "lowest_price_seen", None),
        "raw_subject": getattr(order, "raw_subject", None),
        "email_snippet": getattr(order, "email_snippet", None),
        "email_message_id": getattr(order, "email_message_id", None),
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
