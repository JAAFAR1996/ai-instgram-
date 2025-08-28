# 🔗 دليل تكامل ManyChat - AI Sales Platform

## 📋 نظرة عامة على التكامل

```
Instagram Webhook → AI Processing → ManyChat API → Instagram Response
      ↓                ↓                ↓              ↓
   استقبال رسالة    توليد رد ذكي    إرسال عبر      رد نهائي
   العميل          بالعربية        ManyChat      للعميل
```

---

## 🎯 لماذا ManyChat؟

### **المميزات الرئيسية**:
- ✅ **إدارة متقدمة للمحادثات** - تتبع شامل للعملاء
- ✅ **أتمتة ذكية** - قوالب وردود تلقائية
- ✅ **تحليلات مفصلة** - إحصائيات الأداء
- ✅ **تكامل سهل** - API بسيط وقوي
- ✅ **دعم متعدد المنصات** - Instagram, Facebook, WhatsApp

---

## 🔧 إعداد ManyChat

### 1️⃣ **إنشاء حساب ManyChat**
```bash
# 1. الذهاب إلى https://manychat.com
# 2. إنشاء حساب جديد
# 3. ربط حساب Instagram Business
# 4. الحصول على API Key
```

### 2️⃣ **تكوين متغيرات البيئة**
```env
# ManyChat Configuration
MANYCHAT_API_KEY=your_manychat_api_key_here
MANYCHAT_BASE_URL=https://api.manychat.com
MANYCHAT_WEBHOOK_SECRET=your_webhook_secret_here

# Merchant-specific ManyChat settings
MANYCHAT_DEFAULT_FLOW_ID=your_default_flow_id
MANYCHAT_WELCOME_MESSAGE_FLOW=your_welcome_flow_id
```

### 3️⃣ **إعداد Flows في ManyChat**
```json
{
  "flow_name": "Instagram AI Response",
  "triggers": [
    {
      "type": "webhook",
      "endpoint": "/api/manychat/webhook",
      "method": "POST"
    }
  ],
  "actions": [
    {
      "type": "send_message",
      "platform": "instagram",
      "content": "{{ai_response}}"
    }
  ]
}
```

---

## 🔄 التكامل التقني

### **1. ManyChat Service Implementation**

