/**
 * ===============================================
 * AI Service - OpenAI Integration for Sales Assistant
 * Secure AI conversation handling with Arabic support
 * ===============================================
 */

import OpenAI from 'openai';
import { getEncryptionService } from './encryption.js';
import { getDatabase } from '../database/connection.js';
import type { ConversationStage, Platform } from '../types/database.js';

export interface AIResponse {
  message: string;
  messageAr: string;
  intent: string;
  stage: ConversationStage;
  actions: AIAction[];
  products: ProductRecommendation[];
  confidence: number;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  responseTime: number;
}

export interface AIAction {
  type: 'ADD_TO_CART' | 'SHOW_PRODUCT' | 'CREATE_ORDER' | 'COLLECT_INFO' | 'ESCALATE' | 'SCHEDULE_TEMPLATE';
  data: Record<string, any>;
  priority: number;
}

export interface ProductRecommendation {
  productId: string;
  sku: string;
  name: string;
  price: number;
  confidence: number;
  reason: string;
}

export interface ConversationContext {
  merchantId: string;
  customerId: string;
  platform: Platform;
  stage: ConversationStage;
  cart: any[];
  preferences: Record<string, any>;
  conversationHistory: MessageHistory[];
  customerProfile?: CustomerProfile;
  merchantSettings?: MerchantSettings;
}

export interface MessageHistory {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface CustomerProfile {
  name?: string;
  phone?: string;
  instagram?: string;
  previousOrders: number;
  averageOrderValue: number;
  preferredCategories: string[];
  lastInteraction: Date;
}

export interface MerchantSettings {
  businessName: string;
  businessCategory: string;
  workingHours: any;
  paymentMethods: string[];
  deliveryFees: any;
  autoResponses: any;
}

export class AIService {
  private openai: OpenAI;
  private encryptionService = getEncryptionService();
  protected db = getDatabase();

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }

