/**
 * ===============================================
 * Instagram AI Service - STEP 3 Implementation
 * AI conversation adaptation for Instagram's visual, casual, emoji-rich style
 * ===============================================
 */

import { type ConversationContext, type AIResponse, type ImageData } from './ai.js';
import { getDatabase } from '../db/adapter.js';
import { createLogger } from './logger.js';
import OpenAI from 'openai';
import { getEnv } from '../config/env.js';
import { getCache } from '../cache/index.js';

// تحسين Type Safety - إضافة interfaces جديدة
interface MerchantAIConfig {
  aiModel: string;
  maxTokens: number;
  temperature: number;
  language: string;
}

interface MerchantAIConfigData {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  language?: string;
}

interface StoryContext {
  mediaId: string;
  mediaType: string;
  caption?: string;
}

interface PostContext {
  mediaId: string;
  caption?: string;
}

interface Product {
  id: string;
  sku: string;
  name_ar: string;
  price_usd: number; // TODO: migrate to generic amount+currency
  category: string;
  description_ar?: string;
  image_urls?: string[];
}

interface MerchantContextCached {
  id: string;
  business_name: string;
  currency: string; // ISO 4217
  settings: {
    payment_methods?: string[];
    delivery_fees?: Record<string, unknown>;
    [k: string]: unknown;
  } | null;
}

export interface InstagramAIResponse extends AIResponse {
  mediaRecommendations?: MediaRecommendation[];
  hashtagSuggestions?: string[];
  visualStyle: 'story' | 'post' | 'reel' | 'direct';
  engagement: {
    likelyToShare: boolean;
    viralPotential: number;
    userGeneratedContent: boolean;
  };
}

export interface MediaRecommendation {
  type: 'image' | 'video' | 'carousel' | 'story';
  content: string;
  caption: string;
  hashtags: string[];
  callToAction: string;
}

type ErrorCode = 'AI_API_ERROR' | 'RATE_LIMIT' | 'NETWORK_ERROR';

export interface InstagramContext extends ConversationContext {
  interactionType: 'dm' | 'comment' | 'story_reply' | 'story_mention' | 'story_reaction';
  mediaContext?: {
    mediaId?: string;
    mediaType?: 'video' | 'carousel' | 'photo';
    caption?: string;
    hashtags?: string[];
    [k: string]: unknown;
  };
  visualPreferences?: {
    colorScheme: string[];
    aestheticStyle: string;
    contentType: string[];
  };
  // 🖼️ ENHANCED: Support for advanced image analysis
  imageAnalysis?: Array<{
    ocrText?: string;
    labels: Array<{ name: string; confidence: number; category: string }>;
    objects: Array<{ name: string; confidence: number }>;
    contentType: { category: string; subcategory?: string; confidence: number };
    visualFeatures: {
      isProduct: boolean;
      isText: boolean;
      dominantColors: string[];
      qualityScore: number;
    };
    productMatches?: Array<{
      productId: string;
      sku: string;
      name: string;
      similarity: number;
      matchType: 'visual' | 'text' | 'combined';
    }>;
    confidence: number;
  }>;
}

export class InstagramAIService {
  private logger = createLogger({ component: 'InstagramAI' });
  private openai: OpenAI;
  private static readonly DEFAULT_TIMEOUT_MS = 30_000;
  private static readonly MAX_TOKENS_HARD_CAP = 1_000;
  private static readonly MIN_TEMPERATURE = 0;
  private static readonly MAX_TEMPERATURE = 1;

  private db = getDatabase();
  private cache = getCache();

  constructor() {
    const apiKey = getEnv('OPENAI_API_KEY');
    if (!apiKey) {
      // فشل مبكر آمن في بيئات الإنتاج
      const msg = 'OPENAI_API_KEY is missing';
      if (getEnv('NODE_ENV') === 'production') throw new Error(msg);
      this.logger.warn(`⚠️ ${msg} – running in degraded mode (fallbacks only).`);
    }
    this.openai = new OpenAI({
      apiKey: apiKey ?? 'DEGRADED',
      timeout: Number.isFinite(parseInt(getEnv('OPENAI_TIMEOUT') ?? '', 10))
        ? parseInt(getEnv('OPENAI_TIMEOUT')!, 10)
        : InstagramAIService.DEFAULT_TIMEOUT_MS,
    });
  }

