/**
 * ===============================================
 * Instagram AI Service - STEP 3 Implementation
 * AI conversation adaptation for Instagram's visual, casual, emoji-rich style
 * ===============================================
 */

import { AIService, type ConversationContext, type AIResponse, type MessageHistory } from './ai.js';
import { getDatabase } from '../database/connection.js';
import OpenAI from 'openai';

// Simple merchant configuration interface
interface MerchantAIConfig {
  aiModel: string;
  maxTokens: number;
  temperature: number;
  language: string;
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
  interactionType: 'dm' | 'comment' | 'story_reply' | 'story_mention';
  mediaContext?: {
    mediaId?: string;
    mediaType?: 'video' | 'carousel' | 'photo';
    caption?: string;
    hashtags?: string[];
    [k: string]: any;
  };
  visualPreferences?: {
    colorScheme: string[];
    aestheticStyle: string;
    contentType: string[];
  };
}

export class InstagramAIService extends AIService {
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
      
      if (result.length > 0 && result[0].ai_config) {
        return {
          aiModel: result[0].ai_config.model || 'gpt-4o-mini',
          maxTokens: result[0].ai_config.maxTokens || 600,
          temperature: result[0].ai_config.temperature || 0.8,
          language: result[0].ai_config.language || 'ar'
        };
      }
      
