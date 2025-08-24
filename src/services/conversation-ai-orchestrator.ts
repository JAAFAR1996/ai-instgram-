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
import type { Pool } from 'pg';
import { logger } from './logger.js';

interface InteractionRow {
  platform: string;
  conversation_stage: string;
  message_type: string;
  content: string;
  direction: string;
  created_at: string;
  ai_processed: boolean;
}

interface PlatformHistoryRow {
  platform: string;
  interaction_count: string;
  last_interaction: string;
  stages: string[];
}

interface JourneyStageRow {
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
  private aiService!: ReturnType<typeof getAIService>;
  private instagramAI!: ReturnType<typeof getInstagramAIService>;
  private db!: ReturnType<typeof getDatabase>;
  // removed unused field

  constructor(_container?: DIContainer) {
    if (_container) {
      this.initializeFromContainer();
    } else {
      this.initializeLegacy();
    }
  }

  private initializeFromContainer(): void {
    // Services will be injected via container when available
    // For now, fallback to legacy methods
    this.initializeLegacy();
  }

  private initializeLegacy(): void {
    this.aiService = getAIService();
    this.instagramAI = getInstagramAIService();
    this.db = getDatabase();
  }

  /**
   * Generate platform-optimized AI response
   */
  public async generatePlatformResponse(
    customerMessage: string,
    _context: ConversationContext | InstagramContext,
    platform: Platform
  ): Promise<PlatformAIResponse> {
    try {
      logger.info(`🤖 Generating ${platform} AI response for merchant: ${_context.merchantId}`);

      // احترام Service Controller قبل تشغيل الذكاء
      try {
        const { getServiceController } = await import('./service-controller.js');
        const sc = getServiceController();
        const enabled = await sc.isServiceEnabled(_context.merchantId, 'ai_processing');
        if (!enabled) {
          return this.getFallbackPlatformResponse(platform, _context);
        }
      } catch {
        // لا توقف المسار إذا تعذّر الوصول للكنترولر
      }

      // Get cross-platform context
      const crossPlatformContext = await this.getCrossPlatformContext(
        _context.customerId,
        _context.merchantId
      );

      // Determine conversation personality
      const personality = await this.determineConversationPersonality(
        platform,
        _context,
        crossPlatformContext
      );

      let response: AIResponse | InstagramAIResponse;
      let adaptations: PlatformAdaptation[] = [];

      if (platform === 'instagram') {
        // Use Instagram-specific AI
        const instagramContext = _context as InstagramContext;
        response = await this.instagramAI.generateInstagramResponse(
          customerMessage,
          instagramContext
        );
        
        // Apply Instagram-specific adaptations
        adaptations = this.applyInstagramAdaptations(response, personality, crossPlatformContext);
      } else {
        // Use standard AI for WhatsApp
        response = await this.aiService.generateResponse(customerMessage, _context);
        
        // Apply WhatsApp-specific adaptations
        adaptations = this.applyWhatsAppAdaptations(response, personality, crossPlatformContext);
      }

      // Apply cross-platform learning
      response = await this.applyCrossPlatformLearning(response, crossPlatformContext);

      // Log platform-specific interaction (لا تسقط النظام لو فشلت الكتابة)
      try {
        await this.logPlatformInteraction(
          { ..._context, conversationHistory: [] } as ConversationContext, // لا نمرّر تاريخ طويل
          response, platform, adaptations
        );
      } catch (e) {
        console.warn('logPlatformInteraction failed (non-fatal)', (e as Error)?.message);
      }

      return {
        response,
        platformOptimized: true,
        crossPlatformContext,
        adaptations
      };

    } catch (error: any) {
      this.aiService?.['logger']?.error?.(`❌ Platform response generation failed for ${platform}`, {
        err: error?.message || String(error)
      });
      
      // Return fallback response
      return this.getFallbackPlatformResponse(platform, _context);
    }
  }

