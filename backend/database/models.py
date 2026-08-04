"""
Database Models — Amazon Order Tracker
"""
import os
from datetime import datetime
from sqlalchemy import (
    create_engine, Column, Integer, String,
    Float, DateTime, Boolean, Text, ForeignKey
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///orders.db")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL, echo=False)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


class EmailAccount(Base):
    """حسابات الإيميل المُضافة"""
    __tablename__ = "email_accounts"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False)      # الإيميل الأساسي
    display_name = Column(String(100), nullable=True)             # اسم للعرض
    access_token = Column(Text, nullable=True)                    # Google OAuth token
    refresh_token = Column(Text, nullable=True)
    token_expiry = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)
    last_synced = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    orders = relationship("Order", back_populates="account", cascade="all, delete-orphan")


class Order(Base):
    """طلب أمازون"""
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("email_accounts.id"), nullable=False)

    # بيانات الطلب (من الإيميل تلقائياً)
    amazon_order_id = Column(String(50), unique=True, nullable=True)   # رقم الطلب من أمازون
    product_name = Column(String(500), nullable=True)                   # اسم المنتج
    product_image = Column(Text, nullable=True)                         # صورة المنتج (URL)
    product_url = Column(Text, nullable=True)                           # رابط المنتج
    asin = Column(String(20), nullable=True)

    # الإيميل الدقيق (مع التفرع + إن وُجد)
    to_email = Column(String(255), nullable=True)   # الإيميل الفعلي في حقل "To" (قد يحتوي +alias)

    # الأسعار
    purchase_price = Column(Float, nullable=True)   # سعر الشراء (من أمازون)
    sale_price = Column(Float, nullable=True)        # سعر البيع (يُدخله المستخدم)
    currency = Column(String(10), default="SAR")

    # حالة الطلب
    status = Column(String(30), default="pending")
    # pending / shipped / delivered / returned / cancelled

    # بيانات إضافية
    order_date = Column(DateTime, nullable=True)     # تاريخ الطلب
    estimated_delivery = Column(String(100), nullable=True)
    tracking_number = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)              # ملاحظات يدوية

    # بيانات النظام
    email_message_id = Column(String(255), nullable=True)  # ID الرسالة في Gmail
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    account = relationship("EmailAccount", back_populates="orders")
    status_history = relationship("OrderStatusHistory", back_populates="order", cascade="all, delete-orphan")

    @property
    def profit(self):
        """حساب الربح تلقائياً"""
        if self.sale_price and self.purchase_price:
            return round(self.sale_price - self.purchase_price, 2)
        return None

    @property
    def status_ar(self):
        statuses = {
            "pending": "⏳ قيد الانتظار",
            "shipped": "🚚 تم الشحن",
            "delivered": "✅ تم التوصيل",
            "returned": "↩️ مُعاد",
            "cancelled": "❌ مُلغى",
        }
        return statuses.get(self.status, self.status)


class OrderStatusHistory(Base):
    """تاريخ تغيّر حالة الطلب"""
    __tablename__ = "order_status_history"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    status = Column(String(30), nullable=False)
    changed_at = Column(DateTime, default=datetime.utcnow)
    source = Column(String(50), default="email")   # email / manual

    order = relationship("Order", back_populates="status_history")


def init_db():
    Base.metadata.create_all(bind=engine)