```typescript
// src/services/manychat-service.ts
export class ManyChatService {
  private apiKey: string;
  private baseUrl: string;
  private logger = getLogger({ component: 'ManyChatService' });

  constructor() {
    this.apiKey = getEnv('MANYCHAT_API_KEY');
    this.baseUrl = getEnv('MANYCHAT_BASE_URL') || 'https://api.manychat.com';
  }

  /**
   * إرسال رسالة عبر ManyChat API
   */
  public async sendMessage(
    merchantId: string,
    recipientId: string,
    message: string,
    options?: ManyChatOptions
  ): Promise<ManyChatResponse> {
    try {
      const payload = {
        subscriber_id: recipientId,
        content: [{
          type: 'text',
          text: message
        }],
        message_tag: options?.messageTag || 'CUSTOMER_FEEDBACK',
        flow_id: options?.flowId || await this.getDefaultFlowId(merchantId)
      };

      const response = await fetch(`${this.baseUrl}/fb/sending/sendContent`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (result.status === 'success') {
        this.logger.info('✅ ManyChat message sent successfully', {
          merchantId,
          recipientId,
          messageId: result.message_id
        });

        return {
          success: true,
          messageId: result.message_id,
          timestamp: new Date(),
          platform: 'instagram'
        };
      } else {
        throw new Error(`ManyChat API error: ${result.error}`);
      }

    } catch (error) {
      this.logger.error('❌ ManyChat message sending failed', error, {
        merchantId,
        recipientId
      });

      // إعادة المحاولة تلقائياً
      return await this.retryMessage(merchantId, recipientId, message, options);
    }
  }

  /**
   * الحصول على معلومات العميل من ManyChat
   */
  public async getSubscriberInfo(
    merchantId: string,
    subscriberId: string
  ): Promise<ManyChatSubscriber> {
    try {
      const response = await fetch(
        `${this.baseUrl}/fb/subscriber/getInfo?subscriber_id=${subscriberId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );

      const result = await response.json();

      if (result.status === 'success') {
        return {
          id: result.data.id,
          firstName: result.data.first_name,
          lastName: result.data.last_name,
          language: result.data.language,
          timezone: result.data.timezone,
          tags: result.data.tags || [],
          customFields: result.data.custom_fields || {}
        };
      } else {
        throw new Error(`Failed to get subscriber info: ${result.error}`);
      }

    } catch (error) {
      this.logger.error('Failed to get subscriber info', error, {
        merchantId,
        subscriberId
      });
      throw error;
    }
  }

  /**
   * تحديث معلومات العميل في ManyChat
   */
  public async updateSubscriber(
    merchantId: string,
    subscriberId: string,
    updates: ManyChatSubscriberUpdate
  ): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/fb/subscriber/updateInfo`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          subscriber_id: subscriberId,
          ...updates
        })
      });

      const result = await response.json();

      if (result.status === 'success') {
        this.logger.info('✅ Subscriber updated successfully', {
          merchantId,
          subscriberId
        });
        return true;
      } else {
        throw new Error(`Failed to update subscriber: ${result.error}`);
      }

    } catch (error) {
      this.logger.error('Failed to update subscriber', error, {
        merchantId,
        subscriberId
      });
      return false;
    }
  }

  /**
   * إضافة tags للعميل
   */
  public async addTags(
    merchantId: string,
    subscriberId: string,
    tags: string[]
  ): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/fb/subscriber/addTag`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          subscriber_id: subscriberId,
          tag_name: tags.join(',')
        })
      });

      const result = await response.json();

      if (result.status === 'success') {
        this.logger.info('✅ Tags added successfully', {
          merchantId,
          subscriberId,
          tags
        });
        return true;
      } else {
        throw new Error(`Failed to add tags: ${result.error}`);
      }

    } catch (error) {
      this.logger.error('Failed to add tags', error, {
        merchantId,
        subscriberId,
        tags
      });
      return false;
    }
  }

  /**
   * إعادة المحاولة التلقائية
   */
  private async retryMessage(
    merchantId: string,
    recipientId: string,
    message: string,
    options?: ManyChatOptions,
    retryCount = 0
  ): Promise<ManyChatResponse> {
    const maxRetries = 3;
    const retryDelay = Math.pow(2, retryCount) * 1000; // Exponential backoff

    if (retryCount >= maxRetries) {
      this.logger.error('❌ Max retries exceeded for ManyChat message', {
        merchantId,
        recipientId,
        retryCount
      });

      return {
        success: false,
        error: 'Max retries exceeded',
        timestamp: new Date()
      };
    }

    // انتظار قبل إعادة المحاولة
    await new Promise(resolve => setTimeout(resolve, retryDelay));

    this.logger.info(`🔄 Retrying ManyChat message (attempt ${retryCount + 1})`, {
      merchantId,
      recipientId
    });

    return this.sendMessage(merchantId, recipientId, message, options);
  }

  /**
   * الحصول على Flow ID الافتراضي للتاجر
   */
  private async getDefaultFlowId(merchantId: string): Promise<string> {
    // يمكن تخزين Flow IDs في قاعدة البيانات لكل تاجر
    const merchantConfig = await this.getMerchantManyChatConfig(merchantId);
    return merchantConfig.defaultFlowId || getEnv('MANYCHAT_DEFAULT_FLOW_ID');
  }

  /**
   * الحصول على إعدادات ManyChat للتاجر
   */
  private async getMerchantManyChatConfig(merchantId: string): Promise<ManyChatConfig> {
    // استعلام قاعدة البيانات للحصول على إعدادات التاجر
    const db = getDatabase();
    const result = await db.query(
      'SELECT manychat_config FROM merchants WHERE id = $1',
      [merchantId]
    );

    if (result.rows.length > 0) {
      return result.rows[0].manychat_config || {};
    }

    return {};
  }
}

