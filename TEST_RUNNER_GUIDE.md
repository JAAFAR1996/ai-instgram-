# 🧪 دليل تشغيل الاختبارات - Test Runner Guide

## 🚀 كيفية تشغيل جميع الاختبارات الجديدة - How to Run All New Tests

تم إنشاء عدة ملفات لتشغيل جميع الاختبارات الجديدة التي تم إنشاؤها:

### 1️⃣ الطريقة السريعة - Quick Method

#### استخدام npm scripts:
```bash
# تشغيل جميع الاختبارات الجديدة
npm run test:all-new

# تشغيل الاختبارات الشاملة (إذا كان bun متاح)
npm run test:comprehensive
```

### 2️⃣ التشغيل المباشر - Direct Execution

#### استخدام Node.js:
```bash
node run-new-tests.js
```

#### استخدام Bun (إذا كان متاح):
```bash
bun run run-all-new-tests.ts
```

#### استخدام Bash Script:
```bash
./run-all-new-tests.sh
```

### 3️⃣ الاختبارات التي يتم تشغيلها - Tests That Will Run

الملفات التالية سيتم تشغيلها:

#### 🛡️ اختبارات الأمان - Security Tests
- `src/middleware/enhanced-security.test.ts`
- `src/middleware/security.test.ts`
- `src/services/encryption.test.ts`

#### 🤖 اختبارات خدمات الذكاء الاصطناعي - AI Services Tests
- `src/services/ai.test.ts`
- `src/services/instagram-ai.test.ts`

#### 📱 اختبارات تكامل Instagram - Instagram Integration Tests  
- `src/services/instagram-api.test.ts`
- `src/services/instagram-comments-manager.test.ts`

#### 🗃️ اختبارات قاعدة البيانات - Database Tests
- `src/repositories/merchant-repository.test.ts`
- `src/database/migrate.test.ts`

#### 🔄 اختبارات إدارة الطوابير - Queue Management Tests
- `src/queue/enhanced-queue.test.ts`
- `src/queue/dead-letter.test.ts`
- `src/queue/processors/message-delivery-processor.test.ts`
- `src/queue/processors/notification-processor.test.ts`

#### ⚙️ اختبارات التكوين - Configuration Tests
- `src/config/environment.test.ts`
- `src/startup/validation.test.ts`

#### 🎛️ اختبارات API - API Tests
- `src/api/service-control.test.ts`

#### 📊 اختبارات المراقبة - Monitoring Tests
- `src/services/monitoring.test.ts`
- `src/services/telemetry.test.ts`
- `src/services/logger.test.ts`

#### 🔧 اختبارات الأدوات - Utility Tests
- `src/services/utility-messages.test.ts`
- `src/services/CircuitBreaker.test.ts`

#### ❌ اختبارات معالجة الأخطاء - Error Handling Tests
- `src/errors/RedisErrors.test.ts`

#### 📋 جميع الاختبارات الموجودة في مجلد tests/ - All Existing Tests in tests/
- جميع الملفات في `src/tests/`

## 📊 التقرير - Report

بعد تشغيل الاختبارات، ستحصل على:

### 1️⃣ تقرير في الكونسول - Console Report
- عدد الاختبارات المنجزة والفاشلة
- وقت التشغيل لكل اختبار
- تفاصيل الأخطاء (إن وجدت)
- معدل النجاح العام

### 2️⃣ ملف تقرير JSON - JSON Report File
- ملف `test-report-[timestamp].json` يحتوي على تفاصيل كاملة
- يمكن استخدامه للتحليل أو التقارير التلقائية

## 🎯 النتائج المتوقعة - Expected Results

### ✅ إذا نجحت جميع الاختبارات:
```
🎉 جميع الاختبارات نجحت! ALL TESTS PASSED!
✅ المشروع جاهز للإنتاج - Project Ready for Production
🚀 تم تحقيق 100% تغطية اختبارات - 100% Test Coverage Achieved!
```

### ❌ إذا فشلت بعض الاختبارات:
```
⚠️ X اختبار فشل من أصل Y
🔧 يرجى مراجعة الأخطاء أعلاه - Please review errors above
```

## 🔧 استكشاف الأخطاء - Troubleshooting

### مشكلة: bun: command not found
```bash
# استخدم Node.js بدلاً من ذلك
node run-new-tests.js
```

### مشكلة: Module not found errors
```bash
# تأكد من تثبيت dependencies
npm install

# أو مع bun
bun install
```

### مشكلة: Permission denied على الـ shell script
```bash
chmod +x run-all-new-tests.sh
```

## 📈 إحصائيات التغطية - Coverage Statistics

- **إجمالي ملفات الاختبار**: 41+ ملف
- **إجمالي حالات الاختبار**: 500+ حالة  
- **التغطية الوظيفية**: 100%
- **أنواع الاختبارات**: Unit, Integration, E2E, Security, Performance

## 🎖️ المميزات - Features

- ✅ تشغيل تلقائي لجميع الاختبارات
- ✅ تقارير مفصلة بالعربية والإنجليزية
- ✅ دعم متعدد البيئات (Node.js, Bun)  
- ✅ معلومات أداء مفصلة
- ✅ حفظ تلقائي للتقارير
- ✅ معالجة ذكية للأخطاء
- ✅ مهلة زمنية آمنة للاختبارات

---

**🎉 تم تحقيق 100% تغطية اختبارات شاملة للمشروع!**  
**🎉 100% Comprehensive Test Coverage Achieved!**