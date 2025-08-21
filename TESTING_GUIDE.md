# 🧪 دليل الاختبارات الشامل - AI Sales Platform Testing Guide

## 🚀 **البدء السريع - Quick Start**

### **تشغيل جميع الاختبارات**
```bash
# الطريقة الأسهل - تشغيل جميع الاختبارات
npm run test:all

# أو باستخدام bun مباشرة
bun run-all-tests.ts
```

### **عرض قائمة الاختبارات المتاحة**
```bash
npm run test:all:list
# أو
bun run-all-tests.ts --list
```

---

## 📋 **الأوامر المتاحة - Available Commands**

### **🔥 الاختبارات الأساسية**
```bash
npm run test:all              # جميع الاختبارات
npm run test:all:list         # عرض قائمة المجموعات
npm run test:critical         # الاختبارات الحرجة فقط
```

### **🎯 اختبارات محددة**
```bash
npm run test:security         # اختبارات الأمان
npm run test:api              # اختبارات الـ API
npm run test:repository       # اختبارات قاعدة البيانات
npm run test:circuit          # اختبارات Circuit Breaker
npm run test:migration        # اختبارات الهجرة
npm run test:monitoring       # اختبارات المراقبة
```

### **📱 اختبارات Instagram المتخصصة**
```bash
npm run test:instagram        # اختبارات Instagram الأساسية
npm run test:instagram:all    # جميع اختبارات Instagram
npm run test:instagram:e2e    # اختبارات E2E
```

---

## 🏗️ **بنية الاختبارات - Test Structure**

### **📂 المجلدات والملفات**
```
src/
├── api/
│   └── service-control.test.ts       # اختبارات API التحكم
├── repositories/
│   └── merchant-repository.test.ts   # اختبارات مستودع التجار
├── services/
│   ├── CircuitBreaker.test.ts        # اختبارات Circuit Breaker
│   ├── encryption.test.ts            # اختبارات التشفير
│   └── monitoring.test.ts            # اختبارات المراقبة
├── database/
│   └── migrate.test.ts               # اختبارات الهجرة
├── tests/
│   ├── instagram-*.test.ts           # اختبارات Instagram
│   ├── security-*.test.ts            # اختبارات الأمان
│   └── performance-*.test.ts         # اختبارات الأداء
└── queue/
    └── *.test.ts                     # اختبارات الطوابير
```

### **🎨 أنماط التشغيل**
```bash
# بالاسم
bun run-all-tests.ts instagram

# بعدة أنماط
bun run-all-tests.ts security api repository

# بالمسار
bun run-all-tests.ts src/services/

# عرض المساعدة
bun run-all-tests.ts --help
```

---

## 📊 **مجموعات الاختبارات - Test Suites**

### **🔴 أولوية عالية - HIGH PRIORITY**

#### **1. Security & Encryption** 🔒
- **الوصف:** اختبارات الأمان والتشفير
- **الملف:** `src/services/encryption.test.ts`
- **يغطي:** HMAC، تشفير الرموز، حماية البيانات

#### **2. Service Control API** 🔧
- **الوصف:** اختبارات API التحكم في الخدمات
- **الملف:** `src/api/service-control.test.ts`
- **يغطي:** تفعيل/إيقاف الخدمات، إدارة الحالات، مراقبة الصحة

#### **3. Merchant Repository** 🏪
- **الوصف:** اختبارات طبقة الوصول للبيانات
- **الملف:** `src/repositories/merchant-repository.test.ts`
- **يغطي:** CRUD العمليات، تتبع الاستخدام، الاشتراكات

#### **4. Circuit Breaker** ⚡
- **الوصف:** اختبارات نمط المقاومة
- **الملف:** `src/services/CircuitBreaker.test.ts`
- **يغطي:** كشف الأعطال، الاسترداد التلقائي، إحصائيات الأداء