// Types
export interface ManyChatOptions {
  messageTag?: string;
  flowId?: string;
  priority?: 'low' | 'normal' | 'high';
}

export interface ManyChatResponse {
  success: boolean;
  messageId?: string;
  error?: string;
  timestamp: Date;
  platform?: string;
}

export interface ManyChatSubscriber {
  id: string;
  firstName?: string;
  lastName?: string;
  language?: string;
  timezone?: string;
  tags: string[];
  customFields: Record<string, unknown>;
}

export interface ManyChatSubscriberUpdate {
  first_name?: string;
  last_name?: string;
  language?: string;
  timezone?: string;
  custom_fields?: Record<string, unknown>;
}

export interface ManyChatConfig {
  defaultFlowId?: string;
  welcomeFlowId?: string;
  apiKey?: string;
  webhookSecret?: string;
}
```

### **2. Integration with AI Orchestrator**

```typescript
// src/services/conversation-ai-orchestrator.ts
export class ConversationAIOrchestrator {
  private manyChatService: ManyChatService;

  constructor() {
    this.manyChatService = new ManyChatService();
  }

  /**
   * معالجة الرسالة مع ManyChat
   */
  public async processMessageWithManyChat(
    conversationId: string,
    merchantId: string,
    customerId: string,
    customerMessage: string
  ): Promise<ProcessedMessageResult> {
    try {
      // 1. توليد رد AI
      const aiResponse = await this.generateAIResponse(
        conversationId,
        merchantId,
        customerMessage
      );

      // 2. إرسال عبر ManyChat
      const manyChatResult = await this.manyChatService.sendMessage(
        merchantId,
        customerId,
        aiResponse.response,
        {
          messageTag: 'AI_RESPONSE',
          flowId: await this.getResponseFlowId(merchantId)
        }
      );

      // 3. تحديث معلومات العميل في ManyChat
      await this.updateCustomerInfoInManyChat(merchantId, customerId, {
        conversation_id: conversationId,
        last_ai_response: aiResponse.response,
        response_timestamp: new Date().toISOString()
      });

      // 4. إضافة tags مفيدة
      await this.addRelevantTags(merchantId, customerId, aiResponse);

      return {
        success: true,
        aiResponse: aiResponse.response,
        manyChatMessageId: manyChatResult.messageId,
        timestamp: new Date()
      };

    } catch (error) {
      this.logger.error('Failed to process message with ManyChat', error, {
        conversationId,
        merchantId,
        customerId
      });

      // Fallback: إرسال مباشر عبر Instagram API
      return await this.fallbackToDirectInstagram(merchantId, customerId, customerMessage);
    }
  }

