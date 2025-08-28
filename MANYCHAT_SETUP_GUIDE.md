# 🚀 دليل إعداد ManyChat - خطوة بخطوة

## 📋 المتطلبات الأساسية:

### 1. **الحصول على ManyChat API Key:**
- اذهب إلى [ManyChat Dashboard](https://app.manychat.com/)
- اذهب إلى Settings > API
- انسخ API Key الخاص بك

### 2. **إعداد متغيرات البيئة:**

#### **في Render Dashboard:**
1. اذهب إلى مشروعك في Render
2. اذهب إلى Environment Variables
3. أضف المتغيرات التالية:

```env
# ===============================================
# ManyChat API Configuration (مطلوب)
# ===============================================
MANYCHAT_API_KEY=your_actual_api_key_here
MANYCHAT_BASE_URL=https://api.manychat.com
MANYCHAT_WEBHOOK_SECRET=your_secure_webhook_secret

# ===============================================
# ManyChat Flow IDs (اختياري ولكن موصى به)
# ===============================================
MANYCHAT_DEFAULT_FLOW_ID=your_default_flow_id
MANYCHAT_WELCOME_FLOW_ID=your_welcome_flow_id
MANYCHAT_AI_RESPONSE_FLOW_ID=your_ai_response_flow_id
MANYCHAT_COMMENT_RESPONSE_FLOW_ID=your_comment_response_flow_id
MANYCHAT_STORY_RESPONSE_FLOW_ID=your_story_response_flow_id
```

### 3. **إنشاء Flows في ManyChat:**

#### **Flow 1: Default Flow (للردود العامة)**
- اذهب إلى Flows في ManyChat
- أنشئ flow جديد باسم "Default AI Response"
- أضف رسالة ترحيبية
- انسخ Flow ID

#### **Flow 2: Welcome Flow (للعملاء الجدد)**
- أنشئ flow جديد باسم "Welcome New Customer"
- أضف رسالة ترحيب للعملاء الجدد
- انسخ Flow ID

#### **Flow 3: AI Response Flow (للردود الذكية)**
- أنشئ flow جديد باسم "AI Response"
- أضف رسالة مخصصة للردود الذكية
- انسخ Flow ID

### 4. **تشغيل Migration في قاعدة البيانات:**

```bash
# في Render Shell أو محلياً
npm run db:migrate
```

### 5. **اختبار التكامل:**

#### **اختبار 1: اختبار ManyChat API**
```bash
curl -X POST https://your-app.onrender.com/api/test/manychat \
  -H "Content-Type: application/json" \
  -d '{
    "merchantId": "test-merchant-id",
    "customerId": "test-customer-id",
    "message": "مرحبا، كيف حالك؟"
  }'
```

#### **اختبار 2: اختبار Instagram Webhook**
```bash
curl -X POST https://your-app.onrender.com/api/webhooks/instagram \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: your_signature" \
  -d '{
    "object": "instagram",
    "entry": [{
      "id": "test-id",
      "time": 1234567890,
      "messaging": [{
        "sender": {"id": "test-customer"},
        "recipient": {"id": "test-merchant"},
        "timestamp": 1234567890,
        "message": {
          "mid": "test-message-id",
          "text": "مرحبا، أريد معلومات عن المنتجات"
        }
      }]
    }]
  }'
```

## ✅ **قائمة التحقق (Checklist):**

- [ ] حصلت على ManyChat API Key
- [ ] أضفت متغيرات البيئة في Render
- [ ] أنشأت Flows في ManyChat
- [ ] شغلت migration قاعدة البيانات
- [ ] اختبرت API endpoints
- [ ] اختبرت Instagram webhook

## 🔧 **استكشاف الأخطاء:**

### **مشكلة: ManyChat API Key غير صحيح**
```bash
# تحقق من الـ logs في Render
# تأكد من أن MANYCHAT_API_KEY صحيح
```

### **مشكلة: Flow ID غير موجود**
```bash
# تأكد من أن Flow IDs صحيحة في ManyChat
# تحقق من أن الـ flows منشأة ومفعلة
```

### **مشكلة: قاعدة البيانات**
```bash
# شغل migration مرة أخرى
npm run db:migrate
```

## 📞 **الدعم:**

إذا واجهت أي مشاكل:
1. تحقق من logs في Render
2. تأكد من متغيرات البيئة
3. اختبر API endpoints
4. راجع دليل التكامل الشامل

---
**ملاحظة:** تأكد من أن جميع المتغيرات المطلوبة مضبوطة قبل تشغيل التطبيق في الإنتاج.
