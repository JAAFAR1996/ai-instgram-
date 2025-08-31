# 🔗 ManyChat Integration - AI Sales Platform

## 📋 نظرة عامة

تم تكامل ManyChat مع منصة AI Sales Platform لتوفير تجربة محادثة متقدمة ومتطورة للعملاء عبر Instagram. هذا التكامل يوفر:

- ✅ **معالجة ذكية للمحادثات** - دمج AI المحلي مع ManyChat
- ✅ **إدارة متقدمة للعملاء** - تتبع شامل للتفاعلات
- ✅ **أتمتة ذكية** - قوالب وردود تلقائية
- ✅ **تحليلات مفصلة** - إحصائيات الأداء والتفاعل
- ✅ **Fallback آمن** - عودة للـ AI المحلي عند الحاجة

---

## 🏗️ البنية التقنية

### التدفق العام:
```
Instagram → Webhook → ManyChat Bridge → ManyChat API → Response → Instagram
    ↓           ↓           ↓              ↓           ↓
   رسالة    استقبال     معالجة ذكية    إرسال عبر    رد ذكي
  العميل    Webhook    مع Fallback    ManyChat    للعميل
```

### المكونات الرئيسية:

1. **`ManyChatService`** - خدمة API ManyChat مع rate limiting
2. **`InstagramManyChatBridge`** - جسر ربط Instagram مع ManyChat
3. **Database Schema** - جداول ManyChat في قاعدة البيانات
4. **Webhook Handler** - معالج محدث لاستخدام Bridge

---

## 🚀 التثبيت والإعداد

### 1. إعداد متغيرات البيئة

أضف المتغيرات التالية إلى ملف `.env`:

```env
# ManyChat API Configuration
MANYCHAT_API_KEY=your_manychat_api_key_here
MANYCHAT_BASE_URL=https://api.manychat.com
MANYCHAT_WEBHOOK_SECRET=your_webhook_secret_here

# ManyChat Flow IDs (Optional but recommended)
MANYCHAT_DEFAULT_FLOW_ID=your_default_flow_id
MANYCHAT_WELCOME_FLOW_ID=your_welcome_flow_id
MANYCHAT_AI_RESPONSE_FLOW_ID=your_ai_response_flow_id
MANYCHAT_COMMENT_RESPONSE_FLOW_ID=your_comment_response_flow_id
MANYCHAT_STORY_RESPONSE_FLOW_ID=your_story_response_flow_id
```

### 2. تشغيل Migration

```bash
# تشغيل migration ManyChat
npm run migrate:up

# أو تشغيل migration محدد
npm run migrate:run 053_manychat_integration
```

### 3. إعداد ManyChat Dashboard

