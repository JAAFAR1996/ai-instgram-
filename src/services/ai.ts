/**
 * ===============================================
 * AI Service - OpenAI Integration for Sales Assistant
 * Secure AI conversation handling with Arabic support
 * ===============================================
 */

import OpenAI from 'openai';
import SmartProductSearch from './search/smart-product-search.js';
import ErrorFallbacksService from './error-fallbacks.js';
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

export interface ImageData {
  url?: string; // remote URL
  base64?: string; // raw base64 without data URL prefix
  mimeType?: string; // e.g., image/png, image/jpeg
  width?: number;
  height?: number;
  sizeBytes?: number;
  caption?: string;
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
  imageData?: ImageData[]; // Optional images attached to the current message
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
  
  // Performance optimization: Product caching with size limit
  private productCache = new Map<string, { products: Product[]; timestamp: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_CACHE_SIZE = 100;
  private search = new SmartProductSearch();

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
    if (!text) return '';
    return String(text)
      .replace(/[\r\n]/g, ' ')
      .replace(/\b(\+?\d[\d\s-]{6,})\b/g, '***redacted-phone***')
      .replace(/@[\w.\-]{3,}/g, '@***redacted***')
      .slice(0, 500);
  }

  /** Analyze customer mood and personality from message */
  private analyzeCustomerMood(message: string, _history: MessageHistory[]): {
    mood: 'happy' | 'neutral' | 'frustrated' | 'excited' | 'hesitant' | 'joking';
    personality: 'formal' | 'casual' | 'friendly' | 'business';
    urgency: 'low' | 'medium' | 'high';
    buyingIntent: 'browsing' | 'comparing' | 'ready' | 'negotiating';
  } {
    const text = message.toLowerCase();
    
    // Detect mood
    let mood: 'happy' | 'neutral' | 'frustrated' | 'excited' | 'hesitant' | 'joking' = 'neutral';
    if (/😂|😄|😊|هههه|حلو|رائع|ممتاز|والله زين/.test(text)) mood = 'happy';
    else if (/😍|🔥|واو|يجنن|كلش حلو|أحبه/.test(text)) mood = 'excited';
    else if (/غالي|مكلف|ما عندي|صعب|مش متأكد/.test(text)) mood = 'hesitant';
    else if (/😤|زعلان|مو حلو|سيء|مشكلة/.test(text)) mood = 'frustrated';
    else if (/هههه|😂|مزح|يضحك/.test(text)) mood = 'joking';
    
    // Detect personality
    let personality: 'formal' | 'casual' | 'friendly' | 'business' = 'casual';
    if (/حضرتك|سيادتك|المحترم/.test(text)) personality = 'formal';
    else if (/حبيبي|عزيزي|أخي|صديقي/.test(text)) personality = 'friendly';
    else if (/أريد|أطلب|كم السعر|متى التسليم/.test(text)) personality = 'business';
    
    // Detect urgency
    let urgency: 'low' | 'medium' | 'high' = 'medium';
    if (/بسرعة|عاجل|اليوم|الآن|مستعجل/.test(text)) urgency = 'high';
    else if (/متى شايف|لما أقدر|بالمستقبل/.test(text)) urgency = 'low';
    
    // Detect buying intent
    let buyingIntent: 'browsing' | 'comparing' | 'ready' | 'negotiating' = 'browsing';
    if (/أريد أشتري|خذ طلبي|موافق|أوكي/.test(text)) buyingIntent = 'ready';
    else if (/كم السعر|عندكم أرخص|بكم/.test(text)) buyingIntent = 'comparing';
    else if (/ممكن تنزل|خصم|تخفيض/.test(text)) buyingIntent = 'negotiating';
    
    return { mood, personality, urgency, buyingIntent };
  }

  /** Generate contextual response based on customer analysis */
  private adaptResponseToCustomer(
    baseResponse: string, 
    customerAnalysis: ReturnType<typeof this.analyzeCustomerMood>
  ): string {
    let adapted = baseResponse;
    
    // Adapt to mood
    if (customerAnalysis.mood === 'excited') {
      adapted = adapted.replace(/\.$/, ' 🔥');
      if (!adapted.includes('والله')) adapted = `والله ${adapted}`;
    } else if (customerAnalysis.mood === 'hesitant') {
      adapted = `لا تشيل هم، ${adapted}. وإذا ما عجبك نرجعلك فلوسك`;
    } else if (customerAnalysis.mood === 'frustrated') {
      adapted = `أفهم شعورك حبيبي، ${adapted}. خلنا نحل هاي المشكلة سوية`;
    } else if (customerAnalysis.mood === 'joking') {
      adapted = `هههه ${adapted} 😄`;
    }
    
    // Adapt to personality
    if (customerAnalysis.personality === 'formal') {
      adapted = adapted.replace(/حبيبي|عزيزي/g, 'أستاذ');
    } else if (customerAnalysis.personality === 'friendly') {
      if (!adapted.includes('حبيبي') && Math.random() < 0.7) {
        adapted = adapted.replace(/^/, 'حبيبي، ');
      }
    }
    
    // Adapt to urgency
    if (customerAnalysis.urgency === 'high') {
      adapted = `أكيد، ${adapted}. وبسرعة إن شاء الله`;
    }
    
    // Adapt to buying intent
    if (customerAnalysis.buyingIntent === 'ready') {
      adapted += '. تريد أخذ طلبك الآن؟';
    } else if (customerAnalysis.buyingIntent === 'negotiating') {
      adapted += '. وعندنا عروض حلوة للزبائن الطيبين مثلك';
    }
    
    return adapted;
  }

