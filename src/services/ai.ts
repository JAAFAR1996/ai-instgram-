/**
 * ===============================================
 * AI Service - OpenAI Integration for Sales Assistant
 * Secure AI conversation handling with Arabic support
 * ===============================================
 */

import OpenAI from 'openai';
import type { ConversationStage, Platform } from '../types/database.js';
import type { DIContainer } from '../container/index.js';
import type { Pool } from 'pg';
import type { AppConfig } from '../config/index.js';
import { getLogger } from './logger.js';

// Type definitions for better type safety
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
  data: Record<string, unknown>;
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
  cart: Record<string, unknown>[];
  preferences: Record<string, unknown>;
  conversationHistory: MessageHistory[];
  customerProfile?: CustomerProfile;
  merchantSettings?: MerchantSettings;
}

export interface MessageHistory {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
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
  workingHours: Record<string, unknown>;
  paymentMethods: string[];
  deliveryFees: Record<string, unknown>;
  autoResponses: Record<string, unknown>;
}

export interface Product {
  id: string;
  sku: string;
  name_ar: string;
  price_usd: number;
  category: string;
  stock_quantity: number;
}

export interface ProductSummary {
  category: string;
  count: number;
  avg_price: number;
}

export interface IntentAnalysisResult {
  intent: string;
  confidence: number;
  entities: Record<string, unknown>;
  stage: ConversationStage;
}

export interface AIRecommendationResponse {
  recommendations: ProductRecommendation[];
}

export class AIService {
  protected openai: OpenAI;
  protected pool: Pool;
  private config: AppConfig;
  private logger = getLogger({ component: 'ai-service' });
  private db: { query: (sql: string, params?: unknown[]) => Promise<unknown[]> };
  
