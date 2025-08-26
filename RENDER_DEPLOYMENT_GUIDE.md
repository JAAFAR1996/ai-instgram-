# دليل نشر AI Sales Platform على Render

## المتطلبات الأساسية

### 1. إعداد GitHub Repository
- تأكد من أن الكود موجود في repository على GitHub
- تأكد من أن Repository عام أو أن لديك صلاحيات الوصول من Render

### 2. متغيرات البيئة المطلوبة

#### متغيرات إجبارية:
```bash
NODE_ENV=production
PORT=10000
IG_VERIFY_TOKEN=your_instagram_verify_token_here
META_APP_SECRET=your_meta_app_secret_here
IG_APP_ID=your_instagram_app_id_here
IG_APP_SECRET=your_instagram_app_secret_here
DATABASE_URL=postgresql://username:password@host:port/database_name
REDIS_URL=redis://username:password@host:port/database_number
ENCRYPTION_KEY=your_32_character_encryption_key_here
JWT_SECRET=your_jwt_secret_here
INTERNAL_API_KEY=your_internal_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
```

#### متغيرات اختيارية:
```bash
WHATSAPP_PHONE_NUMBER_ID=your_whatsapp_phone_number_id_here
WHATSAPP_ACCESS_TOKEN=your_whatsapp_access_token_here
SENTRY_DSN=your_sentry_dsn_here
```

#### متغيرات ثابتة (يتم تعيينها تلقائياً):
```bash
BASE_URL=https://ai-instgram.onrender.com
REDIRECT_URI=https://ai-instgram.onrender.com/auth/instagram/callback
CORS_ORIGINS=https://ai-instgram.onrender.com,https://graph.facebook.com
```

## خطوات النشر

### 1. إنشاء حساب على Render
- اذهب إلى [render.com](https://render.com)
- سجل حساب جديد أو سجل الدخول

### 2. ربط GitHub Repository
- في لوحة التحكم، اختر "New Web Service"
- اختر "Connect a repository"
- اختر repository الخاص بك

### 3. إعداد الخدمة
- **Name**: `ai-sales-platform`
- **Environment**: `Node`
- **Region**: `Oregon` (أو أقرب منطقة لك)
- **Branch**: `main`
- **Build Command**: `npm ci && npm run build`
- **Start Command**: `node production.cjs`

### 4. إعداد متغيرات البيئة
في قسم "Environment Variables"، أضف جميع المتغيرات المطلوبة:

#### متغيرات إجبارية:
- `NODE_ENV` = `production`
- `PORT` = `10000`
- `IG_VERIFY_TOKEN` = [قيمة من Meta Developer Console]
- `META_APP_SECRET` = [قيمة من Meta Developer Console]
- `IG_APP_ID` = [قيمة من Meta Developer Console]
- `IG_APP_SECRET` = [قيمة من Meta Developer Console]
- `DATABASE_URL` = [رابط قاعدة البيانات]
- `REDIS_URL` = [رابط Redis]
- `ENCRYPTION_KEY` = [مفتاح تشفير 32 حرف]
- `JWT_SECRET` = [مفتاح JWT]
- `INTERNAL_API_KEY` = [مفتاح API داخلي]
- `OPENAI_API_KEY` = [مفتاح OpenAI API]

### 5. إعداد قاعدة البيانات (اختياري)
- يمكنك إنشاء PostgreSQL database على Render
- أو استخدام خدمة خارجية مثل Supabase أو Railway

### 6. إعداد Redis (اختياري)
- يمكنك إنشاء Redis instance على Render
- أو استخدام خدمة خارجية مثل Upstash أو Redis Cloud

### 7. النشر
- اضغط على "Create Web Service"
- انتظر حتى يكتمل البناء والنشر
- ستظهر رسالة نجاح مع رابط التطبيق

## التحقق من النشر

### 1. فحص Health Check
```bash
curl https://ai-instgram.onrender.com/health
```

يجب أن يعيد:
```json
{
  "status": "healthy",
  "timestamp": "2025-01-XX...",
  "server": "ai-sales-platform-production",
  "version": "2.0.0",
  "environment": "production"
}
```

### 2. فحص Instagram Webhook
```bash
curl "https://ai-instgram.onrender.com/webhooks/instagram?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=test"
```

### 3. فحص Logs
- في لوحة تحكم Render، اذهب إلى "Logs"
- تأكد من عدم وجود أخطاء

## استكشاف الأخطاء

### مشاكل شائعة:

#### 1. خطأ في البناء
```bash
# تأكد من أن جميع التبعيات موجودة في package.json
npm ci
npm run build
```

#### 2. خطأ في متغيرات البيئة
```bash
# تأكد من تعيين جميع المتغيرات الإجبارية
echo $IG_VERIFY_TOKEN
echo $META_APP_SECRET
echo $DATABASE_URL
```

#### 3. خطأ في الاتصال بقاعدة البيانات
- تأكد من صحة `DATABASE_URL`
- تأكد من أن قاعدة البيانات متاحة من Render

#### 4. خطأ في Redis
- تأكد من صحة `REDIS_URL`
- تأكد من أن Redis متاح من Render

### إعادة النشر
```bash
# في GitHub، ادفع تغييرات جديدة
git add .
git commit -m "Update deployment"
git push origin main
```

## مراقبة الأداء

### 1. Render Dashboard
- مراقبة استخدام CPU و Memory
- مراقبة عدد الطلبات
- مراقبة وقت الاستجابة

### 2. Logs
- مراقبة application logs
- مراقبة build logs
- مراقبة error logs

### 3. Health Checks
- إعداد مراقبة تلقائية للـ health endpoint
- إعداد تنبيهات للأخطاء

## الأمان

### 1. متغيرات البيئة
- لا تشارك متغيرات البيئة الحساسة
- استخدم `sync: false` للمتغيرات الحساسة في render.yaml

### 2. CORS
- تأكد من إعداد CORS بشكل صحيح
- لا تسمح بـ `*` في CORS origins

### 3. Rate Limiting
- تأكد من تفعيل rate limiting
- مراقبة عدد الطلبات

## التحديثات

### 1. تحديث الكود
```bash
git add .
git commit -m "Update application"
git push origin main
```

### 2. تحديث متغيرات البيئة
- في لوحة تحكم Render، اذهب إلى Environment Variables
- أضف أو عدل المتغيرات المطلوبة
- اضغط "Save Changes"

### 3. إعادة تشغيل الخدمة
- في لوحة تحكم Render، اضغط "Manual Deploy"
- أو انتظر النشر التلقائي

## الدعم

إذا واجهت مشاكل:
1. راجع logs في Render Dashboard
2. تأكد من صحة متغيرات البيئة
3. تأكد من صحة إعدادات GitHub
4. راجع هذا الدليل مرة أخرى