  /** Remember customer preferences and context */
  private buildSmartMemoryContext(context: ConversationContext): string {
    const history = context.conversationHistory.slice(-10);
    const customerMessages = history.filter(h => h.role === 'user').map(h => h.content);
    
    // Extract preferences from conversation
    const preferences: string[] = [];
    const mentionedProducts: string[] = [];
    
    customerMessages.forEach(msg => {
      const text = msg.toLowerCase();
      
      // Extract product mentions
      if (/قميص|بنطلون|حذاء|جانتي|فستان/.test(text)) {
        const products = text.match(/قميص|بنطلون|حذاء|جانتي|فستان/g);
        if (products) mentionedProducts.push(...products);
      }
    });
    const priceRange: string[] = [];
    
    customerMessages.forEach(msg => {
      const text = msg.toLowerCase();
      
      // Extract color preferences
      if (/أسود|أبيض|أحمر|أزرق|أخضر|أصفر/.test(text)) {
        const colors = text.match(/أسود|أبيض|أحمر|أزرق|أخضر|أصفر/g);
        if (colors) preferences.push(`يحب الألوان: ${colors.join('، ')}`);
      }
      
      // Extract size preferences
      if (/صغير|متوسط|كبير|لارج|ميديوم|سمول/.test(text)) {
        const sizes = text.match(/صغير|متوسط|كبير|لارج|ميديوم|سمول/g);
        if (sizes) preferences.push(`المقاسات المفضلة: ${sizes.join('، ')}`);
      }
      
      // Extract budget hints
      if (/\d+/.test(text)) {
        const numbers = text.match(/\d+/g);
        if (numbers) priceRange.push(`ميزانية حوالي: ${numbers.join('-')} دينار`);
      }
    });
    
    const memoryParts = [];
    if (preferences.length) memoryParts.push(`التفضيلات: ${preferences.join('، ')}`);
    if (priceRange.length) memoryParts.push(priceRange[priceRange.length - 1]);
    if (mentionedProducts.length) memoryParts.push(`منتجات مذكورة: ${mentionedProducts.slice(0, 3).join('، ')}`);
    
    return memoryParts.length ? memoryParts.join(' | ') : 'زبون جديد';
  }

  /** Add smart selling techniques */
  private addSellingIntelligence(
    response: string, 
    customerMessage: string
  ): string {
    const text = customerMessage.toLowerCase();
    let enhanced = response;
    
    // Handle price objections smartly
    if (/غالي|مكلف|أرخص/.test(text)) {
      const techniques = [
        'والله الجودة تستاهل هاي الفلوس',
        'شوف حبيبي، هاي القطعة راح تضل معك سنين',
        'إذا تحسب السعر على الاستعمال، راح تلاقيه رخيص كلش',
        'وعندنا ضمان وإذا ما عجبك نرجعلك فلوسك'
      ];
      enhanced += '. ' + techniques[Math.floor(Math.random() * techniques.length)];
    }
    
    // Handle hesitation with reassurance
    if (/مش متأكد|ما أدري|خلني أفكر/.test(text)) {
      const reassurance = [
        'لا تشيل هم، خذ وقتك بالتفكير',
        'أنا هنا لمساعدتك بأي شي',
        'مافي عجلة، المهم تلاقي اللي يعجبك',
        'وإذا حبيت تشوف قطع ثانية، أنا موجود'
      ];
      enhanced += '. ' + reassurance[Math.floor(Math.random() * reassurance.length)];
    }
    
    // Create urgency for interested customers
    if (/حلو|يعجبني|أحبه|رائع/.test(text)) {
      const urgency = [
        'وهاي القطعة عليها إقبال كبير',
        'بصراحة، ما بقى منها كثير',
        'والله هاي من أحسن القطع عندنا',
        'وعندنا عرض خاص لهاي الأيام'
      ];
      if (Math.random() < 0.6) {
        enhanced += '. ' + urgency[Math.floor(Math.random() * urgency.length)];
      }
    }
    
    // Handle comparison shopping
    if (/عند غيركم|في محل ثاني|أرخص منكم/.test(text)) {
      const competitive = [
        'أكيد راح تلاقي أرخص، بس الجودة مو زي بعض',
        'احنا نركز على الجودة مش بس السعر',
        'وعندنا خدمة بعد البيع ما تلاقيها بمحل',
        'جرب وشوف، وإذا ما عجبك نرجعلك فلوسك'
      ];
      enhanced += '. ' + competitive[Math.floor(Math.random() * competitive.length)];
    }
    
    return enhanced;
  }

