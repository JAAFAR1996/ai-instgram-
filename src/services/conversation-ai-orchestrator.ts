/**
 * ===============================================
 * Conversation AI Orchestrator - STEP 3 Implementation
 * Orchestrates AI responses across WhatsApp and Instagram platforms
 * Adapts conversation style based on platform and context
 * ===============================================
 */

import { getAIService, type ConversationContext, type AIResponse } from './ai.js';
import { getInstagramAIService, type InstagramContext, type InstagramAIResponse } from './instagram-ai.js';
import { getDatabase } from '../db/adapter.js';
import type { Platform } from '../types/database.js';
import type { DIContainer } from '../container/index.js';

import { logger } from './logger.js';
import ExtendedThinkingService from './extended-thinking.js';
import { shouldUseExtendedThinking } from '../utils/reasoning-chain.js';
import { PredictiveAnalyticsEngine } from './predictive-analytics.js';
import IntelligentRejectionHandler from './rejection/intelligent-rejection-handler.js';
import SelfLearningSystem from './learning-analytics.js';
import { pushDLQ } from '../queue/dead-letter.js';

interface InteractionRow extends Record<string, unknown> {
  platform: string;
  conversation_stage: string;
  message_type: string;
  content: string;
  direction: string;
  created_at: string;
  ai_processed: boolean;
}

interface PlatformHistoryRow extends Record<string, unknown> {
  platform: string;
  interaction_count: string;
  last_interaction: string;
  stages: string[];
}

interface JourneyStageRow extends Record<string, unknown> {
  platform: string;
  conversation_stage: string;
  created_at: string;
  intent: string;
}

export interface PlatformAIResponse {
  response: AIResponse | InstagramAIResponse;
  platformOptimized: boolean;
  crossPlatformContext?: CrossPlatformContext;
  adaptations: PlatformAdaptation[];
}

export interface CrossPlatformContext {
  hasWhatsAppHistory: boolean;
  hasInstagramHistory: boolean;
  preferredPlatform: Platform;
  customerJourney: CustomerJourneyStage[];
  totalInteractions: number;
  lastPlatformSwitch?: Date;
}

export interface CustomerJourneyStage {
  platform: Platform;
  stage: string;
  timestamp: Date;
  intent: string;
  outcome?: string;
}

export interface PlatformAdaptation {
  type: 'tone' | 'length' | 'media' | 'emojis' | 'hashtags' | 'formality';
  originalValue: string;
  adaptedValue: string;
  reason: string;
}

export interface ConversationPersonality {
  platform: Platform;
  formality: 'casual' | 'semi-formal' | 'formal';
  emojiUsage: 'heavy' | 'moderate' | 'minimal';
  responseLength: 'brief' | 'medium' | 'detailed';
  visualElements: boolean;
  localDialect: 'baghdadi' | 'southern' | 'northern' | 'standard';
}

export class ConversationAIOrchestrator {
  private aiService!: Awaited<ReturnType<typeof getAIService>>;
  private instagramAI!: ReturnType<typeof getInstagramAIService>;
  private db!: ReturnType<typeof getDatabase>;

  constructor(container?: DIContainer) {
    if (container) {
      this.initializeFromContainer(container).catch(error => {
        logger.error('Failed to initialize from container', error);
      });
    } else {
      this.initializeLegacy().catch(error => {
        logger.error('Failed to initialize legacy', error);
      });
    }
  }

  private async initializeFromContainer(container: DIContainer): Promise<void> {
    try {
      // Try to get services from container first
      this.aiService = container.get<Awaited<ReturnType<typeof getAIService>>>('aiService') || await getAIService();
      this.instagramAI = container.get<ReturnType<typeof getInstagramAIService>>('instagramAIService') || getInstagramAIService();
      this.db = container.get<ReturnType<typeof getDatabase>>('database') || getDatabase();
    } catch (error: unknown) {
      logger.warn('Container initialization failed, falling back to legacy methods', { error });
      await this.initializeLegacy();
    }
  }

  private async initializeLegacy(): Promise<void> {
    this.aiService = await getAIService();
    this.instagramAI = getInstagramAIService();
    this.db = getDatabase();
  }

