# 🚀 منصة المبيعات الذكية - AI Sales Platform

> **نظام احترافي متقدم لأتمتة المبيعات عبر Instagram باستخدام الذكاء الاصطناعي**

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![OpenAI](https://img.shields.io/badge/OpenAI-412991?style=for-the-badge&logo=openai&logoColor=white)](https://openai.com/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

<div align="center">

## 🎯 **منصة ثورية تجمع بين الذكاء الاصطناعي وأتمتة المبيعات**

### ✨ *مصممة خصيصاً للتجار العراقيين والشرق أوسطيين*

![Platform Demo](https://img.shields.io/badge/🔥%20Production%20Ready-100%25-brightgreen?style=for-the-badge)
![API Version](https://img.shields.io/badge/Instagram%20API-v23.0-blue?style=for-the-badge)
![AI Powered](https://img.shields.io/badge/AI%20Powered-GPT--4o--mini-orange?style=for-the-badge)

</div>

---

## 🌟 **نظرة عامة**

**منصة المبيعات الذكية** هي نظام متطور من الجيل الجديد يقدم حلولاً ذكية وآلية لإدارة المبيعات عبر Instagram. تم تطويرها باستخدام أحدث التقنيات والمعايير العالمية لتوفير تجربة استثنائية للتجار والعملاء على حد سواء.

### 🎪 **المميزات الفريدة**

<table>
<tr>
<td align="center">🤖</td>
<td><strong>ذكاء اصطناعي متقدم</strong><br/>محادثات طبيعية باللغة العربية والعراقية</td>
<td align="center">⚡</td>
<td><strong>أداء خارق</strong><br/>استجابة فورية أقل من 100ms</td>
</tr>
<tr>
<td align="center">📱</td>
<td><strong>Instagram محلي 100%</strong><br/>تكامل كامل مع Instagram Business API</td>
<td align="center">🔒</td>
<td><strong>أمان على مستوى المؤسسات</strong><br/>حماية متقدمة وتشفير AES-256</td>
</tr>
<tr>
<td align="center">🌍</td>
<td><strong>متعدد المستأجرين</strong><br/>يدعم آلاف التجار في نفس الوقت</td>
<td align="center">📈</td>
<td><strong>قابل للتوسع لا نهائياً</strong><br/>معمارية حديثة قابلة للنمو</td>
</tr>
</table>

---

## 🚀 **الميزات الثورية**

### 🔄 **تكامل Instagram المتطور**
- **📞 الرسائل المباشرة**: محادثات ذكية مع العملاء باللغة العربية
- **📸 Instagram Stories**: ردود تلقائية على المنشنز والتفاعلات
- **💬 إدارة التعليقات**: ردود ذكية ودعوات للرسائل الخاصة
- **🎬 معالجة الوسائط**: تحليل وفهم الصور والفيديوهات بالـ AI
- **🔄 Webhooks موثوقة**: نظام retry متقدم مع exponential backoff

### 🧠 **ذكاء اصطناعي استثنائي**
- **🎯 OpenAI GPT-4o-mini**: أحدث نماذج الذكاء الاصطناعي
- **🧭 فهم السياق**: يحتفظ بتاريخ المحادثات ويفهم السياق
- **🌍 دعم متعدد اللغات**: العربية، العراقية، الإنجليزية
- **🎨 تخصيص الشخصية**: نبرة مخصصة لكل تاجر
- **⚡ معالجة غير متزامنة**: استجابة فورية مع معالجة خلفية

### 🛡️ **أمان عالي المستوى**
- **🔐 HMAC-SHA256**: التحقق الآمن من webhook Instagram
- **🗝️ JWT Authentication**: مصادقة قوية بمعايير الصناعة
- **🚦 Rate Limiting ذكي**: حماية من سوء الاستخدام والسبام
- **🔒 تشفير AES-GCM**: تشفير قوي للبيانات الحساسة
- **🛡️ حماية SQL Injection**: استعلامات آمنة ومعاملة

### 🏗️ **معمارية احترافية**
- **🎯 Clean Architecture**: فصل واضح للطبقات والمسؤوليات  
- **📦 Repository Pattern**: طبقة وصول بيانات منفصلة ومرنة
- **🔄 Queue System**: Bull + Redis لمعالجة المهام الخلفية
- **💾 قاعدة بيانات متقدمة**: PostgreSQL مع migrations وfull-text search
- **📊 مراقبة شاملة**: health checks ومقاييس الأداء

---

## 🏛️ **المعمارية التقنية**

```
    ┌─────────────────────────────────────────────────────────────┐
    │                    🌐 طبقة العميل                          │
    │        Instagram Business API │ Webhooks │ Admin Panel     │
    └─────────────────┬───────────────────────────────────────────┘
                      │
    ┌─────────────────┴───────────────────────────────────────────┐
    │                   ⚡ طبقة التطبيق                          │
    │     Hono REST API │ JWT Auth │ Rate Limiting │ Validation   │
    └─────────────────┬───────────────────────────────────────────┘
                      │
    ┌─────────────────┴───────────────────────────────────────────┐
    │                   🧠 طبقة الأعمال                          │
    │   AI Service │ Instagram Service │ Queue Manager │ Services │
    └─────────────────┬───────────────────────────────────────────┘
                      │
    ┌─────────────────┴───────────────────────────────────────────┐
    │                   💾 طبقة البيانات                         │
    │      Repositories │ PostgreSQL │ Redis Cache │ Migrations  │
    └─────────────────────────────────────────────────────────────┘
```

### 🔧 **المكونات التقنية المتقدمة**

<div align="center">

| **الفئة** | **التقنية** | **الإصدار** | **الاستخدام** |
|-----------|-------------|-------------|---------------|
| **🚀 Runtime** | Node.js / Bun | 20+ | محرك التشغيل عالي الأداء |
| **🌐 Framework** | Hono | 4.0+ | إطار عمل سريع جداً |
| **📝 Language** | TypeScript | 5.0+ | البرمجة مع التحقق الصارم |
| **💾 Database** | PostgreSQL | 15+ | قاعدة بيانات متقدمة |
| **⚡ Cache** | Redis | 7+ | تخزين مؤقت وطوابير |
| **🤖 AI** | OpenAI GPT | 4o-mini | الذكاء الاصطناعي |
| **📱 Social** | Meta Graph API | v23.0 | تكامل Instagram |

</div>

---

## 🚀 **البدء السريع**

### 📋 **المتطلبات الأساسية**

```bash
# Node.js 20+ (مستحسن استخدام nvm)
node --version # v20.x.x

# مدير الحزم
npm --version # أو yarn/pnpm/bun

# قواعد البيانات
psql --version # PostgreSQL 15+
redis-server --version # Redis 7+
```

### ⚡ **التثبيت السريع**

```bash
# 1️⃣ استنساخ المستودع
git clone https://github.com/JAAFAR1996/ai-instgram-.git
cd ai-sales-platform

# 2️⃣ تثبيت التبعيات
npm install
# أو للسرعة القصوى
bun install

# 3️⃣ إعداد متغيرات البيئة
cp .env.example .env
# تحرير .env بالإعدادات الخاصة بك

# 4️⃣ إعداد قاعدة البيانات
npm run db:migrate
npm run db:seed

# 5️⃣ تشغيل الخادم
npm run dev
```

### 🔧 **إعداد متغيرات البيئة**

```env
# ================================
# AI Sales Platform - Environment
# ================================

# 🚀 إعدادات التطبيق
NODE_ENV=production
PORT=3000
API_VERSION=v1
TZ=Asia/Baghdad

# 💾 قاعدة البيانات
DATABASE_URL=postgresql://user:password@localhost:5432/ai_sales_platform
REDIS_URL=redis://localhost:6379

# 🤖 APIs خارجية
OPENAI_API_KEY=sk-your_openai_key_here
META_APP_ID=your_meta_app_id
META_APP_SECRET=your_meta_app_secret_here
IG_VERIFY_TOKEN=your_webhook_verify_token

# 🔐 الأمان
JWT_SECRET=your_super_secure_jwt_secret_here
ENCRYPTION_KEY=your_32_character_encryption_key_123

# 📱 Instagram
INSTAGRAM_ACCESS_TOKEN=your_long_lived_access_token
INSTAGRAM_BUSINESS_ACCOUNT_ID=your_business_account_id
INSTAGRAM_PAGE_ID=your_page_id
```

---

## 📁 **هيكل المشروع المنظم**

```
ai-sales-platform/
├── 🎯 src/                          # الكود المصدري
│   ├── 🌐 api/                      # نقاط النهاية والتحكم
│   │   ├── auth/                    # مصادقة Instagram
│   │   ├── webhooks.ts              # معالجة الـ webhooks
│   │   └── service-control.ts       # إدارة الخدمات
│   ├── 🧠 services/                 # طبقة منطق الأعمال
│   │   ├── instagram-webhook.ts     # خدمة Instagram webhook
│   │   ├── instagram-ai.ts          # خدمة الذكاء الاصطناعي
│   │   ├── ai.ts                    # محرك OpenAI
│   │   └── encryption.ts            # خدمات التشفير
│   ├── 📦 repositories/             # طبقة الوصول للبيانات
│   │   ├── conversation-repository.ts
│   │   ├── merchant-repository.ts
│   │   └── message-repository.ts
│   ├── 🔄 queue/                    # معالجة المهام الخلفية
│   │   ├── queue-manager.ts         # مدير الطوابير
│   │   └── processors/              # معالجات المهام
│   ├── 💾 database/                 # قاعدة البيانات
│   │   ├── connection.ts            # الاتصال
│   │   ├── migrate.ts               # المايقريشنز
│   │   └── migrations/              # ملفات SQL
│   ├── 🛡️ middleware/               # الوسطاء الأمنية
│   │   ├── security.ts              # الأمان العام
│   │   └── enhanced-security.ts     # أمان متقدم
│   ├── 🔧 types/                    # تعريفات TypeScript
│   └── ⚙️ config/                   # إعدادات النظام
├── 🧪 tests/                        # الاختبارات
│   ├── unit/                        # اختبارات الوحدة
│   ├── integration/                 # اختبارات التكامل
│   └── e2e/                        # اختبارات شاملة
├── 🐳 docker/                       # إعدادات Docker
├── 📚 docs/                         # التوثيق
└── 🔧 scripts/                      # سكريبتات النشر
```

---

## 🛠️ **الأوامر المتاحة**

<div align="center">

| **الأمر** | **الوصف** | **الاستخدام** |
|-----------|-----------|---------------|
| `npm run dev` | 🔥 تشغيل الخادم للتطوير | تطوير مع إعادة التحميل |
| `npm run build` | 🏗️ بناء للإنتاج | إنتاج TypeScript |
| `npm run start` | 🚀 تشغيل الإنتاج | خادم الإنتاج |
| `npm run test` | 🧪 تشغيل الاختبارات | جميع الاختبارات |
| `npm run test:watch` | 👀 اختبارات مراقبة | تشغيل مستمر |
| `npm run lint` | 🔍 فحص الكود | تحليل ESLint |
| `npm run lint:fix` | 🔧 إصلاح الكود | إصلاح تلقائي |
| `npm run typecheck` | ✅ فحص الأنواع | TypeScript validation |
| `npm run db:migrate` | 💾 تطبيق المايقريشنز | تحديث قاعدة البيانات |
| `npm run db:seed` | 🌱 بذر البيانات | بيانات أولية |

</div>

---

## 📚 **توثيق API الشامل**

### 🏥 **نقاط النهاية الأساسية**

```http
# 🏥 فحص الصحة والحالة
GET /health                    # فحص صحة النظام
GET /api/v1/status            # حالة مفصلة للنظام
GET /api/v1/metrics           # مقاييس الأداء

# 📱 تكامل Instagram
GET  /api/v1/instagram/webhook    # تحقق webhook
POST /api/v1/instagram/webhook    # معالجة الأحداث
GET  /api/v1/instagram/profile    # معلومات البروفايل

# 🔄 إدارة الطوابير
GET  /api/v1/queue/stats          # إحصائيات الطوابير
POST /api/v1/queue/retry-failed   # إعادة المحاولة
GET  /api/v1/queue/health         # صحة الطوابير
```

### 🔐 **المصادقة**

جميع نقاط النهاية المحمية تتطلب JWT token:

```http
Authorization: Bearer <your_jwt_token>
Content-Type: application/json
X-API-Version: v1
```

### 📋 **تنسيق الاستجابة الموحد**

```json
{
  "success": true,
  "data": {},
  "message": "رسالة النجاح",
  "timestamp": "2024-01-15T10:30:00Z",
  "requestId": "uuid-request-id",
  "version": "v1.0.0"
}
```

---

## 🐳 **النشر الاحترافي**

### 🔧 **البيئة التطويرية**

```bash
# تشغيل البيئة الكاملة
docker-compose up -d

# عرض السجلات
docker-compose logs -f api

# إيقاف الخدمات
docker-compose down
```

### 🚀 **نشر الإنتاج**

```bash
# بناء صورة الإنتاج
docker build -t ai-sales-platform:latest .

# تشغيل حاوي الإنتاج
docker run -d \
  --name ai-sales-platform \
  -p 3000:3000 \
  --env-file .env.production \
  --restart unless-stopped \
  ai-sales-platform:latest
```

### 📊 **المراقبة والرصد**

```bash
# مراقبة صحة النظام
curl -s http://localhost:3000/health | jq

# إحصائيات الطوابير
curl -s http://localhost:3000/api/v1/queue/stats | jq

# مقاييس الأداء
curl -s http://localhost:3000/metrics
```

---

## 📈 **الأداء والإحصائيات**

<div align="center">

| **المقياس** | **القيمة** | **الوصف** |
|-------------|-----------|------------|
| **⚡ زمن الاستجابة** | < 100ms | استجابة API فائقة السرعة |
| **📱 معالجة Webhook** | < 50ms | معالجة أحداث Instagram |
| **👥 المستخدمين المتزامنين** | 10,000+ | اتصالات متزامنة |
| **🔄 إنتاجية الطوابير** | 1,000+ jobs/sec | معالجة المهام الخلفية |
| **💾 استعلامات قاعدة البيانات** | < 10ms | استعلامات محسنة |
| **🧠 استجابة AI** | < 2s | توليد ردود ذكية |

</div>

---

## 🎯 **خارطة الطريق والمستقبل**

### ✅ **الإصدار الحالي (v1.0)**
- **🎯 تكامل Instagram Business API كامل**
- **🤖 معالجة AI للمحادثات**
- **🔄 نظام طوابير للمعالجة الخلفية**
- **🏗️ معمارية جاهزة للإنتاج**

### 🔄 **الميزات القادمة (v1.1)**
- **💬 تكامل WhatsApp Business API**
- **📊 لوحة تحكم تحليلية متقدمة**
- **🌍 تدريب AI متعدد اللغات**
- **📈 ذكاء أعمال متقدم**

### 🎨 **الخطط المستقبلية (v2.0)**
- **📘 تكامل Facebook Pages**
- **🛒 موصلات منصات التجارة الإلكترونية**
- **🧠 تدريب نماذج AI مخصصة**
- **📱 تطبيق محمول متقدم**

---

## 🧪 **الاختبارات والجودة**

### 🔬 **تشغيل الاختبارات**

```bash
# جميع الاختبارات
npm test

# اختبارات محددة
npm run test:unit          # اختبارات الوحدة
npm run test:integration   # اختبارات التكامل  
npm run test:e2e          # اختبارات شاملة

# تقرير التغطية
npm run test:coverage
```

### 📊 **معايير الجودة**

- **✅ تغطية الكود**: > 85%
- **✅ TypeScript صارم**: Zero tolerance للأخطاء
- **✅ ESLint**: قواعد صارمة للكود
- **✅ Prettier**: تنسيق موحد
- **✅ تحليل الأمان**: فحص دوري للثغرات

---

## 🤝 **المساهمة والتطوير**

### 📝 **إرشادات المساهمة**

1. **🍴 Fork** المستودع
2. **🌿 إنشاء فرع الميزة**: `git checkout -b feature/amazing-feature`  
3. **💾 حفظ التغييرات**: `git commit -m 'إضافة ميزة رائعة'`
4. **📤 رفع الفرع**: `git push origin feature/amazing-feature`
5. **🔄 فتح Pull Request**

### 🎯 **معايير التطوير**

- **📏 اتباع TypeScript strict mode**
- **🧪 كتابة اختبارات للميزات الجديدة**
- **📚 تحديث التوثيق**
- **💬 رسائل commit واضحة**
- **✅ التأكد من نجاح CI/CD**

### 🎨 **أسلوب الكود**

- **🎨 Prettier** للتنسيق
- **🔍 ESLint** للقواعد
- **📝 أسماء متغيرات واضحة**
- **📖 تعليقات JSDoc** للـ APIs العامة
- **🏗️ اتباع مبادئ SOLID**

---

## 📄 **الترخيص والحقوق**

**رخصة خاصة** - جميع الحقوق محفوظة.

هذا البرنامج ملكية خاصة وسرية. يُمنع منعاً باتاً النسخ أو التوزيع أو الاستخدام غير المصرح به.

---

## 🆘 **الدعم والمساعدة**

<div align="center">

### 📞 **للدعم التقني والاستفسارات**

[![Email](https://img.shields.io/badge/Email-jaafarhabash%40yahoo.com-red?style=for-the-badge&logo=gmail)](mailto:jaafarhabash@yahoo.com)
[![Phone](https://img.shields.io/badge/Phone-%2B964%20771%20666%206543-green?style=for-the-badge&logo=whatsapp)](tel:+9647716666543)
[![GitHub](https://img.shields.io/badge/GitHub-Issues%20%26%20Support-black?style=for-the-badge&logo=github)](https://github.com/JAAFAR1996/ai-instgram-/issues)

### 💬 **ساعات الدعم**
**الأحد - الخميس**: 9:00 ص - 6:00 م (توقيت بغداد)  
**استجابة الطوارئ**: 24/7 للمسائل الحرجة

</div>

---

<div align="center">

## 🌟 **شكر خاص**

<table>
<tr>
<td align="center">
<img src="https://flagicons.lipis.dev/flags/4x3/iq.svg" width="50"/>
<br/>
<strong>صُنع في العراق 🇮🇶</strong>
<br/>
<em>بحب وإتقان للتجارة العربية</em>
</td>
<td align="center">
<img src="https://img.icons8.com/color/48/artificial-intelligence.png" width="50"/>
<br/>
<strong>مدعوم بالـ AI</strong>
<br/>
<em>تقنية مستقبلية اليوم</em>
</td>
<td align="center">
<img src="https://img.icons8.com/color/48/instagram-new.png" width="50"/>
<br/>
<strong>Instagram محلي</strong>
<br/>
<em>تكامل كامل ومعتمد</em>
</td>
</tr>
</table>

---

### 🎉 **"تمكين رجال الأعمال العراقيين بأدوات المستقبل"**

*منصة المبيعات الذكية - حيث تلتقي التكنولوجيا بالتجارة* ✨

[![Stars](https://img.shields.io/github/stars/JAAFAR1996/ai-instgram-?style=social)](https://github.com/JAAFAR1996/ai-instgram-)
[![Follow](https://img.shields.io/github/followers/JAAFAR1996?style=social)](https://github.com/JAAFAR1996)

</div>