"""
Shipping Tracker — تتبع شحنات شركات الشحن المختلفة
يستخدم 17track API (مجاني) + روابط مباشرة لشركات الشحن
"""
import os
import logging
import asyncio
import aiohttp
from typing import Optional, Dict, Tuple

logger = logging.getLogger(__name__)

TRACK17_API_KEY = os.getenv("TRACK17_API_KEY", "")  # اختياري - مجاني بحد 100 طلب/يوم

# خريطة شركات الشحن لـ 17track
CARRIER_CODES_17TRACK = {
    "Amazon":    "amazon",
    "SMSA":      "smsa",
    "Aramex":    "aramex",
    "DHL":       "dhl",
    "FedEx":     "fedex",
    "UPS":       "ups",
    "SaudiPost": "saudi-post",
    "Unknown":   "",
}

# حالات 17track → حالاتنا
STATUS_MAP_17TRACK = {
    "InfoReceived":  "pending",
    "InTransit":     "shipped",
    "OutForDelivery":"out_for_delivery",
    "Delivered":     "delivered",
    "FailedAttempt": "shipped",
    "Exception":     "shipped",
    "Expired":       "cancelled",
    "NotFound":      "pending",
}

# روابط التتبع الاحتياطية (تفتح موقع شركة الشحن مباشرة)
CARRIER_DIRECT_URLS = {
    "Amazon":    "https://www.amazon.sa/progress-tracker/package/?orderId={order_id}",
    "SMSA":      "https://www.smsaexpress.com/en/trackandtrace?tracknumbers={tracking}",
    "Aramex":    "https://www.aramex.com/sa/ar/track/results?ShipmentNumber={tracking}",
    "DHL":       "https://www.dhl.com/sa-en/home/tracking.html?tracking-id={tracking}",
    "FedEx":     "https://www.fedex.com/fedextrack/?trknbr={tracking}&trkqual=",
    "UPS":       "https://www.ups.com/track?loc=ar_SA&tracknum={tracking}",
    "SaudiPost": "https://www.sp.com.sa/ar/pages/tracking.aspx?id={tracking}",
}

CARRIER_NAMES_AR = {
    "Amazon":    "أمازون لوجستيك",
    "SMSA":      "SMSA سمسا",
    "Aramex":    "أرامكس",
    "DHL":       "DHL",
    "FedEx":     "فيدإكس",
    "UPS":       "UPS",
    "SaudiPost": "البريد السعودي",
    "Unknown":   "شركة شحن",
}


async def get_tracking_status(tracking_number: str, carrier: str, order_id: str = None) -> Dict:
    """
    جلب حالة الشحنة — يجرب 17track أولاً، ثم يرجع بالرابط المباشر
    """
    result = {
        "tracking_number": tracking_number,
        "carrier": carrier,
        "carrier_ar": CARRIER_NAMES_AR.get(carrier, carrier or ""),
        "status": None,
        "status_detail": None,
        "estimated_delivery": None,
        "last_event": None,
        "events": [],
        "tracking_url": build_tracking_url(carrier, tracking_number, order_id),
    }

    if not tracking_number:
        return result

    # محاولة 17track API إذا توفر API key
    if TRACK17_API_KEY:
        try:
            api_result = await track_via_17track(tracking_number, carrier)
            if api_result:
                result.update(api_result)
                return result
        except Exception as e:
            logger.warning(f"17track API failed: {e}")

    # محاولة SMSA API المجانية
    if carrier == "SMSA":
        try:
            smsa_result = await track_smsa(tracking_number)
            if smsa_result:
                result.update(smsa_result)
                return result
        except Exception as e:
            logger.warning(f"SMSA API failed: {e}")

    return result