1. **إنشاء حساب ManyChat**
   - الذهاب إلى [ManyChat.com](https://manychat.com)
   - إنشاء حساب جديد
   - ربط حساب Instagram Business

2. **الحصول على API Key**
   - الذهاب إلى Settings > API
   - نسخ API Key

3. **إنشاء Flows**
   - إنشاء flow للردود التلقائية
   - إنشاء flow للترحيب بالعملاء الجدد
   - إنشاء flow لمعالجة التعليقات

---

## 🔧 الاستخدام

### معالجة رسالة Instagram

```typescript
import { getInstagramManyChatBridge } from './services/instagram-manychat-bridge.js';

const bridge = getInstagramManyChatBridge();

const result = await bridge.processMessage({
  merchantId: 'merchant_123',
  customerId: 'customer_456',
  message: 'مرحبا، أريد معرفة الأسعار',
  conversationId: 'conv_789',
  interactionType: 'dm',
  platform: 'instagram'
}, {
  useManyChat: true,
  fallbackToLocalAI: true,
  priority: 'normal',
  tags: ['price_inquiry', 'new_customer']
});

console.log('Processing result:', result);
// Output: { success: true, platform: 'manychat', messageId: 'msg_123' }
```

### إرسال رسالة عبر ManyChat

```typescript
import { getManyChatService } from './services/manychat-api.js';

const manyChat = getManyChatService();

const response = await manyChat.sendMessage(
  'merchant_123',
  'subscriber_456',
  'شكراً لك على رسالتك! سنقوم بالرد عليك قريباً.',
  {
    messageTag: 'CUSTOMER_FEEDBACK',
    flowId: 'welcome_flow_123',
    priority: 'high'
  }
);

console.log('Message sent:', response.success);
```

### إدارة المشتركين

```typescript
// الحصول على معلومات المشترك
const subscriber = await manyChat.getSubscriberInfo(
  'merchant_123',
  'subscriber_456'
);

// تحديث معلومات المشترك
await manyChat.updateSubscriber(
  'merchant_123',
  'subscriber_456',
  {
    first_name: 'أحمد',
    last_name: 'محمد',
    language: 'ar',
    custom_fields: {
      instagram_id: 'ahmed_mohamed',
      last_interaction: new Date().toISOString()
    }
  }
);

// إضافة tags
await manyChat.addTags(
  'merchant_123',
  'subscriber_456',
  ['vip', 'premium', 'active_customer']
);
```

---

## 📊 قاعدة البيانات

### الجداول الجديدة:

1. **`manychat_logs`** - سجل جميع التفاعلات مع ManyChat
2. **`manychat_subscribers`** - معلومات المشتركين
3. **`manychat_flows`** - إعدادات Flows
4. **`manychat_webhooks`** - إعدادات Webhooks

### الاستعلامات المفيدة:

```sql
-- الحصول على سجل ManyChat للمتجر
SELECT * FROM manychat_logs 
WHERE merchant_id = 'merchant_123' 
ORDER BY created_at DESC 
LIMIT 10;

-- الحصول على المشتركين النشطين
SELECT * FROM manychat_subscribers 
WHERE merchant_id = 'merchant_123' 
AND status = 'active' 
AND last_interaction_at > NOW() - INTERVAL '7 days';

-- إحصائيات الأداء
SELECT 
  platform,
  COUNT(*) as total_messages,
  AVG(processing_time_ms) as avg_processing_time,
  COUNT(CASE WHEN status = 'success' THEN 1 END) as successful_messages
FROM manychat_logs 
WHERE merchant_id = 'merchant_123'
GROUP BY platform;
```

---

## 🔄 Fallback Mechanism

النظام يدعم Fallback آمن في حالة فشل ManyChat:

1. **ManyChat** - المحاولة الأولى
2. **Local AI** - Fallback للذكاء الاصطناعي المحلي
3. **Simple Response** - رد بسيط كحل أخير

```typescript
const result = await bridge.processMessage(data, {
  useManyChat: true,        // محاولة ManyChat أولاً
  fallbackToLocalAI: true,  // Fallback للـ AI المحلي
  priority: 'normal'
});

// النتيجة تحتوي على معلومات Fallback
console.log('Platform used:', result.platform); // 'manychat' | 'local_ai' | 'fallback'
```

---

## 📈 المراقبة والتحليلات

### Health Check

```typescript
const health = await manyChat.getHealthStatus();
console.log('ManyChat Health:', health);
// Output: { status: 'healthy', circuitBreaker: {...}, rateLimit: {...} }
```

### Bridge Health

```typescript
const bridgeHealth = await bridge.getHealthStatus();
console.log('Bridge Health:', bridgeHealth);
// Output: { status: 'healthy', manyChat: {...}, localAI: true, instagram: true }
```

### Logs Analysis

```typescript
// الحصول على سجل التفاعلات
const logs = await db.query(`
  SELECT 
    action,
    status,
    platform,
    processing_time_ms,
    created_at
  FROM manychat_logs 
  WHERE merchant_id = $1
  ORDER BY created_at DESC
`, [merchantId]);
```

---

## 🧪 الاختبار

### تشغيل الاختبارات

```bash
# اختبار ManyChat API
npm test src/services/__tests__/manychat-api.test.ts

# اختبار Bridge
npm test src/services/__tests__/instagram-manychat-bridge.test.ts

# اختبار التكامل الكامل
npm run test:integration
```

### اختبار يدوي

```typescript
// اختبار إرسال رسالة
const testResult = await manyChat.sendMessage(
  'test_merchant',
  'test_subscriber',
  'رسالة اختبار'
);

console.log('Test result:', testResult);
```

---

## 🔒 الأمان

### Rate Limiting
- **10 requests per second** - حد أقصى للطلبات
- **Circuit Breaker** - حماية من الفشل المتكرر
- **Exponential Backoff** - إعادة المحاولة الذكية

### Webhook Security
- **HMAC Signature Verification** - التحقق من التوقيع
- **Webhook Secret** - سر آمن للتحقق
- **Request Validation** - التحقق من صحة الطلبات

### Data Protection
- **Row Level Security (RLS)** - عزل البيانات بين المتاجر
- **Encrypted Storage** - تشفير البيانات الحساسة
- **Audit Logging** - سجل شامل للعمليات

---

## 🚨 استكشاف الأخطاء

### مشاكل شائعة:

1. **API Key غير صحيح**
   ```
   Error: Missing required environment variable: MANYCHAT_API_KEY
   ```
   **الحل:** تأكد من إعداد `MANYCHAT_API_KEY` في ملف `.env`

2. **Rate Limit Exceeded**
   ```
   Error: HTTP 429: Rate limit exceeded
   ```
   **الحل:** النظام يتعامل مع هذا تلقائياً، انتظر قليلاً

3. **Subscriber Not Found**
   ```
   Error: Failed to get subscriber info: Subscriber not found
   ```
   **الحل:** المشترك سيتم إنشاؤه تلقائياً

4. **Network Error**
   ```
   Error: Network error: fetch failed
   ```
   **الحل:** النظام سيعود للـ AI المحلي تلقائياً

### Debug Mode

```typescript
// تفعيل debug mode
process.env.DEBUG = 'manychat:*';

// أو في الكود
const logger = getLogger({ component: 'ManyChatService', debug: true });
```

---

## 📚 المراجع

### ManyChat API Documentation
- [ManyChat API Docs](https://api.manychat.com/docs)
- [Webhook Events](https://api.manychat.com/docs/webhooks)
- [Subscriber API](https://api.manychat.com/docs/subscribers)

### Flow Examples
- [Welcome Flow](https://manychat.com/docs/flows/welcome)
- [AI Response Flow](https://manychat.com/docs/flows/ai)
- [Comment Response Flow](https://manychat.com/docs/flows/comments)

### Best Practices
- [Rate Limiting](https://api.manychat.com/docs/rate-limiting)
- [Error Handling](https://api.manychat.com/docs/errors)
- [Security](https://api.manychat.com/docs/security)

---

## 🤝 الدعم

### للحصول على المساعدة:

1. **Documentation** - راجع هذا الدليل أولاً
2. **Logs** - تحقق من سجلات النظام
3. **Health Check** - تحقق من حالة الخدمات
4. **Support** - تواصل مع فريق الدعم

### معلومات الاتصال:
- **Email:** support@ai-sales-platform.com
- **Documentation:** [docs.ai-sales-platform.com](https://docs.ai-sales-platform.com)
- **GitHub Issues:** [github.com/ai-sales-platform/issues](https://github.com/ai-sales-platform/issues)

---

## 📝 Changelog

### v1.0.0 (2024-01-XX)
- ✅ إضافة ManyChat API Service
- ✅ إضافة Instagram ManyChat Bridge
- ✅ إضافة Database Schema
- ✅ إضافة Rate Limiting و Circuit Breaker
- ✅ إضافة Fallback Mechanism
- ✅ إضافة Health Monitoring
- ✅ إضافة Comprehensive Testing
- ✅ إضافة Security Features

---

**🎉 تم تكامل ManyChat بنجاح! النظام جاهز للاستخدام الإنتاجي.**