  /**
   * Public: Generic vision analysis usable outside Instagram context
   * - Extract descriptors (labels, attributes)
   * - Build a visual query and search products in catalog
   * - Run lightweight OCR and defect analysis (best-effort)
   */
  public async analyzeImagesGeneric(
    merchantId: string,
    images: ImageData[],
    textHint?: string
  ): Promise<{
    descriptors: { labels: string[]; attributes: Record<string, string> } | null;
    ocrText?: string;
    defects?: { hasDefect: boolean; notes: string[] };
    candidates: Array<{ id: string; sku: string; name_ar: string; effective_price?: number; price_currency?: string; stock_quantity: number }>
  }> {
    let descriptors: { labels: string[]; attributes: Record<string, string> } | null = null;
    const candidates: Array<{ id: string; sku: string; name_ar: string; effective_price?: number; price_currency?: string; stock_quantity: number }>
      = [];
    let ocrText: string | undefined;
    let defects: { hasDefect: boolean; notes: string[] } | undefined;

    try {
      descriptors = await this.classifyProductFromImages(images);
    } catch (e) {
      this.logger.warn('Vision descriptors failed', { error: String(e) });
    }

    // Visual query for product lookup
    try {
      const baseQ = this.buildVisualQuery(descriptors);
      const hint = (textHint ?? '').toString().trim();
      const q = [baseQ, hint].filter(Boolean).join(' ');
      if (q) {
        const found = await this.searchProductsDynamic(merchantId, q, 6);
        candidates.push(
          ...found.map((f: { id: string; sku: string; name_ar: string; effective_price: number; price_currency: string; stock_quantity: number }) => ({
            id: f.id, sku: f.sku, name_ar: f.name_ar,
            effective_price: f.effective_price, price_currency: f.price_currency, stock_quantity: f.stock_quantity
          }))
        );
      }
    } catch (e) {
      this.logger.warn('Visual search failed', { error: String(e) });
    }

    // OCR (best-effort)
    try {
      const sys = 'Extract readable text from images. Return JSON {"text":"..."} only.';
      const user = this.buildUserContentWithImages('أقرأ أي نص واضح بالفاتورة/الملصق/الصورة وأعده بدون شرح.', images);
      const visionModel = getEnv('OPENAI_VISION_MODEL') || 'gpt-4o';
      const completion = await this.openai.chat.completions.create({
        model: visionModel,
        messages: [ { role: 'system', content: sys }, user ],
        temperature: 0,
        max_tokens: 800,
        response_format: { type: 'json_object' }
      });
      const raw = completion.choices?.[0]?.message?.content || '{}';
      const parsed = this.parseJsonSafe<{ text?: string }>(raw);
      if (parsed.ok && parsed.data.text && parsed.data.text.trim()) ocrText = parsed.data.text.trim();
    } catch (e) {
      this.logger.debug('OCR skipped', { error: String(e) });
    }

    // Defect analysis (surface-level)
    try {
      const sys = 'You are a product quality inspector. Return JSON {"hasDefect":boolean,"notes":["..."]} with concise observations (scratches, dents, stains, cracks, low quality photo?).';
      const user = this.buildUserContentWithImages('قيِّم هل بالصورة عيوب واضحة للمنتج؟ أعطني ملاحظات قصيرة.', images);
      const model = getEnv('OPENAI_VISION_MODEL') || 'gpt-4o';
      const completion = await this.openai.chat.completions.create({
        model,
        messages: [ { role: 'system', content: sys }, user ],
        temperature: 0,
        max_tokens: 300,
        response_format: { type: 'json_object' }
      });
      const raw = completion.choices?.[0]?.message?.content || '{}';
      const parsed = this.parseJsonSafe<{ hasDefect?: boolean; notes?: string[] }>(raw);
      if (parsed.ok) defects = { hasDefect: !!parsed.data.hasDefect, notes: Array.isArray(parsed.data.notes) ? parsed.data.notes : [] };
    } catch (e) {
      this.logger.debug('Defect analysis skipped', { error: String(e) });
    }

    return { descriptors, ocrText, defects, candidates };
  }
  /**
   * Get merchant-specific AI configuration
   */
  private async getConfigForMerchant(merchantId: string): Promise<MerchantAIConfig> {
    try {
      const sql = this.db.getSQL();
      const result = await sql`
        SELECT ai_config 
        FROM merchants 
        WHERE id = ${merchantId}::uuid
      `;
      
      if (result.length > 0 && result[0]?.ai_config) {
        const config = (result[0]!.ai_config) as MerchantAIConfigData;
        return {
          aiModel: config?.model || 'gpt-4o-mini',
          maxTokens: config?.maxTokens || 600,
          temperature: (config?.temperature ?? 0.8),
          language: config?.language || 'ar'
        };
      }

      // Default configuration
      const maxTokensEnv = parseInt(getEnv('OPENAI_MAX_TOKENS') || '600', 10);
      const maxTokensRaw = Number.isFinite(maxTokensEnv) ? maxTokensEnv : 600;
      const maxTokens = Math.min(maxTokensRaw, InstagramAIService.MAX_TOKENS_HARD_CAP);

      return {
        aiModel: getEnv('OPENAI_MODEL') || 'gpt-4o-mini',
        maxTokens: Math.min(maxTokens, 500),
        temperature: 0.8,
        language: 'ar'
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('❌ Failed to get merchant AI config:', { error: errorMessage });
      return {
        aiModel: 'gpt-4o-mini',
        maxTokens: 600,
        temperature: 0.8,
        language: 'ar'
      };
    }
  }

  /**
   * Merchant context with Redis caching (TTL ~ 5 minutes)
   */
  private async getMerchantContext(merchantId: string): Promise<MerchantContextCached | null> {
    const cacheKey = `merchant:ctx:${merchantId}`;
    const cached = await this.cache.get<MerchantContextCached>(cacheKey, { prefix: 'ctx' });
    if (cached) return cached;

    try {
      const sql = this.db.getSQL();
      const rows = await sql<{ id: string; business_name: string; currency: string; settings: Record<string, unknown> | null }>`
        SELECT id, business_name, COALESCE(currency, 'IQD') as currency, settings
        FROM merchants
        WHERE id = ${merchantId}::uuid
        LIMIT 1
      `;
      const ctx = rows?.[0] ?? null;
      if (ctx) {
        await this.cache.set(cacheKey, ctx, { prefix: 'ctx', ttl: 300 }); // 5m
      }
      return ctx;
    } catch (e) {
      this.logger.warn('Failed to load merchant context', { merchantId, error: String(e) });
      return null;
    }
  }

  private clampTemperature(t: number): number {
    if (Number.isFinite(t)) {
      return Math.min(InstagramAIService.MAX_TEMPERATURE, Math.max(InstagramAIService.MIN_TEMPERATURE, t));
    }
    return 0.8;
  }

  private parseJsonSafe<T>(raw?: string): { ok: true; data: T } | { ok: false } {
    try {
      if (!raw) return { ok: false };
      // Clean common wrappers like ```json ... ``` or ``` ... ```
      const cleaned = raw
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      const data = JSON.parse(cleaned) as T;
      return { ok: true, data };
    } catch {
      return { ok: false };
    }
  }

  // Coerce partial/loose JSON into a valid InstagramAIResponse with sensible defaults
  private coerceInstagramResponse(
    x: Partial<InstagramAIResponse> | Record<string, any> | null | undefined,
    context: InstagramContext
  ): InstagramAIResponse {
    const obj = (x && typeof x === 'object') ? x : {} as Record<string, unknown>;

    // Try to map common alternative keys
    const message = typeof (obj as any).message === 'string'
      ? (obj as any).message
      : typeof (obj as any).text === 'string'
        ? (obj as any).text
        : typeof (obj as any).content === 'string'
          ? (obj as any).content
          : '';

    const messageAr = typeof (obj as any).messageAr === 'string' && (obj as any).messageAr
      ? (obj as any).messageAr
      : message;

    const intent = typeof (obj as any).intent === 'string' && (obj as any).intent
      ? (obj as any).intent
      : 'GENERAL';

    const stage = typeof (obj as any).stage === 'string' && (obj as any).stage
      ? (obj as any).stage
      : (context.stage || 'initial');

    const actions = Array.isArray((obj as any).actions) ? (obj as any).actions : [];
    const products = Array.isArray((obj as any).products) ? (obj as any).products : [];

    const visualStyleRaw = (obj as any).visualStyle;
    const visualStyle: InstagramAIResponse['visualStyle'] =
      visualStyleRaw === 'story' || visualStyleRaw === 'post' || visualStyleRaw === 'reel' || visualStyleRaw === 'direct'
        ? visualStyleRaw
        : (context.interactionType === 'story_reply' || context.interactionType === 'story_mention' || context.interactionType === 'story_reaction')
          ? 'story'
          : 'direct';

    const engagement = (obj as any).engagement && typeof (obj as any).engagement === 'object'
      ? {
          likelyToShare: !!(obj as any).engagement.likelyToShare,
          viralPotential: Number((obj as any).engagement.viralPotential) || 0,
          userGeneratedContent: !!(obj as any).engagement.userGeneratedContent,
        }
      : {
          likelyToShare: visualStyle === 'story',
          viralPotential: visualStyle === 'story' ? 0.6 : 0.3,
          userGeneratedContent: visualStyle === 'story',
        };

    const hashtagSuggestions = Array.isArray((obj as any).hashtagSuggestions)
      ? (obj as any).hashtagSuggestions
      : [];

    const confidence = Number((obj as any).confidence) || 0.7;

    return {
      message,
      messageAr,
      intent,
      stage,
      actions,
      products,
      confidence,
      tokens: { prompt: 0, completion: 0, total: 0 },
      responseTime: 0,
      visualStyle,
      engagement,
      hashtagSuggestions,
    };
  }

  private validateInstagramResponse(x: Partial<InstagramAIResponse>): x is InstagramAIResponse {
    return !!x &&
      typeof x.message === 'string' &&
      typeof x.intent === 'string' &&
      typeof x.stage === 'string';
  }

  /**
   * Get contextual fallback based on interaction type and error
   */
  private getContextualFallback(context: InstagramContext, errorType: string): InstagramAIResponse {
    const fallbacks = {
      'story_reply': {
        'AI_API_ERROR': 'شكراً لتفاعلك مع ستورينا! 📱✨ راسلنا للمزيد',
        'RATE_LIMIT': 'ستورينا رائعة! 🔥 راح نرد عليك قريباً',
        'NETWORK_ERROR': 'شفت ستورينا! 💕 راسلنا خاص للمزيد'
      },
      'story_mention': {
        'AI_API_ERROR': 'شكراً لذكرك لنا في الستوري! 🌟 راسلنا للمساعدة',
        'RATE_LIMIT': 'ذكرتنا في ستورياتك! 🔔 بنرد عليك قريباً',
        'NETWORK_ERROR': 'يا سلام على الستوري! 🎉 راسلنا خاص لو محتاج شي'
      },
      'story_reaction': {
        'AI_API_ERROR': 'حبيت تفاعلك مع الستوري! 🙌 تواصل معنا لأي مساعدة',
        'RATE_LIMIT': 'ردك على الستوري أسعدنا! 😊 بنرد عليك قريباً',
        'NETWORK_ERROR': 'شكراً لتفاعلك! 💌 حاول راسلنا ثاني لو ما وصل الرد'
      },
      'comment': {
        'AI_API_ERROR': 'شكراً لتعليقك! 💙 راسلنا خاص للمزيد من التفاصيل',
        'RATE_LIMIT': 'شكراً لتفاعلك! راح نرد عليك قريباً 🌹',
        'NETWORK_ERROR': 'شكراً لتعليقك الجميل! راسلنا خاص ✨'
      },
      'dm': {
        'AI_API_ERROR': 'عذراً للانتظار! النظام مشغول حالياً. راح أرد عليك خلال دقائق ⏰',
        'RATE_LIMIT': 'شكراً لصبرك! راح أرد عليك قريباً 🙏',
        'NETWORK_ERROR': 'عذراً، حدث خطأ تقني. جاري المحاولة مرة أخرى...'
      }
    };

    const contextType = ['story_reply', 'story_mention', 'story_reaction', 'comment', 'dm']
      .includes(context.interactionType)
      ? context.interactionType
      : 'dm';

    const fb = fallbacks[contextType as keyof typeof fallbacks] as Record<ErrorCode, string>;
    const code = (errorType as ErrorCode);
    const message = fb[code] ?? fb.AI_API_ERROR;

    return {
      message: message ?? '',
      messageAr: message ?? '',
      intent: 'SUPPORT',
      stage: context.stage,
      actions: [{ type: 'ESCALATE', data: { reason: errorType }, priority: 1 }],
      products: [],
      confidence: 0.1,
      tokens: { prompt: 0, completion: 0, total: 0 },
      responseTime: 0,
      visualStyle: ['story_reply', 'story_mention', 'story_reaction'].includes(contextType) ? 'story' : 'direct',
      engagement: {
        likelyToShare: ['story_reply', 'story_mention', 'story_reaction'].includes(contextType),
        viralPotential: ['story_reply', 'story_mention', 'story_reaction'].includes(contextType) ? 0.7 : 0,
        userGeneratedContent: ['story_reply', 'story_mention', 'story_reaction'].includes(contextType)
      },
      hashtagSuggestions: ['#مساعدة']
    };
  }

  /**
   * Generate Instagram-optimized AI response
   */
  public async generateInstagramResponse(
    customerMessage: string,
    context: InstagramContext
  ): Promise<InstagramAIResponse> {
    const startTime = Date.now();

    try {
      // ✅ 1. Configuration Management: Get merchant-specific config
      const config = await this.getConfigForMerchant(context.merchantId);
      // Preload merchant context and attempt quick dynamic search (used for richer prompts elsewhere)
      try { await this.getMerchantContext(context.merchantId); } catch {}
      try { await this.searchProductsDynamic(context.merchantId, customerMessage, 1); } catch {}
      
      // Vision: if images present, pre-analyze for descriptors and candidate products
      let visionDescriptors: { labels: string[]; attributes: Record<string, string> } | null = null;
      let visionSimilar: Array<{ id: string; sku: string; name_ar: string; effective_price: number; price_currency: string; stock_quantity: number }> = [];
      const hasImages = Array.isArray(context.imageData) && context.imageData.length > 0;
      if (hasImages) {
        try {
          visionDescriptors = await this.classifyProductFromImages(context.imageData!);
          const q = this.buildVisualQuery(visionDescriptors);
          if (q) {
            const found = await this.searchProductsDynamic(context.merchantId, q, 6);
            visionSimilar = found.map(f => ({ id: f.id, sku: f.sku, name_ar: f.name_ar, effective_price: f.effective_price, price_currency: f.price_currency, stock_quantity: f.stock_quantity }));
          }
          // Auto-tag image metadata (best-effort)
          await this.autoTagImage(context, visionDescriptors);
        } catch (e) {
          this.logger.warn('Vision pre-analysis failed', { error: String(e) });
        }
      }

      // Build Instagram-specific prompt (with images if present)
      const prompt = await this.buildInstagramConversationPrompt(customerMessage, context);

      // Call OpenAI with merchant-specific settings + dynamic temperature
      const model = hasImages ? (getEnv('OPENAI_VISION_MODEL') || 'gpt-4o') : config.aiModel;
      let temperature = this.clampTemperature(config.temperature);
      try {
        // Reduce temperature for at-risk customers or low engagement to improve clarity
        const { InstagramInteractionAnalyzer } = await import('./instagram-interaction-analyzer.js');
        const analyzer = new InstagramInteractionAnalyzer();
        const engagement = await analyzer.calculateEngagementScore(context.merchantId, context.customerId);
        if (engagement < 0.2) temperature = Math.min(temperature, 0.5);
        try {
          const { PredictiveAnalyticsEngine } = await import('./predictive-analytics.js');
          const pae = new PredictiveAnalyticsEngine();
          const churn = await pae.predictCustomerChurn(context.merchantId, context.customerId);
          if (churn.riskLevel === 'HIGH') temperature = Math.min(temperature, 0.35);
        } catch {}
      } catch {}

      const completion = await this.openai.chat.completions.create({
        model,
        messages: prompt,
        temperature,
        max_tokens: Math.min(config.maxTokens, InstagramAIService.MAX_TOKENS_HARD_CAP),
        top_p: 0.95,
        frequency_penalty: 0.2,
        presence_penalty: 0.3,
        response_format: { type: 'json_object' }
      });

      const responseTime = Date.now() - startTime;
      const response = completion.choices?.[0]?.message?.content ?? '';
      if (!response) {
        throw new Error('No response from OpenAI for Instagram');
      }

      const parsed = this.parseJsonSafe<Partial<InstagramAIResponse>>(response);
      let aiResponse: InstagramAIResponse;
      if (parsed.ok) {
        aiResponse = this.coerceInstagramResponse(parsed.data, context);
        if (!aiResponse.message) {
          // As a last resort, try to extract a message field from the raw string
          const m = response.match(/"message"\s*:\s*"([\s\S]*?)"/);
          if (m && m[1]) {
            aiResponse.message = m[1];
            aiResponse.messageAr = aiResponse.messageAr || aiResponse.message;
          }
        }
      } else {
        this.logger.warn('Instagram AI returned non-JSON content, coercing', { sample: response.slice(0, 200) });
        // Try to salvage a plain-text response as message
        const text = (response || '').trim();
        if (text) {
          aiResponse = this.coerceInstagramResponse({ message: text } as any, context);
        } else {
          return this.getContextualFallback(context, 'AI_API_ERROR');
        }
      }
      
      // Attach visually similar products if we have them (best-effort)
      if (hasImages && visionSimilar.length) {
        try {
          aiResponse.products = visionSimilar.slice(0, 3).map(p => ({
            productId: p.id,
            sku: p.sku,
            name: p.name_ar,
            price: Math.round(p.effective_price),
            confidence: 0.7,
            reason: 'مشابه بصرياً للصورة'
          }));
        } catch {}
      }
      
      // Add metadata
      aiResponse.tokens = {
        prompt: completion.usage?.prompt_tokens ?? 0,
        completion: completion.usage?.completion_tokens ?? 0,
        total: completion.usage?.total_tokens ?? 0
      };
      aiResponse.responseTime = responseTime;

      // Enhance with Instagram-specific features
      aiResponse.hashtagSuggestions = await this.generateRelevantHashtags(
        context
      );

      // Log Instagram AI interaction
      await this.logInstagramAIInteraction(context, customerMessage, aiResponse);

      return aiResponse;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('❌ Instagram AI response generation failed:', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
      
      return this.getContextualFallback(context, 'AI_API_ERROR');
    }
  }

  /**
   * Generate Instagram story reply response
   */
  public async generateStoryReply(
    storyReaction: string,
    storyContext: StoryContext,
    context: InstagramContext
  ): Promise<InstagramAIResponse> {
    try {
      const prompt = this.buildStoryReplyPrompt(storyReaction, storyContext, context);

      const completion = await this.openai.chat.completions.create({
        model: getEnv('OPENAI_MODEL') || 'gpt-4o-mini',
        messages: prompt,
        temperature: 0.9, // Very creative for story interactions
        max_tokens: 200,
        response_format: { type: 'json_object' }
      });

      const response = completion.choices?.[0]?.message?.content;
      const parsed = this.parseJsonSafe<Partial<InstagramAIResponse>>(response ?? undefined);
      const aiResponse = parsed.ok
        ? this.coerceInstagramResponse(parsed.data, context)
        : this.getInstagramFallbackResponse(context);

      // Set visual style for story replies
      aiResponse.visualStyle = 'story';
      aiResponse.engagement = {
        likelyToShare: true,
        viralPotential: 0.7,
        userGeneratedContent: true
      };

      return aiResponse;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('❌ Story reply generation failed:', { error: errorMessage });
      return this.getInstagramFallbackResponse(context);
    }
  }

  /**
   * Generate comment response for Instagram posts
   */
  public async generateCommentResponse(
    commentText: string,
    postContext: PostContext,
    context: InstagramContext
  ): Promise<InstagramAIResponse> {
    try {
      const prompt = this.buildCommentReplyPrompt(commentText, postContext, context);

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: prompt,
        temperature: 0.7,
        max_tokens: 150, // Comments should be concise
        response_format: { type: 'json_object' }
      });

      const response = completion.choices?.[0]?.message?.content;
      const parsed = this.parseJsonSafe<Partial<InstagramAIResponse>>(response ?? undefined);
      const aiResponse = parsed.ok
        ? this.coerceInstagramResponse(parsed.data, context)
        : this.getInstagramFallbackResponse(context);

      // Set visual style for post comments
      aiResponse.visualStyle = 'post';
      aiResponse.engagement = {
        likelyToShare: false,
        viralPotential: 0.4,
        userGeneratedContent: false
      };

      return aiResponse;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('❌ Comment response generation failed:', { error: errorMessage });
      return this.getInstagramFallbackResponse(context);
    }
  }

