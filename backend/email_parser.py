"""
Amazon Email Parser v2 — محسّن بالكامل
يستخرج: رقم الطلب، المنتج، السعر، رقم التتبع، شركة الشحن، موعد التوصيل، الحالة، ASIN، صورة المنتج
يدعم: أمازون السعودية، الإمارات، US، UK، مصر
"""
import re
import logging
from datetime import datetime
from email.utils import parseaddr
from typing import Optional, Dict, List
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════
# أنماط الاستخراج الشاملة
# ══════════════════════════════════════════════════════════

ORDER_ID_PATTERNS = [
    r"\b(\d{3}-\d{7}-\d{7})\b",          # النمط القياسي: 408-1234567-1234567
    r"(?:order|طلب|رقم)[^\d]*(\d{3}-\d{7}-\d{7})",
    r"#\s*(\d{3}-\d{7}-\d{7})",
]

TRACKING_PATTERNS = {
    # أمازون لوجستيك
    "Amazon": [
        r"\b(TBA\d{12,15})\b",
        r"\b(AMZN\d{10,15})\b",
    ],
    # SMSA السعودية
    "SMSA": [
        r"\b(1\d{9})\b",
        r"\b(SMSA\d{8,12})\b",
        r"\b(\d{10})\b",    # 10 أرقام
    ],
    # أرامكس
    "Aramex": [
        r"\b(\d{4}[A-Z]{2}\d{10})\b",
        r"\b(11\d{14})\b",
        r"\b(JD\d{18})\b",
    ],
    # DHL
    "DHL": [
        r"\b(\d{10,11})\b",
        r"\b(JD\d{18})\b",
        r"\b([A-Z]{2}\d{9}[A-Z]{2})\b",
    ],
    # FedEx
    "FedEx": [
        r"\b(\d{12})\b",
        r"\b(\d{15})\b",
        r"\b(\d{20})\b",
    ],
    # UPS
    "UPS": [
        r"\b(1Z[A-Z0-9]{16})\b",
    ],
    # البريد السعودي
    "SaudiPost": [
        r"\b(SA\d{9}SA)\b",
        r"\b([A-Z]{2}\d{9}[A-Z]{2})\b",
    ],
}

TRACKING_LABEL_PATTERNS = [
    r"(?:tracking|تتبع|Track|رقم\s+الشحن|رقم\s+التتبع|Shipment\s+ID)[:\s#]*([A-Z0-9]{8,25})",
    r"(?:carrier|شركة\s+الشحن|الناقل)[:\s]*([A-Za-z0-9 ]+)",
]

PRICE_PATTERNS = [
    r"(?:Order Total|المجموع|Total)[:\s]*(?:SAR|ر\.?س\.?|AED|د\.إ|\$|£|EUR)?\s*([\d,]+\.?\d{0,2})",
    r"(?:SAR|ر\.س)\s*([\d,]+\.?\d{0,2})",
    r"([\d,]+\.?\d{0,2})\s*(?:SAR|ر\.س)",
    r"AED\s*([\d,]+\.?\d{0,2})",
    r"\$\s*([\d,]+\.?\d{0,2})",
    r"£\s*([\d,]+\.?\d{0,2})",
    r"(?:EGP|جنيه)\s*([\d,]+\.?\d{0,2})",
]

DELIVERY_DATE_PATTERNS = [
    r"(?:estimated delivery|arriving|وصول|سيصل|تاريخ التوصيل|delivery date)[:\s,]*([A-Za-z]+ \d{1,2},?\s*\d{4})",
    r"(?:estimated delivery|arriving|وصول|سيصل)[:\s,]*([A-Za-z]+ \d{1,2}(?:\s*-\s*[A-Za-z]+ \d{1,2})?)",
    r"(?:by|قبل|في)[:\s]*([A-Za-z]+day,\s*[A-Za-z]+ \d{1,2})",
    r"(?:届く予定|تاريخ|وصول)[^\n]*(\d{1,2}\s+[A-Za-z]+\s+\d{4})",
    r"(\d{1,2}/\d{1,2}/\d{4})",
]

PRODUCT_PATTERNS = [
    r"(?:You ordered|Your order includes|قمت بطلب)[:\s]*\n?\s*(.{10,200}?)(?:\n|Qty|الكمية)",
    r"<td[^>]*>\s*<b>([^<]{10,200})</b>\s*</td>",
    r"(?:item|product|المنتج|الصنف)[:\s]+([^\n<]{5,200})",
    r"\"product_title\"[:\s]+\"([^\"]{5,200})\"",
]

