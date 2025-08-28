# 🔄 التسلسل الصحيح للعملية - Instagram → Webhook → AI → ManyChat → Instagram

## 📋 نظرة عامة على التسلسل

```
Instagram → Webhook → AI Processing → ManyChat API → Instagram
    ↓           ↓           ↓              ↓           ↓
   رسالة    استقبال     معالجة ذكية    إرسال عبر    رد ذكي
  العميل    Webhook    اصطناعية      ManyChat    للعميل
```

---

## 🎯 التسلسل التفصيلي للعملية

### 1️⃣ **Instagram (العميل)**
- **المصدر**: العميل يرسل رسالة عبر Instagram DM
- **الأنواع المدعومة**:
  - رسائل نصية
  - صور
  - فيديوهات
  - ملصقات
  - ردود على القصص
  - تعليقات على المنشورات

### 2️⃣ **Webhook (استقبال)**
- **النقطة**: `/webhooks/instagram` (POST)
- **المعالج**: `InstagramWebhookHandler`
- **الوظائف**:
  - التحقق من صحة التوقيع (HMAC-SHA256)
  - استخراج بيانات الرسالة
  - تحديد نوع التفاعل (DM, Comment, Story)
  - إضافة المهمة إلى Queue للمعالجة

```typescript
// مثال على معالجة Webhook
private async processMessagingEvent(
  event: InstagramMessagingEvent,
  merchantId: string
): Promise<number> {
  // 1. استخراج معرف العميل
  const customerId = event.sender?.id;
  
  // 2. إنشاء أو العثور على المحادثة
  const conversation = await this.findOrCreateConversation(
    merchantId, customerId, 'instagram'
  );
  
  // 3. حفظ الرسالة في قاعدة البيانات
  await this.saveMessage(conversation.id, event);
  
  // 4. إضافة مهمة AI للمعالجة
  await this.queueManager.addAIJob(conversation.id, merchantId, customerId);
  
  return 1; // عدد الرسائل المعالجة
}
```

### 3️⃣ **معالجة الذكاء الاصطناعي (AI Processing)**
- **المعالج**: `ConversationAIOrchestrator`
- **الخدمة**: `InstagramAIService`
- **الوظائف**:
  - تحليل سياق المحادثة
  - توليد رد ذكي باللغة العربية العراقية
  - تحديد نية العميل
  - إعداد البيانات لإرسالها عبر ManyChat

```typescript
// مثال على معالجة AI
public async generateAIResponse(
  conversationId: string,
  merchantId: string,
  customerMessage: string
): Promise<AIResponse> {
  // 1. تحليل سياق المحادثة
  const context = await this.buildConversationContext(conversationId);
  
  // 2. توليد رد ذكي
  const aiResponse = await this.openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'أنت مساعد تجاري عراقي ودود ومهني...'
      },
      {
        role: 'user',
        content: customerMessage
      }
    ],
    max_tokens: 500,
    temperature: 0.7
  });
  
  // 3. إعداد البيانات لـ ManyChat
  const manyChatData = {
    recipient_id: context.customerId,
    message: aiResponse.choices[0].message.content,
    platform: 'instagram',
    conversation_id: conversationId
  };
  
  return {
    response: aiResponse.choices[0].message.content,
    manyChatPayload: manyChatData,
    context: context
  };
}
```

### 4️⃣ **ManyChat API (إرسال)**
- **النقطة**: `/api/utility-messages/:merchantId/send`
- **المعالج**: `UtilityMessagesService`
- **الوظائف**:
  - إرسال الرسالة عبر ManyChat API
  - تتبع حالة التسليم
  - معالجة الأخطاء وإعادة المحاولة

```typescript
// مثال على إرسال عبر ManyChat
public async sendUtilityMessage(
  merchantId: string,
  messageData: UtilityMessageRequest
): Promise<SendResult> {
  try {
    // 1. الحصول على بيانات ManyChat للتاجر
    const manyChatConfig = await this.getManyChatConfig(merchantId);
    
    // 2. إرسال الرسالة عبر ManyChat API
    const response = await fetch('https://api.manychat.com/fb/sending/sendContent', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${manyChatConfig.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        subscriber_id: messageData.recipient_id,
        content: [{
          type: 'text',
          text: messageData.message
        }],
        message_tag: 'CUSTOMER_FEEDBACK'
      })
    });
    
    // 3. معالجة الاستجابة
    const result = await response.json();
    
    if (result.status === 'success') {
      return {
        success: true,
        message_id: result.message_id,
        timestamp: new Date()
      };
    } else {
      throw new Error(`ManyChat API error: ${result.error}`);
    }
    
  } catch (error) {
    // 4. معالجة الأخطاء وإعادة المحاولة
    await this.handleManyChatError(error, merchantId, messageData);
    throw error;
  }
}
```

### 5️⃣ **Instagram (الرد)**
- **المعالج**: `InstagramMessageSender`
- **الوظائف**:
  - إرسال الرد النهائي للعميل
  - تتبع حالة التسليم
  - تحديث قاعدة البيانات

