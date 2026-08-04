"""
Amazon Email Parser — استخراج بيانات الطلبات من رسائل أمازون
يدعم: السعودية، الإمارات، US، UK
"""
import re
import logging
from datetime import datetime
from email.utils import parseaddr
from typing import Optional, Dict

logger = logging.getLogger(__name__)


# ─── أنماط استخراج البيانات ──────────────────────────────────────

ORDER_ID_PATTERNS = [
    r"(?:Order|Bestellung|طلب|رقم الطلب)[^\d]*?(\d{3}-\d{7}-\d{7})",
    r"(\d{3}-\d{7}-\d{7})",
]

PRICE_PATTERNS = [
    # SAR, AED
    r"(?:SAR|ر\.س|ر\.?س\.?|AED|د\.إ)\s*([\d,]+\.?\d*)",
    r"([\d,]+\.?\d*)\s*(?:SAR|ر\.س|AED)",
    # USD
    r"\$\s*([\d,]+\.?\d*)",
    # GBP
    r"£\s*([\d,]+\.?\d*)",
]

PRODUCT_NAME_PATTERNS = [
    r"(?:Item|المنتج|Product|الصنف)[:\s]+([^\n]{5,150})",
]

STATUS_KEYWORDS = {
    "shipped": ["shipped", "تم الشحن", "dispatched", "on its way", "في الطريق", "has shipped"],
    "delivered": ["delivered", "تم التوصيل", "تم التسليم", "out for delivery", "package delivered"],
    "cancelled": ["cancelled", "canceled", "مُلغى", "تم الإلغاء", "order cancelled"],
    "returned": ["returned", "مُعاد", "return", "refund"],
    "pending": ["order placed", "تم تقديم الطلب", "order confirmed", "تأكيد الطلب", "thank you for your order"],
}

SUBJECT_STATUS_MAP = {
    "shipped": ["shipped", "dispatched", "on its way"],
    "delivered": ["delivered", "out for delivery"],
    "cancelled": ["cancelled", "canceled"],
    "returned": ["return", "refund"],
    "pending": ["order", "confirmation", "placed", "confirm"],
}


def parse_order_email(email_data: Dict) -> Optional[Dict]:
    """
    الدالة الرئيسية لتحليل رسالة أمازون واستخراج بيانات الطلب
    """
    subject = email_data.get("subject", "")
    body = email_data.get("body", "")
    snippet = email_data.get("snippet", "")
    to_addr = email_data.get("to", "")
    date_str = email_data.get("date", "")

    full_text = f"{subject}\n{snippet}\n{body}"

    # استخراج رقم الطلب
    order_id = extract_order_id(full_text)
    if not order_id:
        logger.debug(f"No order ID found in email: {subject[:60]}")
        return None

    # استخراج حالة الطلب
    status = detect_status(subject, body)

    # استخراج السعر
    price = extract_price(full_text)

    # استخراج اسم المنتج
    product_name = extract_product_name(subject, body, snippet)

    # استخراج الإيميل الدقيق (مع التفرع +)
    exact_email = extract_exact_email(to_addr)

    # تحليل التاريخ
    order_date = parse_date(date_str)

    return {
        "amazon_order_id": order_id,
        "product_name": product_name,
        "purchase_price": price,
        "status": status,
        "to_email": exact_email,
        "order_date": order_date,
        "raw_subject": subject,
    }


def extract_order_id(text: str) -> Optional[str]:
    """استخراج رقم طلب أمازون من النص"""
    for pattern in ORDER_ID_PATTERNS:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return None


def extract_price(text: str) -> Optional[float]:
    """استخراج السعر من النص"""
    for pattern in PRICE_PATTERNS:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            price_str = match.group(1).replace(",", "")
            try:
                return float(price_str)
            except ValueError:
                continue
    return None


def extract_product_name(subject: str, body: str, snippet: str) -> Optional[str]:
    """محاولة استخراج اسم المنتج"""
    # من الموضوع أولاً
    for pattern in PRODUCT_NAME_PATTERNS:
        match = re.search(pattern, body, re.IGNORECASE | re.MULTILINE)
        if match:
            name = match.group(1).strip()
            if len(name) > 3:
                return name[:300]

    # من الـ snippet
    if snippet and len(snippet) > 10:
        cleaned = re.sub(r"Your order|طلبك|has shipped|تم شحن", "", snippet, flags=re.IGNORECASE).strip()
        if cleaned and len(cleaned) > 5:
            return cleaned[:200]

    # من عنوان الموضوع
    clean_subject = re.sub(
        r"(?:Amazon|order|طلب|shipped|confirmed|delivered|your|رقم|#|:|-)",
        "", subject, flags=re.IGNORECASE
    ).strip()
    if clean_subject and len(clean_subject) > 3:
        return clean_subject[:200]

    return None


def detect_status(subject: str, body: str) -> str:
    """كشف حالة الطلب من موضوع وجسم الرسالة"""
    combined = f"{subject.lower()} {body[:500].lower()}"

    for status, keywords in STATUS_KEYWORDS.items():
        for kw in keywords:
            if kw.lower() in combined:
                return status

    return "pending"


def extract_exact_email(to_field: str) -> Optional[str]:
    """
    استخراج الإيميل الدقيق من حقل "To"
    يحافظ على التفرع + إن وُجد
    مثال: "Ahmed <me+amazon@gmail.com>" → "me+amazon@gmail.com"
    """
    if not to_field:
        return None

    # parseaddr يستخرج الجزء الإيميل من "Name <email>"
    _, email_part = parseaddr(to_field)

    if email_part and "@" in email_part:
        return email_part.lower().strip()

    # fallback: regex
    match = re.search(r"[\w.+\-]+@[\w.\-]+\.\w+", to_field)
    if match:
        return match.group(0).lower().strip()

    return to_field.strip()


def parse_date(date_str: str) -> Optional[datetime]:
    """تحليل تاريخ الرسالة"""
    from email.utils import parsedate_to_datetime
    try:
        return parsedate_to_datetime(date_str).replace(tzinfo=None)
    except Exception:
        return datetime.utcnow()


def detect_currency(text: str) -> str:
    """كشف العملة"""
    if re.search(r"SAR|ر\.س", text, re.IGNORECASE):
        return "SAR"
    if re.search(r"AED|د\.إ", text, re.IGNORECASE):
        return "AED"
    if re.search(r"\$|USD", text):
        return "USD"
    if re.search(r"£|GBP", text):
        return "GBP"
    return "SAR"