ASIN_PATTERNS = [
    r"/dp/([A-Z0-9]{10})",
    r"/gp/product/([A-Z0-9]{10})",
    r"asin[=:]([A-Z0-9]{10})",
    r"\bASIN[:\s]*([A-Z0-9]{10})\b",
]

IMAGE_PATTERNS = [
    r"https://[^\"'\s]*images-amazon\.com[^\"'\s]*\.(jpg|png|jpeg|gif)",
    r"https://[^\"'\s]*m\.media-amazon\.com[^\"'\s]*\.(jpg|png|jpeg|gif)",
    r"src=[\"'](https://[^\"']*amazon[^\"']*\.(jpg|png|jpeg))[\"']",
]

STATUS_PRIORITY = ["cancelled", "returned", "delivered", "shipped", "out_for_delivery", "pending"]

STATUS_KEYWORDS = {
    "cancelled": [
        "cancelled", "canceled", "your order has been cancelled",
        "تم إلغاء", "تم الإلغاء", "أُلغي طلبك", "order cancellation",
        "we've cancelled", "has been cancelled",
    ],
    "returned": [
        "return confirmed", "refund", "return approved",
        "تم الإرجاع", "تم الاسترداد", "تم الاسترجاع",
        "your return", "return request",
    ],
    "delivered": [
        "delivered", "package delivered", "your order has been delivered",
        "تم التوصيل", "تم التسليم", "استلمت طلبك",
        "has been delivered", "was delivered",
    ],
    "out_for_delivery": [
        "out for delivery", "will be delivered today",
        "في طريقه إليك", "سيتم التوصيل اليوم",
        "arriving today", "delivery today",
    ],
    "shipped": [
        "shipped", "dispatched", "on its way", "has shipped",
        "تم الشحن", "في الطريق", "جاري الشحن",
        "your order is on the way", "your package is on the way",
        "your shipment",
    ],
    "pending": [
        "order placed", "order confirmed", "thank you for your order",
        "order confirmation", "order received",
        "تم تقديم الطلب", "تأكيد الطلب", "شكراً لطلبك",
        "we received your order",
    ],
}

CARRIER_TRACKING_URLS = {
    "Amazon":    "https://www.amazon.com/progress-tracker/package/?orderId={order_id}",
    "SMSA":      "https://www.smsaexpress.com/en/trackandtrace?tracknumbers={tracking}",
    "Aramex":    "https://www.aramex.com/us/en/track/results?ShipmentNumber={tracking}",
    "DHL":       "https://www.dhl.com/en/express/tracking.html?AWB={tracking}",
    "FedEx":     "https://www.fedex.com/fedextrack/?trknbr={tracking}",
    "UPS":       "https://www.ups.com/track?tracknum={tracking}",
    "SaudiPost": "https://www.sp.com.sa/ar/pages/tracking.aspx?id={tracking}",
}


# ══════════════════════════════════════════════════════════
# الدالة الرئيسية
# ══════════════════════════════════════════════════════════

# ══════════════════════════════════════════════════════════
# AI Fallback Parser (Gemini API)
# ══════════════════════════════════════════════════════════
import os
import json
import urllib.request

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")