  /**
   * Generate Instagram-optimized product showcase
   */
  public async generateProductShowcase(
    productIds: string[],
    context: InstagramContext
  ): Promise<{
    mediaRecommendations: MediaRecommendation[];
    caption: string;
    hashtags: string[];
    engagementBoosts: string[];
  }> {
    try {
      // Ensure price formatter is available in builds
      this.formatMoney(0, 'IQD');
      const products = await this.getProductsForShowcase(productIds, context.merchantId);
      const prompt = this.buildProductShowcasePrompt(products, context);
      
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: prompt,
        temperature: 0.8,
        max_tokens: 800,
        response_format: { type: 'json_object' }
      });

      const response = completion.choices[0]?.message?.content;
      let showcase: {
        mediaRecommendations: MediaRecommendation[];
        caption: string;
        hashtags: string[];
        engagementBoosts: string[];
      };
      try {
        showcase = JSON.parse(response || '{}');
      } catch {
        showcase = {
          mediaRecommendations: [],
          caption: '',
          hashtags: [],
          engagementBoosts: []
        };
      }
      return showcase;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('❌ Product showcase generation failed:', { error: errorMessage });
      return {
        mediaRecommendations: [],
        caption: '',
        hashtags: [],
        engagementBoosts: []
      };
    }
  }

  /**
   * Analyze Instagram content performance potential
   */
  public async analyzeContentPerformance(
    content: string,
    contentType: 'story' | 'post' | 'reel'
  ): Promise<{
    viralScore: number;
    engagementPrediction: number;
    audienceMatch: number;
    optimizationSuggestions: string[];
  }> {
    try {
      const prompt = this.buildContentAnalysisPrompt(content, contentType);

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: prompt,
        temperature: 0.4,
        max_tokens: 400,
        response_format: { type: 'json_object' }
      });

      const response = completion.choices[0]?.message?.content;
      let analysis: {
        viralScore: number;
        engagementPrediction: number;
        audienceMatch: number;
        optimizationSuggestions: string[];
      };
      try {
        analysis = JSON.parse(response || '{}');
      } catch {
        analysis = {
          viralScore: 0,
          engagementPrediction: 0,
          audienceMatch: 0,
          optimizationSuggestions: []
        };
      }
      return analysis;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('❌ Content performance analysis failed:', { error: errorMessage });
      return {
        viralScore: 0,
        engagementPrediction: 0,
        audienceMatch: 0,
        optimizationSuggestions: []
      };
    }
  }

  /**
   * Private: Build Instagram-specific conversation prompt
   */
  private async buildInstagramConversationPrompt(
    customerMessage: string,
    context: InstagramContext
  ): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
    const systemPrompt = `أنت مساعد مبيعات ذكي متخصص في Instagram للتجار العراقيين. 

🎯 خصائص أسلوب Instagram:
- أسلوب بصري وجذاب
- استخدام كثيف للرموز التعبيرية 😍🔥✨
- محتوى قصير ومؤثر
- لغة عامية عراقية شبابية
- تركيز على الترندات والموضة
- تفاعل عاطفي قوي

📱 نوع التفاعل: ${context.interactionType}
🏪 اسم المحل: ${context.merchantSettings?.businessName || 'غير محدد'}
🛍️ فئة المنتجات: ${context.merchantSettings?.businessCategory || 'عام'}
📊 عدد الطلبات السابقة: ${context.customerProfile?.previousOrders ?? 0}

🎨 إرشادات المحتوى:
1. استخدم 3-5 رموز تعبيرية في كل رد
2. اكتب بأسلوب شبابي عراقي مودرن
3. اقترح محتوى بصري مناسب
4. اربط المنتجات بالترندات الحالية
5. شجع على المشاركة والتفاعل
6. اجعل الرد قابل للنشر كستوري
7. استخدم كلمات تجذب الانتباه مثل "حصري"، "ترند"، "جديد"

💫 سياق بصري: ${context.mediaContext ? 
  `يتفاعل مع ${context.mediaContext.mediaType} - ${context.mediaContext.caption}` : 
  'لا يوجد محتوى بصري'
}

🎯 يجب أن تكون إجابتك بصيغة JSON:
{
  "message": "الرد بأسلوب Instagram شبابي مع رموز تعبيرية",
  "messageAr": "نفس الرد", 
  "intent": "نية العميل",
  "stage": "المرحلة التالية",
  "actions": [{"type": "نوع العمل", "data": {}, "priority": 1}],
  "products": [{"productId": "", "sku": "", "name": "", "price": 0, "confidence": 0.8, "reason": ""}],
  "confidence": 0.9,
  "visualStyle": "story|post|reel|direct",
  "engagement": {
    "likelyToShare": true,
    "viralPotential": 0.8,
    "userGeneratedContent": true
  },
  "mediaRecommendations": [
    {
      "type": "image|video|carousel|story",
      "content": "وصف المحتوى البصري المقترح",
      "caption": "النص المرافق للمحتوى",
      "hashtags": ["#ترند", "#عراق"],
      "callToAction": "ادعوة للتفاعل"
    }
  ]
}`;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt }
    ];

    // Enrich prompt with merchant data (name, currency, top products, message window)
    try {
      const sql = this.db.getSQL();
      const merchantRows = await sql<{ business_name: string; currency?: string }>`
        SELECT business_name, COALESCE(currency, 'IQD') as currency
        FROM merchants
        WHERE id = ${context.merchantId}::uuid
        LIMIT 1
      `;
      const merchantName = merchantRows[0]?.business_name || 'المتجر';
      const currency = (merchantRows[0]?.currency || 'IQD').toUpperCase();

      const productRows = await sql<{
        id: string;
        sku: string;
        name_ar: string;
        effective_price: number;
        price_currency: string;
        stock_quantity: number;
      }>`
        SELECT id, sku, name_ar,
               effective_price::float as effective_price,
               price_currency,
               stock_quantity
        FROM products_priced
        WHERE merchant_id = ${context.merchantId}::uuid
        ORDER BY updated_at DESC
        LIMIT 8
      `;

      const productsList = productRows.map(p =>
        `• ${p.name_ar} (SKU ${p.sku}) — ${Math.round(p.effective_price)} ${p.price_currency}${p.stock_quantity <= 0 ? ' [غير متوفر]' : ''}`
      ).join('\n');

      // 24h messaging window (optional, best-effort)
      let windowLine = '';
      try {
        const w = await sql<{ can_send_message: boolean; window_expires_at: Date | null; time_remaining_minutes: number | null; message_count_in_window: number | null }>`
          SELECT * FROM check_message_window(${context.merchantId}::uuid, NULL, ${context.customerId}, 'instagram')
        `;
        if (Array.isArray(w) && w.length > 0) {
          const row = w[0]!;
          const can = !!row.can_send_message;
          const mins = row.time_remaining_minutes ?? 0;
          windowLine = can ? `نافذة الرسائل: صالحة (تبقى ${mins} دقيقة)` : 'نافذة الرسائل: منتهية';
        }
      } catch {}

      const merchantContextBlock = [
        `سياق التاجر:`,
        `- الاسم: ${merchantName}`,
        `- العملة: ${currency}`,
        windowLine ? `- ${windowLine}` : null,
        `- منتجات بارزة:`,
        productsList || 'لا توجد منتجات متاحة حالياً'
      ].filter(Boolean).join('\n');

      messages.push({ role: 'system', content: merchantContextBlock });

      // Add interaction analysis + risk/engagement context (best-effort)
      try {
        const { InstagramInteractionAnalyzer } = await import('./instagram-interaction-analyzer.js');
        const { PredictiveAnalyticsEngine } = await import('./predictive-analytics.js');
        const analyzer = new InstagramInteractionAnalyzer();
        const dm = await analyzer.categorizeDMIntent(customerMessage);
        const engagement = await analyzer.calculateEngagementScore(context.merchantId, context.customerId);
        const pae = new PredictiveAnalyticsEngine();
        const churn = await pae.predictCustomerChurn(context.merchantId, context.customerId);
        const analysisBlock = [
          'تحليل تفاعل العميل:',
          `- نية مبدئية: ${dm.intent} (ثقة ${Math.round(dm.confidence * 100)}%)`,
          `- درجة التفاعل: ${Math.round(engagement * 100)}/100`,
          `- خطر مغادرة: ${churn.riskLevel}`
        ].join('\n');
        messages.unshift({ role: 'system', content: analysisBlock });
      } catch (e) {
        this.logger.debug('Interaction analysis injection skipped', { error: String(e) });
      }
    } catch (e) {
      this.logger.warn('Failed to enrich Instagram prompt with merchant data', { error: String(e), merchantId: context.merchantId });
    }

    // Add conversation history with Instagram context
    context.conversationHistory.slice(-8).forEach(msg => {
      messages.push({
        role: msg.role,
        content: msg.content
      });
    });

    // Add current customer message with context (+ vision parts)
    let messageWithContext = customerMessage;
    if (context.interactionType === 'story_reply') {
      messageWithContext = `[ردّ على ستوري] ${customerMessage}`;
    } else if (context.interactionType === 'comment') {
      messageWithContext = `[تعليق على منشور] ${customerMessage}`;
    } else if (context.interactionType === 'story_mention') {
      messageWithContext = `[منشن في ستوري] ${customerMessage}`;
    }

    const hasImages = Array.isArray(context.imageData) && context.imageData.length > 0;
    if (hasImages) {
      messages.push(this.buildUserContentWithImages(messageWithContext, context.imageData!));
    } else {
      messages.push({ role: 'user', content: messageWithContext });
    }

    // Inject lightweight personalization profile into system context (best-effort)
    try {
      const { CustomerProfiler } = await import('./customer-profiler.js');
      const profiler = new CustomerProfiler();
      const profile = await profiler.personalizeResponses(context.merchantId, context.customerId);
      const personalBlock = [
        'سياق العميل:',
        `- التصنيف: ${profile.tier}`,
        profile.preferences.categories.length ? `- فئات مفضلة: ${profile.preferences.categories.slice(0,3).join(', ')}` : null,
        profile.preferences.colors.length ? `- ألوان مفضلة: ${profile.preferences.colors.slice(0,3).join(', ')}` : null,
        profile.preferences.brands.length ? `- علامات مفضلة: ${profile.preferences.brands.slice(0,3).join(', ')}` : null,
        `- حساسية السعر: ${profile.preferences.priceSensitivity}`
      ].filter(Boolean).join('\n');
      messages.unshift({ role: 'system', content: personalBlock });
    } catch (e) {
      this.logger.debug('Personalization injection skipped', { error: String(e) });
    }

    return messages;
  }

  // ===== Vision helpers =====
  private buildUserContentWithImages(text: string, images: ImageData[]): OpenAI.Chat.Completions.ChatCompletionMessageParam {
    type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
    const parts: ContentPart[] = [];
    const safeText = (text ?? '').trim();
    if (safeText) parts.push({ type: 'text', text: safeText });
    for (const img of (images || []).slice(0, 3)) {
      const url = this.toDataUrlOrPass(img);
      if (url) parts.push({ type: 'image_url', image_url: { url } });
      if (img.caption) parts.push({ type: 'text', text: `تفاصيل الصورة: ${img.caption}` });
    }
    // OpenAI Chat Completions supports multimodal content via array parts on supported models
    return { role: 'user', content: parts as any } as any;
  }

  private toDataUrlOrPass(img: ImageData): string | null {
    if (img.base64 && img.mimeType) return `data:${img.mimeType};base64,${img.base64}`;
    if (img.url && /^https?:\/\//i.test(img.url)) return img.url;
    return null;
  }

  private async classifyProductFromImages(images: ImageData[]): Promise<{ labels: string[]; attributes: Record<string, string> }> {
    const sys = 'أنت محلل بصري للمنتجات. أعد فقط JSON: {"labels": [..], "attributes": {"color?":"","category?":"","brand?":""}} دون شرح.';
    const user = this.buildUserContentWithImages('حلّل الصورة وحدد اللون/الفئة/العلامة ووسوم مختصرة.', images);
    const visionModel = getEnv('OPENAI_VISION_MODEL') || 'gpt-4o';
    const completion = await this.openai.chat.completions.create({
      model: visionModel,
      messages: [ { role: 'system', content: sys }, user ],
      temperature: 0.1,
      max_tokens: 600,
      response_format: { type: 'json_object' }
    });
    const raw = completion.choices?.[0]?.message?.content || '{}';
    const parsed = this.parseJsonSafe<{ labels?: string[]; attributes?: Record<string, string> }>(raw);
    if (!parsed.ok) return { labels: [], attributes: {} };
    return { labels: parsed.data.labels || [], attributes: parsed.data.attributes || {} };
  }

  private buildVisualQuery(desc: { labels: string[]; attributes: Record<string, string> } | null): string {
    if (!desc) return '';
    const parts: string[] = [];
    if (Array.isArray(desc.labels)) parts.push(...desc.labels.slice(0, 3));
    for (const k of ['category','color','brand']) {
      const v = desc.attributes?.[k];
      if (typeof v === 'string' && v) parts.push(v);
    }
    return parts.filter(Boolean).join(' ');
  }

  private async autoTagImage(context: InstagramContext, desc: { labels: string[]; attributes: Record<string, string> } | null): Promise<void> {
    if (!desc) return;
    try {
      const sql = this.db.getSQL();
      await sql`
        INSERT INTO message_image_metadata (merchant_id, customer_id, labels)
        VALUES (${context.merchantId}::uuid, ${context.customerId}, ${JSON.stringify(desc)}::jsonb)
      `;
    } catch (e) {
      this.logger.warn('autoTagImage failed', { error: String(e) });
    }
  }

  // Price formatter with Arabic locale fallback
  private formatMoney(amount: number, currency: string): string {
    try {
      // Normalize currency code
      const curr = String(currency || 'IQD').toUpperCase();
      return new Intl.NumberFormat('ar-IQ', { style: 'currency', currency: curr, maximumFractionDigits: 0 }).format(amount);
    } catch {
      return `${Math.round(amount).toLocaleString('ar')} ${currency}`;
    }
  }

  // Extract simple search terms from a message (Arabic/English tokens >= 2 chars)
  private extractSearchTerms(text: string): string[] {
    try {
      const t = (text ?? '').toString().toLowerCase();
      const words = t.split(/[^\p{L}\p{N}\._-]+/u).filter(w => w && w.length >= 2);
      // Prefer last 2 tokens (often most specific)
      return words.slice(-2);
    } catch {
      return [];
    }
  }

  // Parse attribute filters (size/color/category hints) from free text (AR/EN)
  private parseAttributeFilters(text: string): { sizes: string[]; colors: string[]; categories: string[] } {
    const t = (text ?? '').toLowerCase();
    const sizes: string[] = [];
    const colors: string[] = [];
    const categories: string[] = [];

    // Sizes (EN)
    const sizeMatch = t.match(/\b(xx?l|xs|s|m|l|xl|xxl)\b/g);
    if (sizeMatch) sizes.push(...Array.from(new Set(sizeMatch.map(s => s.toUpperCase()))));
    // Sizes (AR)
    if (/\b(صغير|سمول)\b/.test(t)) sizes.push('S');
    if (/\b(متوسط|وسط|ميديم)\b/.test(t)) sizes.push('M');
    if (/\b(كبير|لارج)\b/.test(t)) sizes.push('L');
    if (/\b(اكبر|إكس لارج|اكس لارج|xl)\b/.test(t)) sizes.push('XL');

    // Colors map
    const colorMap: Record<string, string> = {
      'red': 'red', 'أحمر': 'red', 'احمر': 'red', 'حمرا': 'red',
      'blue': 'blue', 'أزرق': 'blue', 'ازرق': 'blue',
      'black': 'black', 'أسود': 'black', 'اسود': 'black',
      'white': 'white', 'أبيض': 'white', 'ابيض': 'white',
      'green': 'green', 'أخضر': 'green', 'اخضر': 'green',
      'pink': 'pink', 'وردي': 'pink',
      'yellow': 'yellow', 'أصفر': 'yellow', 'اصفر': 'yellow',
      'purple': 'purple', 'بنفسجي': 'purple',
      'brown': 'brown', 'بني': 'brown',
      'gray': 'gray', 'رمادي': 'gray'
    };
    for (const k of Object.keys(colorMap)) {
      if (t.includes(k)) {
        const v = (colorMap as Record<string, string>)[k];
        if (v) colors.push(v);
      }
    }

    // Do NOT assume merchant vertical. Categories will be
    // inferred dynamically from merchant catalog where possible.

    return {
      sizes: Array.from(new Set(sizes)),
      colors: Array.from(new Set(colors)),
      categories: Array.from(new Set(categories))
    };
  }

  // Load merchant categories from catalog (cached 5m) without assuming a vertical
  private async getMerchantCategories(merchantId: string): Promise<string[]> {
    const key = `merchant:cats:${merchantId}`;
    const cached = await this.cache.get<string[]>(key, { prefix: 'ctx' });
    if (cached) return cached;
    try {
      const sql = this.db.getSQL();
      const rows = await sql<{ category: string }>`
        SELECT DISTINCT category FROM products
        WHERE merchant_id = ${merchantId}::uuid AND category IS NOT NULL AND category <> ''
        LIMIT 500
      `;
      const cats = rows.map(r => (r.category ?? '').toString()).filter(Boolean);
      await this.cache.set(key, cats, { prefix: 'ctx', ttl: 300 });
      return cats;
    } catch (e) {
      this.logger.warn('Failed to load merchant categories', { merchantId, error: String(e) });
      return [];
    }
  }

  /**
   * Dynamic product search by name/SKU/category/attributes/variants
   */
  private async searchProductsDynamic(
    merchantId: string,
    queryText: string,
    limit: number = 8
  ): Promise<Array<{
    id: string;
    sku: string;
    name_ar: string;
    effective_price: number;
    price_currency: string;
    stock_quantity: number;
    attributes: Record<string, unknown>;
    variants: Array<Record<string, unknown>>;
    category: string;
  }>> {
    const sql = this.db.getSQL();

    // Normalize tokens and filters
    const tokens = this.extractSearchTerms(queryText);
    const filters = this.parseAttributeFilters(queryText);

    // Cache key for identical searches for 2 minutes
    const ck = `psearch:${merchantId}:${tokens.join('-')}:${filters.sizes.join(',')}:${filters.colors.join(',')}`;
    const cached = await this.cache.get<Array<Record<string, unknown>>>(ck, { prefix: 'ctx' });
    if (cached) return cached as unknown as Array<{
      id: string;
      sku: string;
      name_ar: string;
      effective_price: number;
      price_currency: string;
      stock_quantity: number;
      attributes: Record<string, unknown>;
      variants: Array<Record<string, unknown>>;
      category: string;
    }>;

    // Build dynamic WHERE parts (safe fragments, seeded reducers)
    const sizeFilter = filters.sizes[0];
    const colorFilter = filters.colors[0];

    // Optionally narrow by matching merchant categories if text hints match
    const merchantCats = await this.getMerchantCategories(merchantId);
    const matchedCats = merchantCats.filter(cat => {
      const c = cat.toLowerCase();
      return tokens.some(t => c.includes(t));
    });

    // Early input guard: return top products if no search tokens/filters/categories
    if (tokens.length === 0 && !sizeFilter && !colorFilter && matchedCats.length === 0) {
      return await this.topProductsFallback(merchantId, limit);
    }

    try {
      // Consolidated, safe fragments: build once and embed into main WHERE
      const text = (queryText ?? '').toString().trim();
      const textSearchClause = text
        ? sql.or(
            sql.like('p.name_ar', text),
            sql.like('p.sku', text),
            sql.like('p.category', text)
          )
        : sql.empty;

      const sizes = (filters.sizes || []).map(s => s.toLowerCase());
      const colors = (filters.colors || []).map(c => c.toLowerCase());

      const sizeClause = sizes.length
        ? sql.fragment`( (p.attributes->>'size') = ANY(${sizes}) )`
        : sql.empty;

      const colorClause = colors.length
        ? sql.fragment`( (p.attributes->>'color') = ANY(${colors}) )`
        : sql.empty;

      const categoryClause = matchedCats.length > 0
        ? sql.fragment`p.category = ANY(${matchedCats})`
        : sql.empty;

      const minPrice = (filters as any)?.minPrice ?? null;
      const maxPrice = (filters as any)?.maxPrice ?? null;
      const priceClause = (minPrice != null || maxPrice != null)
        ? sql.fragment`pp.effective_price BETWEEN ${minPrice ?? 0} AND ${maxPrice ?? 9_999_999}`
        : sql.empty;

      const rows = await sql<{
        id: string;
        sku: string;
        name_ar: string;
        effective_price: number;
        price_currency: string;
        stock_quantity: number;
        attributes: Record<string, unknown>;
        variants: Array<Record<string, unknown>>;
        category: string;
      }>`
        SELECT p.id, p.sku, p.name_ar, p.attributes, p.variants, p.category,
               pp.effective_price::float as effective_price, pp.price_currency,
               p.stock_quantity
        FROM products p
        JOIN products_priced pp ON pp.id = p.id
        ${sql.where(
          sql.fragment`p.merchant_id = ${merchantId}::uuid`,
          sql.fragment`p.status = 'ACTIVE'`,
          textSearchClause,
          categoryClause,
          sizeClause,
          colorClause,
          priceClause
        )}
        ORDER BY pp.effective_price ASC
        LIMIT ${limit}
      `;
      const result = rows || [];
      // Cache for 2 minutes for identical queries
      await this.cache.set(ck, result, { prefix: 'ctx', ttl: 120 });
      return result;
    } catch (e) {
      this.logger.warn('Dynamic product search failed', { merchantId, error: String(e) });
      return [];
    }
  }

  /**
   * Fallback when no tokens/filters present: return top products for merchant
   */
  private async topProductsFallback(
    merchantId: string,
    limit: number
  ): Promise<Array<{
    id: string;
    sku: string;
    name_ar: string;
    effective_price: number;
    price_currency: string;
    stock_quantity: number;
    attributes: Record<string, unknown>;
    variants: Array<Record<string, unknown>>;
    category: string;
  }>> {
    try {
      const sql = this.db.getSQL();
      const rows = await sql<{
        id: string;
        sku: string;
        name_ar: string;
        effective_price: number;
        price_currency: string;
        stock_quantity: number;
        attributes: Record<string, unknown>;
        variants: Array<Record<string, unknown>>;
        category: string;
      }>`
        SELECT p.id, p.sku, p.name_ar, p.attributes, p.variants, p.category,
               pp.effective_price::float AS effective_price, pp.price_currency,
               p.stock_quantity
        FROM products p
        JOIN products_priced pp ON pp.id = p.id
        WHERE p.merchant_id = ${merchantId}::uuid
          AND p.status = 'ACTIVE'
        ORDER BY p.is_featured DESC, p.updated_at DESC, p.stock_quantity DESC
        LIMIT ${limit}
      `;
      return rows || [];
    } catch (e) {
      this.logger.warn('topProductsFallback failed', { merchantId, error: String(e) });
      return [];
    }
  }

  /**
   * Private: Build story reply prompt
   */
  private buildStoryReplyPrompt(
    storyReaction: string,
    storyContext: StoryContext,
    _context: InstagramContext
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    return [
      {
        role: 'system',
        content: `أنت تتعامل مع ردّ على ستوري Instagram. 

🎬 محتوى الستوري: ${storyContext.mediaType} ${storyContext.caption ? `- "${storyContext.caption}"` : ''}
💬 ردّ العميل: "${storyReaction}"

يجب أن يكون ردك:
- قصير جداً (1-2 جملة)
- مليء بالطاقة والحماس 🔥
- يشجع على المتابعة والتفاعل
- يربط ردّهم بمنتجاتك

أجب بصيغة JSON مع message مختصر وحماسي.`
      },
      {
        role: 'user',
        content: `الردّ: "${storyReaction}"`
      }
    ];
  }

  /**
   * Private: Build comment reply prompt
   */
  private buildCommentReplyPrompt(
    commentText: string,
    postContext: PostContext,
    _context: InstagramContext
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    return [
      {
        role: 'system',
        content: `أنت تردّ على تعليق في منشور Instagram.

📸 المنشور: ${postContext.caption ? `"${postContext.caption}"` : 'منشور بدون نص'}
💬 التعليق: "${commentText}"

يجب أن يكون ردك:
- مهذب ومهني
- قصير ومباشر
- يدعو للتواصل الخاص إذا كان استفسار جدي
- يحافظ على صورة العلامة التجارية

أجب بصيغة JSON مع message مناسب للتعليقات العامة.`
      },
      {
        role: 'user',
        content: `التعليق: "${commentText}"`
      }
    ];
  }

  /**
   * Private: Build product showcase prompt
   */
  private buildProductShowcasePrompt(
    products: Product[],
    _context: InstagramContext
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const productsText = products.map(p => 
      `${p.name_ar} - ${p.price_usd} - ${p.category}`
    ).join('\n');

    return [
      {
        role: 'system',
        content: `صمم محتوى Instagram مبدع لعرض هذه المنتجات:

${productsText}

أنشئ:
1. اقتراحات محتوى بصري (صور/فيديو)
2. نصوص جذابة للمنشورات
3. هاشتاجات ترندينج عراقية
4. طرق لزيادة التفاعل

يجب أن يكون المحتوى:
- جذاب بصرياً
- يستهدف الجمهور العراقي الشاب
- يشجع على الشراء دون أن يبدو إعلاناً
- يستخدم الترندات الحالية

أجب بصيغة JSON كاملة.`
      },
      {
        role: 'user',
        content: 'اعرض هذه المنتجات بطريقة إبداعية على Instagram'
      }
    ];
  }

  /**
   * Private: Build content analysis prompt
   */
  private buildContentAnalysisPrompt(
    content: string,
    contentType: string
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    return [
      {
        role: 'system',
        content: `حلل هذا المحتوى لـ Instagram من ناحية:

1. النتيجة المتوقعة (Viral Score 0-10)
2. معدل التفاعل المتوقع (0-10) 
3. مناسبة للجمهور العراقي (0-10)
4. اقتراحات للتحسين

المحتوى: "${content}"
النوع: ${contentType}

أجب بصيغة JSON:
{
  "viralScore": 0-10,
  "engagementPrediction": 0-10, 
  "audienceMatch": 0-10,
  "optimizationSuggestions": ["اقتراح 1", "اقتراح 2"]
}`
      },
      {
        role: 'user',
        content: `حلل هذا المحتوى: "${content}"`
      }
    ];
  }

  /**
   * Private: Generate relevant hashtags
   */
  private async generateRelevantHashtags(
    _context: InstagramContext
  ): Promise<string[]> {
    try {
      // Base hashtags for Iraqi market
      const baseHashtags = ['#عراق', '#بغداد', '#العراق', '#تسوق'];
      
      // Category-specific hashtags
      const categoryHashtags: Record<string, string[]> = {
        fashion: ['#موضة', '#أزياء', '#ستايل', '#موضة_عراقية'],
        electronics: ['#جوالات', '#تكنولوجيا', '#الكترونيات'],
        beauty: ['#جمال', '#مكياج', '#عناية', '#تجميل'],
        food: ['#طعام', '#حلويات', '#اكل_عراقي'],
        home: ['#منزل', '#ديكور', '#تأثيث']
      };

      const category = _context.merchantSettings?.businessCategory || 'general';
      const relevantHashtags = categoryHashtags[category] || [];

      // Trending hashtags (this could be enhanced with real-time trend data)
      const trendingHashtags = ['#ترند', '#جديد', '#حصري', '#عرض_خاص'];

      // إزالة التكرارات + قص للطول
      const uniq = Array.from(new Set([...baseHashtags, ...relevantHashtags, ...trendingHashtags]));
      return uniq.slice(0, 8);
    } catch (error) {
      this.logger.error('❌ Hashtag generation failed:', error);
      return ['#عراق', '#تسوق', '#جديد'];
    }
  }

  /**
   * Private: Get products for showcase - optimized with batching
   */
  private async getProductsForShowcase(productIds: string[], merchantId: string): Promise<Product[]> {
    try {
      const sql = this.db.getSQL();
      
      // Batch multiple queries if needed
      const batchSize = 50; // Limit batch size for performance
      const productBatches = [];
      
      for (let i = 0; i < productIds.length; i += batchSize) {
        const batch = productIds.slice(i, i + batchSize);
        productBatches.push(batch);
      }
      
      const allProducts: Product[] = [];
      
      // Process batches concurrently for better performance
      const batchPromises = productBatches.map(batch => 
        sql`
          SELECT id, sku, name_ar,
                 COALESCE(price_amount, price_usd) as price_usd, -- temporary alias for generic pricing
                 category, description_ar, image_urls
          FROM products_priced
          WHERE id = ANY(${batch}) 
          AND merchant_id = ${merchantId}::uuid 
          AND status = 'ACTIVE'
          ORDER BY is_featured DESC
        `
      );
      
      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(batch => allProducts.push(...(batch as unknown as Product[])));
      
      return allProducts;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('❌ Error fetching showcase products:', { error: errorMessage });
      return [];
    }
  }

  /**
   * ✅ 3. Performance Optimization: Batch process multiple operations
   */
  private async processCommentBatch(operations: Array<() => Promise<unknown>>): Promise<unknown[]> {
    try {
      // Execute operations in parallel for better performance
      return await Promise.all(operations);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('❌ Batch processing failed:', { error: errorMessage });
      return [];
    }
  }

  /**
   * Private: Log Instagram AI interaction - optimized for batching
   */
  private async logInstagramAIInteraction(
    context: InstagramContext,
    input: string,
    response: InstagramAIResponse
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();
      
      // ✅ 3. Performance: Batch multiple logging operations
      const operations = [
        // Store the main interaction log
        () => sql`
          INSERT INTO audit_logs (
            merchant_id,
            action,
            resource_type,
            entity_type,
            details,
            execution_time_ms,
            success
          ) VALUES (
            ${context.merchantId}::uuid,
            'SYSTEM_EVENT',
            'SYSTEM',
            'AI_INTERACTION',
            ${JSON.stringify({
              input: input.substring(0, 200),
              intent: response.intent,
              stage: response.stage,
              tokens: response.tokens,
              confidence: response.confidence,
              platform: 'instagram',
              interactionType: context.interactionType,
              visualStyle: response.visualStyle,
              engagement: response.engagement,
              mediaRecommendations: response.mediaRecommendations?.length ?? 0,
              hashtagsGenerated: response.hashtagSuggestions?.length ?? 0
            })},
            ${response.responseTime},
            true
          )
        `,
        
        // NOTE: use a daily rollup table with a real unique key (merchant_id, day)
        () => sql`
          INSERT INTO instagram_analytics_daily (
            merchant_id, day, interaction_type, tokens_used, response_time_ms, total_interactions, total_tokens, avg_response_time
          ) VALUES (
            ${context.merchantId}::uuid, CURRENT_DATE, ${context.interactionType},
            ${response.tokens?.total ?? 0}, ${response.responseTime}, 1, ${response.tokens?.total ?? 0}, ${response.responseTime}
          )
          ON CONFLICT (merchant_id, day)
          DO UPDATE SET
            total_interactions = instagram_analytics_daily.total_interactions + 1,
            total_tokens = instagram_analytics_daily.total_tokens + EXCLUDED.tokens_used,
            avg_response_time = (instagram_analytics_daily.avg_response_time + EXCLUDED.response_time_ms) / 2
        `
      ];

      // Execute all operations in batch
      await this.processCommentBatch(operations);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('❌ Instagram AI interaction logging failed:', { error: errorMessage });
    }
  }

  /**
   * Private: Get Instagram-specific fallback response
   */
  private getInstagramFallbackResponse(context: InstagramContext): InstagramAIResponse {
    const fallbackMessages = [
      'عذراً حبيبي 🙏 صار خطأ تقني بسيط، ارسل رسالتك مرة ثانية 💕',
      'آسف عزيزي 😅 ما فهمت طلبك بوضوح، ممكن تعيدلي إياه؟ 🤔',
      'في مشكلة تقنية صغيرة عندنا 🔧 بس راح نحلها بسرعة، انتظرنا شوية 😊'
    ];

    const message = fallbackMessages[Math.floor(Math.random() * fallbackMessages.length)];

    return {
      message: message ?? '',
      messageAr: message ?? '',
      intent: 'SUPPORT',
      stage: context.stage,
      actions: [{ type: 'ESCALATE', data: { reason: 'AI_ERROR' }, priority: 1 }],
      products: [],
      confidence: 0.1,
      tokens: { prompt: 0, completion: 0, total: 0 },
      responseTime: 0,
      visualStyle: 'direct',
      engagement: {
        likelyToShare: false,
        viralPotential: 0,
        userGeneratedContent: false
      },
      hashtagSuggestions: ['#مساعدة']
    };
  }
}

// Singleton instance
let instagramAIServiceInstance: InstagramAIService | null = null;

/**
 * Get Instagram AI service instance
 */
export function getInstagramAIService(): InstagramAIService {
  if (!instagramAIServiceInstance) {
    instagramAIServiceInstance = new InstagramAIService();
  }
  return instagramAIServiceInstance;
}

export default InstagramAIService;