  /** Add natural conversation flow */
  private makeConversationNatural(
    response: string,
    customerMessage: string,
    history: MessageHistory[]
  ): string {
    let natural = response;
    
    // Add natural transitions
    const recentMessages = history.slice(-3).map(h => h.content.toLowerCase());
    const hasRepeatedQuestion = recentMessages.some(msg => 
      customerMessage.toLowerCase().includes(msg.substring(0, 10))
    );
    
    if (hasRepeatedQuestion) {
      const acknowledgments = [
        'زي ما قلتلك،',
        'مثل ما ذكرتلك،',
        'نعم حبيبي،',
        'أكيد،'
      ];
      natural = acknowledgments[Math.floor(Math.random() * acknowledgments.length)] + ' ' + natural;
    }
    
    // Add conversation continuers
    if (Math.random() < 0.3) {
      const continuers = [
        'شنو رأيك؟',
        'عندك أي سؤال ثاني؟',
        'تحب أوريك شي ثاني؟',
        'وشنو رأيك باللون؟'
      ];
      natural += ' ' + continuers[Math.floor(Math.random() * continuers.length)];
    }
    
    return natural;
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
        
        const fallbackResponse = await this.getEnhancedFallbackResponse(context, customerMessage);
        
        // تأكد من إيصال الرسالة للمستخدم
        await this.notifyUserAIDisabled(context);
        
        return fallbackResponse;
      }

      // Lightweight intent analysis to guide downstream behavior
      let analyzedIntent: IntentAnalysisResult | undefined;
      try { 
        analyzedIntent = await this.analyzeIntent(customerMessage, context);
        this.logger.debug('Intent analysis successful', { 
          intent: analyzedIntent.intent, 
          confidence: analyzedIntent.confidence 
        });
      } catch (error) {
        this.logger.warn('Intent analysis failed, continuing without intent', { 
          error: String(error),
          customerMessage: this.maskPII(customerMessage)
        });
        // إنشاء intent افتراضي بدلاً من تجاهل الخطأ
        analyzedIntent = {
          intent: 'CONVERSATION',
          confidence: 0.5,
          entities: {},
          stage: context.stage
        };
      }

      // Build conversation prompt (text + optional vision parts)
      const prompt = await this.buildConversationPrompt(customerMessage, context);

      // Call OpenAI API with timeout + retry
      const controller = new AbortController();
      const timeout = this.config.ai.timeout || 30000;
      const timer = setTimeout(() => controller.abort(), timeout);
      
      const useVision = Array.isArray(context.imageData) && context.imageData.length > 0;
      // Best-effort vision product analysis to enrich results
      let visionProducts: { id: string; sku: string; name_ar: string; effective_price?: number; price_currency?: string; stock_quantity: number }[] = [];
      let visionInfo: { ocrText?: string; defects?: { hasDefect: boolean; notes: string[] } } | null = null;
      if (useVision) {
        try {
          const { getInstagramAIService } = await import('./instagram-ai.js');
          const ig = getInstagramAIService();
          const analysis = await ig.analyzeImagesGeneric(context.merchantId, context.imageData!, customerMessage);
          visionProducts = analysis.candidates || [];
          visionInfo = { ocrText: analysis.ocrText, defects: analysis.defects };
          this.logger.debug('Vision analysis successful', { 
            productsFound: visionProducts.length,
            hasOCR: !!visionInfo?.ocrText,
            hasDefects: !!visionInfo?.defects?.hasDefect
          });
        } catch (e) {
          this.logger.warn('Vision product analysis failed, continuing without vision data', { 
            error: String(e),
            imageCount: context.imageData?.length || 0
          });
          // إنشاء بيانات افتراضية للرؤية بدلاً من تجاهل الخطأ
          visionProducts = [];
          visionInfo = { ocrText: '', defects: { hasDefect: false, notes: [] } };
        }
      }
      const model = useVision ? (this.config.ai.visionModel || 'gpt-4o-mini') : this.config.ai.model;
      // باتش 4: تسجيل DEBUG للـ HTTP Outbound
      this.logger.debug('OpenAI request payload:', { 
        model, 
        messageCount: prompt.length,
        temperature: Math.min(this.config.ai.temperature ?? 0.8, 1.0),
        maxTokens: Math.min(this.config.ai.maxTokens ?? 500, 800),
        presencePenalty: 0.6,
        frequencyPenalty: 0.4
      });

      const completion = await this.withRetry(
        () => this.openai.chat.completions.create({
          model,
          messages: prompt,
          temperature: Math.min(this.config.ai.temperature ?? 0.8, 1.0),
          max_tokens: Math.min(this.config.ai.maxTokens ?? 500, 800),
          top_p: 0.9,
          presence_penalty: 0.6, // زيادة عقوبة التكرار
          frequency_penalty: 0.4, // تقليل تكرار الكلمات
        }),
        'openai.chat.completions'
      ).finally(() => clearTimeout(timer));

