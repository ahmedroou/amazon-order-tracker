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
    scheduler.add_job(sync_all_accounts, "interval", minutes=interval, id="sync_emails")
    scheduler.add_job(
        refresh_shipped_orders,
        "interval",
        hours=2,
        id="refresh_tracking",
        args=[SessionLocal],
    )
    scheduler.start()
    logger.info(f"⏰ Scheduler started: every {interval} minutes")


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


@app.post("/api/sync")
async def sync_now():
    """مزامنة فورية لكل الحسابات"""
    total = await sync_all_accounts()
    return {"success": True, "new_orders_found": total}


# ─── Core Sync Logic ──────────────────────────────────────

async def sync_all_accounts() -> int:
    """الدالة الرئيسية لفحص كل الحسابات المربوطة"""
    logger.info("🔄 Starting email sync for all accounts...")
    total_new = 0

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
            new_count = await sync_account(acc)
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

    logger.info(f"✅ Sync complete. New orders: {total_new}")
    return total_new



async def sync_account(acc: dict) -> int:
    """فحص حساب إيميل واحد"""
    after_ts = None
    if acc["last_synced"]:
        after_ts = int(acc["last_synced"].timestamp())

    emails, updated_tokens = fetch_amazon_emails(
        access_token=acc["access_token"],
        refresh_token=acc["refresh_token"],
        expiry=acc["token_expiry"],
        after_timestamp=after_ts,
    )

    new_count = 0

    with SessionLocal() as db:
        for email_data in emails:
            parsed = parse_order_email(email_data)
            if not parsed or not parsed.get("amazon_order_id"):
                continue

            order_id = parsed["amazon_order_id"]
            existing = db.query(Order).filter_by(amazon_order_id=order_id).first()

            if existing:
                # تحديث الحالة إذا تغيرت
                new_status = parsed.get("status", "pending")
                if new_status != existing.status and new_status != "pending":
                    old_status = existing.status
                    existing.status = new_status
                    existing.updated_at = datetime.utcnow()
                    db.add(OrderStatusHistory(
                        order_id=existing.id,
                        status=new_status,
                        source="email"
                    ))
                    db.commit()
                    await notify_status_change(
                        {"product_name": existing.product_name, "amazon_order_id": order_id},
                        old_status, new_status
                    )
            else:
                # طلب جديد — حفظ كل البيانات المستخرجة
                order = Order(
                    account_id=acc["id"],
                    amazon_order_id=order_id,
                    product_name=parsed.get("product_name"),
                    asin=parsed.get("asin"),
                    product_image=parsed.get("product_image"),
                    product_url=parsed.get("product_url"),
                    purchase_price=parsed.get("purchase_price"),
                    to_email=parsed.get("to_email") or acc["email"],
                    status=parsed.get("status", "pending"),
                    order_date=parsed.get("order_date") or datetime.utcnow(),
                    currency=parsed.get("currency") or detect_currency(email_data.get("body", "")),
                    tracking_number=parsed.get("tracking_number"),
                    carrier=parsed.get("carrier"),
                    tracking_url=parsed.get("tracking_url"),
                    estimated_delivery=parsed.get("estimated_delivery"),
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
