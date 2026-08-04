# 📱 Amazon Order Tracker — React Native Mobile Application

تطبيق جوال احترافي بنظام **React Native** مرتبط مباشرة بالسيرفر السحابي `https://84.8.102.52.sslip.io`.

## 🚀 المميزات والهيكلية:
- **🏠 شاشة الرئيسية (DashboardScreen):** إحصائيات عامة، أزرار المزامنة، وشريط تقدم تفاعلي لحظي.
- **📦 شاشة الطلبات (OrdersScreen):** بحث لحظي بالاسم/رقم الطلب/الإيميل، فلترة فورية بحالة الطلب، وزر حذف مباشر.
- **📊 شاشة التحليلات (AnalyticsScreen):** تعداد المشتريات، فلترة زمنية (اليوم، 7 أيام، 30 يوماً، الشهر)، وإجمالي التكلفة ومتوسط الشراء.
- **⚙️ شاشة الإعدادات (SettingsScreen):** إعدادات السيرفر السحابي، تفويض Gmail، وعرض مواعيد المزامنة المزدوجة (30 دقيقة سريع / 4 ساعات AI).

## 🛠️ كيفية التشغيل والبناء (How to Run & Build):

### 1. تشغيل التطبيق في وضع التطوير (Development):
```bash
cd mobile_app
npm install
npx expo start
```
- يمكنك مسح كود QR باستخدام تطبيق **Expo Go** على جوالك الآيفون أو الأندرويد لفتح التطبيق فوراً!

### 2. بناء ملف APK للأندرويد (Build Android APK):
```bash
npx eas build -p android --profile preview
```
أو عبر React Native CLI:
```bash
npx expo run:android
```

---
تم التطوير والربط بنجاح مع السيرفر السحابي المباشر.