```typescript
// مثال على إرسال الرد النهائي
public async sendTextMessage(
  merchantId: string,
  recipientId: string,
  message: string,
  conversationId?: string
): Promise<SendResult> {
  try {
    // 1. التحقق من نافذة الرسائل
    if (conversationId) {
      const canSendMessage = await this.checkMessageWindow(merchantId, recipientId);
      if (!canSendMessage) {
        // استخدام template message إذا انتهت النافذة
        return await this.sendTemplateOrBroadcast(merchantId, recipientId, message);
      }
    }
    
    // 2. إرسال الرسالة عبر Instagram API
    const client = await this.getClient(merchantId);
    const credentials = await this.getCredentials(merchantId);
    
    const response = await client.sendMessage(credentials, merchantId, {
      recipientId,
      messagingType: 'RESPONSE',
      text: message
    });
    
    // 3. تحديث حالة التسليم
    const result: SendResult = {
      success: response.success,
      deliveryStatus: response.success ? 'sent' : 'failed',
      timestamp: new Date(),
      messageId: response.messageId
    };
    
    // 4. تسجيل الرسالة في قاعدة البيانات
    await this.logMessageSent(merchantId, recipientId, message, result, conversationId);
    
    return result;
    
  } catch (error) {
    // 5. معالجة الأخطاء
    await this.handleSendError(error, merchantId, recipientId);
    throw error;
  }
}
```

---

## 🔄 معالجة الطوابير (Queue Processing)

### **ProductionQueueManager**
- **الوظيفة**: إدارة المهام غير المتزامنة
- **المعالجات**:
  1. `process-webhook`: معالجة webhooks الواردة
  2. `ai-response`: توليد ردود AI
  3. `message-delivery`: إرسال الرسائل
  4. `cleanup`: تنظيف البيانات القديمة

```typescript
// مثال على معالج Queue
const webhookProcessor = async (job: Job) => {
  const { eventId, merchantId, platform, payload } = job.data;
  
  // 1. معالجة Webhook
  const webhookResult = await this.processWebhookJob(job.data);
  
  // 2. إضافة مهمة AI
  if (webhookResult.success) {
    await this.queue.add('ai-response', {
      conversationId: webhookResult.conversationId,
      merchantId,
      customerId: webhookResult.customerId,
      message: webhookResult.message
    });
  }
  
  return webhookResult;
};
```

---

## 🛡️ الأمان والتحقق

### **HMAC Signature Verification**
```typescript
export function verifySignature(
  signature: string,
  rawBody: Buffer,
  appSecret: string
): void {
  const result = verifyHMACRaw(rawBody, signature, appSecret);
  if (!result.ok) {
    throw new Error(`Invalid signature: ${result.reason}`);
  }
}
```

### **Rate Limiting**
```typescript
// حماية من إساءة الاستخدام
app.use('/webhooks/*', rateLimiter);
```

---

## 📊 مراقبة الأداء

### **Health Checks**
- `/health`: حالة النظام العامة
- `/api/queue/stats`: إحصائيات الطوابير
- `/api/queue/health`: صحة نظام الطوابير

### **Telemetry**
```typescript
// تتبع الأداء
telemetry.recordWebhookProcessing({
  merchantId,
  platform: 'instagram',
  processingTime: duration,
  success: result.success
});
```

---

## 🔧 التكوين المطلوب

### **متغيرات البيئة**
```env
# Instagram/Meta Configuration
IG_APP_ID=your_instagram_app_id
IG_APP_SECRET=your_instagram_app_secret
META_APP_SECRET=your_meta_app_secret
IG_VERIFY_TOKEN=your_webhook_verify_token

# OpenAI Configuration
OPENAI_API_KEY=sk-your_openai_api_key
OPENAI_MODEL=gpt-4o-mini

# ManyChat Configuration
MANYCHAT_API_KEY=your_manychat_api_key
MANYCHAT_BASE_URL=https://api.manychat.com

# Security
ENCRYPTION_KEY=your_32_character_key
JWT_SECRET=your_jwt_secret
```

---

## 🎯 ملخص التسلسل

1. **Instagram** → العميل يرسل رسالة
2. **Webhook** → استقبال وتوثيق الرسالة
3. **Queue** → إضافة مهمة للمعالجة
4. **AI** → توليد رد ذكي
5. **ManyChat** → إرسال عبر ManyChat API
6. **Instagram** → إرسال الرد النهائي للعميل

### **المميزات الرئيسية**:
- ✅ معالجة غير متزامنة عالية الأداء
- ✅ أمان متقدم مع HMAC verification
- ✅ دعم اللغة العربية العراقية
- ✅ تتبع شامل للأداء
- ✅ معالجة الأخطاء وإعادة المحاولة
- ✅ دعم الوسائط المتعددة

---

## 🚀 جاهز للاستخدام الإنتاجي

هذا التسلسل مُحسَّن ومُختبر للإنتاج، مع دعم كامل لـ:
- Instagram DMs, Stories, Comments
- معالجة AI ذكية
- تكامل ManyChat
- مراقبة شاملة
- أمان متقدم

