# 📋 دليل إدخال بيانات التاجر الشامل

## نظرة عامة

هذا الدليل يوضح كيفية استخدام ملفات إدخال بيانات التاجر والتحقق من الجاهزية للإنتاج في منصة AI Sales Platform.

## 📁 الملفات المتاحة

### 1. `merchant-data-entry-complete.js`
**الملف الرئيسي لإدخال بيانات التاجر**

```bash
node scripts/merchant-data-entry-complete.js
```

**المميزات:**
- ✅ التحقق من صحة البيانات باستخدام Zod Schema
- ✅ حساب درجة الاكتمال (Completeness Score)
- ✅ التحقق من الجاهزية للإنتاج
- ✅ إنشاء التاجر في قاعدة البيانات
- ✅ إدراج قوالب الردود الديناميكية
- ✅ إدراج إعدادات الذكاء الاصطناعي
- ✅ إدراج المنتجات (اختياري)

### 2. `production-readiness-check.js`
**سكريبت التحقق من الجاهزية للإنتاج**

```bash
# فحص النظام العام
node scripts/production-readiness-check.js

# فحص تاجر محدد
node scripts/production-readiness-check.js [merchant_id]
```

**المميزات:**
- 🔍 فحص قاعدة البيانات
- 🔍 فحص التاجر المحدد
- 🔍 فحص الخدمات
- 🔍 فحص الأداء
- 🔍 فحص الأمان
- 📊 تقرير شامل بالنتائج

## 🚀 الاستخدام السريع

### 1. إدخال تاجر جديد

```javascript
import { MerchantDataEntry } from './scripts/merchant-data-entry-complete.js';

const merchantEntry = new MerchantDataEntry();

const merchantData = {
  business_name: 'متجر الأزياء الحديث',
  business_category: 'fashion',
  whatsapp_number: '+964771234567',
  instagram_username: 'modern_fashion_store',
  email: 'info@modernfashion.com',
  currency: 'IQD',
  // ... باقي البيانات
};

const result = await merchantEntry.processMerchantData(merchantData);
console.log(result);
```

### 2. فحص الجاهزية للإنتاج

```javascript
import { ProductionReadinessChecker } from './scripts/production-readiness-check.js';

const checker = new ProductionReadinessChecker();
const result = await checker.runFullCheck('merchant-id-here');
console.log(result);
```

## 📊 معايير التقييم

### درجة الاكتمال (Completeness Score)

| النسبة | التقييم | الوصف |
|--------|---------|--------|
| 90-100% | 🟢 ممتاز | البيانات مكتملة جداً |
| 75-89% | 🟡 جيد | البيانات مكتملة بشكل جيد |
| 60-74% | 🟠 متوسط | البيانات تحتاج تحسين |
| 0-59% | 🔴 ضعيف | البيانات غير مكتملة |

### الجاهزية للإنتاج

| النسبة | الحالة | الوصف |
|--------|---------|--------|
| 80-100% | ✅ جاهز | النظام جاهز للإنتاج |
| 60-79% | ⚠️ يحتاج تحسين | يحتاج تحسينات طفيفة |
| 0-59% | ❌ غير جاهز | يحتاج تحسينات كبيرة |

## 📋 الحقول المطلوبة

### الحقول الأساسية (مطلوبة)
- `business_name` - اسم العمل
- `business_category` - فئة العمل
- `whatsapp_number` - رقم الواتساب
- `currency` - العملة

### الحقول المهمة (موصى بها)
- `instagram_username` - اسم المستخدم في إنستغرام
- `email` - البريد الإلكتروني
- `business_address` - عنوان العمل
- `working_hours` - ساعات العمل
- `payment_methods` - طرق الدفع
- `ai_config` - إعدادات الذكاء الاصطناعي
- `response_templates` - قوالب الردود

### الحقول الاختيارية
- `business_description` - وصف العمل
- `phone` - رقم الهاتف
- `delivery_fees` - رسوم التوصيل
- `products` - المنتجات

## 🔧 إعدادات الذكاء الاصطناعي

```javascript
ai_config: {
  model: 'gpt-4o-mini',           // النموذج المستخدم
  language: 'ar',                 // اللغة
  temperature: 0.7,               // درجة الإبداع (0-1)
  max_tokens: 600,                // الحد الأقصى للكلمات
  tone: 'friendly',               // نبرة الرد
  product_hints: true,            // تلميحات المنتجات
  auto_responses: true            // الردود التلقائية
}
```

## 📝 قوالب الردود

```javascript
response_templates: {
  welcome_message: 'أهلاً بك! كيف يمكنني مساعدتك اليوم؟',
  fallback_message: 'واضح! أعطيني تفاصيل أكثر وسأساعدك فوراً.',
  outside_hours_message: 'نرحب برسالتك، سنعود لك بأقرب وقت ضمن ساعات الدوام.',
  order_confirmation: 'تم تأكيد طلبك بنجاح!',
  payment_confirmation: 'تم استلام الدفع بنجاح!'
}
```