async def track_via_17track(tracking_number: str, carrier: str) -> Optional[Dict]:
    """تتبع عبر 17track API"""
    carrier_code = CARRIER_CODES_17TRACK.get(carrier, "")

    url = "https://api.17track.net/track/v2.2/register"
    headers = {
        "17token": TRACK17_API_KEY,
        "Content-Type": "application/json",
    }
    payload = [{"number": tracking_number, "carrier": carrier_code or 0}]

    async with aiohttp.ClientSession() as session:
        async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            if resp.status != 200:
                return None
            data = await resp.json()

    # جلب التفاصيل
    url2 = "https://api.17track.net/track/v2.2/gettrackinfo"
    async with aiohttp.ClientSession() as session:
        async with session.post(url2, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            if resp.status != 200:
                return None
            data = await resp.json()

    try:
        track = data["data"]["accepted"][0]["track"]
        status_code = track.get("e", "NotFound")
        status = STATUS_MAP_17TRACK.get(status_code, "shipped")

        events = []
        for ev in track.get("tracking", {}).get("providers", [{}])[0].get("events", [])[:10]:
            events.append({
                "date": ev.get("time_iso", ""),
                "location": ev.get("location", ""),
                "description": ev.get("description", ""),
            })

        last_event = events[0] if events else None

        return {
            "status": status,
            "status_detail": track.get("z2", {}).get("z", ""),
            "estimated_delivery": track.get("e1", None),
            "last_event": last_event,
            "events": events,
        }
    except (KeyError, IndexError):
        return None


async def track_smsa(tracking_number: str) -> Optional[Dict]:
    """تتبع SMSA عبر API العلني"""
    url = f"https://www.smsaexpress.com/api/Tracking?trackingnumber={tracking_number}&lang=A"

    async with aiohttp.ClientSession() as session:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=8)) as resp:
            if resp.status != 200:
                return None
            try:
                data = await resp.json(content_type=None)
            except Exception:
                return None

    try:
        items = data if isinstance(data, list) else data.get("data", [])
        if not items:
            return None

        events = []
        for ev in items:
            events.append({
                "date": ev.get("ScanDate", ""),
                "location": ev.get("ScanLocation", ""),
                "description": ev.get("ScanType", ""),
            })

        last = events[0] if events else None
        desc = last["description"].lower() if last else ""

        if "delivered" in desc or "تم التسليم" in desc:
            status = "delivered"
        elif "out for delivery" in desc or "خرج للتوصيل" in desc:
            status = "out_for_delivery"
        elif events:
            status = "shipped"
        else:
            status = "pending"

        return {
            "status": status,
            "last_event": last,
            "events": events[:10],
        }
    except Exception as e:
        logger.warning(f"SMSA parse error: {e}")
        return None


def build_tracking_url(carrier: Optional[str], tracking: Optional[str], order_id: Optional[str] = None) -> Optional[str]:
    """بناء رابط التتبع المناسب"""
    template = CARRIER_DIRECT_URLS.get(carrier or "")

    if template and tracking:
        return template.format(tracking=tracking, order_id=order_id or "")

    # fallback: صفحة تتبع أمازون بالأوردر ID
    if order_id:
        return f"https://www.amazon.sa/progress-tracker/package/?orderId={order_id}"

    # fallback عام: 17track
    if tracking:
        return f"https://t.17track.net/en#nums={tracking}"

    return None


async def refresh_shipped_orders(db_session, bot=None):
    """
    تحديث حالة الطلبات التي في مرحلة الشحن
    يُستدعى من الـ scheduler كل ساعتين
    """
    from database.models import Order, OrderStatusHistory
    from datetime import datetime

    with db_session() as db:
        shipped_orders = db.query(Order).filter(
            Order.status.in_(["shipped", "out_for_delivery"])
        ).all()

        order_data = [
            {
                "id": o.id,
                "tracking_number": o.tracking_number,
                "carrier": o.carrier,
                "amazon_order_id": o.amazon_order_id,
                "user_id": o.account.user_id if hasattr(o, "account") else None,
                "product_name": o.product_name,
            }
            for o in shipped_orders
        ]

    for order in order_data:
        if not order["tracking_number"] and not order["amazon_order_id"]:
            continue
        try:
            result = await get_tracking_status(
                order["tracking_number"] or "",
                order["carrier"] or "Amazon",
                order["amazon_order_id"],
            )

            new_status = result.get("status")
            if not new_status or new_status == "shipped":
                continue

            with db_session() as db:
                o = db.query(Order).filter_by(id=order["id"]).first()
                if o and o.status != new_status:
                    old_status = o.status
                    o.status = new_status
                    if result.get("estimated_delivery"):
                        o.estimated_delivery = str(result["estimated_delivery"])
                    o.updated_at = datetime.utcnow()
                    db.add(OrderStatusHistory(
                        order_id=o.id,
                        status=new_status,
                        source="tracking"
                    ))
                    db.commit()
                    logger.info(f"Order {order['id']} status: {old_status} → {new_status}")

                    if bot and order.get("user_id"):
                        from bot.notify import notify_status_change
                        await notify_status_change(
                            {"product_name": order["product_name"], "amazon_order_id": order["amazon_order_id"]},
                            old_status, new_status
                        )
        except Exception as e:
            logger.error(f"Tracking refresh error for order {order['id']}: {e}")

    logger.info(f"✅ Tracking refresh complete for {len(order_data)} orders")