  /**
   * تحديث معلومات العميل في ManyChat
   */
  private async updateCustomerInfoInManyChat(
    merchantId: string,
    customerId: string,
    updates: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.manyChatService.updateSubscriber(merchantId, customerId, {
        custom_fields: updates
      });
    } catch (error) {
      this.logger.warn('Failed to update customer info in ManyChat', error, {
        merchantId,
        customerId
      });
    }
  }

  /**
   * إضافة tags مفيدة بناءً على رد AI
   */
  private async addRelevantTags(
    merchantId: string,
    customerId: string,
    aiResponse: AIResponse
  ): Promise<void> {
    try {
      const tags: string[] = [];

      // تحليل رد AI لتحديد Tags
      if (aiResponse.response.includes('سعر') || aiResponse.response.includes('تكلفة')) {
        tags.push('price_inquiry');
      }

      if (aiResponse.response.includes('طلب') || aiResponse.response.includes('شراء')) {
        tags.push('purchase_intent');
      }

      if (aiResponse.response.includes('شكراً') || aiResponse.response.includes('ممتاز')) {
        tags.push('positive_feedback');
      }

      if (tags.length > 0) {
        await this.manyChatService.addTags(merchantId, customerId, tags);
      }

    } catch (error) {
      this.logger.warn('Failed to add tags', error, {
        merchantId,
        customerId
      });
    }
  }

  /**
   * Fallback: إرسال مباشر عبر Instagram API
   */
  private async fallbackToDirectInstagram(
    merchantId: string,
    customerId: string,
    customerMessage: string
  ): Promise<ProcessedMessageResult> {
    try {
      const aiResponse = await this.generateAIResponse(
        'fallback',
        merchantId,
        customerMessage
      );

      const instagramSender = getInstagramMessageSender();
      const result = await instagramSender.sendTextMessage(
        merchantId,
        customerId,
        aiResponse.response
      );

      return {
        success: result.success,
        aiResponse: aiResponse.response,
        fallbackUsed: true,
        timestamp: new Date()
      };

    } catch (error) {
      this.logger.error('Fallback also failed', error, {
        merchantId,
        customerId
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date()
      };
    }
  }
}
```

### **3. Webhook Handler Integration**

```typescript
// src/services/instagram-webhook.ts
export class InstagramWebhookHandler {
  private manyChatService: ManyChatService;

  constructor() {
    this.manyChatService = new ManyChatService();
  }

  /**
   * معالجة رسالة مع ManyChat
   */
  private async processMessagingEvent(
    event: InstagramMessagingEvent,
    merchantId: string
  ): Promise<number> {
    const customerId = event.sender?.id;
    
    if (!customerId) {
      throw new Error('Missing sender ID in messaging event');
    }

    // 1. إنشاء أو العثور على المحادثة
    const conversation = await this.findOrCreateConversation(
      merchantId,
      customerId,
      'instagram'
    );

    // 2. حفظ الرسالة
    const messageContent = event.message?.text || '';
    await this.saveMessage(conversation.id, event);

    // 3. إضافة مهمة ManyChat للمعالجة
    await this.queueManager.addManyChatJob({
      conversationId: conversation.id,
      merchantId,
      customerId,
      message: messageContent,
      platform: 'instagram',
      priority: 'HIGH'
    });

    return 1;
  }
}
```

---

## 📊 مراقبة الأداء

### **ManyChat Analytics Integration**

```typescript
// src/services/manychat-analytics.ts
export class ManyChatAnalytics {
  private manyChatService: ManyChatService;

  constructor() {
    this.manyChatService = new ManyChatService();
  }