def parse_with_ai(email_text: str) -> Optional[Dict]:
    """
    استخدام الذكاء الاصطناعي (Gemini 1.5 Flash) كطبقة احتياطية فائقة الذكاء
    يُستدعى عندما يفشل الـ Regex أو لتقديم دقة 100% في الرسائل المعقدة
    """
    if not GEMINI_API_KEY:
        return None

    prompt = f"""You are an expert email parser for Amazon order confirmation and status update emails.
Extract the items from this email and return a JSON ARRAY of objects ONLY.
Each object in the array must represent an item in the order with these keys:
- amazon_order_id: string (format like 123-4567890-1234567 or null)
- product_name: string (short clean name of the product or null)
- purchase_price: float (price of this specific item as number or null)
- currency: string (SAR, AED, USD, EGP, GBP or null)
- status: string (one of: pending, shipped, out_for_delivery, delivered, returned, cancelled)
- tracking_number: string (or null)
- carrier: string (Amazon, SMSA, Aramex, DHL, FedEx, UPS, SaudiPost or null)
- estimated_delivery: string (or null)

If there are multiple products in the email, return an array of multiple objects.
If there is one product, return an array of one object.

Email Text:
{email_text[:3000]}

Return a raw JSON array only, no markdown:"""

    models_to_try = [
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.1-flash-lite",
        "gemini-3.5-flash-lite",
    ]

    for model_name in models_to_try:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={GEMINI_API_KEY}"
        headers = {"Content-Type": "application/json"}
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.1, "responseMimeType": "application/json"}
        }

        try:
            req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                text_response = data["candidates"][0]["content"]["parts"][0]["text"].strip()
                if text_response.startswith("```"):
                    text_response = re.sub(r"^```(?:json)?\n|\n```$", "", text_response, flags=re.MULTILINE).strip()
                parsed_json = json.loads(text_response)
                
                # Ensure we always return a list
                if isinstance(parsed_json, dict):
                    parsed_json = [parsed_json]
                elif not isinstance(parsed_json, list):
                    parsed_json = []

                logger.info(f"✨ AI Parser ({model_name}) successfully processed {len(parsed_json)} items.")
                return parsed_json
        except Exception as e:
            logger.debug(f"AI Parser ({model_name}) attempt error: {e}")
            continue

    return []



def parse_order_email(email_data: Dict) -> List[Dict]:
    """
    تحليل شامل لرسالة أمازون — هجين بين الـ Regex السريع والـ AI الفائق
    """
    subject  = email_data.get("subject", "")
    body_raw = email_data.get("body", "")
    snippet  = email_data.get("snippet", "")
    to_addr  = email_data.get("to", "")
    date_str = email_data.get("date", "")

    # تنظيف HTML واستخراج النص النظيف
    body_text = strip_html(body_raw)
    full_text = f"{subject}\n{snippet}\n{body_text}"

    # رقم الطلب — إلزامي
    order_id = extract_order_id(full_text)
    if not order_id:
        logger.debug(f"No order ID: {subject[:80]}")
        return []

    # 1. محاولة الاستخراج عبر Regex الأساسي
    status = detect_status(subject, body_text, snippet)
    price    = extract_price(full_text)
    currency = detect_currency(full_text)
    product_name = extract_product_name(subject, body_raw, body_text, snippet)
    asin = extract_asin(full_text + body_raw)
    product_image = extract_product_image(body_raw)
    product_url = build_product_url(asin) if asin else None
    tracking_number, carrier = extract_tracking(full_text)
    tracking_url = build_tracking_url(carrier, tracking_number, order_id)
    estimated_delivery = extract_delivery_date(full_text)
    exact_email = extract_exact_email(to_addr)
    order_date = parse_date(date_str)

    base_item = {
        "amazon_order_id":    order_id,
        "product_name":       product_name,
        "asin":               asin,
        "product_image":      product_image,
        "product_url":        product_url,
        "purchase_price":     price,
        "currency":           currency,
        "status":             status,
        "to_email":           exact_email,
        "order_date":         order_date,
        "tracking_number":    tracking_number,
        "carrier":            carrier,
        "tracking_url":       tracking_url,
        "estimated_delivery": estimated_delivery,
        "raw_subject":        subject,
    }

    # 2. إذا نقص اسم المنتج أو السعر، أو إذا أردنا جلب عدة منتجات في طلب واحد
    if GEMINI_API_KEY and (not product_name or price is None or "item" in full_text.lower() or "cancel" in status):
        logger.info("🤖 Invoking AI Layer for multi-item / complex parsing...")
        ai_results = parse_with_ai(full_text)
        
        if ai_results and len(ai_results) > 0:
            final_items = []
            for ai_item in ai_results:
                item = base_item.copy()
                item["product_name"] = ai_item.get("product_name") or product_name
                item["purchase_price"] = ai_item.get("purchase_price") if ai_item.get("purchase_price") is not None else price
                item["currency"] = ai_item.get("currency") or currency
                item["status"] = ai_item.get("status") or status
                item["tracking_number"] = ai_item.get("tracking_number") or tracking_number
                item["carrier"] = ai_item.get("carrier") or carrier
                item["estimated_delivery"] = ai_item.get("estimated_delivery") or estimated_delivery
                
                if item["carrier"] and item["tracking_number"] and not item["tracking_url"]:
                    item["tracking_url"] = build_tracking_url(item["carrier"], item["tracking_number"], order_id)
                final_items.append(item)
            return final_items

    return [base_item]