#### **5. Database Migration** 🔄
- **الوصف:** اختبارات هجرة قاعدة البيانات
- **الملف:** `src/database/migrate.test.ts`
- **يغطي:** تنفيذ الهجرات، تحويل البيانات، التراجع الآمن

### **🟡 أولوية متوسطة - MEDIUM PRIORITY**

#### **6. Monitoring & Analytics** 📈
- **الوصف:** اختبارات المراقبة والتحليلات
- **الملف:** `src/services/monitoring.test.ts`
- **يغطي:** جمع المقاييس، التنبيهات، لوحات المراقبة

#### **7. Instagram Integration** 📱
- **الوصف:** اختبارات تكامل Instagram
- **الملف:** `src/tests/instagram-integration.test.ts`
- **يغطي:** Webhook، إدارة الوسائط، إرسال الرسائل

#### **8. Rate Limiting** 🚦
- **الوصف:** اختبارات تحديد المعدل
- **الملف:** `src/tests/meta-rate-limiter.test.ts`
- **يغطي:** حماية من الإفراط، حدود Instagram API

---

## 🎯 **مثال على التشغيل - Example Run**

```bash
$ npm run test:all

═══════════════════════════════════════════════════════════════════════════════
🚀 AI SALES PLATFORM - مشغل الاختبارات الشامل
   Comprehensive Test Suite Runner
═══════════════════════════════════════════════════════════════════════════════
📋 المجموعات المتاحة: 18
⏰ وقت البدء: 15/1/2025, 10:30:00 ص
═══════════════════════════════════════════════════════════════════════════════

🚀 بدء تشغيل 18 مجموعة اختبارات...

🔄 تشغيل: Security & Encryption
   📄 اختبارات الأمان والتشفير - حماية البيانات الحساسة
   📁 src/services/encryption.test.ts
   ────────────────────────────────────────────────────────────────

✓ verifyHMAC returns false for signatures with wrong length
✓ readRawBody throws 413 when payload exceeds limit
✓ returns payload for valid token
✓ throws on invalid JSON
✓ throws when required keys missing

   ✅ PASS - Security & Encryption 🔴
   📊 النتائج: 5/5 نجح
   ⏱️  المدة: 150ms
   ────────────────────────────────────────────────────────────────

...

═══════════════════════════════════════════════════════════════════════════════
📈 التقرير النهائي - FINAL REPORT
═══════════════════════════════════════════════════════════════════════════════
📊 إجمالي المجموعات المختبرة: 18
🧪 إجمالي الاختبارات: 247
✅ نجح: 235 (95.14%)
❌ فشل: 12 (4.86%)
⏱️  إجمالي الوقت: 45.67 ثانية

────────────────────────────────────────────────────────────────────────────────
🎯 تقييم الجودة:
────────────────────────────────────────────────────────────────────────────────
📈 النتيجة الإجمالية: 95.14% - 🏆 ممتاز - Excellent
🎯 التوصية: ✅ جاهز للإنتاج - Ready for Production

📊 تقرير الأولوية:
🔴 عالية الأولوية: 11/11 (100%)

═══════════════════════════════════════════════════════════════════════════════
🏁 انتهى تشغيل جميع الاختبارات
   مجموعة الاختبارات الشاملة للـ AI Sales Platform
═══════════════════════════════════════════════════════════════════════════════
```

---

## 🔧 **إعداد البيئة - Environment Setup**

### **متطلبات النظام**
```bash
# Node.js >= 20.12.0
# Bun >= 1.0.0
# PostgreSQL >= 14
# Redis >= 6.0
```

### **متغيرات البيئة المطلوبة**
```env
# ملف .env.test
DATABASE_URL=postgresql://test:test@localhost:5432/ai_sales_test
REDIS_URL=redis://localhost:6379/1
ENCRYPTION_KEY_HEX=your-test-encryption-key
INSTAGRAM_TEST_TOKEN=your-test-token
NODE_ENV=test
```