  /**
   * Ensure services are initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.aiService) {
      this.aiService = await getAIService();
    }
    if (!this.instagramAI) {
      this.instagramAI = getInstagramAIService();
    }
    if (!this.db) {
      this.db = getDatabase();
    }
  }

  /**
   * Generate platform-optimized AI response
   */
  public async generatePlatformResponse(
    customerMessage: string,
    context: ConversationContext | InstagramContext,
    platform: Platform
  ): Promise<PlatformAIResponse> {
    try {
      await this.ensureInitialized();
      logger.info(`🤖 Generating ${platform} AI response for merchant: ${context.merchantId}`);

      // احترام Service Controller قبل تشغيل الذكاء
      try {
        const { getServiceController } = await import('./service-controller.js');
        const sc = getServiceController();
        const enabled = await sc.isServiceEnabled(context.merchantId, 'AI_RESPONSES');
        if (!enabled) {
          return this.getFallbackPlatformResponse(platform, context);
        }
      } catch (error: unknown) {
        logger.warn('Service controller check failed, continuing with AI processing', { error });
      }

      // Get cross-platform context
      const crossPlatformContext = await this.getCrossPlatformContext(
        context.customerId,
        context.merchantId
      );

      // Determine conversation personality
      const personality = await this.determineConversationPersonality(
        platform,
        context,
        crossPlatformContext
      );

      let response: AIResponse | InstagramAIResponse;
      let adaptations: PlatformAdaptation[] = [];
      let thinkingChain: import('../types/thinking.js').ThinkingChain | undefined;

      // 0) Extended thinking for complex queries (best-effort)
      try {
        const enableThinking = shouldUseExtendedThinking(customerMessage, undefined);
        if (enableThinking) {
          const thinkingService = new ExtendedThinkingService();
          const thinking = await thinkingService.processWithThinking(customerMessage, {
            merchantId: context.merchantId,
            username: context.customerId,
            session: ((context as { session?: Record<string, unknown> }).session || {}),
            nlp: undefined,
            hints: {}
          }, false);
          thinkingChain = thinking.chain;
        }
      } catch (e) {
        logger.debug('Extended thinking skipped', { error: String(e) });
      }

      if (platform === 'instagram') {
        // Use Instagram-specific AI
        const instagramContext = context as InstagramContext;
        response = await this.instagramAI.generateInstagramResponse(
          customerMessage,
          instagramContext
        );
        
        // Apply Instagram-specific adaptations
        adaptations = this.applyInstagramAdaptations(response, personality, crossPlatformContext);
      } else {
        // Use standard AI for WhatsApp
        response = await this.aiService.generateResponse(customerMessage, context);
        
        // Apply WhatsApp-specific adaptations
        adaptations = this.applyWhatsAppAdaptations(response, personality, crossPlatformContext);
      }

      // Apply cross-platform learning
      response = await this.applyCrossPlatformLearning(response, crossPlatformContext);

      // 1) Merge extended-thinking decision into final text when available
      try {
        if (thinkingChain && (response as AIResponse)?.message) {
          const enhanced = this.mergeThinkingWithResponse((response as AIResponse).message, thinkingChain);
          if (enhanced && enhanced !== (response as AIResponse).message) {
            (response as AIResponse).message = enhanced;
            (response as AIResponse).messageAr = enhanced;
            adaptations.push({ type: 'tone', originalValue: 'auto', adaptedValue: 'with-clarifier', reason: 'extended-thinking decision integration' });
          }
        }
      } catch {}

      // 2) Predictive analytics influences (size/churn/timing)
      try {
        const pae = new PredictiveAnalyticsEngine();
        const insights = await pae.getCustomerInsights(context.merchantId, context.customerId);
        if (insights.sizeRisk.riskLevel === 'HIGH' || insights.sizeRisk.riskLevel === 'MEDIUM') {
          const hint = 'ممكن نتأكد من القياس المناسب إلك؟ إذا تحب أعطيك جدول المقاسات ✅';
          (response as AIResponse).message = `${hint}\n\n${(response as AIResponse).message}`;
          (response as AIResponse).actions = [ ...(response.actions || []), { type: 'COLLECT_INFO', data: { field: 'size' }, priority: 1 } ];
          adaptations.push({ type: 'length', originalValue: 'base', adaptedValue: 'add-size-clarifier', reason: 'predictive size risk' });
        }
        if (insights.churnRisk.riskLevel === 'HIGH') {
          const retain = 'نحبك تبقى ويانه ♥️ عدنا عرض بسيط خاص إلك إذا مهتم.';
          (response as AIResponse).message = `${(response as AIResponse).message}\n\n${retain}`;
          (response as AIResponse).actions = [ ...(response.actions || []), { type: 'SCHEDULE_TEMPLATE', data: { template: 'LOYALTY_OFFER' }, priority: 2 } ];
          adaptations.push({ type: 'tone', originalValue: 'base', adaptedValue: 'retention', reason: 'high churn risk' });
        }
      } catch (e) {
        logger.debug('Predictive analytics influence skipped', { error: String(e) });
      }

      // 3) Intelligent rejection handling even if not strictly OBJECTION
      try {
        const msg = (customerMessage ?? '').toLowerCase();
        const looksRejection = /(غالي|ما اريد|مو حلو|رديء|خايس|مو الآن|بعدين)/.test(msg);
        if (looksRejection) {
          const rej = new IntelligentRejectionHandler();
          const analysis = await rej.analyzeRejection(customerMessage, context as ConversationContext);
          const counter = await rej.generateCounterResponse(analysis);
          (response as AIResponse).message = `${counter}\n\n${(response as AIResponse).message}`;
          adaptations.push({ type: 'tone', originalValue: 'base', adaptedValue: 'objection-handled', reason: 'rejection heuristic' });
        }
      } catch (e) {
        logger.debug('Rejection handler skipped', { error: String(e) });
      }

      // 4) Light self-learning adaptation
      try {
        const sl = new SelfLearningSystem();
        const prefs = (context as { preferences?: Record<string, unknown> } | undefined)?.preferences || {};
        const adj = await sl.adaptToCustomerPreferences(context.customerId, prefs);
        if (adj.notes?.length) adaptations.push({ type: 'tone', originalValue: 'base', adaptedValue: 'personalized', reason: adj.notes.join('; ').slice(0, 80) });
      } catch {}

      // Log platform-specific interaction (لا تسقط النظام لو فشلت الكتابة)
      try {
        await this.logPlatformInteraction(
          { ...context, conversationHistory: [] } as ConversationContext, // لا نمرّر تاريخ طويل
          response, platform, adaptations
        );
      } catch (error: unknown) {
        logger.warn('logPlatformInteraction failed (non-fatal)', { error });
      }

      return {
        response,
        platformOptimized: true,
        crossPlatformContext,
        adaptations
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Platform response generation failed for ${platform}`, {
        error: errorMessage,
        merchantId: context.merchantId,
        customerId: context.customerId
      });
      try { pushDLQ({ reason: 'orchestrator_generate_failed', payload: { platform, customerMessage }, merchantId: context.merchantId, platform: String(platform), severity: 'high', category: 'other' }); } catch {}

      // Return fallback response
      return this.getFallbackPlatformResponse(platform, context);
    }
  }

  /**
   * Adapt message style when customer switches platforms
   */
  public async adaptCrossPlatformMessage(
    originalMessage: string,
    fromPlatform: Platform,
    toPlatform: Platform,
    _context: ConversationContext
  ): Promise<{
    adaptedMessage: string;
    adaptations: PlatformAdaptation[];
    contextPreserved: boolean;
  }> {
    try {
      if (fromPlatform === toPlatform) {
        return {
          adaptedMessage: originalMessage,
          adaptations: [],
          contextPreserved: true
        };
      }

      const adaptations: PlatformAdaptation[] = [];
      let adaptedMessage = originalMessage;

      if (fromPlatform === 'whatsapp' && toPlatform === 'instagram') {
        // WhatsApp → Instagram: Make more casual, add emojis, shorter
        adaptedMessage = await this.adaptWhatsAppToInstagram(originalMessage);
        adaptations.push({
          type: 'tone',
          originalValue: 'formal WhatsApp',
          adaptedValue: 'casual Instagram',
          reason: 'Platform style adaptation'
        });
      } else if (fromPlatform === 'instagram' && toPlatform === 'whatsapp') {
        // Instagram → WhatsApp: Make more formal, reduce emojis, detailed
        adaptedMessage = await this.adaptInstagramToWhatsApp(originalMessage);
        adaptations.push({
          type: 'formality',
          originalValue: 'casual Instagram',
          adaptedValue: 'semi-formal WhatsApp',
          reason: 'Platform formality expectation'
        });
      }

      return {
        adaptedMessage,
        adaptations,
        contextPreserved: true
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Cross-platform adaptation failed', { error: errorMessage });
      return {
        adaptedMessage: originalMessage,
        adaptations: [],
        contextPreserved: false
      };
    }
  }

  /**
   * Get conversation insights across platforms
   */
  public async getConversationInsights(
    customerId: string,
    merchantId: string
  ): Promise<{
    customerProfile: EnhancedCustomerProfile;
    platformPreferences: PlatformPreferences;
    conversationTrends: ConversationTrend[];
    recommendations: string[];
  }> {
    try {
      const pool = this.db.getPool();

      // Get customer interactions across platforms
      const { rows: interactions } = await pool.query<InteractionRow>(
        `SELECT 
          c.platform,
          c.conversation_stage,
          ml.message_type,
          ml.content,
          ml.direction,
          ml.created_at,
          ml.ai_processed
        FROM conversations c
        JOIN message_logs ml ON c.id = ml.conversation_id
        WHERE (c.customer_phone = $1 OR c.customer_instagram = $1)
        AND c.merchant_id = $2::uuid
        ORDER BY ml.created_at DESC
        LIMIT 100`,
        [customerId, merchantId]
      );

      // Analyze patterns
      const customerProfile = await this.analyzeCustomerProfile(interactions);
      const platformPreferences = this.analyzePlatformPreferences(interactions);
      const conversationTrends = this.analyzeConversationTrends(interactions);
      const recommendations = this.generateConversationRecommendations(
        customerProfile,
        platformPreferences,
        conversationTrends
      );

      return {
        customerProfile,
        platformPreferences,
        conversationTrends,
        recommendations
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Conversation insights generation failed:', { error: errorMessage });
      return {
        customerProfile: {} as EnhancedCustomerProfile,
        platformPreferences: {} as PlatformPreferences,
        conversationTrends: [],
        recommendations: []
      };
    }
  }

  /**
   * Private: Get cross-platform conversation context
   */
  private async getCrossPlatformContext(
    customerId: string,
    merchantId: string
  ): Promise<CrossPlatformContext> {
    if (process.env.DISABLE_CROSS_PLATFORM_CONTEXT === 'true') {
      return {
        hasWhatsAppHistory: false,
        hasInstagramHistory: false,
        preferredPlatform: 'whatsapp',
        customerJourney: [],
        totalInteractions: 0
      };
    }
    try {
      const pool = this.db.getPool();
      const { rows: platformHistory } = await pool.query<PlatformHistoryRow>(
        `SELECT 
          platform,
          COUNT(*) as interaction_count,
          MAX(updated_at) as last_interaction,
          array_agg(DISTINCT conversation_stage) as stages
        FROM conversations
        WHERE (customer_phone = $1 OR customer_instagram = $1)
        AND merchant_id = $2::uuid
        GROUP BY platform`,
        [customerId, merchantId]
      );

      const hasWhatsAppHistory = platformHistory.some(
        (p: PlatformHistoryRow) => p.platform === 'whatsapp'
      );
      const hasInstagramHistory = platformHistory.some(
        (p: PlatformHistoryRow) => p.platform === 'instagram'
      );

      const preferredPlatform =
        (platformHistory || []).reduce((prev: PlatformHistoryRow | null, current: PlatformHistoryRow) => {
          if (!prev) return current;
          return Number(prev.interaction_count) > Number(current.interaction_count) ? prev : current;
        }, null as PlatformHistoryRow | null)?.platform || 'whatsapp';

      const totalInteractions = platformHistory.reduce(
        (sum: number, p: PlatformHistoryRow) => sum + parseInt(p.interaction_count),
        0
      );

      // Get customer journey stages
      const { rows: journeyStages } = await pool.query<JourneyStageRow>(
        `SELECT 
          platform,
          conversation_stage,
          created_at,
          'unknown' as intent
        FROM conversations
        WHERE (customer_phone = $1 OR customer_instagram = $1)
        AND merchant_id = $2::uuid
        ORDER BY created_at ASC
        LIMIT 20`,
        [customerId, merchantId]
      );

      const customerJourney: CustomerJourneyStage[] = journeyStages.map(
        (stage: JourneyStageRow) => ({
          platform: stage.platform as Platform,
          stage: stage.conversation_stage,
          timestamp: new Date(stage.created_at),
          intent: stage.intent
        })
      );

      return {
        hasWhatsAppHistory,
        hasInstagramHistory,
        preferredPlatform: preferredPlatform as Platform,
        customerJourney,
        totalInteractions
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Error getting cross-platform context:', { error: errorMessage });
      return {
        hasWhatsAppHistory: false,
        hasInstagramHistory: false,
        preferredPlatform: 'whatsapp',
        customerJourney: [],
        totalInteractions: 0
      };
    }
  }

  /**
   * Private: Determine conversation personality based on platform and context
   */
  private async determineConversationPersonality(
    platform: Platform,
    _context: ConversationContext,
    crossPlatformContext: CrossPlatformContext
  ): Promise<ConversationPersonality> {
    const basePersonality: ConversationPersonality = {
      platform,
      formality: 'semi-formal',
      emojiUsage: 'moderate',
      responseLength: 'medium',
      visualElements: false,
      localDialect: 'standard'
    };

    if (platform === 'instagram') {
      return {
        ...basePersonality,
        formality: 'casual',
        emojiUsage: 'heavy',
        responseLength: 'brief',
        visualElements: true,
        localDialect: 'baghdadi' // More colloquial for Instagram
      };
    } else {
      // WhatsApp - more formal and detailed
      return {
        ...basePersonality,
        formality: crossPlatformContext.totalInteractions > 5 ? 'casual' : 'semi-formal',
        emojiUsage: 'moderate',
        responseLength: 'medium',
        visualElements: false,
        localDialect: 'standard'
      };
    }
  }

  /**
   * Private: Apply Instagram-specific adaptations
   */
  private applyInstagramAdaptations(
    response: AIResponse | InstagramAIResponse,
    personality: ConversationPersonality,
    _crossPlatformContext: CrossPlatformContext
  ): PlatformAdaptation[] {
    const adaptations: PlatformAdaptation[] = [];

    if (personality.emojiUsage === 'heavy' && typeof response.message === 'string') {
      const emojiCount = (response.message.match(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu) || []).length;
      
      if (emojiCount < 3) {
        adaptations.push({
          type: 'emojis',
          originalValue: `${emojiCount} emojis`,
          adaptedValue: 'Enhanced with Instagram-style emojis',
          reason: 'Instagram requires more visual expression'
        });
      }
    }

    if (typeof response.message === 'string' && response.message.length > 180) {
      adaptations.push({
        type: 'length',
        originalValue: `${response.message.length} characters`,
        adaptedValue: 'Shortened for Instagram',
        reason: 'Instagram prefers concise communication'
      });
    }

    return adaptations;
  }

  /**
   * Private: Apply WhatsApp-specific adaptations
   */
  private applyWhatsAppAdaptations(
    response: AIResponse,
    personality: ConversationPersonality,
    crossPlatformContext: CrossPlatformContext
  ): PlatformAdaptation[] {
    const adaptations: PlatformAdaptation[] = [];

    // Ensure appropriate formality for WhatsApp
    if (personality.formality === 'semi-formal' && crossPlatformContext.totalInteractions === 0) {
      adaptations.push({
        type: 'formality',
        originalValue: 'casual tone',
        adaptedValue: 'semi-formal introduction',
        reason: 'First WhatsApp interaction requires proper introduction'
      });
    }

    // Ensure detailed responses when needed
    if (response.message.length < 50 && personality.responseLength === 'detailed') {
      adaptations.push({
        type: 'length',
        originalValue: `${response.message.length} characters`,
        adaptedValue: 'Expanded with details',
        reason: 'WhatsApp allows for more detailed explanations'
      });
    }

    return adaptations;
  }

  /**
   * Private: Apply cross-platform learning
   */
  private async applyCrossPlatformLearning(
    response: AIResponse | InstagramAIResponse,
    crossPlatformContext: CrossPlatformContext
  ): Promise<AIResponse | InstagramAIResponse> {
    // If customer has history on both platforms, leverage learnings
    if (crossPlatformContext.hasWhatsAppHistory && crossPlatformContext.hasInstagramHistory) {
      if (crossPlatformContext.customerJourney.length > 0) {
        // تعزيز الثقة بشكل طفيف بوجود سجلّ متعدد المنصات
        response.confidence = Math.min((response.confidence ?? 0.6) + 0.08, 1.0);
      }
    }

    return response;
  }

  private mergeThinkingWithResponse(base: string, chain: import('../types/thinking.js').ThinkingChain): string {
    try {
      const decide = chain.steps.find(s => s.stage === 'DECIDE');
      const hint = typeof decide?.result === 'string' ? decide.result.trim() : '';
      if (!hint) return base;
      const concise = hint.replace(/\s+/g, ' ').replace(/^\W+/, '').slice(0, 140);
      if (!concise) return base;
      return `${concise}\n\n${base}`;
    } catch {
      return base;
    }
  }

  /**
   * Private: Adapt WhatsApp message to Instagram style
   */
  private async adaptWhatsAppToInstagram(message: string): Promise<string> {
    // More casual, more emojis, shorter
    let adapted = message;
    
    // Replace formal phrases with casual ones
    const formalToCasual: Record<string, string> = {
      'السلام عليكم ورحمة الله وبركاته': 'هلا وغلا 👋',
      'يرجى التواصل معنا': 'كلمنا 📱',
      'نشكركم لاختياركم': 'شكراً حبيبي 💕',
      'في حال': 'لو',
      'يمكنكم': 'تقدر',
      'بإمكانكم': 'تقدر'
    };

    Object.entries(formalToCasual).forEach(([formal, casual]) => {
      adapted = adapted.replace(new RegExp(formal, 'g'), casual);
    });

    // Add Instagram-style emojis if missing
    if (!/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]/u.test(adapted)) {
      adapted += ' ✨';
    }

    return adapted;
  }

  /**
   * Private: Adapt Instagram message to WhatsApp style
   */
  private async adaptInstagramToWhatsApp(message: string): Promise<string> {
    // More formal, fewer emojis, more detailed
    let adapted = message;
    
    // Replace casual phrases with more formal ones
    const casualToFormal: Record<string, string> = {
      'هلا وغلا': 'أهلاً وسهلاً',
      'شلونك': 'كيف حالك',
      'كلمنا': 'يرجى التواصل معنا',
      'شكراً حبيبي': 'نشكركم لتفاعلكم'
    };

    Object.entries(casualToFormal).forEach(([casual, formal]) => {
      adapted = adapted.replace(new RegExp(casual, 'g'), formal);
    });

    // Reduce excessive emojis (keep max 2)
    const emojis = adapted.match(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu);
    if (emojis && emojis.length > 2) {
      // Keep only first 2 emojis
      let emojiCount = 0;
      adapted = adapted.replace(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, (match) => {
        emojiCount++;
        return emojiCount <= 2 ? match : '';
      });
    }

    return adapted;
  }

  /**
   * Private: Analyze customer profile across platforms
   */
  private async analyzeCustomerProfile(interactions: InteractionRow[]): Promise<EnhancedCustomerProfile> {
    // Analyze customer behavior patterns across platforms
    const whatsappInteractions = interactions.filter(i => i.platform === 'whatsapp');
    const instagramInteractions = interactions.filter(i => i.platform === 'instagram');

    return {
      totalInteractions: interactions.length,
      whatsappInteractions: whatsappInteractions.length,
      instagramInteractions: instagramInteractions.length,
      preferredTimeOfDay: this.analyzeTimePreferences(interactions),
      responsePatterns: this.analyzeResponsePatterns(interactions),
      purchaseIntent: this.analyzePurchaseIntent(interactions)
    };
  }

  /**
   * Private: Analyze platform preferences
   */
  private analyzePlatformPreferences(interactions: InteractionRow[]): PlatformPreferences {
    const platforms = interactions.reduce(
      (acc: Record<string, number>, interaction: InteractionRow) => {
        const key = String(interaction.platform).toLowerCase();
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const total = interactions.length;
    
    return {
      whatsappPreference: total > 0 ? ((platforms.whatsapp ?? 0) / total) * 100 : 0,
      instagramPreference: total > 0 ? ((platforms.instagram ?? 0) / total) * 100 : 0,
      switchingFrequency: this.calculateSwitchingFrequency(interactions)
    };
  }

  /**
   * Private: Analyze time preferences based on interaction timestamps
   */
  private analyzeTimePreferences(interactions: InteractionRow[]): string {
    if (interactions.length === 0) return 'unknown';
    
    const hours = interactions.map(i => new Date(i.created_at).getHours());
    const hourCounts = hours.reduce((acc, hour) => {
      acc[hour] = (acc[hour] ?? 0) + 1;
      return acc;
    }, {} as Record<number, number>);
    
    const entries = Object.entries(hourCounts);
    if (entries.length === 0) return 'unknown';
    
    // Find the hour with maximum interactions
    let maxHour = 12;
    let maxCount = 0;
    
    for (const [hourStr, count] of entries) {
      const hour = Number(hourStr);
      if (count > maxCount) {
        maxCount = count;
        maxHour = hour;
      }
    }
    
    // Categorize the hour
    if (maxHour >= 6 && maxHour < 12) return 'morning';
    if (maxHour >= 12 && maxHour < 17) return 'afternoon';
    if (maxHour >= 17 && maxHour < 22) return 'evening';
    return 'night';
  }

  /**
   * Private: Analyze response patterns
   */
  private analyzeResponsePatterns(interactions: InteractionRow[]): Record<string, unknown> {
    if (interactions.length === 0) return {};
    
    const patterns = {
      averageResponseTime: 0,
      responseRate: 0,
      preferredMessageType: 'text',
      engagementLevel: 'medium'
    };
    
    // Calculate response rate
    const userMessages = interactions.filter(i => i.direction === 'inbound');
    const aiResponses = interactions.filter(i => i.direction === 'outbound' && i.ai_processed);
    patterns.responseRate = userMessages.length > 0 ? (aiResponses.length / userMessages.length) * 100 : 0;
    
    // Determine preferred message type
    const messageTypes = interactions.map(i => i.message_type);
    const typeCounts = messageTypes.reduce((acc, type) => {
      acc[type] = (acc[type] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const typeEntries = Object.entries(typeCounts);
    if (typeEntries.length === 0) {
      patterns.preferredMessageType = 'text';
    } else {
      // Find the message type with maximum count
      let maxType = 'text';
      let maxCount = 0;
      
      for (const [type, count] of typeEntries) {
        if (count > maxCount) {
          maxCount = count;
          maxType = type;
        }
      }
      
      patterns.preferredMessageType = maxType;
    }
    
    // Determine engagement level
    if (patterns.responseRate > 80) patterns.engagementLevel = 'high';
    else if (patterns.responseRate > 50) patterns.engagementLevel = 'medium';
    else patterns.engagementLevel = 'low';
    
    return patterns;
  }

  /**
   * Private: Analyze purchase intent based on conversation patterns
   */
  private analyzePurchaseIntent(interactions: InteractionRow[]): number {
    if (interactions.length === 0) return 0;
    
    let intentScore = 0;
    
    // Check for purchase-related keywords
    const purchaseKeywords = ['سعر', 'ثمن', 'شراء', 'طلب', 'دفع', 'حجز', 'احجز', 'اريد', 'عايز'];
    const hasPurchaseKeywords = interactions.some(i => 
      purchaseKeywords.some(keyword => 
        i.content.toLowerCase().includes(keyword.toLowerCase())
      )
    );
    
    if (hasPurchaseKeywords) intentScore += 0.4;
    
    // Check for product inquiries
    const productKeywords = ['موجود', 'متوفر', 'فيه', 'عندك', 'عندكم', 'متوفر'];
    const hasProductInquiries = interactions.some(i => 
      productKeywords.some(keyword => 
        i.content.toLowerCase().includes(keyword.toLowerCase())
      )
    );
    
    if (hasProductInquiries) intentScore += 0.3;
    
    // Check for detailed questions
    const detailedQuestions = interactions.filter(i => i.content.length > 50);
    if (detailedQuestions.length > 2) intentScore += 0.2;
    
    // Check for multiple interactions (engagement)
    if (interactions.length > 5) intentScore += 0.1;
    
    return Math.min(intentScore, 1.0);
  }

  /**
   * Private: Analyze conversation trends
   */
  private analyzeConversationTrends(interactions: InteractionRow[]): ConversationTrend[] {
    if (interactions.length < 3) return [];
    
    const trends: ConversationTrend[] = [];
    
    // Analyze platform usage trends
    const platformGroups = interactions.reduce((acc, i) => {
      if (!acc[i.platform]) {
        acc[i.platform] = [];
      }
      const platformArray = acc[i.platform];
      if (platformArray) {
        platformArray.push(i);
      }
      return acc;
    }, {} as Record<string, InteractionRow[]>);
    
    Object.entries(platformGroups).forEach(([platform, platformInteractions]) => {
      if (platformInteractions && platformInteractions.length > 2) {
        trends.push({
          trend: `Increasing ${platform} usage`,
          frequency: platformInteractions.length,
          platform: platform as Platform
        });
      }
    });
    
    // Analyze conversation stage progression
    const stages = interactions.map(i => i.conversation_stage);
    const uniqueStages = [...new Set(stages)];
    if (uniqueStages.length > 2) {
      trends.push({
        trend: 'Conversation stage progression',
        frequency: uniqueStages.length,
        platform: 'whatsapp' // Default platform
      });
    }
    
    return trends;
  }

  /**
   * Private: Calculate platform switching frequency
   */
  private calculateSwitchingFrequency(interactions: InteractionRow[]): number {
    if (interactions.length < 2) return 0;
    
    let switches = 0;
    for (let i = 1; i < interactions.length; i++) {
      const currentInteraction = interactions[i];
      const previousInteraction = interactions[i - 1];
      
      if (currentInteraction && previousInteraction) {
        const currentPlatform = currentInteraction.platform;
        const previousPlatform = previousInteraction.platform;
        if (currentPlatform && previousPlatform && currentPlatform !== previousPlatform) {
          switches++;
        }
      }
    }
    
    return switches / (interactions.length - 1);
  }

  /**
   * Private: Generate conversation recommendations
   */
  private generateConversationRecommendations(
    profile: EnhancedCustomerProfile,
    preferences: PlatformPreferences,
    _trends: ConversationTrend[]
  ): string[] {
    const recommendations: string[] = [];
    
    // Platform-specific recommendations
    if (preferences.instagramPreference > 70) {
      recommendations.push('Focus on Instagram engagement and visual content');
    }
    
    if (preferences.whatsappPreference > 70) {
      recommendations.push('Prioritize WhatsApp for detailed conversations');
    }
    
    // Engagement recommendations
    if (profile.purchaseIntent > 0.7) {
      recommendations.push('High purchase intent detected - focus on closing');
    }
    
    if (profile.totalInteractions > 10) {
      recommendations.push('High engagement customer - maintain relationship');
    }
    
    // Time-based recommendations
    if (profile.preferredTimeOfDay === 'evening') {
      recommendations.push('Schedule interactions during evening hours');
    }
    
    // Cross-platform recommendations
    if (preferences.switchingFrequency > 0.3) {
      recommendations.push('Customer switches platforms frequently - maintain consistency');
    }
    
    return recommendations.length > 0 ? recommendations : ['Continue current engagement strategy'];
  }

  /**
   * Private: Log platform interaction
   */
  private async logPlatformInteraction(
    context: ConversationContext,
    response: AIResponse | InstagramAIResponse,
    platform: Platform,
    adaptations: PlatformAdaptation[]
  ): Promise<void> {
    try {
      const pool = this.db.getPool();
      // قص التفاصيل الطويلة لتفادي قيود الأعمدة/الفهارس
      const safeDetails = {
        platform,
        intent: response.intent,
        stage: response.stage,
        confidence: response.confidence,
        adaptations: adaptations.length,
        responseTime: response.responseTime,
        orchestrated: true,
      };
      await pool.query(
        `INSERT INTO audit_logs (
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
          $6,
          $7
        )`,
        [
          context.merchantId,
          'SYSTEM_EVENT',
          'SYSTEM',
          'AI_INTERACTION',
          JSON.stringify(safeDetails),
          response.responseTime,
          true
        ]
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('❌ Platform interaction logging failed:', { error: errorMessage });
    }
  }

  /**
   * Private: Get fallback platform response
   */
  private getFallbackPlatformResponse(
    platform: Platform,
    context: ConversationContext | InstagramContext
  ): PlatformAIResponse {
    // لا تعتمد على دوال private من الخدمات الأخرى
    const baseMsg =
      platform === 'instagram'
        ? 'عذرًا صار خطأ بسيط، راسلنا مرة ثانية 🌟'
        : 'عذرًا، واجهتنا مشكلة مؤقتة. حاول مجددًا 🙏';
    
    const stage = 'stage' in context ? context.stage : 'UNKNOWN';
    
    const fallback =
      platform === 'instagram'
        ? ({
            message: baseMsg,
            messageAr: baseMsg,
            intent: 'SUPPORT',
            stage,
            actions: [{ type: 'ESCALATE', data: { reason: 'AI_ERROR' }, priority: 1 }],
            products: [],
            confidence: 0.1,
            tokens: { prompt: 0, completion: 0, total: 0 },
            responseTime: 0,
            visualStyle: 'direct',
            engagement: { likelyToShare: false, viralPotential: 0, userGeneratedContent: false }
          } as InstagramAIResponse)
        : ({
            message: baseMsg, 
            messageAr: baseMsg, 
            intent: 'SUPPORT', 
            stage,
            actions: [{ type: 'ESCALATE', data: { reason: 'AI_ERROR' }, priority: 1 }],
            products: [], 
            confidence: 0.1, 
            tokens: { prompt: 0, completion: 0, total: 0 }, 
            responseTime: 0
          } as AIResponse);

    return {
      response: fallback,
      platformOptimized: false,
      adaptations: []
    };
  }
}

// Additional interfaces
interface EnhancedCustomerProfile {
  totalInteractions: number;
  whatsappInteractions: number;
  instagramInteractions: number;
  preferredTimeOfDay: string;
  responsePatterns: Record<string, unknown>;
  purchaseIntent: number;
}

interface PlatformPreferences {
  whatsappPreference: number;
  instagramPreference: number;
  switchingFrequency: number;
}

interface ConversationTrend {
  trend: string;
  frequency: number;
  platform: Platform;
}

// Factory function for DI container
export function createConversationAIOrchestrator(container: DIContainer): ConversationAIOrchestrator {
  return new ConversationAIOrchestrator(container);
}

// Singleton instance (legacy support)
let orchestratorInstance: ConversationAIOrchestrator | null = null;

/**
 * Get conversation AI orchestrator instance
 */
export function getConversationAIOrchestrator(): ConversationAIOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new ConversationAIOrchestrator();
  }
  return orchestratorInstance;
}

export default ConversationAIOrchestrator;