    this.openai = new OpenAI({
      apiKey,
      timeout: parseInt(process.env.OPENAI_TIMEOUT || '30000'),
    });
  }

  /**
   * Generate AI response for customer message
   */
  public async generateResponse(
    customerMessage: string,
    context: ConversationContext
  ): Promise<AIResponse> {
    const startTime = Date.now();

    try {
      // Build conversation prompt
      const prompt = await this.buildConversationPrompt(customerMessage, context);
      
      // Call OpenAI API
      const completion = await this.openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: prompt,
        temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.7'),
        max_tokens: parseInt(process.env.OPENAI_MAX_TOKENS || '500'),
        top_p: 0.9,
        frequency_penalty: 0.1,
        presence_penalty: 0.1,
        response_format: { type: 'json_object' }
      });

      const responseTime = Date.now() - startTime;
      const response = completion.choices[0]?.message?.content;

      if (!response) {
        throw new Error('No response from OpenAI');
      }

      // Parse AI response
      const aiResponse = JSON.parse(response) as AIResponse;
      
      // Add metadata
      aiResponse.tokens = {
        prompt: completion.usage?.prompt_tokens || 0,
        completion: completion.usage?.completion_tokens || 0,
        total: completion.usage?.total_tokens || 0
      };
      aiResponse.responseTime = responseTime;

      // Log AI interaction
      await this.logAIInteraction(context, customerMessage, aiResponse);

      return aiResponse;
    } catch (error) {
      console.error('❌ AI response generation failed:', error);
      
      // Return fallback response
      return this.getFallbackResponse(context);
    }
  }

  /**
   * Analyze customer intent from message
   */
  public async analyzeIntent(
    customerMessage: string,
    context: ConversationContext
  ): Promise<{
    intent: string;
    confidence: number;
    entities: Record<string, any>;
    stage: ConversationStage;
  }> {
    try {
      const prompt = this.buildIntentAnalysisPrompt(customerMessage, context);
      
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: prompt,
        temperature: 0.3,
        max_tokens: 200,
        response_format: { type: 'json_object' }
      });

      const response = completion.choices[0]?.message?.content;
      return JSON.parse(response || '{}');
    } catch (error) {
      console.error('❌ Intent analysis failed:', error);
      return {
        intent: 'UNKNOWN',
        confidence: 0,
        entities: {},
        stage: context.stage
      };
    }
  }

  /**
   * Generate product recommendations
   */
  public async generateProductRecommendations(
    customerQuery: string,
    context: ConversationContext,
    maxProducts: number = 5
  ): Promise<ProductRecommendation[]> {
    try {
      // Get merchant's products
      const products = await this.getMerchantProducts(context.merchantId);
      
      const prompt = this.buildProductRecommendationPrompt(
        customerQuery,
        context,
        products
      );

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: prompt,
        temperature: 0.5,
        max_tokens: 300,
        response_format: { type: 'json_object' }
      });

      const response = completion.choices[0]?.message?.content;
      const recommendations = JSON.parse(response || '{"recommendations": []}');
      
      return recommendations.recommendations.slice(0, maxProducts);
    } catch (error) {
      console.error('❌ Product recommendation failed:', error);
      return [];
    }
  }

  /**
   * Generate conversation summary
   */
  public async generateConversationSummary(
    conversationHistory: MessageHistory[],
    context: ConversationContext
  ): Promise<string> {
    try {
      const prompt = this.buildSummaryPrompt(conversationHistory, context);
      
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: prompt,
        temperature: 0.3,
        max_tokens: 200
      });

      return completion.choices[0]?.message?.content || 'لا يوجد ملخص متاح';
    } catch (error) {
      console.error('❌ Conversation summary failed:', error);
      return 'خطأ في إنتاج الملخص';
    }
  }

  /**
   * Private: Build conversation prompt
   */
  private async buildConversationPrompt(
    customerMessage: string,
    context: ConversationContext
  ): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
    const systemPrompt = `أنت مساعد مبيعات ذكي للتجار العراقيين على واتساب وانستقرام.

معلومات التاجر:
- اسم المحل: ${context.merchantSettings?.businessName || 'غير محدد'}
- فئة المنتجات: ${context.merchantSettings?.businessCategory || 'عام'}
- منتجات متوفرة: ${await this.getProductsSummary(context.merchantId)}

معلومات العميل:
- المرحلة الحالية: ${context.stage}
- عدد الطلبات السابقة: ${context.customerProfile?.previousOrders || 0}
- معدل قيمة الطلب: $${context.customerProfile?.averageOrderValue || 0}

تعليمات مهمة:
1. أجب باللغة العربية العراقية المحلية
2. كن ودود ومساعد ومهني
3. أظهر اهتماماً حقيقياً بحاجة العميل
4. اقترح منتجات مناسبة عند الحاجة
5. اجمع معلومات الطلب تدريجياً
6. استخدم رموز تعبيرية مناسبة
7. حافظ على الطابع المحلي العراقي

يجب أن تكون إجابتك بصيغة JSON:
{
  "message": "الرد بالعربية",
  "messageAr": "نفس الرد",
  "intent": "نية العميل",
  "stage": "المرحلة التالية",
  "actions": [{"type": "نوع العمل", "data": {}, "priority": 1}],
  "products": [{"productId": "", "sku": "", "name": "", "price": 0, "confidence": 0.8, "reason": ""}],
  "confidence": 0.9
}`;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt }
    ];

    // Add conversation history
    context.conversationHistory.slice(-10).forEach(msg => {
      messages.push({
        role: msg.role,
        content: msg.content
      });
    });

    // Add current customer message
    messages.push({
      role: 'user',
      content: customerMessage
    });

    return messages;
  }

  /**
   * Private: Build intent analysis prompt
   */
  private buildIntentAnalysisPrompt(
    customerMessage: string,
    context: ConversationContext
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    return [
      {
        role: 'system',
        content: `حلل نية العميل من الرسالة. الأهداف المحتملة:
- BROWSING: يتصفح المنتجات
- PRODUCT_INQUIRY: يسأل عن منتج محدد  
- PRICE_INQUIRY: يسأل عن الأسعار
- ORDERING: يريد طلب شيء
- SUPPORT: يحتاج مساعدة
- NEGOTIATING: يفاوض على السعر
- COMPLAINT: شكوى أو مشكلة

أجب بصيغة JSON:
{"intent": "", "confidence": 0.8, "entities": {}, "stage": "المرحلة المقترحة"}`
      },
      {
        role: 'user',
        content: `الرسالة: "${customerMessage}"\nالمرحلة الحالية: ${context.stage}`
      }
    ];
  }

  /**
   * Private: Build product recommendation prompt
   */
  private buildProductRecommendationPrompt(
    customerQuery: string,
    context: ConversationContext,
    products: any[]
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const productsText = products.map(p => 
      `ID: ${p.id}, SKU: ${p.sku}, اسم: ${p.name_ar}, سعر: $${p.price_usd}, فئة: ${p.category}`
    ).join('\n');

    return [
      {
        role: 'system',
        content: `اقترح منتجات مناسبة للعميل بناءً على استفساره.

المنتجات المتوفرة:
${productsText}

أجب بصيغة JSON:
{"recommendations": [{"productId": "", "sku": "", "name": "", "price": 0, "confidence": 0.8, "reason": "سبب الاقتراح"}]}`
      },
      {
        role: 'user',
        content: `استفسار العميل: "${customerQuery}"`
      }
    ];
  }

  /**
   * Private: Build summary prompt
   */
  private buildSummaryPrompt(
    conversationHistory: MessageHistory[],
    context: ConversationContext
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const historyText = conversationHistory.map(msg => 
      `${msg.role}: ${msg.content}`
    ).join('\n');

    return [
      {
        role: 'system',
        content: 'لخص المحادثة باللغة العربية في 1-2 جملة. ركز على النتيجة والمنتجات المهتم بها.'
      },
      {
        role: 'user',
        content: `المحادثة:\n${historyText}`
      }
    ];
  }

  /**
   * Private: Get merchant products summary
   */
  private async getProductsSummary(merchantId: string): Promise<string> {
    try {
      const sql = this.db.getSQL();
      const products = await sql`
        SELECT category, COUNT(*) as count, AVG(price_usd) as avg_price
        FROM products 
        WHERE merchant_id = ${merchantId}::uuid 
        AND status = 'ACTIVE'
        GROUP BY category
        LIMIT 5
      `;

      return products.map(p => 
        `${p.category}: ${p.count} منتج (متوسط السعر: $${Math.round(p.avg_price)})`
      ).join(', ');
    } catch (error) {
      return 'منتجات متنوعة';
    }
  }

  /**
   * Private: Get merchant products
   */
  private async getMerchantProducts(merchantId: string): Promise<any[]> {
    try {
      const sql = this.db.getSQL();
      return await sql`
        SELECT id, sku, name_ar, price_usd, category, stock_quantity
        FROM products 
        WHERE merchant_id = ${merchantId}::uuid 
        AND status = 'ACTIVE'
        AND stock_quantity > 0
        ORDER BY is_featured DESC, created_at DESC
        LIMIT 20
      `;
    } catch (error) {
      console.error('❌ Error fetching products:', error);
      return [];
    }
  }

  /**
   * Private: Log AI interaction
   */
  private async logAIInteraction(
    context: ConversationContext,
    input: string,
    response: AIResponse
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
          'AI_RESPONSE_GENERATED',
          'AI_INTERACTION',
          ${JSON.stringify({
            input: input.substring(0, 200),
            intent: response.intent,
            stage: response.stage,
            tokens: response.tokens,
            confidence: response.confidence,
            platform: context.platform
          })},
          ${response.responseTime},
          true
        )
      `;
    } catch (error) {
      console.error('❌ AI interaction logging failed:', error);
    }
  }

  /**
   * Private: Get fallback response
   */
  private getFallbackResponse(context: ConversationContext): AIResponse {
    const fallbackMessages = [
      'عذراً، واجهت مشكلة تقنية. يرجى إعادة إرسال رسالتك 🙏',
      'أعتذر، لم أتمكن من فهم طلبك بوضوح. هل يمكنك إعادة الصياغة؟',
      'نواجه مشكلة تقنية مؤقتة. سأتواصل معك قريباً 📱'
    ];

    const message = fallbackMessages[Math.floor(Math.random() * fallbackMessages.length)];

    return {
      message,
      messageAr: message,
      intent: 'SUPPORT',
      stage: context.stage,
      actions: [{ type: 'ESCALATE', data: { reason: 'AI_ERROR' }, priority: 1 }],
      products: [],
      confidence: 0.1,
      tokens: { prompt: 0, completion: 0, total: 0 },
      responseTime: 0
    };
  }
}

// Singleton instance
let aiServiceInstance: AIService | null = null;

/**
 * Get AI service instance
 */
export function getAIService(): AIService {
  if (!aiServiceInstance) {
    aiServiceInstance = new AIService();
  }
  return aiServiceInstance;
}

export default AIService;