## 🕒 ساعات العمل

```javascript
working_hours: {
  enabled: true,
  timezone: 'Asia/Baghdad',
  schedule: {
    sunday: { open: '10:00', close: '22:00', enabled: true },
    monday: { open: '10:00', close: '22:00', enabled: true },
    tuesday: { open: '10:00', close: '22:00', enabled: true },
    wednesday: { open: '10:00', close: '22:00', enabled: true },
    thursday: { open: '10:00', close: '22:00', enabled: true },
    friday: { open: '14:00', close: '22:00', enabled: true },
    saturday: { open: '10:00', close: '22:00', enabled: false }
  }
}
```

## 💳 طرق الدفع

```javascript
payment_methods: [
  'COD',           // الدفع عند الاستلام
  'ZAIN_CASH',     // زين كاش
  'ASIA_HAWALA',   // آسيا حوالة
  'VISA',          // فيزا
  'MASTERCARD',    // ماستركارد
  'PAYPAL',        // باي بال
  'BANK_TRANSFER'  // تحويل بنكي
]
```

## 📦 المنتجات

```javascript
products: [
  {
    sku: 'SHIRT-001',                    // رمز المنتج
    name_ar: 'قميص قطني رجالي',          // الاسم بالعربية
    name_en: 'Men Cotton Shirt',         // الاسم بالإنجليزية (اختياري)
    description_ar: 'وصف المنتج...',     // الوصف بالعربية
    category: 'fashion',                 // الفئة
    price_usd: 25.0,                     // السعر بالدولار
    stock_quantity: 50,                  // الكمية المتوفرة
    tags: ['رجالي', 'قطني', 'صيفي'],    // العلامات
    is_active: true                      // نشط
  }
]
```

## 🔍 فحوصات الجاهزية للإنتاج

### 1. فحص قاعدة البيانات
- ✅ اتصال قاعدة البيانات
- ✅ وجود الجداول المطلوبة
- ✅ فهارس قاعدة البيانات

### 2. فحص التاجر
- ✅ وجود التاجر
- ✅ البيانات الأساسية
- ✅ الإعدادات
- ✅ إعدادات الذكاء الاصطناعي
- ✅ قوالب الردود
- ✅ المنتجات

### 3. فحص الخدمات
- ✅ خدمات التاجر
- ✅ حالة كل خدمة

### 4. فحص الأداء
- ✅ عدد التجار
- ✅ عدد المنتجات
- ✅ قوالب الردود
- ✅ سرعة قاعدة البيانات

### 5. فحص الأمان
- ✅ متغيرات البيئة
- ✅ قوة كلمة مرور الإدارة
- ✅ اتصال قاعدة البيانات الآمن

## 🚨 استكشاف الأخطاء

### خطأ في الاتصال بقاعدة البيانات
```bash
# تحقق من متغير البيئة
echo $DATABASE_URL

# تحقق من الاتصال
node -e "console.log(process.env.DATABASE_URL)"
```

### خطأ في التحقق من صحة البيانات
```bash
# تحقق من البيانات المدخلة
node -e "
const data = { /* بياناتك */ };
console.log(JSON.stringify(data, null, 2));
"
```

### خطأ في إنشاء التاجر
```bash
# تحقق من الجداول
node scripts/check-db.js
```

## 📈 أمثلة عملية

### مثال 1: تاجر أزياء
```javascript
const fashionMerchant = {
  business_name: 'متجر الأزياء الحديث',
  business_category: 'fashion',
  whatsapp_number: '+964771234567',
  instagram_username: 'modern_fashion_store',
  email: 'info@modernfashion.com',
  currency: 'IQD',
  working_hours: {
    enabled: true,
    timezone: 'Asia/Baghdad',
    schedule: {
      sunday: { open: '10:00', close: '22:00', enabled: true },
      monday: { open: '10:00', close: '22:00', enabled: true },
      tuesday: { open: '10:00', close: '22:00', enabled: true },
      wednesday: { open: '10:00', close: '22:00', enabled: true },
      thursday: { open: '10:00', close: '22:00', enabled: true },
      friday: { open: '14:00', close: '22:00', enabled: true },
      saturday: { open: '10:00', close: '22:00', enabled: false }
    }
  },
  payment_methods: ['COD', 'ZAIN_CASH', 'ASIA_HAWALA'],
  ai_config: {
    model: 'gpt-4o-mini',
    language: 'ar',
    temperature: 0.7,
    max_tokens: 600,
    tone: 'friendly'
  },
  response_templates: {
    welcome_message: 'أهلاً بك في متجر الأزياء الحديث! كيف يمكنني مساعدتك اليوم؟',
    fallback_message: 'واضح! أعطيني تفاصيل أكثر عن المنتج الذي تبحث عنه وسأساعدك فوراً.',
    outside_hours_message: 'نرحب برسالتك، سنعود لك بأقرب وقت ضمن ساعات الدوام.'
  }
};
```