  /**
   * Adapt message style when customer switches platforms
   */
  public async adaptCrossPlatformMessage(
    originalMessage: string,
    fromPlatform: Platform,
    toPlatform: Platform,
    context: ConversationContext
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

    } catch (error: any) {
      this.aiService['logger']?.error('❌ Cross-platform adaptation failed', error);
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
      const sql = this.db.getSQL() as any;

      // Get customer interactions across platforms
      const interactions = await sql<InteractionRow>`
        SELECT 
          c.platform,
          c.conversation_stage,
          ml.message_type,
          ml.content,
          ml.direction,
          ml.created_at,
          ml.ai_processed
        FROM conversations c
        JOIN message_logs ml ON c.id = ml.conversation_id
        WHERE (c.customer_whatsapp = ${customerId} OR c.customer_instagram = ${customerId})
        AND c.merchant_id = ${merchantId}::uuid
        ORDER BY ml.created_at DESC
        LIMIT 100
      `;

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

    } catch (error: any) {
      console.error('❌ Conversation insights generation failed:', error?.message || String(error));
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
    try {
      const sql = this.db.getSQL() as any;

      const platformHistory = await sql<PlatformHistoryRow>`
        SELECT 
          platform,
          COUNT(*) as interaction_count,
          MAX(updated_at) as last_interaction,
          array_agg(DISTINCT conversation_stage) as stages
        FROM conversations
        WHERE (customer_whatsapp = ${customerId} OR customer_instagram = ${customerId})
        AND merchant_id = ${merchantId}::uuid
        GROUP BY platform
      `;

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
      const journeyStages = await sql<JourneyStageRow>`
        SELECT 
          platform,
          conversation_stage,
          created_at,
          'unknown' as intent
        FROM conversations
        WHERE (customer_whatsapp = ${customerId} OR customer_instagram = ${customerId})
        AND merchant_id = ${merchantId}::uuid
        ORDER BY created_at ASC
        LIMIT 20
      `;

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

    } catch (error: any) {
      console.error('❌ Error getting cross-platform context:', error?.message || String(error));
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
    context: ConversationContext,
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
    crossPlatformContext: CrossPlatformContext
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
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const total = interactions.length;
    
    return {
      whatsappPreference: ((platforms.whatsapp || 0) / total) * 100,
      instagramPreference: ((platforms.instagram || 0) / total) * 100,
      switchingFrequency: this.calculateSwitchingFrequency(interactions)
    };
  }

  /**
   * Private: Additional helper methods would be implemented here
   */
  private analyzeTimePreferences(_interactions: InteractionRow[]): string {
    // Implementation for time preference analysis
    return 'evening';
  }

  private analyzeResponsePatterns(_interactions: InteractionRow[]): any {
    // Implementation for response pattern analysis
    return {};
  }

  private analyzePurchaseIntent(_interactions: InteractionRow[]): number {
    // Implementation for purchase intent analysis
    return 0.7;
  }

  private analyzeConversationTrends(_interactions: InteractionRow[]): ConversationTrend[] {
    // Implementation for conversation trend analysis
    return [];
  }

  private calculateSwitchingFrequency(_interactions: InteractionRow[]): number {
    // Implementation for platform switching frequency calculation
    return 0.3;
  }

  private generateConversationRecommendations(
    profile: EnhancedCustomerProfile,
    preferences: PlatformPreferences,
    trends: ConversationTrend[]
  ): string[] {
    // Implementation for generating recommendations
    return ['Focus on Instagram engagement', 'Use more visual content'];
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
      const sql = this.db.getSQL() as any;
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
          'PLATFORM_AI_ORCHESTRATION',
          'AI_INTERACTION',
          ${JSON.stringify(safeDetails)},
          ${response.responseTime},
          true
        )
      `;
    } catch (error: any) {
      console.error('❌ Platform interaction logging failed:', error?.message || String(error));
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
    const fallback =
      platform === 'instagram'
        ? ({
            message: baseMsg,
            messageAr: baseMsg,
            intent: 'SUPPORT',
            stage: (context as any).stage,
            actions: [{ type: 'ESCALATE', data: { reason: 'AI_ERROR' }, priority: 1 }],
            products: [],
            confidence: 0.1,
            tokens: { prompt: 0, completion: 0, total: 0 },
            responseTime: 0,
            visualStyle: 'direct',
            engagement: { likelyToShare: false, viralPotential: 0, userGeneratedContent: false }
          } as InstagramAIResponse)
        : ({
            message: baseMsg, messageAr: baseMsg, intent: 'SUPPORT', stage: (context as any).stage,
            actions: [{ type: 'ESCALATE', data: { reason: 'AI_ERROR' }, priority: 1 }],
            products: [], confidence: 0.1, tokens: { prompt: 0, completion: 0, total: 0 }, responseTime: 0
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
  responsePatterns: any;
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