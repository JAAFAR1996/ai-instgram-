# 🚀 دليل الاستخدام الإنتاجي - منصة المبيعات الذكية

## 📋 نظرة عامة

هذا الدليل يوضح كيفية استخدام منصة المبيعات الذكية في بيئة الإنتاج بشكل احترافي وآمن.

## 🔐 الوصول للنظام الإداري

### 1. الوصول الأساسي
```
URL: https://ai-instgram.onrender.com/admin?key=YOUR_ADMIN_KEY
```

### 2. متغيرات البيئة المطلوبة
```env
# مفتاح الإدارة (يجب تغييره في الإنتاج)
ADMIN_API_KEY=your-secure-admin-key-here

# متغيرات أساسية مطلوبة
DATABASE_URL=postgresql://...
META_APP_SECRET=your_meta_app_secret
IG_VERIFY_TOKEN=your_webhook_verify_token
ENCRYPTION_KEY_HEX=your_64_character_hex_key
JWT_SECRET=your_jwt_secret_32_chars_minimum
OPENAI_API_KEY=sk-your_openai_key

# متغيرات اختيارية
REDIS_URL=redis://...
CORS_ORIGINS=https://yourdomain.com,https://admin.yourdomain.com
```

## 🏗️ الواجهات الإدارية

### 1. لوحة التحكم الرئيسية
- **الرابط**: `/admin`
- **الوصف**: لوحة تحكم شاملة مع روابط لجميع الأدوات الإدارية
- **المميزات**:
  - إدارة التجار
  - مراقبة النظام
  - الإعدادات المتقدمة
  - التقارير والإحصائيات

### 2. إضافة تاجر جديد
- **الرابط**: `/admin/merchants/new`
- **الوصف**: واجهة شاملة لإضافة تاجر جديد
- **المميزات**:
  - نموذج تفاعلي مع validation
  - حساب درجة الاكتمال
  - إضافة المنتجات
  - تكوين AI والردود التلقائية

### 3. إدارة التجار
- **الرابط**: `/admin/merchants`
- **الوصف**: واجهة إدارة التجار الموجودين
- **المميزات**:
  - عرض قائمة التجار
  - تعديل بيانات التجار
  - إحصائيات مفصلة

## 📊 نقاط API للمراقبة

### 1. إحصائيات النظام
```bash
GET /api/metrics/system
Authorization: Bearer YOUR_ADMIN_KEY

# الاستجابة
{
  "success": true,
  "data": {
    "timestamp": "2025-01-18T...",
    "uptime_seconds": 3600,
    "memory_usage_mb": 256,
    "total_merchants": 15,
    "active_merchants_24h": 8,
    "total_conversations_24h": 45,
    "total_messages_24h": 234,
    "ai_responses_24h": 189,
    "avg_response_time_ms": 850
  }
}
```

### 2. إحصائيات التجار
```bash
GET /api/metrics/merchants?limit=20
Authorization: Bearer YOUR_ADMIN_KEY

# الاستجابة
{
  "success": true,
  "data": [
    {
      "merchant_id": "uuid",
      "business_name": "متجر الأزياء",
      "conversations_24h": 12,
      "messages_24h": 67,
      "ai_responses_24h": 54,
      "avg_response_time_ms": 750,
      "status": "ACTIVE"
    }
  ]
}
```

### 3. صحة المنصة
```bash
GET /api/health/detailed
Authorization: Bearer YOUR_ADMIN_KEY

# الاستجابة
{
  "success": true,
  "data": {
    "status": "healthy",
    "components": {
      "database": { "status": "healthy", "response_time_ms": 45 },
      "redis": { "status": "healthy" },
      "queue": { "status": "healthy", "pending_jobs": 3 },
      "ai_service": { "status": "healthy", "avg_response_time_ms": 850 }
    },
    "alerts": []
  }
}
```

### 4. إحصائيات سريعة
```bash
GET /api/stats/quick
Authorization: Bearer YOUR_ADMIN_KEY

# الاستجابة
{
  "success": true,
  "data": {
    "merchants": 15,
    "conversations_today": 23,
    "messages_today": 156,
    "ai_responses_today": 134,
    "uptime_hours": 24
  }
}
```

### 5. لوحة التحكم التحليلية
```bash
GET /api/analytics/dashboard
Authorization: Bearer YOUR_ADMIN_KEY

# الاستجابة الشاملة تتضمن جميع الإحصائيات
```

## 🔧 إدارة التجار

### 1. إنشاء تاجر جديد
```bash
POST /admin/merchants
Authorization: Bearer YOUR_ADMIN_KEY
Content-Type: application/json

{
  "business_name": "متجر الأزياء الحديث",
  "business_category": "fashion",
  "whatsapp_number": "+964771234567",
  "instagram_username": "modern_fashion",
  "email": "info@modernfashion.com",
  "working_hours": {
    "enabled": true,
    "timezone": "Asia/Baghdad",
    "schedule": {
      "sunday": { "open": "10:00", "close": "22:00", "enabled": true }
    }
  },
  "ai_config": {
    "model": "gpt-4o-mini",
    "temperature": 0.7,
    "max_tokens": 600,
    "tone": "friendly"
  },
  "products": [
    {
      "sku": "SHIRT-001",
      "name_ar": "قميص قطني",
      "price_usd": 25.0,
      "stock_quantity": 50
    }
  ]
}
```