  /**
   * تتبع أداء ManyChat
   */
  public async trackManyChatPerformance(
    merchantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<ManyChatAnalytics> {
    try {
      // الحصول على إحصائيات ManyChat
      const stats = await this.getManyChatStats(merchantId, startDate, endDate);

      // تحليل الأداء
      const analytics = {
        totalMessages: stats.total_messages,
        deliveredMessages: stats.delivered_messages,
        failedMessages: stats.failed_messages,
        deliveryRate: (stats.delivered_messages / stats.total_messages) * 100,
        averageResponseTime: stats.average_response_time,
        topFlows: stats.top_flows,
        customerEngagement: stats.customer_engagement
      };

      // حفظ الإحصائيات في قاعدة البيانات
      await this.saveAnalytics(merchantId, analytics);

      return analytics;

    } catch (error) {
      this.logger.error('Failed to track ManyChat performance', error, {
        merchantId,
        startDate,
        endDate
      });
      throw error;
    }
  }

  /**
   * تقرير الأداء الشامل
   */
  public async generatePerformanceReport(
    merchantId: string,
    period: 'daily' | 'weekly' | 'monthly'
  ): Promise<PerformanceReport> {
    const endDate = new Date();
    const startDate = this.getStartDate(period);

    const analytics = await this.trackManyChatPerformance(
      merchantId,
      startDate,
      endDate
    );

    return {
      period,
      startDate,
      endDate,
      analytics,
      recommendations: this.generateRecommendations(analytics)
    };
  }
}
```

---

## 🔧 التكوين والإعداد

### **1. إعداد قاعدة البيانات**

```sql
-- إضافة جدول إعدادات ManyChat للتجار
ALTER TABLE merchants ADD COLUMN manychat_config JSONB DEFAULT '{}';

-- إضافة جدول تتبع ManyChat
CREATE TABLE manychat_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID REFERENCES merchants(id),
    subscriber_id VARCHAR(255),
    message_id VARCHAR(255),
    action VARCHAR(50),
    status VARCHAR(20),
    response_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- إضافة فهارس للأداء
CREATE INDEX idx_manychat_logs_merchant_id ON manychat_logs(merchant_id);
CREATE INDEX idx_manychat_logs_subscriber_id ON manychat_logs(subscriber_id);
CREATE INDEX idx_manychat_logs_created_at ON manychat_logs(created_at);
```

### **2. إعداد Environment Variables**

```env
# ManyChat Configuration
MANYCHAT_API_KEY=your_manychat_api_key_here
MANYCHAT_BASE_URL=https://api.manychat.com
MANYCHAT_WEBHOOK_SECRET=your_webhook_secret_here

# Default Flow IDs
MANYCHAT_DEFAULT_FLOW_ID=your_default_flow_id
MANYCHAT_WELCOME_MESSAGE_FLOW=your_welcome_flow_id
MANYCHAT_AI_RESPONSE_FLOW=your_ai_response_flow_id

# ManyChat Settings
MANYCHAT_RETRY_ATTEMPTS=3
MANYCHAT_RETRY_DELAY=1000
MANYCHAT_TIMEOUT=30000
```

### **3. إعداد Webhook Endpoints**

```typescript
// src/routes/manychat-webhooks.ts
export function registerManyChatWebhookRoutes(app: Hono): void {
  app.post('/api/manychat/webhook', async (c) => {
    try {
      const body = await c.req.json();
      
      // التحقق من صحة Webhook
      const signature = c.req.header('X-ManyChat-Signature');
      if (!this.verifyManyChatSignature(signature, body)) {
        return c.json({ error: 'Invalid signature' }, 401);
      }

      // معالجة Webhook
      const result = await this.processManyChatWebhook(body);

      return c.json({ success: true, result });

    } catch (error) {
      this.logger.error('ManyChat webhook processing failed', error);
      return c.json({ error: 'Webhook processing failed' }, 500);
    }
  });
}
```

---

## 🎯 أفضل الممارسات

### **1. إدارة الأخطاء**
- ✅ إعادة المحاولة التلقائية مع exponential backoff
- ✅ Fallback إلى Instagram API المباشر
- ✅ تسجيل شامل للأخطاء
- ✅ تنبيهات فورية للأخطاء الحرجة

### **2. تحسين الأداء**
- ✅ Caching لبيانات العملاء
- ✅ معالجة غير متزامنة
- ✅ Rate limiting ذكي
- ✅ Connection pooling

### **3. الأمان**
- ✅ التحقق من التوقيعات
- ✅ تشفير البيانات الحساسة
- ✅ Rate limiting
- ✅ Audit logging

### **4. المراقبة**
- ✅ تتبع معدل التسليم
- ✅ مراقبة وقت الاستجابة
- ✅ تنبيهات للأخطاء
- ✅ تقارير الأداء

---

## 🚀 جاهز للاستخدام

هذا التكامل يوفر:
- ✅ إدارة متقدمة للمحادثات عبر ManyChat
- ✅ معالجة AI ذكية
- ✅ تتبع شامل للأداء
- ✅ أمان متقدم
- ✅ مراقبة شاملة
- ✅ إعادة المحاولة التلقائية

**النظام جاهز للاستخدام الإنتاجي مع ManyChat!** 🎉