### **إعداد قاعدة البيانات للاختبار**
```bash
# إنشاء قاعدة بيانات الاختبار
createdb ai_sales_test

# تشغيل الهجرات
npm run db:migrate

# إدخال البيانات التجريبية (اختياري)
npm run db:seed
```

---

## 📋 **نصائح للمطورين - Developer Tips**

### **🚀 أفضل الممارسات**

1. **تشغيل الاختبارات قبل الـ Commit**
   ```bash
   npm run test:critical  # الاختبارات الحرجة فقط
   ```

2. **اختبار الوظائف الجديدة**
   ```bash
   # إذا أضفت وظيفة API جديدة
   npm run test:api
   
   # إذا عدلت على قاعدة البيانات
   npm run test:repository
   ```

3. **مراقبة الأداء**
   ```bash
   # اختبار الأداء تحت الحمولة
   npm run test:monitoring
   ```

### **🔍 تشخيص الأخطاء**

#### **إذا فشل اختبار معين:**
```bash
# تشغيل اختبار محدد فقط
bun test src/path/to/specific.test.ts

# مع تفاصيل أكثر
bun test src/path/to/specific.test.ts --verbose
```

#### **إذا فشلت اختبارات قاعدة البيانات:**
```bash
# إعادة تعيين قاعدة البيانات
npm run db:reset
npm run db:migrate
```

#### **إذا فشلت اختبارات Redis:**
```bash
# تأكد من تشغيل Redis
redis-cli ping  # يجب أن يرجع "PONG"
```

### **🎨 إضافة اختبارات جديدة**

1. **إنشاء ملف الاختبار:**
   ```typescript
   // src/services/my-new-service.test.ts
   import { describe, test, expect } from 'bun:test';
   import { MyNewService } from './my-new-service.js';
   
   describe('MyNewService', () => {
     test('should work correctly', async () => {
       const service = new MyNewService();
       const result = await service.doSomething();
       expect(result).toBeDefined();
     });
   });
   ```

2. **إضافة المجموعة للمشغل:**
   ```typescript
   // في run-all-tests.ts
   {
     name: 'My New Service',
     pattern: 'src/services/my-new-service.test.ts',
     description: 'وصف الخدمة الجديدة',
     priority: 'MEDIUM'
   }
   ```

---

## 📊 **تقارير التغطية - Coverage Reports**

### **قياس التغطية**
```bash
# تشغيل مع تقرير التغطية
bun test --coverage

# عرض تقرير HTML
bun test --coverage --coverage-reporter=html
open coverage/index.html
```

### **أهداف التغطية**
- **🎯 الهدف العام:** 95%+
- **🔴 الوظائف الحرجة:** 100%
- **🟡 الوظائف العادية:** 90%+
- **🟢 الوظائف المساعدة:** 80%+

---

## 🚀 **CI/CD Integration**

### **في GitHub Actions:**
```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: npm run test:all
```

### **في GitLab CI:**
```yaml
# .gitlab-ci.yml
test:
  stage: test
  image: oven/bun:latest
  script:
    - bun install
    - npm run test:all
  coverage: '/Coverage: \d+\.\d+%/'
```

---

## 📞 **الدعم والمساعدة - Support**

### **🆘 إذا احتجت مساعدة:**

1. **مراجعة التوثيق:** هذا الملف
2. **فحص الأخطاء الشائعة:** القسم أعلاه
3. **تشغيل التشخيص:** `npm run test:all:list`
4. **التواصل مع الفريق:** Slack #testing-support

### **🐛 الإبلاغ عن خطأ:**
- **العنوان:** وصف مختصر للمشكلة
- **الوصف:** خطوات إعادة الإنتاج
- **البيئة:** نظام التشغيل، إصدار Bun/Node
- **اللوغات:** نسخ لصق مخرجات الخطأ

---

**🎉 مبروك! الآن لديك نظام اختبارات شامل وقوي لمنصة AI Sales Platform!**

**آخر تحديث:** 15 يناير 2025  
**الإصدار:** 1.0.0  
**الحالة:** ✅ جاهز للإنتاج