  // Performance optimization: Product caching
  private productCache = new Map<string, { products: Product[]; timestamp: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(container: DIContainer) {
    // Initialize OpenAI client with proper validation
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    
    this.openai = new OpenAI({
      apiKey: openaiApiKey,
      timeout: 30000, // 30 seconds timeout
    });

    // Initialize database pool with validation
    this.pool = container.get<Pool>('pool');
    if (!this.pool) {
      throw new Error('Database pool not found in container');
    }

    // Initialize configuration with validation
    this.config = container.get<AppConfig>('config');
    if (!this.config) {
      throw new Error('AppConfig not found in container');
    }

    // Validate AI configuration
    if (!this.config.ai?.model) {
      throw new Error('AI model configuration is required');
    }

    if (!this.config.ai?.temperature) {
      throw new Error('AI temperature configuration is required');
    }

    if (!this.config.ai?.maxTokens) {
      throw new Error('AI maxTokens configuration is required');
    }

    // Initialize database interface with proper error handling
    this.db = {
      query: async (sql: string, params?: unknown[]) => {
        const client = await this.pool.connect();
        try {
          const result = await client.query(sql, params);
          return result.rows;
        } catch (error) {
          this.logger.error('Database query failed:', { sql, params, error });
          throw error;
        } finally {
          client.release();
        }
      }
    };

    this.logger.info('AI Service initialized successfully');
  }


  /** Mask PII (phones/IG handles) before logging */
  private maskPII(text: string): string {
    return (text || '')
      .replace(/\b(\+?\d[\d\s-]{6,})\b/g, '***redacted-phone***')
      .replace(/@[\w.\-]{3,}/g, '@***redacted***')
      .slice(0, 500);
  }

  /** Exponential backoff retry helper */
  private async withRetry<T>(fn: () => Promise<T>, label: string, max = 3, timeout = 30000): Promise<T> {
    let attempt = 0;
    let lastErr: unknown;
    while (attempt < max) {
      try {
        // ✅ إضافة timeout للعملية نفسها
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        const result = await Promise.race([
          fn(),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener('abort', () => {
              reject(new Error(`${label} timeout after ${timeout}ms`));
            });
          })
        ]);
        
        clearTimeout(timeoutId);
        return result;
      } catch (e: unknown) {
        lastErr = e;
        const msg = String((e as { message?: string })?.message || e);
        const retriable = /rate limit|timeout|ETIMEDOUT|ECONNRESET|ENETUNREACH|EAI_AGAIN/i.test(msg);
        if (!retriable) break;
        const delay = Math.min(2000 * Math.pow(2, attempt), 8000);
        this.logger.warn(`Retrying ${label} after ${delay}ms (attempt ${attempt + 1})`, { msg });
        await new Promise(r => setTimeout(r, delay));
      }
      attempt++;
    }
    throw lastErr instanceof Error ? lastErr : new Error(`${label} failed`);
  }

  /** Check if AI processing is enabled for merchant */
  private async isAIEnabled(merchantId: string): Promise<boolean> {
    try {
      const { getServiceController } = await import('./service-controller.js');
      const sc = getServiceController();
      return await sc.isServiceEnabled(merchantId, 'AI_RESPONSES');
    } catch (error: unknown) {
      this.logger.warn('Failed to check AI service status, defaulting to enabled:', { merchantId, error });
      return true;
    }
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
      // Service enablement check
      if (!(await this.isAIEnabled(context.merchantId))) {
        this.logger.warn('AI disabled by ServiceController; sending user notification', { 
          merchantId: context.merchantId 
        });
        
        const fallbackResponse = this.getFallbackResponse();
        
        // تأكد من إيصال الرسالة للمستخدم
        await this.notifyUserAIDisabled(context);
        
        return fallbackResponse;
      }

      // Build conversation prompt
      const prompt = await this.buildConversationPrompt(customerMessage, context);

      // Call OpenAI API with timeout + retry
      const controller = new AbortController();
      const timeout = this.config.ai.timeout || 30000;
      const timer = setTimeout(() => controller.abort(), timeout);
      
      const completion = await this.withRetry(
        () => this.openai.chat.completions.create({
          model: this.config.ai.model,
          messages: prompt,
          temperature: Math.min(this.config.ai.temperature ?? 0.2, 0.4),
          max_tokens: Math.min(this.config.ai.maxTokens ?? 180, 220),
          top_p: 0.9,
          presence_penalty: 0,
          frequency_penalty: 0,
          // response_format: { type: 'json_object' },
        }),
        'openai.chat.completions'
      ).finally(() => clearTimeout(timer));

      const responseTime = Date.now() - startTime;
      const response = completion.choices?.[0]?.message?.content;

      if (!response) {
        throw new Error('No response from OpenAI');
      }

      // Create simple AI response from text
      const aiResponse: AIResponse = {
        message: response.trim(),
        messageAr: response.trim(),
        intent: 'conversation',
        stage: context.stage,
        actions: [],
        products: [],
        confidence: 0.9,
        tokens: {
          prompt: completion.usage?.prompt_tokens || 0,
          completion: completion.usage?.completion_tokens || 0,
          total: completion.usage?.total_tokens || 0
        },
        responseTime: responseTime
      };
      
      // Simple validation - just check if message exists
      if (!aiResponse.message || aiResponse.message.trim().length === 0) {
        this.logger.error("Empty AI response", { got: aiResponse });
        return this.getFallbackResponse();
      }
      
      // Add metadata
      aiResponse.tokens = {
        prompt: completion.usage?.prompt_tokens || 0,
        completion: completion.usage?.completion_tokens || 0,
        total: completion.usage?.total_tokens || 0
      };
      aiResponse.responseTime = responseTime;

      // Log AI interaction
      await this.logAIInteraction(context, this.maskPII(customerMessage), aiResponse);

      return aiResponse;
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('AI response generation failed:', {
        error: err.message,
        stack: err.stack,
        merchantId: context.merchantId,
        customerId: context.customerId
      });
      
      // Return fallback response
      return this.getFallbackResponse();
    }
  }

  /**
   * Analyze customer intent from message
   */
  public async analyzeIntent(
    customerMessage: string,
    context: ConversationContext
  ): Promise<IntentAnalysisResult> {
    try {
      const prompt = this.buildIntentAnalysisPrompt(customerMessage, context);
      
      const completion = await this.openai.chat.completions.create({
        model: this.config.ai.intentModel || 'gpt-4o-mini',
        messages: prompt,
        temperature: this.config.ai.intentTemperature || 0.3,
        max_tokens: this.config.ai.intentMaxTokens || 200,
        response_format: { type: 'json_object' }
      });

      const response = completion.choices?.[0]?.message?.content;
      if (!response) {
        throw new Error('No response from OpenAI for intent analysis');
      }
      
      const result = JSON.parse(response) as IntentAnalysisResult;
      return result;
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Intent analysis failed', { 
        error: err.message, 
        customerMessage: this.maskPII(customerMessage),
        merchantId: context.merchantId 
      });
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
      // Get merchant's products with caching
      const products = await this.getMerchantProducts(context.merchantId);
      
      const prompt = this.buildProductRecommendationPrompt(
        customerQuery,
        products
      );

      const completion = await this.openai.chat.completions.create({
        model: this.config.ai.recommendationModel || 'gpt-4o-mini',
        messages: prompt,
        temperature: this.config.ai.recommendationTemperature || 0.5,
        max_tokens: this.config.ai.recommendationMaxTokens || 300,
        response_format: { type: 'json_object' }
      });

      const response = completion.choices?.[0]?.message?.content;
      if (!response) {
        throw new Error('No response from OpenAI for product recommendations');
      }
      
      const recommendations = JSON.parse(response) as AIRecommendationResponse;
      return recommendations.recommendations.slice(0, maxProducts);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Product recommendation failed', { 
        error: err.message, 
        customerQuery: this.maskPII(customerQuery),
        merchantId: context.merchantId 
      });
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
      const prompt = this.buildSummaryPrompt(conversationHistory);
      
      const completion = await this.openai.chat.completions.create({
        model: this.config.ai.summaryModel || 'gpt-4o-mini',
        messages: prompt,
        temperature: this.config.ai.summaryTemperature || 0.3,
        max_tokens: this.config.ai.summaryMaxTokens || 200
      });

      return completion.choices[0]?.message?.content || 'لا يوجد ملخص متاح';
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Conversation summary failed', { 
        error: err.message, 
        merchantId: context.merchantId,
        historyLength: conversationHistory.length 
      });
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
    const systemPrompt = `أنت مساعد مبيعات لمتجر أزياء على إنستغرام.
قواعد صارمة:
- اللغة: عربية بسيطة بلهجة عراقية.
- لا تحية عامة إلا في أول رسالة بالمحادثة فقط.
- رد قصير جدًا (سطر واحد أو سطران كحد أقصى).
- لا تكرر جملًا ولا تطيل.
- لا تختلق أسعار/منتجات؛ عند النقص قل: "أحتاج أتأكد".
- إيموجي واحد كحد أقصى.
- أنهِ الرد دائمًا بسؤال متابعة واحد محدد يملأ أقرب خانة ناقصة (الفئة، المقاس، اللون، النوع).`;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt }
    ];

    // Add recent conversation history for context (last 6 messages)
    const recentHistory = context.conversationHistory.slice(-6);
    if (recentHistory.length > 0) {
      recentHistory.forEach(msg => {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      });
    }

    // Add current customer message with context
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
    products: Product[]
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
    conversationHistory: MessageHistory[]
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
   * Private: Get merchant products summary with caching
   */

  /**
   * Private: Get merchant products with caching
   */
  private async getMerchantProducts(merchantId: string): Promise<Product[]> {
    try {
      // Check cache first
      const cached = this.productCache.get(merchantId);
      const now = Date.now();
      
      if (cached && (now - cached.timestamp) < this.CACHE_TTL) {
        return cached.products;
      }

      // Fetch from database
      const rows = await this.db.query(`
        SELECT id, sku, name_ar, price_usd, category, stock_quantity
        FROM products
        WHERE merchant_id = $1::uuid AND status = $2
        ORDER BY created_at DESC
        LIMIT 20
      `, [merchantId, 'ACTIVE']);
      
      const products = rows as Product[];
      
      // Update cache
      this.productCache.set(merchantId, { products, timestamp: now });
      
      return products;
    } catch (error: unknown) {
      this.logger.error('Failed to fetch merchant products', { merchantId, error });
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
      await this.db.query(`
        INSERT INTO audit_logs (
          merchant_id,
          action,
          entity_type,
          details,
          execution_time_ms,
          success
        ) VALUES (
          $1::uuid,
          $2,
          $3,
          $4::jsonb,
          $5::int,
          $6::boolean
        )
      `, [
        context.merchantId,
        'AI_RESPONSE_GENERATED',
        'AI_INTERACTION',
        JSON.stringify({
          input: input.substring(0, 200),
          intent: response.intent,
          stage: response.stage,
          tokens: response.tokens,
          confidence: response.confidence,
        }),
        Math.round(response.responseTime ?? 0),
        true
      ]);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error('AI interaction logging failed:', {
        error: err.message,
        stack: err.stack,
        merchantId: context.merchantId
      });
    }
  }

  /**
   * Private: Generate fallback response when AI fails
   */
  private getFallbackResponse(): AIResponse {
    return {
      message: 'عذراً، حدث خطأ في معالجة رسالتك. يرجى المحاولة مرة أخرى.',
      messageAr: 'عذراً، حدث خطأ في معالجة رسالتك. يرجى المحاولة مرة أخرى.',
      intent: 'unknown',
      stage: 'GREETING',
      actions: [{ type: 'ESCALATE', data: { reason: 'AI_ERROR' }, priority: 1 }],
      products: [],
      confidence: 0.1,
      tokens: { prompt: 0, completion: 0, total: 0 },
      responseTime: 0
    };
  }

  private async notifyUserAIDisabled(
    context: ConversationContext
  ): Promise<void> {
    try {
      // أرسل إشعار للمستخدم مباشرة
      const { getInstagramClient } = await import('./instagram-api.js');
      const client = await getInstagramClient(context.merchantId);
      const credentials = await client.loadMerchantCredentials(context.merchantId);
      
      if (credentials && context.customerId) {
        const notificationMessage = "خدمة الرد الآلي معطلة مؤقتاً. سيرد عليك أحد الموظفين قريباً 🙏";
        
        await client.sendMessage(credentials, context.merchantId, {
          recipientId: context.customerId,
          messagingType: 'RESPONSE',
          text: notificationMessage
        });
        
        this.logger.info('✅ AI disabled notification sent to user', { 
          merchantId: context.merchantId,
          customerId: context.customerId 
        });
      }
    } catch (notificationError) {
      this.logger.error('❌ Failed to notify user about AI disable', notificationError);
    }
  }



  /**
   * Clear product cache (useful for testing or manual cache invalidation)
   */
  public clearProductCache(): void {
    this.productCache.clear();
    this.logger.info('Product cache cleared');
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.productCache.size,
      entries: Array.from(this.productCache.keys())
    };
  }
}

// Factory function for DI container
export function createAIService(container: DIContainer): AIService {
  return new AIService(container);
}

// Legacy support function (deprecated)
export async function getAIService(): Promise<AIService> {
  // استخدام dynamic import بدلاً من require
  const { container } = await import('../container/index.js');
  if (!container.has('aiService')) {
    container.registerSingleton('aiService', () => new AIService(container));
  }
  return container.get('aiService');
}

export default AIService;