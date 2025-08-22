# 🔧 إعداد التاجر التجريبي - Test Merchant Setup

## نظرة عامة

هذا الدليل يوضح كيفية إضافة بيانات التاجر التجريبي لربط Instagram Page ID `17841405545604018` بالنظام.

## الملفات المطلوبة

- ✅ `insert_test_merchant.sql` - SQL script لإدراج البيانات
- ✅ `insert-test-merchant.js` - Node.js script للتنفيذ
- ✅ npm script: `db:insert-test-merchant`

## 🚀 طريقة التشغيل

### الطريقة الأولى: باستخدام npm script (مُوصى بها)

```bash
# تأكد من وجود DATABASE_URL في .env
npm run db:insert-test-merchant
```

### الطريقة الثانية: تشغيل مباشر

```bash
# باستخدام Node.js
node insert-test-merchant.js

# أو باستخدام SQL مباشرة
psql $DATABASE_URL -f insert_test_merchant.sql
```

## 📋 البيانات التي سيتم إدراجها

### جدول `merchants`:
```sql
- id: 'dd90061a-a1ad-42de-be9b-1c9760d0de02'
- business_name: 'Test Store'
- instagram_username: 'test_store'
- whatsapp_number: '+9647701234567'
- subscription_status: 'ACTIVE'
- is_active: true
```

### جدول `merchant_credentials`:
```sql
- merchant_id: 'dd90061a-a1ad-42de-be9b-1c9760d0de02'
- platform: 'INSTAGRAM'
- instagram_page_id: '17841405545604018'
- instagram_business_account_id: '17841405545604018'
```

## ✅ التحقق من نجاح العملية

بعد التشغيل، ستحصل على رسائل مثل:

```
✅ Database connection successful
📄 SQL file loaded successfully
⚡ Executing SQL statements...
✅ Test merchant data inserted successfully!

📋 Merchant Data Verified:
   • ID: dd90061a-a1ad-42de-be9b-1c9760d0de02
   • Business Name: Test Store
   • Instagram Username: test_store
   • Status: ACTIVE
   • Active: true
   • Platform: INSTAGRAM
   • Instagram Page ID: 17841405545604018
   • Business Account ID: 17841405545604018

🎯 Next steps:
   1. Test webhook with this Page ID: 17841405545604018
   2. Verify merchant ID resolution in logs
   3. Check AI response generation
```

## 🔍 التحقق اليدوي من قاعدة البيانات

```sql
-- تحقق من البيانات
SELECT 
  m.id,
  m.business_name,
  m.instagram_username,
  mc.platform,
  mc.instagram_page_id,
  mc.instagram_business_account_id
FROM merchants m
LEFT JOIN merchant_credentials mc ON m.id = mc.merchant_id
WHERE m.id = 'dd90061a-a1ad-42de-be9b-1c9760d0de02';
```

## 🐛 استكشاف الأخطاء

### خطأ في الاتصال بقاعدة البيانات:
```
❌ Database connection failed: connection refused
```

**الحل:**
1. تحقق من `DATABASE_URL` في ملف `.env`
2. تأكد من تشغيل PostgreSQL
3. تحقق من صحة المصادقة

### خطأ في الجداول غير موجودة:
```
❌ relation "merchants" does not exist
```

**الحل:**
```bash
# تشغيل المايجريشن
npm run db:migrate
```

### خطأ في التكرار:
```
❌ duplicate key value violates unique constraint
```

**الحل:** البيانات موجودة بالفعل - لا مشكلة.

## 📊 تأثير العملية

بعد إدراج البيانات:

1. **Webhook Processing**: Instagram Page ID `17841405545604018` سيُربط بـ merchant
2. **AI Responses**: الذكاء الاصطناعي سيعمل مع التاجر المحدد  
3. **Logging**: جميع العمليات ستُسجل باسم التاجر الصحيح
4. **RLS**: عزل البيانات سيعمل تلقائياً

## 🔄 إلغاء العملية (إذا لزم الأمر)

```sql
-- حذف بيانات التاجر التجريبي
DELETE FROM merchant_credentials 
WHERE merchant_id = 'dd90061a-a1ad-42de-be9b-1c9760d0de02';

DELETE FROM merchants 
WHERE id = 'dd90061a-a1ad-42de-be9b-1c9760d0de02';
```

---

## 📞 المساعدة

إذا واجهت أي مشاكل:

1. تحقق من لوحة logs في production
2. راجع ملف `.env` للمتغيرات المطلوبة
3. تأكد من تشغيل جميع المايجريشن
4. اختبر الاتصال بقاعدة البيانات

النظام جاهز الآن لاستقبال webhooks من Instagram Page `17841405545604018` 🚀