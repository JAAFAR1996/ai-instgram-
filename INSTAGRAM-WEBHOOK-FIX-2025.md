# Instagram Webhook Signature Verification Fix (2025)

## 🚨 المشكلة الأساسية

كانت مشكلة التحقق من توقيع Instagram Webhooks تحدث بسبب:

1. **معالجة الـ Raw Body**: Express.js يقوم بتحويل الـ raw body إلى JSON قبل التحقق من التوقيع
2. **ترتيب Middleware**: JSON parsing middleware يعمل قبل signature verification
3. **خوارزمية التوقيع**: عدم دعم كامل لـ SHA1 و SHA256
4. **معالجة الأخطاء**: نقص في error handling والتشخيص

## ✅ الحلول المطبقة (2025)

### 1. تحسين Raw Body Middleware

```typescript
// CRITICAL: Raw body middleware - MUST be before any JSON parsing
app.use('/webhooks/instagram', async (c, next) => {
  if (c.req.method === 'POST') {
    try {
      // Get raw ArrayBuffer first, before any parsing
      const arrayBuffer = await c.req.arrayBuffer();
      const rawBuffer = Buffer.from(arrayBuffer);
      
      // Store raw body for signature verification
      c.set('rawBody', rawBuffer);
      
      console.log('📦 Raw body captured:', {
        length: rawBuffer.length,
        contentType: c.req.header('content-type') || 'unknown',
        hasSignature: !!c.req.header('X-Hub-Signature-256')
      });
      
    } catch (error) {
      console.error('❌ Failed to capture raw body:', error);
      return c.text('Failed to process request body', 400);
    }
  }
  await next();
});
```

### 2. تحسين دالة التحقق من التوقيع

```typescript
function verifyInstagramSignature(rawBody: Buffer, signature: string): boolean {
  const sigHeaderRaw = (signature || '').trim();
  if (!sigHeaderRaw) return false;

  const appSecret = (META_APP_SECRET || '').trim();
  if (!appSecret) return false;

  // Auto-detect algorithm (SHA1 or SHA256)
  const algo = sigHeaderRaw.toLowerCase().startsWith('sha1=') ? 'sha1' : 'sha256';
  const received = sigHeaderRaw.replace(/^sha(?:1|256)=/i, '').trim().toLowerCase();

  // Validate hex format
  const hexOk = (algo === 'sha1' && /^[a-f0-9]{40}$/.test(received)) ||
                (algo === 'sha256' && /^[a-f0-9]{64}$/.test(received));
  if (!hexOk) return false;

  // Generate expected signature
  const expected = crypto.createHmac(algo, appSecret).update(rawBody).digest('hex');

  // Constant-time comparison for security
  try {
    return crypto.timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
  } catch (e) {
    return false;
  }
}
```

### 3. أدوات التشخيص المتقدمة

تم إنشاء `instagram-signature-debug.js` لتشخيص مشاكل التوقيع:

```bash
# اختبار مع ملف
node instagram-signature-debug.js /tmp/ig.raw "sha256=abc123..."

# اختبار تفاعلي
node instagram-signature-debug.js
```

## 🔧 خطوات النشر

### 1. تحديث متغيرات البيئة

```bash
export META_APP_SECRET="your_instagram_app_secret"
export IG_VERIFY_TOKEN="your_verify_token"
export DEBUG_DUMP="1"  # للتشخيص المؤقت
```

### 2. تشغيل سكريبت النشر

```bash
chmod +x deploy-instagram-fix-2025.sh
./deploy-instagram-fix-2025.sh
```

### 3. اختبار التوقيع محلياً

```bash
# إنشاء payload تجريبي
echo '{"object":"instagram","entry":[{"id":"test"}]}' > test.json

# حساب التوقيع المتوقع
SIGNATURE=$(openssl dgst -sha256 -hmac "$META_APP_SECRET" test.json | awk '{print $2}')

# اختبار التحقق
node instagram-signature-debug.js test.json "sha256=$SIGNATURE"
```

## 🚀 الميزات الجديدة (2025)

