"""
Price Drop Monitor & Gamification Badge Evaluator Module
"""
import logging
from datetime import datetime, timedelta
from database.models import SessionLocal, Order, UserBadge

logger = logging.getLogger(__name__)

# Initial Gamification Badges List
DEFAULT_BADGES = [
    {
        "badge_key": "first_step",
        "title": "بداية الرحلة 🚀",
        "description": "تم ربط أول حساب بريد إلكتروني وتتبع أول طلب بنجاح",
        "icon_svg": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>'
    },
    {
        "badge_key": "saver_king",
        "title": "صائد التوفير 💰",
        "description": "حققت أرباحاً أو توفيراً أكثر من 100 ريال عبر تتبع المبيعات والأسعار",
        "icon_svg": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><line x1="12" y1="6" x2="12" y2="18"/></svg>'
    },
    {
        "badge_key": "delivery_master",
        "title": "سيد التوصيل 📦",
        "description": "استلمت أكثر من 5 شحنات بنجاح ودون أي تأخير",
        "icon_svg": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>'
    },
    {
        "badge_key": "smart_analyst",
        "title": "المحلل الذكي 🤖",
        "description": "استخدمت التدقيق بالذكاء الاصطناعي لفحص جميع طلبياتك",
        "icon_svg": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
    }
]


def init_badges(db):
    """إضافة الشارات الأولية إن لم تكن موجودة"""
    try:
        for badge_data in DEFAULT_BADGES:
            existing = db.query(UserBadge).filter(UserBadge.badge_key == badge_data["badge_key"]).first()
            if not existing:
                b = UserBadge(
                    badge_key=badge_data["badge_key"],
                    title=badge_data["title"],
                    description=badge_data["description"],
                    icon_svg=badge_data["icon_svg"],
                    unlocked=False,
                    progress=0
                )
                db.add(b)
        db.commit()
    except Exception as e:
        logger.warning(f"Badges init note: {e}")


def evaluate_user_badges(db):
    """تحديث تقدم الشارات وفتحها بناءً على إحصائيات المستخدم"""
    init_badges(db)
    try:
        total_orders = db.query(Order).count()
        delivered_orders = db.query(Order).filter(Order.status == "delivered").count()
        
        # Calculate total profit
        orders_with_profit = db.query(Order).filter(Order.sale_price.isnot(None), Order.purchase_price.isnot(None)).all()
        total_profit = sum([o.profit for o in orders_with_profit if o.profit])

        # Badge 1: first_step
        b1 = db.query(UserBadge).filter(UserBadge.badge_key == "first_step").first()
        if b1 and not b1.unlocked:
            b1.progress = min(100, int((total_orders / 1) * 100))
            if total_orders >= 1:
                b1.unlocked = True
                b1.unlocked_at = datetime.utcnow()

        # Badge 2: saver_king
        b2 = db.query(UserBadge).filter(UserBadge.badge_key == "saver_king").first()
        if b2 and not b2.unlocked:
            b2.progress = min(100, int((total_profit / 100) * 100))
            if total_profit >= 100:
                b2.unlocked = True
                b2.unlocked_at = datetime.utcnow()

        # Badge 3: delivery_master
        b3 = db.query(UserBadge).filter(UserBadge.badge_key == "delivery_master").first()
        if b3 and not b3.unlocked:
            b3.progress = min(100, int((delivered_orders / 5) * 100))
            if delivered_orders >= 5:
                b3.unlocked = True
                b3.unlocked_at = datetime.utcnow()

        db.commit()
    except Exception as e:
        logger.warning(f"Error evaluating badges: {e}")


def check_post_purchase_price_drops(db):
    """
    تتبع انخفاض الأسعار بعد الشراء:
    يفحص طلبات الشراء خلال فترة الإرجاع (30 يوماً من الشراء/التوصيل)
    ويرصد أي انخفاض في السعر لإرسال تنبيه للمستخدم لاسترداد الفرق.
    """
    alerts = []
    try:
        thirty_days_ago = datetime.utcnow() - timedelta(days=30)
        recent_orders = db.query(Order).filter(
            Order.purchase_price.isnot(None),
            Order.purchase_price > 0,
            Order.created_at >= thirty_days_ago
        ).all()

        for order in recent_orders:
            # إذا كان قد سُجل له سعر أقل سابقاً
            if order.lowest_price_seen and order.lowest_price_seen < order.purchase_price:
                diff = round(order.purchase_price - order.lowest_price_seen, 2)
                alerts.append({
                    "order_id": order.id,
                    "amazon_order_id": order.amazon_order_id,
                    "product_name": order.product_name,
                    "purchase_price": order.purchase_price,
                    "lowest_price_seen": order.lowest_price_seen,
                    "savings_opportunity": diff,
                    "currency": order.currency or "SAR"
                })
    except Exception as e:
        logger.warning(f"Price drop check note: {e}")

    return alerts