### 2. الحصول على قائمة التجار
```bash
GET /api/merchants?page=1&limit=20
Authorization: Bearer YOUR_ADMIN_KEY

# الاستجابة مع pagination
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "pages": 3
  }
}
```

## 🔍 المراقبة والصحة

### 1. فحص صحة النظام
```bash
# فحص أساسي
GET /health

# فحص مفصل (يتطلب مصادقة)
GET /api/health/detailed
Authorization: Bearer YOUR_ADMIN_KEY
```

### 2. حالة النظام
```bash
GET /api/status

# الاستجابة
{
  "service": "AI Sales Platform",
  "version": "1.0.0",
  "status": "operational",
  "uptime_seconds": 86400,
  "uptime_human": "24h 0m",
  "memory_usage_mb": 256,
  "environment": "production",
  "components": {
    "database": "operational",
    "redis": "operational",
    "queue": "operational"
  }
}
```

### 3. التحقق من التكوين
```bash
GET /api/config/validate
Authorization: Bearer YOUR_ADMIN_KEY

# يتحقق من جميع متغيرات البيئة والاتصالات
```

## 🚨 التنبيهات والمراقبة

### 1. مستويات التنبيه
- **🟢 Healthy**: جميع الأنظمة تعمل بشكل طبيعي
- **🟡 Degraded**: بعض المشاكل البسيطة
- **🔴 Critical**: مشاكل خطيرة تتطلب تدخل فوري

### 2. المقاييس المهمة للمراقبة
- **وقت الاستجابة**: يجب أن يكون أقل من 1000ms
- **استخدام الذاكرة**: يجب أن يكون أقل من 500MB
- **معدل الأخطاء**: يجب أن يكون أقل من 1%
- **اتصال قاعدة البيانات**: يجب أن يكون مستقر

## 🔐 الأمان

### 1. مفاتيح API
- استخدم مفاتيح قوية ومعقدة
- غير المفاتيح بانتظام
- لا تشارك المفاتيح في الكود

### 2. HTTPS
- استخدم HTTPS دائماً في الإنتاج
- تأكد من صحة شهادات SSL

### 3. Rate Limiting
- النظام يحتوي على rate limiting تلقائي
- 100 طلب كل 15 دقيقة للـ webhooks

## 📈 الأداء والتحسين

### 1. Cache
- النظام يستخدم cache ذكي للإحصائيات
- مدة الـ cache: دقيقة واحدة

### 2. Database
- استخدام connection pooling
- فهرسة محسنة للاستعلامات

### 3. Queue System
- معالجة غير متزامنة للمهام الثقيلة
- retry mechanism للمهام الفاشلة

## 🛠️ استكشاف الأخطاء

### 1. مشاكل شائعة

#### خطأ في الاتصال بقاعدة البيانات
```bash
# فحص الاتصال
curl https://your-domain.com/health

# إذا كان هناك خطأ، تحقق من DATABASE_URL
```

#### مشاكل في Instagram API
```bash
# تحقق من صحة الـ tokens
curl -X GET "https://graph.facebook.com/v18.0/me?access_token=YOUR_TOKEN"
```

#### مشاكل في الذاكرة
```bash
# مراقبة استخدام الذاكرة
curl https://your-domain.com/api/status
```

### 2. Logs
- جميع الأخطاء يتم تسجيلها في audit_logs
- استخدم trace_id لتتبع الطلبات

## 📞 الدعم

### 1. معلومات النظام
- **الإصدار**: 1.0.0
- **البيئة**: Production
- **قاعدة البيانات**: PostgreSQL
- **Cache**: Redis (اختياري)
- **AI**: OpenAI GPT-4o-mini

### 2. الاتصال
- للدعم التقني: راجع الـ logs في `/api/health/detailed`
- للمشاكل الطارئة: تحقق من `/health` endpoint

## 🎯 أفضل الممارسات

### 1. النشر
- اختبر دائماً في بيئة staging أولاً
- استخدم migrations للتغييرات في قاعدة البيانات
- احتفظ بنسخ احتياطية منتظمة

### 2. المراقبة
- راقب الـ endpoints بانتظام
- اضبط تنبيهات للمقاييس المهمة
- راجع الـ logs يومياً

### 3. الأمان
- غير كلمات المرور بانتظام
- راجع الـ access logs
- استخدم HTTPS دائماً

---

## 🚀 الخلاصة

منصة المبيعات الذكية جاهزة للإنتاج مع:
- ✅ نظام إداري شامل وآمن
- ✅ مراقبة متقدمة وإحصائيات مفصلة
- ✅ API endpoints محسنة ومؤمنة
- ✅ معالجة أخطاء متقدمة
- ✅ أداء عالي مع caching ذكي
- ✅ أمان على مستوى المؤسسات

استخدم هذا الدليل كمرجع شامل لإدارة المنصة في بيئة الإنتاج.