# ══════════════════════════════════════════════════════════
# دوال الاستخراج
# ══════════════════════════════════════════════════════════

def extract_order_id(text: str) -> Optional[str]:
    for pattern in ORDER_ID_PATTERNS:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    return None


def extract_asin(text: str) -> Optional[str]:
    for pattern in ASIN_PATTERNS:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            candidate = m.group(1).upper()
            if len(candidate) == 10:
                return candidate
    return None


def extract_product_image(html_body: str) -> Optional[str]:
    """استخراج صورة المنتج من HTML الرسالة"""
    for pattern in IMAGE_PATTERNS:
        m = re.search(pattern, html_body, re.IGNORECASE)
        if m:
            img_url = m.group(0) if pattern.startswith("https") else m.group(1)
            img_url = re.sub(r'src=["\']', '', img_url).strip("\"'")
            # تحقق أن الرابط لصورة منتج فعلية وليس أيقونة أمازون
            if "images-amazon.com" in img_url or "m.media-amazon.com" in img_url:
                # تنظيف معاملات الحجم
                img_url = re.sub(r'\._[A-Z0-9_]+_\.', '.', img_url)
                return img_url
    return None


def extract_product_name(subject: str, html_body: str, body_text: str, snippet: str) -> Optional[str]:
    """استخراج اسم المنتج من مصادر متعددة"""

    # 1. من HTML (أكثر دقة)
    if html_body:
        soup = BeautifulSoup(html_body, "html.parser")

        # بحث في العناصر التي تحتوي عادةً على اسم المنتج في رسائل أمازون
        for tag in soup.find_all(["b", "strong", "span", "td", "p"]):
            text = tag.get_text(strip=True)
            if 10 < len(text) < 300 and not any(kw in text.lower() for kw in [
                "amazon", "order", "total", "thank", "click", "visit", "help", "unsubscribe"
            ]):
                # اسم المنتج عادةً يحتوي أحرف كبيرة وأرقام وعلامات تجارية
                if re.search(r'[A-Z][a-z]|\d+', text):
                    return text[:300]

    # 2. من body text
    for pattern in PRODUCT_PATTERNS:
        m = re.search(pattern, body_text, re.IGNORECASE | re.MULTILINE)
        if m:
            name = m.group(1).strip()
            if 5 < len(name) < 300:
                return name

    # 3. من الـ snippet
    if snippet and len(snippet) > 15:
        noise = r"Your order|طلبك|has shipped|تم شحن|Amazon\.com|shipped|delivered|confirmed"
        cleaned = re.sub(noise, "", snippet, flags=re.IGNORECASE).strip()
        if cleaned and len(cleaned) > 8:
            return cleaned[:200]

    return None


def extract_price(text: str) -> Optional[float]:
    """استخراج أعلى سعر منطقي (سعر الطلب الكامل)"""
    prices = []
    for pattern in PRICE_PATTERNS:
        for m in re.finditer(pattern, text, re.IGNORECASE):
            try:
                val = float(m.group(1).replace(",", ""))
                if 0.5 < val < 1_000_000:
                    prices.append(val)
            except (ValueError, IndexError):
                continue

    if not prices:
        return None

    # إعطاء الأولوية لأول سعر مرتبط بـ "Order Total" أو "المجموع"
    total_match = re.search(
        r"(?:Order Total|المجموع|Total)[:\s]*(?:SAR|ر\.?س\.?|AED|\$|£)?\s*([\d,]+\.?\d{0,2})",
        text, re.IGNORECASE
    )
    if total_match:
        try:
            return float(total_match.group(1).replace(",", ""))
        except ValueError:
            pass

    return prices[0]


def extract_tracking(text: str) -> tuple:
    """استخراج رقم التتبع وشركة الشحن"""

    # 1. البحث عن رقم التتبع بعد كلمات مفتاحية
    tracking_label = re.search(
        r"(?:tracking\s*(?:number|id|#)|رقم\s+(?:التتبع|الشحن|الطرد)|track\s+your\s+(?:package|order))[:\s#]*([A-Z0-9]{8,30})",
        text, re.IGNORECASE
    )
    if tracking_label:
        tracking = tracking_label.group(1).strip()
        carrier = detect_carrier_from_number(tracking)
        return tracking, carrier

    # 2. البحث بأنماط شركات الشحن المحددة
    for carrier_name, patterns in TRACKING_PATTERNS.items():
        # لكل شركة، نبحث فقط بعد كلمات السياق
        for pattern in patterns:
            context_pattern = r"(?:track|شحن|carrier|SMSA|DHL|Aramex|FedEx|UPS|Amazon Logistics)[^\n]{0,50}" + pattern
            m = re.search(context_pattern, text, re.IGNORECASE)
            if m:
                tracking = m.group(1).strip()
                return tracking, carrier_name

    # 3. بحث TBA لأمازون لوجستيك (الأكثر شيوعاً في السعودية)
    tba = re.search(r"\b(TBA\d{12,16})\b", text, re.IGNORECASE)
    if tba:
        return tba.group(1), "Amazon"

    return None, None


