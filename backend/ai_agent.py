"""
AI Agent & Intelligent Rational Agent Module — Amazon Order Tracker
Includes:
1. Tracking Rational Agent (Predicts shipping delays based on carrier patterns & order age)
2. Smart LLM/NER Receipt Parser (Extracts structured JSON order details)
3. Spending Auto-Categorizer (Categories: إلكترونيات، كتب، أزياء، مستلزمات منزلية، عناية وصحة، ألعاب، سوبرماركت، أخرى)
"""
import os
import json
import logging
from datetime import datetime, timedelta
import urllib.request
import urllib.parse

logger = logging.getLogger(__name__)

# Categories Mapping
CATEGORIES = {
    "إلكترونيات": ["phone", "iphone", "samsung", "charger", "cable", "laptop", "macbook", "headphone", "airpods", "watch", "tv", "camera", "شاحن", "كابل", "جوال", "هاتف", "سماعة", "كمبيوتر", "شاشة", "ساعة"],
    "كتب ومكتبة": ["book", "novel", "pen", "paper", "notebook", "كتاب", "رواية", "قلم", "دفتر", "ورق"],
    "أزياء وموضة": ["shirt", "t-shirt", "shoes", "pants", "dress", "jacket", "قميص", "حذاء", "بنطال", "فستان", "جاكيت", "ملابس"],
    "مستلزمات منزلية": ["kitchen", "coffee", "mug", "lamp", "towel", "pillow", "مطبخ", "قهوة", "كوب", "إضاءة", "وسادة", "منشفة", "منزل"],
    "عناية وصحة": ["cream", "lotion", "soap", "vitamin", "shampoo", "perfume", "كريم", "صابون", "فيتامين", "شامبو", "عطر", "عناية"],
    "ألعاب وترفيه": ["game", "ps5", "xbox", "nintendo", "toy", "puzzle", "لعبة", "العاب", "دمية"],
    "سوبرماركت وغذاء": ["food", "snack", "water", "tea", "coffee", "biscuit", "طعام", "وجبة", "ماء", "شاي", "بسكويت", "حفاضات"]
}


def categorize_product(product_name: str) -> str:
    """تصنيف المنتج تلقائياً بناءً على الكلمات المفتاحية"""
    if not product_name:
        return "أخرى"
    
    name_lower = product_name.lower()
    for cat_name, keywords in CATEGORIES.items():
        for kw in keywords:
            if kw in name_lower:
                return cat_name
    return "أخرى"


def predict_delay(order_dict: dict, recent_orders: list) -> tuple:
    """
    Rational Agent: التنبؤ بالتأخير الذكي بناءً على الشركة وتاريخ الشحن وعمر الطلب.
    Returns: (is_delayed: bool, reason: str)
    """
    status = order_dict.get("status")
    if status in ["delivered", "cancelled", "returned"]:
        return False, None

    order_date_str = order_dict.get("order_date")
    carrier = (order_dict.get("carrier") or "").lower()
    
    if not order_date_str:
        return False, None

    try:
        if isinstance(order_date_str, datetime):
            order_dt = order_date_str
        else:
            order_dt = datetime.fromisoformat(str(order_date_str).replace("Z", ""))
    except Exception:
        return False, None

    days_pending = (datetime.utcnow() - order_dt).days

    # Rational Rule 1: Pending for > 5 days without shipping
    if status == "pending" and days_pending >= 5:
        return True, f"الطلب قيد الانتظار منذ {days_pending} أيام دون تحديث شحن من أمازون"

    # Rational Rule 2: Shipped but > 7 days without delivery
    if status == "shipped" and days_pending >= 7:
        return True, f"الشحنة في الطريق منذ {days_pending} أيام وتجاوزت المتوسط المتوقع للتوصيل"

    # Rational Rule 3: Carrier specific delay heuristic
    if carrier and "aramex" in carrier and days_pending >= 6:
        return True, "تنبؤ الناقل: شركة الشحن تستغرق وقتاً أطول من المعتاد هذا الأسبوع"

    return False, None


def llm_parse_email(subject: str, snippet: str, body: str = "") -> dict:
    """
    محلل البريد الذكي باستخدام Gemini API أو الذكاء المحلي لاستخراج الكيانات (NER / LLM)
    """
    gemini_api_key = os.getenv("GEMINI_API_KEY")
    if not gemini_api_key:
        return None

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_api_key}"
    
    prompt = f"""
    أنت وكيل استخراج بيانات بريد إلكتروني من أمازون.
    استخرج البيانات التالية بتنسيق JSON فقط بدون أي نص إضافي:
    {{
       "amazon_order_id": "رقم الطلب مثال 123-4567890-1234567",
       "product_name": "اسم المنتج الرئيسي",
       "purchase_price": 0.00 (رقم فقط),
       "currency": "SAR",
       "status": "pending / shipped / delivered / cancelled",
       "tracking_number": "رقم التتبع إن وجد",
       "carrier": "اسم شركة الشحن إن وجد",
       "category": "تصنيف المنتج"
    }}

    عنوان البريد: {subject}
    ملخص البريد: {snippet}
    """

    data = {
        "contents": [{"parts": [{"text": prompt}]}]
    }

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(data).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=8) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            text_resp = res_data["candidates"][0]["content"]["parts"][0]["text"]
            # Clean JSON markdown if present
            if "```json" in text_resp:
                text_resp = text_resp.split("```json")[1].split("```")[0]
            elif "```" in text_resp:
                text_resp = text_resp.split("```")[1].split("```")[0]
            
            parsed = json.loads(text_resp.strip())
            return parsed
    except Exception as e:
        logger.warning(f"LLM parse note: {e}")
        return None
