"""
Telegram Notifications — إشعارات تيليجرام للطلبات الجديدة
"""
import os
import logging
import aiohttp

logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")


async def send_telegram(text: str):
    """إرسال رسالة عبر تيليجرام"""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text,
        "parse_mode": "Markdown",
        "disable_web_page_preview": True,
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload) as resp:
                if resp.status != 200:
                    logger.error(f"Telegram error: {await resp.text()}")
    except Exception as e:
        logger.error(f"Telegram send error: {e}")


async def notify_new_order(order_data: dict):
    """إشعار بطلب جديد"""
    product = order_data.get("product_name") or "منتج جديد"
    price = order_data.get("purchase_price")
    email = order_data.get("to_email") or "—"
    order_id = order_data.get("amazon_order_id") or "—"
    status = {
        "pending": "⏳ قيد الانتظار",
        "shipped": "🚚 تم الشحن",
        "delivered": "✅ تم التوصيل",
        "cancelled": "❌ مُلغى",
        "returned": "↩️ مُعاد",
    }.get(order_data.get("status", "pending"), "⏳ قيد الانتظار")

    price_str = f"{price:,.2f}" if price else "غير محدد"

    msg = (
        f"📦 *طلب جديد مُكتشَف!*\n\n"
        f"🛍 *{product[:100]}*\n\n"
        f"━━━━━━━━━━━━\n"
        f"📧 الإيميل: `{email}`\n"
        f"🔢 رقم الطلب: `{order_id}`\n"
        f"💰 السعر: *{price_str} ر.س*\n"
        f"📌 الحالة: {status}\n"
    )

    await send_telegram(msg)


async def notify_status_change(order_data: dict, old_status: str, new_status: str):
    """إشعار بتغيّر حالة طلب"""
    status_labels = {
        "pending": "⏳ قيد الانتظار",
        "shipped": "🚚 تم الشحن",
        "delivered": "✅ تم التوصيل",
        "cancelled": "❌ مُلغى",
        "returned": "↩️ مُعاد",
    }

    product = order_data.get("product_name") or "منتج"
    order_id = order_data.get("amazon_order_id") or "—"

    msg = (
        f"🔄 *تحديث حالة طلب*\n\n"
        f"📦 {product[:80]}\n"
        f"🔢 `{order_id}`\n\n"
        f"{status_labels.get(old_status, old_status)} ← {status_labels.get(new_status, new_status)}"
    )

    await send_telegram(msg)