### مثال 2: تاجر إلكترونيات
```javascript
const electronicsMerchant = {
  business_name: 'أحمد للموبايلات',
  business_category: 'electronics',
  whatsapp_number: '+964771234567',
  instagram_username: 'ahmed_mobiles',
  email: 'info@ahmedmobiles.com',
  currency: 'IQD',
  working_hours: {
    enabled: true,
    timezone: 'Asia/Baghdad',
    schedule: {
      sunday: { open: '09:00', close: '21:00', enabled: true },
      monday: { open: '09:00', close: '21:00', enabled: true },
      tuesday: { open: '09:00', close: '21:00', enabled: true },
      wednesday: { open: '09:00', close: '21:00', enabled: true },
      thursday: { open: '09:00', close: '21:00', enabled: true },
      friday: { open: '14:00', close: '21:00', enabled: true },
      saturday: { open: '09:00', close: '21:00', enabled: true }
    }
  },
  payment_methods: ['COD', 'ZAIN_CASH', 'VISA', 'MASTERCARD'],
  ai_config: {
    model: 'gpt-4o-mini',
    language: 'ar',
    temperature: 0.6,
    max_tokens: 500,
    tone: 'professional'
  },
  response_templates: {
    welcome_message: 'أهلاً بك في أحمد للموبايلات! كيف يمكنني مساعدتك في اختيار الهاتف المناسب؟',
    fallback_message: 'واضح! أخبرني عن نوع الهاتف الذي تبحث عنه (سامسونج، آيفون، هواوي...) وسأساعدك.',
    outside_hours_message: 'نرحب برسالتك، سنعود لك بأقرب وقت ضمن ساعات الدوام (9:00 - 21:00).'
  }
};
```

## 🎯 أفضل الممارسات

### 1. إدخال البيانات
- ✅ استخدم أسماء واضحة ومفهومة
- ✅ تأكد من صحة أرقام الهواتف
- ✅ حدد ساعات عمل واقعية
- ✅ اختر طرق دفع مناسبة للسوق المحلي

### 2. إعدادات الذكاء الاصطناعي
- ✅ استخدم `gpt-4o-mini` للأداء المتوازن
- ✅ اضبط `temperature` بين 0.6-0.8
- ✅ حدد `max_tokens` حسب طول الردود المطلوبة
- ✅ اختر نبرة مناسبة لنوع العمل

### 3. قوالب الردود
- ✅ اجعل الرسائل ودودة ومهنية
- ✅ استخدم اللغة العربية الفصحى
- ✅ تجنب الرسائل الطويلة جداً
- ✅ أضف معلومات مفيدة (ساعات العمل، طرق الدفع)

### 4. المنتجات
- ✅ استخدم رموز منتجات واضحة (SKU)
- ✅ أضف أوصاف مفصلة
- ✅ حدد الأسعار بدقة
- ✅ استخدم علامات (tags) مناسبة

## 🔧 التخصيص المتقدم

### إضافة حقول مخصصة
```javascript
// في MerchantDataSchema
const CustomMerchantSchema = MerchantDataSchema.extend({
  custom_field: z.string().optional(),
  business_license: z.string().optional(),
  tax_number: z.string().optional()
});
```

### إضافة فئات منتجات جديدة
```javascript
const customCategories = [
  'general', 'fashion', 'electronics', 'beauty', 
  'home', 'sports', 'grocery', 'automotive', 
  'health', 'education', 'books', 'toys'
];
```

### إضافة طرق دفع جديدة
```javascript
const customPaymentMethods = [
  'COD', 'ZAIN_CASH', 'ASIA_HAWALA', 'VISA', 
  'MASTERCARD', 'PAYPAL', 'BANK_TRANSFER',
  'CRYPTO', 'GIFT_CARD'
];
```

## 📞 الدعم والمساعدة

إذا واجهت أي مشاكل أو تحتاج مساعدة:

1. **تحقق من السجلات**: راجع رسائل الخطأ في وحدة التحكم
2. **فحص قاعدة البيانات**: استخدم `check-db.js` للتحقق من الاتصال
3. **فحص الجاهزية**: استخدم `production-readiness-check.js` للتشخيص
4. **مراجعة الوثائق**: راجع هذا الدليل والملفات ذات الصلة

## 🎉 الخلاصة

ملفات إدخال بيانات التاجر توفر:
- ✅ **إدخال آمن وموثوق** للبيانات
- ✅ **التحقق التلقائي** من صحة البيانات
- ✅ **تقييم شامل** للجاهزية للإنتاج
- ✅ **إنشاء تلقائي** لجميع الجداول المطلوبة
- ✅ **إعدادات ذكية** للذكاء الاصطناعي
- ✅ **قوالب ردود** جاهزة للاستخدام

**النظام جاهز لإضافة تجار جدد بكفاءة وأمان!** 🚀