      // باتش 4: تسجيل استجابة OpenAI
      this.logger.debug('OpenAI response received:', { 
        usage: completion.usage,
        choicesCount: completion.choices?.length || 0,
        finishReason: completion.choices?.[0]?.finish_reason
      });

      const responseTime = Date.now() - startTime;
      const response = completion.choices?.[0]?.message?.content;

      if (!response) {
        throw new Error('No response from OpenAI');
      }

      // Get the already analyzed customer data and create intelligent response
      let smartResponse = response.trim();
      
      // Apply human-like intelligence enhancements
      if (smartResponse.length < 10) {
        smartResponse = 'أهلاً حبيبي! شلونك اليوم؟ شنو أقدر أساعدك بيه؟';
      }
      
      // Apply customer mood analysis and adaptation
      const customerAnalysis = this.analyzeCustomerMood(customerMessage, context.conversationHistory);
      smartResponse = this.adaptResponseToCustomer(smartResponse, customerAnalysis);
      
      // Add selling intelligence
      smartResponse = this.addSellingIntelligence(smartResponse, customerMessage);
      
      // Make conversation more natural
      smartResponse = this.makeConversationNatural(smartResponse, customerMessage, context.conversationHistory);
      
      const aiResponse: AIResponse = {
        message: smartResponse,
        messageAr: smartResponse,
        intent: analyzedIntent?.intent || 'conversation',
        stage: context.stage,
        actions: [],
        products: [],
        confidence: 0.9,
        tokens: {
          prompt: completion.usage?.prompt_tokens ?? 0,
          completion: completion.usage?.completion_tokens ?? 0,
          total: completion.usage?.total_tokens ?? 0
        },
        responseTime: responseTime
      };

      // Attach visual candidates and signals
      if (visionProducts.length) {
        aiResponse.products = visionProducts.slice(0, 5).map(p => ({
          productId: p.id,
          sku: p.sku,
          name: p.name_ar,
          price: Number(p.effective_price ?? 0),
          confidence: 0.7,
          reason: 'visual_match'
        }));
        aiResponse.actions.push({ type: 'SHOW_PRODUCT', data: { items: aiResponse.products.slice(0, 3) }, priority: 1 });
      }
      if (visionInfo?.ocrText && visionInfo.ocrText.length > 0) {
        aiResponse.actions.push({ type: 'COLLECT_INFO', data: { field: 'ocr_text', value: visionInfo.ocrText.slice(0, 500) }, priority: 2 });
      }
      if (visionInfo?.defects && visionInfo.defects.hasDefect) {
        aiResponse.actions.push({ type: 'ESCALATE', data: { reason: 'defect_detected', notes: (visionInfo.defects.notes || []).slice(0, 3) }, priority: 1 });
      }

      // Auto-suggest products for product-related intents
      try {
        const productIntents = new Set(['PRODUCT_INQUIRY', 'BROWSING', 'PRICE_INQUIRY']);
        if (analyzedIntent && productIntents.has(analyzedIntent.intent)) {
          const recs = await this.generateProductRecommendations(customerMessage, context, 5);
          if (Array.isArray(recs) && recs.length) {
            aiResponse.products = recs;
            aiResponse.actions = [
              { type: 'SHOW_PRODUCT', data: { items: recs.slice(0, 3) }, priority: 1 }
            ];
            this.logger.debug('Product recommendations generated successfully', { 
              count: recs.length,
              intent: analyzedIntent.intent
            });
          }
        }
      } catch (e) {
        this.logger.warn('Auto-suggestions generation failed, trying fallback recommendations', { 
          error: String(e),
          intent: analyzedIntent?.intent
        });
        // محاولة إنشاء اقتراحات بديلة
        try {
          const fallbackRecs = await this.getFallbackProductRecommendations(context.merchantId, 3);
          if (fallbackRecs.length > 0) {
            aiResponse.products = fallbackRecs;
            aiResponse.actions = [
              { type: 'SHOW_PRODUCT', data: { items: fallbackRecs }, priority: 2 }
            ];
            this.logger.debug('Fallback product recommendations generated', { count: fallbackRecs.length });
          }
        } catch (fallbackError) {
          this.logger.error('Fallback recommendations also failed', { error: String(fallbackError) });
        }
      }
      
      // Simple validation - just check if message exists
      if (!aiResponse.message || aiResponse.message.trim().length === 0) {
        this.logger.error("Empty AI response", { got: aiResponse });
        return await this.getEnhancedFallbackResponse(context, customerMessage);
      }
      
      // Add metadata
      aiResponse.tokens = {
        prompt: completion.usage?.prompt_tokens ?? 0,
        completion: completion.usage?.completion_tokens ?? 0,
        total: completion.usage?.total_tokens ?? 0
      };
      aiResponse.responseTime = responseTime;

