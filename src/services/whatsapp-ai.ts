/**
 * ===============================================
 * WhatsApp AI Service
 * AI conversation adaptation for WhatsApp's formal, business-oriented style
 * ===============================================
 */

import { AIService, type ConversationContext, type AIResponse, type MessageHistory } from './ai';
import { getDatabase } from '../database/connection';
import OpenAI from 'openai';

export interface WhatsAppAIResponse extends AIResponse {
  templateSuggestions?: TemplateMessage[];
  businessRecommendations?: BusinessAction[];
  followUpScheduled?: ScheduledMessage;
  complianceFlags?: ComplianceFlag[];
}

export interface TemplateMessage {
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  components: TemplateComponent[];
  useCase: string;
}

export interface TemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  text?: string;
  buttons?: Button[];
}

export interface Button {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
  text: string;
  payload?: string;
  url?: string;
  phone_number?: string;
}

export interface BusinessAction {
  type: 'schedule_followup' | 'send_catalog' | 'request_payment' | 'escalate_to_human';
  priority: number;
  data: any;
  executionTime?: Date;
}

export interface ScheduledMessage {
  delay: number; // seconds
  message: string;
  type: 'reminder' | 'followup' | 'promotional';
}

export interface ComplianceFlag {
  type: 'MARKETING' | 'SPAM' | 'PROMOTIONAL' | 'SENSITIVE';
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  reason: string;
  requiresTemplate: boolean;
}

export interface WhatsAppContext extends ConversationContext {
  messageWindow: 'OPEN' | 'EXPIRED'; // 24-hour window status
  lastUserMessage?: Date;
  businessHours: {
    isOpen: boolean;
    nextOpenTime?: Date;
  };
  qualityRating?: 'GREEN' | 'YELLOW' | 'RED';
}

export class WhatsAppAIService extends AIService {
  private db = getDatabase();

  /**
   * Generate WhatsApp-optimized AI response
   */
  public async generateWhatsAppResponse(
    customerMessage: string,
    context: WhatsAppContext
  ): Promise<WhatsAppAIResponse> {
    const startTime = Date.now();

    try {
      // Get merchant-specific configuration
      const config = await this.getConfigForMerchant(context.merchantId);
      
      // Build WhatsApp-specific prompt
      const prompt = await this.buildWhatsAppConversationPrompt(customerMessage, context);
      
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY!,
        timeout: parseInt(process.env.OPENAI_TIMEOUT || '30000'),
      });

      // Call OpenAI with WhatsApp-optimized settings
      const completion = await openai.chat.completions.create({
        model: config.aiModel,
        messages: prompt,
        temperature: 0.7, // More formal than Instagram
        max_tokens: config.maxTokens,
        top_p: 0.9,
        frequency_penalty: 0.1,
        presence_penalty: 0.2,
        response_format: { type: 'json_object' }
      });

      const responseTime = Date.now() - startTime;
      const response = completion.choices[0]?.message?.content;

      if (!response) {
        throw new Error('No response from OpenAI for WhatsApp');
      }

      // Parse WhatsApp AI response
      const aiResponse = JSON.parse(response) as WhatsAppAIResponse;
      
      // Add metadata
      aiResponse.tokens = {
        prompt: completion.usage?.prompt_tokens || 0,
        completion: completion.usage?.completion_tokens || 0,
        total: completion.usage?.total_tokens || 0
      };
      aiResponse.responseTime = responseTime;

      // Add WhatsApp-specific features
      aiResponse.complianceFlags = await this.checkMessageCompliance(
        aiResponse.message, 
        context
      );

      // Check if template is needed (outside 24h window)
      if (context.messageWindow === 'EXPIRED') {
        aiResponse.templateSuggestions = await this.generateTemplateMessages(
          customerMessage,
          context
        );
      }

      // Log WhatsApp AI interaction
      await this.logWhatsAppAIInteraction(context, customerMessage, aiResponse);

