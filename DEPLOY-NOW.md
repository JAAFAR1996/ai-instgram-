# 🚀 نشر فوري - خطوات التشغيل

## المتطلبات المُحققة ✅
- Docker image: `ai-sales-platform:v1.0.0-final` ✅
- Environment: `.env.production` مع الأسرار ✅
- Production server: `production-server.cjs` ✅
- Database: PostgreSQL جاهز ✅

## التشغيل الفوري

### 1. بناء الإنتاج
```bash
docker-compose -f docker-compose.prod.yml build
```

### 2. تشغيل البيئة الكاملة
```bash
docker-compose -f docker-compose.prod.yml up -d
```

### 3. التحقق من الصحة
```bash
# فحص الخدمات
docker-compose -f docker-compose.prod.yml ps

# اختبار API
curl http://localhost:3000/health

# مراقبة Grafana
open http://localhost:3001
# username: admin
# password: secure_grafana_password_2025
```

## الخدمات المتاحة

| الخدمة | المنفذ | الوصف |
|--------|--------|-------|
| **API** | 3000 | التطبيق الرئيسي |
| **Grafana** | 3001 | المراقبة والتحليلات |
| **Prometheus** | 9090 | جمع المقاييس |
| **PostgreSQL** | 5432 | قاعدة البيانات |
| **Redis** | 6379 | التخزين المؤقت |

## الاختبارات الأساسية

```bash
# 1. فحص الصحة العامة
curl -X GET http://localhost:3000/health

# 2. اختبار Instagram webhook
curl -X GET "http://localhost:3000/webhooks/instagram?hub.mode=subscribe&hub.verify_token=webhook_verify_ai_sales_2025&hub.challenge=test123"

# 3. اختبار WhatsApp 24h policy
curl -X POST http://localhost:3000/api/whatsapp/send \
  -H "Content-Type: application/json" \
  -d '{"to": "+1234567890", "text": "test message"}'
```

## إيقاف الخدمات

```bash
# إيقاف مع حفظ البيانات
docker-compose -f docker-compose.prod.yml down

# إيقاف مع مسح البيانات
docker-compose -f docker-compose.prod.yml down -v
```

## للنشر الخارجي لاحقًا

### Render.com (أسهل)
1. رفع الكود إلى GitHub
2. ربط Render بـ GitHub  
3. نشر تلقائي

### VPS (إنتاج حقيقي)
```bash
# نسخ للخادم
scp -r . user@your-server:/app/

# تشغيل على الخادم
ssh user@your-server
cd /app
docker-compose -f docker-compose.prod.yml up -d
```

---
**الحالة:** 🟢 جاهز للتشغيل الفوري
**التاريخ:** 2025-08-14