/**
 * ===============================================
 * Instagram AI Service - STEP 3 Implementation
 * AI conversation adaptation for Instagram's visual, casual, emoji-rich style
 * ===============================================
 */

import { type ConversationContext, type AIResponse } from './ai.js';
import { getDatabase } from '../db/adapter.js';
import { createLogger } from './logger.js';
import OpenAI from 'openai';
import { getEnv } from '../config/env.js';

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
  price_usd: number;
  category: string;
  description_ar?: string;
  image_urls?: string[];
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
}

export class InstagramAIService {
  private logger = createLogger({ component: 'InstagramAI' });
  private openai: OpenAI;
  private static readonly DEFAULT_TIMEOUT_MS = 30_000;
  private static readonly MAX_TOKENS_HARD_CAP = 1_000;
  private static readonly MIN_TEMPERATURE = 0;
  private static readonly MAX_TEMPERATURE = 1;

  private db = getDatabase();

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
      timeout: Number.isFinite(parseInt(getEnv('OPENAI_TIMEOUT') || '', 10))
        ? parseInt(getEnv('OPENAI_TIMEOUT')!, 10)
        : InstagramAIService.DEFAULT_TIMEOUT_MS,
    });
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
          temperature: config?.temperature || 0.8,
          language: config?.language || 'ar'
        };
      }

      // Default configuration
      const maxTokensEnv = parseInt(getEnv('OPENAI_MAX_TOKENS') || '600', 10);
      const maxTokensRaw = Number.isFinite(maxTokensEnv) ? maxTokensEnv : 600;
      const maxTokens = Math.min(maxTokensRaw, InstagramAIService.MAX_TOKENS_HARD_CAP);

      return {
        aiModel: getEnv('OPENAI_MODEL') || 'gpt-4o-mini',
        maxTokens,
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

  private clampTemperature(t: number): number {
    if (Number.isFinite(t)) {
      return Math.min(InstagramAIService.MAX_TEMPERATURE, Math.max(InstagramAIService.MIN_TEMPERATURE, t));
    }
    return 0.8;
  }

  private parseJsonSafe<T>(raw?: string): { ok: true; data: T } | { ok: false } {
    try {
      if (!raw) return { ok: false };
      const data = JSON.parse(raw) as T;
      return { ok: true, data };
    } catch {
      return { ok: false };
    }
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
      
      // Build Instagram-specific prompt
      const prompt = await this.buildInstagramConversationPrompt(customerMessage, context);

      // Call OpenAI with merchant-specific settings and rate limit protection
      let completion;
      try {
        completion = await this.openai.chat.completions.create({
          model: config.aiModel,
          messages: prompt,
          temperature: this.clampTemperature(config.temperature),
          max_tokens: Math.min(config.maxTokens, InstagramAIService.MAX_TOKENS_HARD_CAP),
          top_p: 0.95,
          frequency_penalty: 0.2,
          presence_penalty: 0.3,
          response_format: { type: 'json_object' }
        });
      } catch (error: any) {
        const msg = String(error?.message || error);
        
        // 🛡️ ARCHITECTURE ENFORCEMENT: Rate limit guard with static response
        if (msg.includes('429') || /rate limit/i.test(msg) || msg.includes('quota')) {
          this.logger.warn('🛑 OpenAI rate limit - sending static response via ManyChat', {
            merchantId: context.merchantId,
            error: msg,
            context: 'rate_limit_guard'
          });
          
          // Return static Arabic response - ManyChat will send it
          const rateLimitMessage = '😊 عذراً للانتظار! النظام مشغول حالياً. سأرد عليك خلال دقائق ✨';
          return {
            message: rateLimitMessage,
            messageAr: rateLimitMessage,
            intent: 'rate_limit_error',
            stage: 'SUPPORT' as const,
            actions: [],
            products: [],
            confidence: 0.5,
            tokens: { prompt: 0, completion: 0, total: 0 },
            responseTime: Date.now() - startTime,
            mediaRecommendations: [],
            hashtagSuggestions: [],
            visualStyle: 'direct' as const,
            engagement: {
              likelyToShare: false,
              viralPotential: 0.1,
              userGeneratedContent: false
            }
          };
        }
        
        throw error;
      }

      const responseTime = Date.now() - startTime;
      const response = completion.choices?.[0]?.message?.content || '';
      if (!response) {
        throw new Error('No response from OpenAI for Instagram');
      }

      const parsed = this.parseJsonSafe<Partial<InstagramAIResponse>>(response);
      if (!parsed.ok || !this.validateInstagramResponse(parsed.data)) {
        this.logger.error('Invalid Instagram AI JSON response', { sample: response.slice(0, 200) });
        return this.getContextualFallback(context, 'AI_API_ERROR');
      }
      const aiResponse = parsed.data;
      
      // Add metadata
      aiResponse.tokens = {
        prompt: completion.usage?.prompt_tokens || 0,
        completion: completion.usage?.completion_tokens || 0,
        total: completion.usage?.total_tokens || 0
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

      let completion;
      try {
        completion = await this.openai.chat.completions.create({
          model: getEnv('OPENAI_MODEL') || 'gpt-4o-mini',
          messages: prompt,
          temperature: 0.9, // Very creative for story interactions
          max_tokens: 200,
          response_format: { type: 'json_object' }
        });
      } catch (error: any) {
        // 🛡️ Rate limit guard for story replies
        const msg = String(error?.message || error);
        if (msg.includes('429') || /rate limit/i.test(msg)) {
          const storyMessage = '🎉 شكراً لتفاعلك! سأرد عليك قريباً 😊';
          return {
            message: storyMessage,
            messageAr: storyMessage,
            intent: 'rate_limit_error',
            stage: 'SUPPORT' as const,
            actions: [],
            products: [],
            confidence: 0.5,
            tokens: { prompt: 0, completion: 0, total: 0 },
            responseTime: 0,
            mediaRecommendations: [],
            hashtagSuggestions: [],
            visualStyle: 'story' as const,
            engagement: {
              likelyToShare: false,
              viralPotential: 0.1,
              userGeneratedContent: false
            }
          };
        }
        throw error;
      }

      const response = completion.choices?.[0]?.message?.content;
      const parsed = this.parseJsonSafe<InstagramAIResponse>(response ?? undefined);
      const aiResponse = parsed.ok && this.validateInstagramResponse(parsed.data)
        ? parsed.data
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
      const parsed = this.parseJsonSafe<InstagramAIResponse>(response ?? undefined);
      const aiResponse = parsed.ok && this.validateInstagramResponse(parsed.data)
        ? parsed.data
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
📊 عدد الطلبات السابقة: ${context.customerProfile?.previousOrders || 0}

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

    // Add conversation history with Instagram context
    context.conversationHistory.slice(-8).forEach(msg => {
      messages.push({
        role: msg.role,
        content: msg.content
      });
    });

    // Add current customer message with context
    let messageWithContext = customerMessage;
    if (context.interactionType === 'story_reply') {
      messageWithContext = `[ردّ على ستوري] ${customerMessage}`;
    } else if (context.interactionType === 'comment') {
      messageWithContext = `[تعليق على منشور] ${customerMessage}`;
    } else if (context.interactionType === 'story_mention') {
      messageWithContext = `[منشن في ستوري] ${customerMessage}`;
    }

    messages.push({
      role: 'user',
      content: messageWithContext
    });

    return messages;
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
      `${p.name_ar} - $${p.price_usd} - ${p.category}`
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
          SELECT id, sku, name_ar, price_usd, category, description_ar, image_urls
          FROM products 
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
            entity_type,
            details,
            execution_time_ms,
            success
          ) VALUES (
            ${context.merchantId}::uuid,
            'INSTAGRAM_AI_RESPONSE_GENERATED',
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
              mediaRecommendations: response.mediaRecommendations?.length || 0,
              hashtagsGenerated: response.hashtagSuggestions?.length || 0
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
            ${response.tokens?.total || 0}, ${response.responseTime}, 1, ${response.tokens?.total || 0}, ${response.responseTime}
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