def detect_carrier_from_number(tracking: str) -> str:
    """تحديد شركة الشحن من رقم التتبع"""
    if tracking.startswith("TBA"):
        return "Amazon"
    if tracking.startswith("1Z"):
        return "UPS"
    if re.match(r"^JD\d+", tracking):
        return "DHL"
    if re.match(r"^(SA|EX)\d{9}[A-Z]{2}$", tracking):
        return "SaudiPost"
    if re.match(r"^\d{10}$", tracking):
        return "SMSA"
    if re.match(r"^\d{12}$", tracking):
        return "FedEx"
    return "Unknown"


def build_tracking_url(carrier: Optional[str], tracking: Optional[str], order_id: Optional[str]) -> Optional[str]:
    """بناء رابط التتبع الخاص بشركة الشحن"""
    if not carrier and not tracking:
        # إذا لم نجد رقم تتبع — استخدم رابط تتبع أمازون بالأوردر ID
        if order_id:
            return f"https://www.amazon.sa/progress-tracker/package/?orderId={order_id}"
        return None

    template = CARRIER_TRACKING_URLS.get(carrier or "")
    if template and tracking:
        return template.format(tracking=tracking, order_id=order_id or "")

    if order_id:
        return f"https://www.amazon.sa/progress-tracker/package/?orderId={order_id}"
    return None


def extract_delivery_date(text: str) -> Optional[str]:
    """استخراج موعد التوصيل المتوقع"""
    for pattern in DELIVERY_DATE_PATTERNS:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            date_str = m.group(1).strip()
            if len(date_str) > 3:
                return date_str
    return None


def detect_status(subject: str, body: str, snippet: str = "") -> str:
    """كشف حالة الطلب بالأولوية الصحيحة"""
    combined = f"{subject} {snippet} {body[:2000]}".lower()

    for status in STATUS_PRIORITY:
        keywords = STATUS_KEYWORDS.get(status, [])
        for kw in keywords:
            if kw.lower() in combined:
                return status

    return "pending"


def extract_exact_email(to_field: str) -> Optional[str]:
    """استخراج الإيميل الدقيق مع الحفاظ على +alias"""
    if not to_field:
        return None

    for addr in to_field.split(","):
        _, email_part = parseaddr(addr.strip())
        if email_part and "@" in email_part:
            return email_part.lower().strip()

    m = re.search(r"[\w.+\-]+@[\w.\-]+\.\w+", to_field)
    if m:
        return m.group(0).lower().strip()

    return None


def parse_date(date_str: str) -> Optional[datetime]:
    from email.utils import parsedate_to_datetime
    try:
        return parsedate_to_datetime(date_str).replace(tzinfo=None)
    except Exception:
        return datetime.utcnow()


def detect_currency(text: str) -> str:
    if re.search(r"\bSAR\b|ر\.?س", text, re.IGNORECASE):
        return "SAR"
    if re.search(r"\bAED\b|د\.إ", text, re.IGNORECASE):
        return "AED"
    if re.search(r"\bEGP\b|جنيه", text, re.IGNORECASE):
        return "EGP"
    if re.search(r"£|\bGBP\b", text):
        return "GBP"
    if re.search(r"\$|\bUSD\b", text):
        return "USD"
    return "SAR"


def build_product_url(asin: str) -> str:
    return f"https://www.amazon.sa/dp/{asin}"


def strip_html(html: str) -> str:
    """تنظيف HTML وإرجاع نص واضح"""
    if not html:
        return ""
    try:
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "head", "meta", "link"]):
            tag.decompose()
        return soup.get_text(separator="\n", strip=True)
    except Exception:
        return re.sub(r"<[^>]+>", " ", html)
