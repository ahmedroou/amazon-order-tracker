"""
Gmail OAuth Client — ربط Gmail API وجلب الإيميلات
"""
import os
import base64
import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict
from email import message_from_bytes

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
REDIRECT_URI = os.getenv("REDIRECT_URI", "http://localhost:8000/auth/callback")


def get_oauth_flow() -> Flow:
    """إنشاء OAuth flow للتفويض"""
    client_config = {
        "web": {
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uris": [REDIRECT_URI],
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    }
    flow = Flow.from_client_config(client_config, scopes=SCOPES)
    flow.redirect_uri = REDIRECT_URI
    return flow


def get_auth_url() -> str:
    """الحصول على رابط تفويض Google"""
    flow = get_oauth_flow()
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent"
    )
    return auth_url


def exchange_code_for_tokens(code: str) -> Dict:
    """تبادل الكود بـ tokens"""
    flow = get_oauth_flow()
    flow.fetch_token(code=code)
    creds = flow.credentials
    return {
        "access_token": creds.token,
        "refresh_token": creds.refresh_token,
        "expiry": creds.expiry,
        "email": get_user_email(creds),
    }


def get_user_email(creds: Credentials) -> str:
    """جلب إيميل المستخدم المرتبط"""
    try:
        service = build("gmail", "v1", credentials=creds)
        profile = service.users().getProfile(userId="me").execute()
        return profile.get("emailAddress", "")
    except Exception as e:
        logger.error(f"Error getting user email: {e}")
        return ""


def build_credentials(access_token: str, refresh_token: str, expiry: Optional[datetime]) -> Credentials:
    """بناء credentials من قاعدة البيانات"""
    creds = Credentials(
        token=access_token,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        scopes=SCOPES,
    )
    if expiry:
        creds.expiry = expiry
    return creds


def refresh_if_needed(creds: Credentials) -> Credentials:
    """تجديد التوكن إذا انتهت صلاحيته"""
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
    return creds


def fetch_amazon_emails(access_token: str, refresh_token: str, expiry: Optional[datetime], after_timestamp: Optional[int] = None) -> List[Dict]:
    """
    جلب رسائل أمازون من Gmail
    يبحث في الرسائل الواردة من نطاقات أمازون الرسمية
    """
    creds = build_credentials(access_token, refresh_token, expiry)
    creds = refresh_if_needed(creds)

    try:
        service = build("gmail", "v1", credentials=creds)

        # بناء الفلتر: رسائل من أمازون فقط
        query_parts = [
            "from:(ship-confirm@amazon.com OR order-update@amazon.com OR auto-confirm@amazon.com OR shipment-tracking@amazon.com OR no-reply@amazon.com OR marketplace@amazon.com)"
        ]
        if after_timestamp:
            query_parts.append(f"after:{after_timestamp}")

        query = " ".join(query_parts)
        logger.info(f"Gmail query: {query}")

        results = service.users().messages().list(
            userId="me",
            q=query,
            maxResults=50
        ).execute()

        messages = results.get("messages", [])
        parsed_emails = []

        for msg_ref in messages:
            try:
                msg = service.users().messages().get(
                    userId="me",
                    id=msg_ref["id"],
                    format="full"
                ).execute()

                parsed = parse_gmail_message(msg)
                if parsed:
                    parsed["gmail_message_id"] = msg_ref["id"]
                    parsed_emails.append(parsed)
            except Exception as e:
                logger.error(f"Error fetching message {msg_ref['id']}: {e}")

        # تحديث التوكن في حالة تجديده
        return parsed_emails, {
            "access_token": creds.token,
            "expiry": creds.expiry
        }

    except HttpError as e:
        logger.error(f"Gmail API error: {e}")
        return [], {}


def parse_gmail_message(msg: Dict) -> Optional[Dict]:
    """استخراج المعلومات الأساسية من رسالة Gmail"""
    headers = {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}

    subject = headers.get("subject", "")
    from_addr = headers.get("from", "")
    to_addr = headers.get("to", "")
    date_str = headers.get("date", "")

    # استخراج نص الرسالة
    body = extract_body(msg.get("payload", {}))

    return {
        "subject": subject,
        "from": from_addr,
        "to": to_addr,          # هذا يحتوي على الإيميل الدقيق مع التفرع +
        "date": date_str,
        "body": body,
        "snippet": msg.get("snippet", ""),
    }


def extract_body(payload: Dict) -> str:
    """استخراج نص الرسالة (plain text أو HTML)"""
    body = ""

    if payload.get("body", {}).get("data"):
        data = payload["body"]["data"]
        body = base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="ignore")
        return body

    for part in payload.get("parts", []):
        mime_type = part.get("mimeType", "")
        if mime_type == "text/plain":
            data = part.get("body", {}).get("data", "")
            if data:
                body = base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="ignore")
                return body
        elif mime_type == "text/html" and not body:
            data = part.get("body", {}).get("data", "")
            if data:
                body = base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="ignore")
        elif "parts" in part:
            nested = extract_body(part)
            if nested:
                return nested

    return body