      // Post-process: Constitutional AI critique & improvement (best-effort)
      try {
        const { ConstitutionalAI } = await import('./constitutional-ai.js');
        const ca = new ConstitutionalAI();
        const critique = await ca.critiqueResponse(aiResponse.message, { merchantId: context.merchantId });
        if (!critique.meetsThreshold) {
          const improved = await ca.improveResponse(aiResponse.message, critique, { merchantId: context.merchantId });
          aiResponse.message = improved.improved;
          aiResponse.messageAr = improved.improved;
          this.logger.debug('ConstitutionalAI improved response', { 
            originalLength: aiResponse.message.length,
            improvedLength: improved.improved.length
          });
        } else {
          this.logger.debug('ConstitutionalAI response meets quality threshold');
        }
      } catch (e) {
        this.logger.warn('ConstitutionalAI post-process failed, using original response', { 
          error: String(e),
          messageLength: aiResponse.message.length
        });
        // الاستمرار بالرد الأصلي بدلاً من تجاهل الخطأ
      }

      // Post-process: Response diversity improvement
      try {
        const { improveResponseDiversity } = await import('../utils/response-diversity.js');
        const conversationHistory = Array.isArray((context as any)?.conversationHistory) 
          ? (context as any).conversationHistory as Array<{ role: string; content: string; timestamp?: string | Date }>
          : [];
        
        const historyForDiversity = conversationHistory.map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
          timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date()
        }));
        
        const improvedMessage = improveResponseDiversity(aiResponse.message, historyForDiversity);
        if (improvedMessage !== aiResponse.message) {
          this.logger.debug('Response diversity improved', {
            originalLength: aiResponse.message.length,
            improvedLength: improvedMessage.length
          });
          aiResponse.message = improvedMessage;
          aiResponse.messageAr = improvedMessage;
        } else {
          this.logger.debug('Response diversity already optimal');
        }
      } catch (e) {
        this.logger.warn('Response diversity improvement failed, using original response', { 
          error: String(e),
          historyLength: context.conversationHistory.length
        });
        // الاستمرار بالرد الأصلي بدلاً من تجاهل الخطأ
      }

      // Post-process: Tone & Dialect adaptation (Iraqi/BAGHDADI + tier + sentiment)
      try {
        const { CustomerProfiler } = await import('./customer-profiler.js');
        const { adaptDialectAndTone, detectSentiment } = await import('./tone-dialect.js');
        const profiler = new CustomerProfiler();
        const profile = await profiler.personalizeResponses(context.merchantId, context.customerId);
        const sentiment = detectSentiment(customerMessage);
        const adapted = adaptDialectAndTone(aiResponse.message, {
          dialect: 'baghdadi',
          tier: profile.tier,
          sentiment
        });
        aiResponse.message = adapted;
        aiResponse.messageAr = adapted;
        this.logger.debug('Tone/Dialect adaptation successful', { 
          dialect: 'baghdadi',
          tier: profile.tier,
          sentiment
        });
      } catch (e) {
        this.logger.warn('Tone/Dialect adaptation failed, using original response', { 
          error: String(e),
          customerId: context.customerId
        });
        // الاستمرار بالرد الأصلي بدلاً من تجاهل الخطأ
      }

      // Log AI interaction
      await this.logAIInteraction(context, this.maskPII(customerMessage), aiResponse);

      // Save assistant message in semantic memory (best-effort)
      try {
        const { getSemanticMemoryService } = await import('./semantic-memory.js');
        const mem = getSemanticMemoryService();
        const convId = (context as any)?.conversationId || '00000000-0000-0000-0000-000000000000';
        await mem.saveMessage(context.merchantId, context.customerId, convId, 'assistant', aiResponse.message);
        this.logger.debug('Message saved to semantic memory', { 
          conversationId: convId,
          messageLength: aiResponse.message.length
        });
      } catch (e) {
        this.logger.warn('Failed to save message to semantic memory', { 
          error: String(e),
          conversationId: (context as any)?.conversationId
        });
        // الاستمرار بدون حفظ في الذاكرة الدلالية
      }

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
      return await this.getEnhancedFallbackResponse(context, customerMessage);
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
        temperature: this.config.ai.intentTemperature ?? 0.3,
        max_tokens: this.config.ai.intentMaxTokens || 200,
        response_format: { type: 'json_object' }
      });

      const response = completion.choices?.[0]?.message?.content;
      if (!response) {
        throw new Error('No response from OpenAI for intent analysis');
      }
      
      try {
        const result = JSON.parse(response) as IntentAnalysisResult;
        return result;
      } catch (parseError) {
        this.logger.error('Intent analysis JSON parse failed', { error: parseError, response: response.slice(0, 200) });
        return {
          intent: 'UNKNOWN',
          confidence: 0,
          entities: {},
          stage: context.stage
        };
      }
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
        temperature: this.config.ai.recommendationTemperature ?? 0.5,
        max_tokens: this.config.ai.recommendationMaxTokens || 300,
        response_format: { type: 'json_object' }
      });

      const response = completion.choices?.[0]?.message?.content;
      if (!response) {
        throw new Error('No response from OpenAI for product recommendations');
      }
      
      try {
        const recommendations = JSON.parse(response) as AIRecommendationResponse;
        if (Array.isArray(recommendations.recommendations)) {
          return recommendations.recommendations.slice(0, maxProducts);
        }
        return [];
      } catch (parseError) {
        this.logger.error('Product recommendations JSON parse failed', { error: parseError, response: response.slice(0, 200) });
        return [];
      }
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
        temperature: this.config.ai.summaryTemperature ?? 0.3,
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
    // Persona by merchant type (fallbacks)
    const persona = await this.getMerchantPersona(context.merchantId);
    const memoryLine = this.buildMemoryLine(context.customerProfile);

    // Enrich prompt with business label and relevant products
    const catLabelMap: Record<string, string> = {
      fashion: 'ملابس وأزياء', electronics: 'إلكترونيات', beauty: 'جمال', grocery: 'مواد غذائية',
      pharmacy: 'صيدلية', toys: 'ألعاب', sports: 'رياضة', books: 'كتب', home: 'منزل', auto: 'سيارات',
      electric: 'أجهزة كهربائية', other: 'عام'
    };
    const catLabel = catLabelMap[persona.businessCategory] || 'عام';
    // جلب اسم المتجر من قاعدة البيانات - ديناميكي بالكامل
    let businessName = 'متجرنا'; // قيمة افتراضية فقط
    try {
      const { dynamicTemplateManager } = await import('./dynamic-template-manager.js');
      const defaults = await dynamicTemplateManager.getDefaults(context.merchantId);
      businessName = defaults.businessName;
    } catch (error) {
      this.logger.warn('Failed to get dynamic business name', { error: String(error) });
      businessName = context.merchantSettings?.businessName || 'متجرنا';
    }
    let relevantProducts: Array<Record<string, any>> = [];
    try { 
      relevantProducts = await this.searchRelevantProducts(customerMessage, context.merchantId, 5);
      this.logger.debug('Relevant products found', { count: relevantProducts.length });
    } catch (e) {
      this.logger.warn('Product search failed, using empty product list', { 
        error: String(e),
        query: this.maskPII(customerMessage)
      });
      relevantProducts = [];
    }
    const productInfo = this.formatProductsForPrompt(relevantProducts);
    const newSystemPrompt = `أنت بائع عراقي ذكي وطبيعي في متجر ${businessName} (${catLabel}). تتكلم مثل الإنسان الحقيقي.\n\n📦 المنتجات المتوفرة:\n${productInfo}\n\n🧠 كن ذكياً:\n- اقرأ بين السطور وافهم قصد الزبون\n- تذكر تفضيلاته من المحادثات السابقة\n- اقترح منتجات تناسب شخصيته وميزانيته\n- فاوض بذكاء واعرض خصومات منطقية\n- اربط المنتجات بحياة الزبون الشخصية\n\n💬 كن طبيعياً:\n- رد مثل صديق يساعد صديقه\n- استخدم نكت خفيفة ومناسبة\n- اظهر اهتمام حقيقي بالزبون\n- تفاعل مع مشاعره (فرح، قلق، استعجال)\n- كن صبور مع الأسئلة الكثيرة\n\n🎯 هدفك النهائي: اجعل الزبون يحس انك صديقه وتريد مصلحته، مش بس تبيع له.`;

    // legacy prompt kept for reference was replaced by newSystemPrompt

    // Analyze customer mood for intelligent response
    const customerAnalysis = this.analyzeCustomerMood(customerMessage, context.conversationHistory);
    const smartMemory = this.buildSmartMemoryContext(context);
    
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: newSystemPrompt },
      { role: 'system', content: `معلومات الزبون: ${memoryLine}` },
      { role: 'system', content: `ذاكرة ذكية: ${smartMemory}` },
      { role: 'system', content: `حالة الزبون: مزاجه ${customerAnalysis.mood}، شخصيته ${customerAnalysis.personality}، استعجاله ${customerAnalysis.urgency}، نية الشراء ${customerAnalysis.buyingIntent}` },
      { role: 'system', content: 'تكلم مثل العراقي الأصيل - بغدادي ذكي وودود. استخدم: شلونك، حبيبي، أكيد، والله، إن شاء الله، كلش حلو، يعجبك، تجنن، ما شاء الله. اقرأ مزاج الزبون وتفاعل معه بذكاء. الأهم: كن صادق ومفيد وطبيعي.' },
      { role: 'system', content: '🧠 قواعد الذكاء: 1) اقرأ بين السطور 2) تذكر المحادثات السابقة 3) اربط المنتجات بحياة الزبون 4) فاوض بذكاء 5) اعرض حلول للمشاكل 6) كن صبور ومتفهم 7) استخدم اليومور بذكاء' }
    ];

    // Add recent conversation history (last 6)
    for (const msg of context.conversationHistory.slice(-6)) {
      messages.push({ role: msg.role, content: msg.content });
    }

    // RAG: Merchant Knowledge Base (best-effort)
    try {
      const { kbSearch } = await import('../kb/search.js');
      const kbHits = await kbSearch(context.merchantId, customerMessage, 3, {});
      if (kbHits && kbHits.length) {
        const ctx = kbHits.map(h => `• ${h.title}: ${h.chunk.trim().slice(0, 300)}`).join('\n');
        messages.push({ role: 'system', content: `مقتطفات من قاعدة المعرفة (استخدمها فقط إذا كانت مناسبة للسؤال):\n${ctx}` });
        this.logger.debug('Knowledge base context added', { hits: kbHits.length });
      } else {
        this.logger.debug('No knowledge base hits found');
      }
    } catch (e) {
      this.logger.warn('Knowledge base retrieval failed, continuing without KB context', { 
        error: String(e),
        merchantId: context.merchantId
      });
    }

    // Semantic Memory: retrieve similar conversation snippets (best-effort)
    try {
      const { getSemanticMemoryService } = await import('./semantic-memory.js');
      const mem = getSemanticMemoryService();
      const memories = await mem.searchSimilar(context.merchantId, context.customerId, customerMessage, 4);
      if (Array.isArray(memories) && memories.length) {
        const lines = memories.map(m => `${m.role === 'user' ? 'المستخدم' : 'الوكيل'}: ${m.content}`).join('\n');
        messages.push({ role: 'system', content: `ذكريات محادثة سابقة:\n${lines}` });
        this.logger.debug('Semantic memory context added', { memories: memories.length });
      } else {
        this.logger.debug('No semantic memories found');
      }
    } catch (e) {
      this.logger.warn('Semantic memory retrieval failed, continuing without memory context', { 
        error: String(e),
        customerId: context.customerId
      });
    }

    // Build user content with optional images (vision parts)
    const userContent = this.buildUserContentWithImages(customerMessage, context.imageData || []);
    messages.push(userContent);

    return messages;
  }

  /** Build user content including image parts when provided */
  private buildUserContentWithImages(
    text: string,
    images: ImageData[]
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam {
    if (!images || images.length === 0) {
      return { role: 'user', content: text };
    }
    const parts: Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    > = [];
    const safeText = (text ?? '').trim();
    if (safeText) parts.push({ type: 'text', text: safeText });
    for (const img of images.slice(0, 3)) {
      const url = this.toDataUrlOrPass(img);
      if (url) parts.push({ type: 'image_url', image_url: { url } });
      if (img.caption) parts.push({ type: 'text', text: `تفاصيل الصورة: ${img.caption}` });
    }
    // Cast to SDK param (content as parts supported by gpt-4o)
    return { role: 'user', content: parts as OpenAI.Chat.Completions.ChatCompletionMessageParam['content'] } as OpenAI.Chat.Completions.ChatCompletionMessageParam;
  }

  /** Convert ImageData to a data URL if base64 present, otherwise return URL */
  private toDataUrlOrPass(img: ImageData): string | null {
    if (img.base64 && img.mimeType) {
      return `data:${img.mimeType};base64,${img.base64}`;
    }
    if (img.url && /^https?:\/\//i.test(img.url)) return img.url;
    return null;
  }

  // Search products related to the user message (via SmartProductSearch)
  private async searchRelevantProducts(message: string, merchantId: string, limit = 5): Promise<any[]> {
    try {
      const results = await this.search.searchProducts(message, merchantId, { limit });
      return results.map(r => r.product);
    } catch (error: unknown) {
      this.logger.warn('Product search failed', { error: String(error) });
      return [];
    }
  }

  // Format product list for inclusion in system prompt
  private formatProductsForPrompt(products: unknown[]): string {
    if (!products || products.length === 0) {
      return 'لا توجد نتائج مرتبطة بالاستفسار. يمكنك طلب تفاصيل أكثر (المقاس/اللون/الفئة).';
    }
    return products.map((p: unknown, idx: number) => {
      if (typeof p !== 'object' || p === null) return `${idx + 1}. منتج غير صالح`;
      
      const product = p as Record<string, unknown>;
      const price = product.sale_price_amount ?? product.price_amount ?? product.price_usd ?? 'غير محدد';
      const stockNum = Number(product.stock_quantity ?? 0);
      const stock = stockNum > 0 ? `متوفر (مخزون: ${stockNum})` : 'غير متوفر';
      const sku = product.sku ? ` | SKU: ${product.sku}` : '';
      const name = product.name_ar ?? product.name_en ?? 'غير محدد';
      return `${idx + 1}. ${name} — ${price} د.ع — ${stock}${sku}`;
    }).join('\n');
  }

  /** Fetch merchant persona (tone/category) from DB */
  private async getMerchantPersona(merchantId: string): Promise<{ tone: string; businessCategory: string; salesStyle: string }> {
    try {
      const rows = await this.db.query(
        `SELECT COALESCE(business_category,'other') as business_category, COALESCE(sales_style,'neutral') as sales_style FROM merchants WHERE id = $1 LIMIT 1`,
        [merchantId]
      ) as Array<{ business_category: string; sales_style: string }>;
      const bc = (rows[0]?.business_category || 'other').toLowerCase();
      const salesStyle = rows[0]?.sales_style || 'neutral';
      
      // Default tone based on category, but can be overridden by sales_style
      let tone = bc === 'fashion' ? 'عصرية وودودة' : bc === 'electronics' ? 'احترافية وواضحة' : 'لطيفة ومهنية';
      
      // Override tone based on sales_style
      if (salesStyle === 'friendly') tone = 'ودودة ومرحبة';
      else if (salesStyle === 'professional') tone = 'احترافية ومهنية';
      else if (salesStyle === 'casual') tone = 'عفوية ومريحة';
      else if (salesStyle === 'enthusiastic') tone = 'متحمسة ونشطة';
      else if (salesStyle === 'persuasive') tone = 'مقنعة ومؤثرة';
      
      return { tone, businessCategory: bc, salesStyle };
    } catch {
      return { tone: 'لطيفة ومهنية', businessCategory: 'other', salesStyle: 'neutral' };
    }
  }

  /** Build short memory context string */
  private buildMemoryLine(profile?: CustomerProfile): string {
    if (!profile) return 'غير متوفر';
    const prefs = profile.preferredCategories?.slice(0, 3).join(', ');
    const orders = profile.previousOrders;
    return `طلبات سابقة: ${orders}, تفضيلات: ${prefs || 'غير محدد'}`;
  }

  /** Analyze images with a short, low-cost pass (optional utility) */
  public async analyzeImages(images: ImageData[], hint?: string): Promise<string> {
    if (!images || images.length === 0) return '';
    const msg = this.buildUserContentWithImages(hint || 'حلّل الصورة باختصار مفيد للبيع.', images);
    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'أنت محلل صور مختصر. اذكر اللون، النوع، وأي عيب واضح فقط.' },
        msg
      ],
      temperature: 0.7,
      max_tokens: 120,
    });
    return completion.choices?.[0]?.message?.content ?? '';
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
      `ID: ${p.id}, SKU: ${p.sku}, اسم: ${p.name_ar}, سعر: ${p.price_usd}, فئة: ${p.category}`
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
   * Private: Get fallback product recommendations when AI fails
   */
  private async getFallbackProductRecommendations(merchantId: string, limit: number = 3): Promise<ProductRecommendation[]> {
    try {
      const products = await this.getMerchantProducts(merchantId);
      return products.slice(0, limit).map(p => ({
        productId: p.id,
        sku: p.sku,
        name: p.name_ar,
        price: p.price_usd,
        confidence: 0.6,
        reason: 'اقتراح تلقائي (بديل)'
      }));
    } catch (error) {
      this.logger.error('Fallback product recommendations failed', { merchantId, error });
      return [];
    }
  }

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
      
      // Update cache with size management
      if (this.productCache.size >= this.MAX_CACHE_SIZE) {
        const oldestKey = this.productCache.keys().next().value;
        this.productCache.delete(oldestKey);
      }
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
          resource_type,
          entity_type,
          details,
          execution_time_ms,
          success
        ) VALUES (
          $1::uuid,
          $2,
          $3,
          $4,
          $5::jsonb,
          $6::int,
          $7::boolean
        )
      `, [
        context.merchantId,
        'SYSTEM_EVENT',
        'SYSTEM',
        'AI_INTERACTION',
        JSON.stringify({
          input: (input || '').substring(0, 200),
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

  // Product-aware enhanced fallback (tries quick suggestions)
  private async getEnhancedFallbackResponse(context: ConversationContext, lastMessage: string): Promise<AIResponse> {
    try {
      const svc = new ErrorFallbacksService();
      const fb = await svc.buildFallback(context.merchantId, context.customerId, lastMessage ?? '');
      const products = (fb.recommendations || []).map(r => ({
        productId: r.id,
        sku: r.sku,
        name: r.name,
        price: r.price ?? 0,
        confidence: 0.6,
        reason: 'اقتراح تلقائي'
      }));
      return {
        message: fb.text,
        messageAr: fb.text,
        intent: 'FALLBACK',
        stage: 'BROWSING',
        actions: products.length ? [{ type: 'SHOW_PRODUCT', data: { items: products.slice(0, 3) }, priority: 1 }] : [],
        products,
        confidence: 0.6,
        tokens: { prompt: 0, completion: 0, total: 0 },
        responseTime: 0
      };
    } catch (e) {
      this.logger.warn('Enhanced fallback failed', { error: String(e) });
      return this.getFallbackResponse();
    }
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