### 1. دعم خوارزميات متعد��ة
- **SHA256**: الافتراضي والموصى به
- **SHA1**: للتوافق مع الأنظمة القديمة
- **Auto-detection**: اكتشاف تلقائي للخوارزمية

### 2. تحسينات الأمان
- **Constant-time comparison**: مقارنة آمنة للتوقيعات
- **Input validation**: التحقق من صحة التوقيع والمدخلات
- **Safe logging**: عدم كشف الأسرار في السجلات

### 3. تشخيص متقدم
- **Raw body dumping**: حفظ الـ raw body للتشخيص
- **Debug logging**: سجلات مفصلة للتشخيص
- **Environment validation**: التحقق من متغيرات البيئة

## 🔍 استكشاف الأخطاء

### المشكلة: "Signature verification failed"

**الأسباب المحتملة:**
1. App Secret غير صحيح
2. Raw body تم تحويله إلى JSON
3. مسافات أو أحرف إضافية في التوقيع

**الحلول:**
```bash
# تحقق من App Secret
echo -n "$META_APP_SECRET" | sha256sum | cut -c1-8

# اختبر التوقيع محلياً
node instagram-signature-debug.js /tmp/ig.raw "sha256=your_signature"

# فعّل debug dumping
export DEBUG_DUMP=1
```

### المشكلة: "Raw body already parsed"

**الحل:**
```typescript
// تأكد من ترتيب middleware ا��صحيح
app.use('/webhooks/instagram', rawBodyMiddleware);  // أولاً
app.use('*', express.json());                       // ثانياً
```

### المشكلة: "Invalid signature format"

**الحل:**
```bash
# تحقق من تنسيق التوقيع
# صحيح: sha256=abc123def456...
# خطأ: "sha256=abc123def456..." (مع علامات اقتباس)
```

## 📊 مراقبة الإنتاج

### سجلات النجاح
```
📦 Raw body captured: { length: 1234, contentType: 'application/json', hasSignature: true }
🔍 Signature verification result: true
✅ Instagram webhook verified: instagram
```

### سجلات الفشل
```
❌ Missing X-Hub-Signature-256 header
❌ Bad signature format
❌ Signature mismatch: { algo: 'sha256', provided: 'abc123...', expected: 'def456...' }
```

## 🌐 اختبار الإنتاج

### 1. اختبار Health Check
```bash
curl https://your-domain.com/health
```

### 2. اختبار Webhook Verification
```bash
curl "https://your-domain.com/webhooks/instagram?hub.mode=subscribe&hub.verify_token=$IG_VERIFY_TOKEN&hub.challenge=test"
```

### 3. اختبار Webhook Event
```bash
# استخدم Stripe CLI أو أداة مشابهة لإرسال webhook حقيقي
stripe listen --forward-to https://your-domain.com/webhooks/instagram
```

## 📚 مراجع إضافية

- [Meta Webhooks Documentation](https://developers.facebook.com/docs/messenger-platform/webhooks/)
- [Instagram Business API](https://developers.facebook.com/docs/instagram-api/)
- [Webhook Signature Verification](https://developers.facebook.com/docs/messenger-platform/webhooks/#verify-webhook-signature)
- [Node.js Crypto Module](https://nodejs.org/api/crypto.html)

## 🎯 الخلاصة

تم تطبيق إصلاحات شاملة لمشكلة التحقق من توقيع Instagram Webhooks تتضمن:

✅ **Raw body preservation** - الحفاظ على الـ raw body قبل أي معالجة  
✅ **Enhanced signature verification** - تحسين دالة التحقق من التوقيع  
✅ **Algorithm auto-detection** - دعم SHA1 و SHA256  
✅ **Security improvements** - تحسينات أمنية متقدمة  
✅ **Debug tools** - أدوات تشخيص شاملة  
✅ **Production monitoring** - مراقبة الإنتاج المتقدمة  

هذه الإصلاحات تضمن عمل Instagram Webhooks بشكل موثوق في بيئة الإنتاج لعام 2025.