      // Default configuration
      return {
        aiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || '600'),
        temperature: 0.8,
        language: 'ar'
      };
    } catch (error) {
      console.error('❌ Error loading merchant config:', error);
      return {
        aiModel: 'gpt-4o-mini',
        maxTokens: 600,
        temperature: 0.8,
        language: 'ar'
      };
    }
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

    const contextType = context.interactionType === 'story_reply' ? 'story_reply' 
                       : context.interactionType === 'comment' ? 'comment' 
                       : 'dm';
    
    const fb = fallbacks[contextType as keyof typeof fallbacks] as Record<ErrorCode, string>;
    const code = (errorType as ErrorCode);
    const message = fb[code] ?? fb.AI_API_ERROR;

    return {
      message,
      messageAr: message,
      intent: 'SUPPORT',
      stage: context.stage,
      actions: [{ type: 'ESCALATE', data: { reason: errorType }, priority: 1 }],
      products: [],
      confidence: 0.1,
      tokens: { prompt: 0, completion: 0, total: 0 },
      responseTime: 0,
      visualStyle: contextType === 'story_reply' ? 'story' : 'direct',
      engagement: {
        likelyToShare: contextType === 'story_reply',
        viralPotential: contextType === 'story_reply' ? 0.7 : 0,
        userGeneratedContent: contextType === 'story_reply'
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
      
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY!,
        timeout: parseInt(process.env.OPENAI_TIMEOUT || '30000'),
      });

      // Call OpenAI with merchant-specific settings
      const completion = await openai.chat.completions.create({
        model: config.aiModel,
        messages: prompt,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        top_p: 0.95,
        frequency_penalty: 0.2,
        presence_penalty: 0.3,
        response_format: { type: 'json_object' }
      });

      const responseTime = Date.now() - startTime;
      const response = completion.choices[0]?.message?.content;

      if (!response) {
        throw new Error('No response from OpenAI for Instagram');
      }

      // Parse Instagram AI response
      const aiResponse = JSON.parse(response) as InstagramAIResponse;
      
      // Add metadata
      aiResponse.tokens = {
        prompt: completion.usage?.prompt_tokens || 0,
        completion: completion.usage?.completion_tokens || 0,
        total: completion.usage?.total_tokens || 0
      };
      aiResponse.responseTime = responseTime;

      // Enhance with Instagram-specific features
      aiResponse.hashtagSuggestions = await this.generateRelevantHashtags(
        customerMessage, 
        context
      );

      // Log Instagram AI interaction
      await this.logInstagramAIInteraction(context, customerMessage, aiResponse);

      return aiResponse;
    } catch (error) {
      console.error('❌ Instagram AI response generation failed:', error);
      
      // ✅ 2. Error Handling: Use contextual fallback
      const errorType = error.message?.includes('rate limit') ? 'RATE_LIMIT'
                       : error.message?.includes('network') ? 'NETWORK_ERROR'
                       : 'AI_API_ERROR';
      
      return this.getContextualFallback(context, errorType);
    }
  }

  /**
   * Generate Instagram story reply response
   */
  public async generateStoryReply(
    storyReaction: string,
    storyContext: { mediaId: string; mediaType: string; caption?: string },
    context: InstagramContext
  ): Promise<InstagramAIResponse> {
    try {
      const prompt = this.buildStoryReplyPrompt(storyReaction, storyContext, context);

      const completion = await this.openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: prompt,
        temperature: 0.9, // Very creative for story interactions
        max_tokens: 200,
        response_format: { type: 'json_object' }
      });

      const response = completion.choices[0]?.message?.content;
      const aiResponse = JSON.parse(response || '{}') as InstagramAIResponse;

      // Set visual style for story replies
      aiResponse.visualStyle = 'story';
      aiResponse.engagement = {
        likelyToShare: true,
        viralPotential: 0.7,
        userGeneratedContent: true
      };

      return aiResponse;
    } catch (error) {
      console.error('❌ Story reply generation failed:', error);
      return this.getInstagramFallbackResponse(context);
    }
  }

  /**
   * Generate comment response for Instagram posts
   */
  public async generateCommentResponse(
    commentText: string,
    postContext: { mediaId: string; caption?: string },
    context: InstagramContext
  ): Promise<InstagramAIResponse> {
    try {
      const prompt = this.buildCommentReplyPrompt(commentText, postContext, context);
      
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY!,
      });

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: prompt,
        temperature: 0.7,
        max_tokens: 150, // Comments should be concise
        response_format: { type: 'json_object' }
      });

      const response = completion.choices[0]?.message?.content;
      const aiResponse = JSON.parse(response || '{}') as InstagramAIResponse;

      // Set visual style for post comments
      aiResponse.visualStyle = 'post';
      aiResponse.engagement = {
        likelyToShare: false,
        viralPotential: 0.4,
        userGeneratedContent: false
      };

      return aiResponse;
    } catch (error) {
      console.error('❌ Comment response generation failed:', error);
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
      
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY!,
      });

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: prompt,
        temperature: 0.8,
        max_tokens: 800,
        response_format: { type: 'json_object' }
      });

      const response = completion.choices[0]?.message?.content;
      return JSON.parse(response || '{}');
    } catch (error) {
      console.error('❌ Product showcase generation failed:', error);
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
    contentType: 'story' | 'post' | 'reel',
    context: InstagramContext
  ): Promise<{
    viralScore: number;
    engagementPrediction: number;
    audienceMatch: number;
    optimizationSuggestions: string[];
  }> {
    try {
      const prompt = this.buildContentAnalysisPrompt(content, contentType, context);
      
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY!,
      });

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: prompt,
        temperature: 0.4,
        max_tokens: 400,
        response_format: { type: 'json_object' }
      });

      const response = completion.choices[0]?.message?.content;
      return JSON.parse(response || '{}');
    } catch (error) {
      console.error('❌ Content performance analysis failed:', error);
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
    storyContext: any,
    context: InstagramContext
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
    postContext: any,
    context: InstagramContext
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
    products: any[],
    context: InstagramContext
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
    contentType: string,
    context: InstagramContext
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
    message: string,
    context: InstagramContext
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

      const category = context.merchantSettings?.businessCategory || 'general';
      const relevantHashtags = categoryHashtags[category] || [];

      // Trending hashtags (this could be enhanced with real-time trend data)
      const trendingHashtags = ['#ترند', '#جديد', '#حصري', '#عرض_خاص'];

      return [...baseHashtags, ...relevantHashtags, ...trendingHashtags].slice(0, 8);
    } catch (error) {
      console.error('❌ Hashtag generation failed:', error);
      return ['#عراق', '#تسوق', '#جديد'];
    }
  }

  /**
   * Private: Get products for showcase - optimized with batching
   */
  private async getProductsForShowcase(productIds: string[], merchantId: string): Promise<any[]> {
    try {
      const sql = this.db.getSQL();
      
      // Batch multiple queries if needed
      const batchSize = 50; // Limit batch size for performance
      const productBatches = [];
      
      for (let i = 0; i < productIds.length; i += batchSize) {
        const batch = productIds.slice(i, i + batchSize);
        productBatches.push(batch);
      }
      
      let allProducts: any[] = [];
      
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
      batchResults.forEach(batch => allProducts.push(...batch));
      
      return allProducts;
    } catch (error) {
      console.error('❌ Error fetching showcase products:', error);
      return [];
    }
  }

  /**
   * ✅ 3. Performance Optimization: Batch process multiple operations
   */
  private async processCommentBatch(operations: Array<() => Promise<any>>): Promise<any[]> {
    try {
      // Execute operations in parallel for better performance
      return await Promise.all(operations);
    } catch (error) {
      console.error('❌ Batch processing failed:', error);
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
        
        // Update analytics in the same batch
        () => sql`
          INSERT INTO instagram_analytics (
            merchant_id,
            interaction_type,
            tokens_used,
            response_time_ms,
            created_at
          ) VALUES (
            ${context.merchantId}::uuid,
            ${context.interactionType},
            ${response.tokens?.total || 0},
            ${response.responseTime},
            NOW()
          )
          ON CONFLICT (merchant_id, DATE(created_at)) 
          DO UPDATE SET
            total_interactions = instagram_analytics.total_interactions + 1,
            total_tokens = instagram_analytics.total_tokens + ${response.tokens?.total || 0},
            avg_response_time = (instagram_analytics.avg_response_time + ${response.responseTime}) / 2
        `
      ];

      // Execute all operations in batch
      await this.processCommentBatch(operations);
      
    } catch (error) {
      console.error('❌ Instagram AI interaction logging failed:', error);
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
      message,
      messageAr: message,
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
      hashtagSuggestions: ['#عذر', '#مساعدة']
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