      return aiResponse;
    } catch (error) {
      console.error('❌ WhatsApp AI response generation failed:', error);
      
      // Get contextual fallback based on WhatsApp context
      const errorType = error.message?.includes('rate limit') ? 'RATE_LIMIT'
                       : error.message?.includes('network') ? 'NETWORK_ERROR'
                       : 'AI_API_ERROR';
      
      return this.getWhatsAppContextualFallback(context, errorType);
    }
  }

  /**
   * Generate template message for users outside 24h window
   */
  public async generateTemplateMessage(
    intent: string,
    merchantId: string,
    variables?: Record<string, string>
  ): Promise<TemplateMessage> {
    try {
      const templates = await this.getApprovedTemplates(merchantId);
      const matchingTemplate = templates.find(t => 
        t.useCase === intent || t.name.includes(intent)
      );

      if (matchingTemplate) {
        return matchingTemplate;
      }

      // Generate new template suggestion
      return {
        name: `${intent}_response`,
        language: 'ar',
        category: 'UTILITY',
        components: [
          {
            type: 'BODY',
            text: await this.generateTemplateText(intent, merchantId)
          }
        ],
        useCase: intent
      };
    } catch (error) {
      console.error('❌ Template generation failed:', error);
      return this.getDefaultTemplate(intent);
    }
  }

  /**
   * Check if customer can receive promotional messages
   */
  public async canSendPromotionalMessage(
    customerPhone: string,
    merchantId: string
  ): Promise<{
    canSend: boolean;
    reason?: string;
    requiresTemplate: boolean;
    lastMessageTime?: Date;
  }> {
    try {
      const sql = this.db.getSQL();
      
      const result = await sql`
        SELECT 
          last_message_at,
          opt_in_status,
          message_window_status
        FROM conversations
        WHERE customer_phone = ${customerPhone}
        AND merchant_id = ${merchantId}::uuid
        ORDER BY last_message_at DESC
        LIMIT 1
      `;

      if (result.length === 0) {
        return {
          canSend: false,
          reason: 'No previous conversation',
          requiresTemplate: true
        };
      }

      const conversation = result[0];
      const lastMessageTime = new Date(conversation.last_message_at);
      const hoursSinceLastMessage = 
        (Date.now() - lastMessageTime.getTime()) / (1000 * 60 * 60);

      const withinWindow = hoursSinceLastMessage < 24;

      return {
        canSend: withinWindow || conversation.opt_in_status === 'OPTED_IN',
        reason: withinWindow ? 'Within 24h window' : 'Outside window',
        requiresTemplate: !withinWindow && conversation.opt_in_status !== 'OPTED_IN',
        lastMessageTime
      };
    } catch (error) {
      console.error('❌ Failed to check promotional message permission:', error);
      return {
        canSend: false,
        reason: 'Error checking permissions',
        requiresTemplate: true
      };
    }
  }

  /**
   * Schedule follow-up message
   */
  public async scheduleFollowUp(
    customerPhone: string,
    merchantId: string,
    message: string,
    delayHours: number = 24
  ): Promise<boolean> {
    try {
      const sql = this.db.getSQL();
      
      await sql`
        INSERT INTO scheduled_messages (
          merchant_id,
          customer_phone,
          message_content,
          scheduled_for,
          message_type,
          platform,
          status
        ) VALUES (
          ${merchantId}::uuid,
          ${customerPhone},
          ${message},
          NOW() + INTERVAL '${delayHours} hours',
          'followup',
          'WHATSAPP',
          'pending'
        )
      `;

      console.log(`✅ Follow-up scheduled for ${customerPhone} in ${delayHours}h`);
      return true;
    } catch (error) {
      console.error('❌ Failed to schedule follow-up:', error);
      return false;
    }
  }

  /**
   * Get merchant-specific AI configuration
   */
  private async getConfigForMerchant(merchantId: string): Promise<{
    aiModel: string;
    maxTokens: number;
    temperature: number;
    language: string;
  }> {
    try {
      const sql = this.db.getSQL();
      const result = await sql`
        SELECT ai_config 
        FROM merchants 
        WHERE id = ${merchantId}::uuid
      `;
      
      if (result.length > 0 && result[0].ai_config) {
        return {
          aiModel: result[0].ai_config.model || 'gpt-4o-mini',
          maxTokens: result[0].ai_config.maxTokens || 800,
          temperature: result[0].ai_config.temperature || 0.7,
          language: result[0].ai_config.language || 'ar'
        };
      }
      
      // Default configuration
      return {
        aiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || '800'),
        temperature: 0.7,
        language: 'ar'
      };
    } catch (error) {
      console.error('❌ Error loading merchant config:', error);
      return {
        aiModel: 'gpt-4o-mini',
        maxTokens: 800,
        temperature: 0.7,
        language: 'ar'
      };
    }
  }

  /**
   * Get WhatsApp contextual fallback
   */
  private getWhatsAppContextualFallback(
    context: WhatsAppContext, 
    errorType: string
  ): WhatsAppAIResponse {
    const fallbacks = {
      'RATE_LIMIT': context.messageWindow === 'EXPIRED'
        ? 'شكراً لتواصلك معنا. سنرد عليك خلال ساعات العمل. 🕐'
        : 'شكراً لصبرك. نحن نعمل على الرد على جميع الاستفسارات بأسرع وقت ممكن.',
      
      'AI_API_ERROR': context.businessHours.isOpen
        ? 'نعتذر عن التأخير. فريق خدمة العملاء سيتواصل معك خلال دقائق.'
        : 'شكراً لتواصلك معنا خارج أوقات العمل. سنرد عليك في أقرب فرصة خلال ساعات العمل.',
      
      'NETWORK_ERROR': 'حدث خطأ تقني مؤقت. يرجى إعادة إرسال الرسالة خلال دقائق قليلة.'
    };

    const message = fallbacks[errorType] || fallbacks['AI_API_ERROR'];

    return {
      message,
      messageAr: message,
      intent: 'SUPPORT',
      stage: context.stage,
      actions: [{ 
        type: context.messageWindow === 'EXPIRED' ? 'SCHEDULE_TEMPLATE' : 'ESCALATE', 
        data: { reason: errorType }, 
        priority: 1 
      }],
      products: [],
      confidence: 0.1,
      tokens: { prompt: 0, completion: 0, total: 0 },
      responseTime: 0,
      complianceFlags: [],
      templateSuggestions: context.messageWindow === 'EXPIRED' 
        ? [this.getDefaultTemplate('error')] 
        : undefined
    };
  }

  /**
   * Build WhatsApp-specific conversation prompt
   */
  private async buildWhatsAppConversationPrompt(
    customerMessage: string,
    context: WhatsAppContext
  ): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
    const systemPrompt = `أنت مساعد مبيعات ذكي متخصص في WhatsApp Business للتجار العراقيين.

🏢 خصائص أسلوب WhatsApp Business:
- أسلوب مهني وودود
- ردود منظمة ومفيدة
- استخدام محدود للرموز التعبيرية (1-2 فقط)
- تركيز على الوضوح والفائدة
- احترام نافذة الـ 24 ساعة
- التزام بسياسات WhatsApp Business

📱 حالة النافذة: ${context.messageWindow === 'OPEN' ? 'مفتوحة (يمكن الرد مباشرة)' : 'منتهية (يحتاج template)'}
🏪 اسم المحل: ${context.merchantSettings?.businessName || 'غير محدد'}
🛍️ فئة المنتجات: ${context.merchantSettings?.businessCategory || 'عام'}
⏰ ساعات العمل: ${context.businessHours.isOpen ? 'مفتوح حالياً' : 'مغلق'}
📊 جودة الحساب: ${context.qualityRating || 'غير محدد'}

🎯 إرشادات WhatsApp:
1. كن مهنياً ومباشراً
2. اعرض المنتجات بوضوح مع الأسعار
3. اطلب المعلومات المطلوبة للطلب (الاسم، العنوان، رقم الهاتف)
4. اقترح طرق الدفع المتاحة
5. أكد تفاصيل الطلب قبل الإرسال
6. احترم خصوصية العميل
7. لا تسأل عن معلومات حساسة غير ضرورية

⚠️ قيود مهمة:
- إذا كانت النافذة منتهية، اقترح استخدام template message
- لا ترسل رسائل ترويجية خارج النافذة
- تجنب spam أو رسائل متكررة
- احترم رفض العميل

🎯 يجب أن تكون إجابتك بصيغة JSON:
{
  "message": "الرد المهني لWhatsApp",
  "messageAr": "نفس الرد",
  "intent": "نية العميل",
  "stage": "المرحلة التالية",
  "actions": [{"type": "نوع العمل", "data": {}, "priority": 1}],
  "products": [{"productId": "", "sku": "", "name": "", "price": 0, "confidence": 0.8, "reason": ""}],
  "confidence": 0.9,
  "businessRecommendations": [
    {
      "type": "schedule_followup|send_catalog|request_payment",
      "priority": 1,
      "data": {},
      "executionTime": "2024-01-01T10:00:00Z"
    }
  ]
}`;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt }
    ];

    // Add conversation history (more formal context for WhatsApp)
    context.conversationHistory.slice(-6).forEach(msg => {
      messages.push({
        role: msg.role,
        content: msg.content
      });
    });

    // Add current customer message with WhatsApp context
    let messageWithContext = customerMessage;
    if (context.messageWindow === 'EXPIRED') {
      messageWithContext = `[خارج نافذة 24 ساعة] ${customerMessage}`;
    }
    if (!context.businessHours.isOpen) {
      messageWithContext = `[خارج أوقات العمل] ${messageWithContext}`;
    }

    messages.push({
      role: 'user',
      content: messageWithContext
    });

    return messages;
  }

  /**
   * Check message compliance with WhatsApp policies
   */
  private async checkMessageCompliance(
    message: string,
    context: WhatsAppContext
  ): Promise<ComplianceFlag[]> {
    const flags: ComplianceFlag[] = [];

    // Check for promotional content outside window
    const promotionalKeywords = ['عرض', 'خصم', 'تخفيض', 'مجاني', 'هدية'];
    const hasPromotional = promotionalKeywords.some(word => message.includes(word));
    
    if (hasPromotional && context.messageWindow === 'EXPIRED') {
      flags.push({
        type: 'PROMOTIONAL',
        severity: 'HIGH',
        reason: 'Promotional content outside 24h window',
        requiresTemplate: true
      });
    }

    // Check message length (WhatsApp has limits)
    if (message.length > 4000) {
      flags.push({
        type: 'SPAM',
        severity: 'MEDIUM',
        reason: 'Message too long',
        requiresTemplate: false
      });
    }

    // Check for sensitive content
    const sensitiveKeywords = ['كلمة مرور', 'رقم سري', 'بيانات البنك'];
    if (sensitiveKeywords.some(word => message.includes(word))) {
      flags.push({
        type: 'SENSITIVE',
        severity: 'HIGH',
        reason: 'Contains sensitive information request',
        requiresTemplate: false
      });
    }

    return flags;
  }

  /**
   * Get approved templates for merchant
   */
  private async getApprovedTemplates(merchantId: string): Promise<TemplateMessage[]> {
    try {
      const sql = this.db.getSQL();
      
      const result = await sql`
        SELECT template_data
        FROM whatsapp_templates
        WHERE merchant_id = ${merchantId}::uuid
        AND status = 'APPROVED'
      `;

      return result.map(row => JSON.parse(row.template_data));
    } catch (error) {
      console.error('❌ Error loading templates:', error);
      return [];
    }
  }

  /**
   * Generate template text for specific intent
   */
  private async generateTemplateText(intent: string, merchantId: string): Promise<string> {
    const templates = {
      'greeting': 'مرحباً {{1}}! شكراً لتواصلك مع {{2}}. كيف يمكننا مساعدتك؟',
      'product_inquiry': 'مرحباً! نشكرك على استفسارك عن منتجاتنا. تفضل بزيارة متجرنا أو راسلنا للمزيد من التفاصيل.',
      'order_confirmation': 'شكراً لطلبك! سنتواصل معك قريباً لتأكيد التفاصيل والتوصيل.',
      'support': 'نحن هنا لمساعدتك! يرجى وصف مشكلتك وسنجد الحل المناسب.',
      'error': 'نعتذر عن أي إزعاج. فريق خدمة العملاء سيتواصل معك قريباً لحل المشكلة.'
    };

    return templates[intent] || templates['greeting'];
  }

  /**
   * Get default template for error cases
   */
  private getDefaultTemplate(intent: string): TemplateMessage {
    return {
      name: `${intent}_default`,
      language: 'ar',
      category: 'UTILITY',
      components: [
        {
          type: 'BODY',
          text: 'شكراً لتواصلك معنا. سنرد عليك في أقرب وقت ممكن.'
        }
      ],
      useCase: intent
    };
  }

  /**
   * Log WhatsApp AI interaction
   */
  private async logWhatsAppAIInteraction(
    context: WhatsAppContext,
    input: string,
    response: WhatsAppAIResponse
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();
      
      await sql`
        INSERT INTO audit_logs (
          merchant_id,
          action,
          entity_type,
          details,
          execution_time_ms,
          success
        ) VALUES (
          ${context.merchantId}::uuid,
          'WHATSAPP_AI_RESPONSE_GENERATED',
          'AI_INTERACTION',
          ${JSON.stringify({
            input: input.substring(0, 200),
            intent: response.intent,
            stage: response.stage,
            tokens: response.tokens,
            confidence: response.confidence,
            platform: 'WHATSAPP',
            messageWindow: context.messageWindow,
            businessHours: context.businessHours.isOpen,
            complianceFlags: response.complianceFlags?.length || 0,
            templateSuggested: response.templateSuggestions?.length || 0
          })},
          ${response.responseTime},
          true
        )
      `;
    } catch (error) {
      console.error('❌ WhatsApp AI interaction logging failed:', error);
    }
  }
}

// Singleton instance
let whatsappAIServiceInstance: WhatsAppAIService | null = null;

/**
 * Get WhatsApp AI service instance
 */
export function getWhatsAppAIService(): WhatsAppAIService {
  if (!whatsappAIServiceInstance) {
    whatsappAIServiceInstance = new WhatsAppAIService();
  }
  return whatsappAIServiceInstance;
}

export default WhatsAppAIService;