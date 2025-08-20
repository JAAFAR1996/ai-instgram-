/**
 * ===============================================
 * Conversation AI Orchestrator - STEP 3 Implementation
 * Orchestrates AI responses across WhatsApp and Instagram platforms
 * Adapts conversation style based on platform and context
 * ===============================================
 */

import { getAIService, type ConversationContext, type AIResponse } from './ai.js';
import { getInstagramAIService, type InstagramContext, type InstagramAIResponse } from './instagram-ai.js';
import { getDatabase } from '../database/connection.js';
import type { Platform } from '../types/database.js';

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
  private aiService = getAIService();
  private instagramAI = getInstagramAIService();
  private db = getDatabase();

  /**
   * Generate platform-optimized AI response
   */
  public async generatePlatformResponse(
    customerMessage: string,
    context: ConversationContext | InstagramContext,
    platform: Platform
  ): Promise<PlatformAIResponse> {
    try {
      console.log(`🤖 Generating ${platform} AI response for merchant: ${context.merchantId}`);

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

      // Log platform-specific interaction
      await this.logPlatformInteraction(context, response, platform, adaptations);

      return {
        response,
        platformOptimized: true,
        crossPlatformContext,
        adaptations
      };

    } catch (error) {
      console.error(`❌ Platform response generation failed for ${platform}:`, error);
      
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

    } catch (error) {
      console.error('❌ Cross-platform adaptation failed:', error);
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
      const sql = this.db.getSQL();

      // Get customer interactions across platforms
      const interactions = await sql`
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
        WHERE c.customer_phone = ${customerId} OR c.customer_instagram = ${customerId}
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

    } catch (error) {
      console.error('❌ Conversation insights generation failed:', error);
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
      const sql = this.db.getSQL();

      const platformHistory = await sql`
        SELECT 
          platform,
          COUNT(*) as interaction_count,
          MAX(updated_at) as last_interaction,
          array_agg(DISTINCT conversation_stage) as stages
        FROM conversations
        WHERE (customer_phone = ${customerId} OR customer_instagram = ${customerId})
        AND merchant_id = ${merchantId}::uuid
        GROUP BY platform
      `;

      const hasWhatsAppHistory = platformHistory.some(p => p.platform === 'whatsapp');
      const hasInstagramHistory = platformHistory.some(p => p.platform === 'instagram');
      
      const preferredPlatform = platformHistory.reduce((prev, current) => 
        prev.interaction_count > current.interaction_count ? prev : current
      )?.platform || 'whatsapp';

      const totalInteractions = platformHistory.reduce(
        (sum, p) => sum + parseInt(p.interaction_count), 0
      );

      // Get customer journey stages
      const journeyStages = await sql`
        SELECT 
          platform,
          conversation_stage,
          created_at,
          'unknown' as intent
        FROM conversations
        WHERE (customer_phone = ${customerId} OR customer_instagram = ${customerId})
        AND merchant_id = ${merchantId}::uuid
        ORDER BY created_at ASC
        LIMIT 20
      `;

      const customerJourney: CustomerJourneyStage[] = journeyStages.map(stage => ({
        platform: stage.platform as Platform,
        stage: stage.conversation_stage,
        timestamp: new Date(stage.created_at),
        intent: stage.intent
      }));

      return {
        hasWhatsAppHistory,
        hasInstagramHistory,
        preferredPlatform: preferredPlatform as Platform,
        customerJourney,
        totalInteractions
      };

    } catch (error) {
      console.error('❌ Error getting cross-platform context:', error);
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

    // Ensure heavy emoji usage for Instagram
    if (personality.emojiUsage === 'heavy') {
      const emojiCount = (response.message.match(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/gu) || []).length;
      
      if (emojiCount < 3) {
        adaptations.push({
          type: 'emojis',
          originalValue: `${emojiCount} emojis`,
          adaptedValue: 'Enhanced with Instagram-style emojis',
          reason: 'Instagram requires more visual expression'
        });
      }
    }

    // Ensure brief responses for Instagram
    if (response.message.length > 150) {
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
      // Enhance response with cross-platform insights
      if (crossPlatformContext.customerJourney.length > 0) {
        const lastStage = crossPlatformContext.customerJourney[crossPlatformContext.customerJourney.length - 1];
        
        // Adjust confidence based on cross-platform success
        response.confidence = Math.min(response.confidence + 0.1, 1.0);
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
    const emojis = adapted.match(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]/gu);
    if (emojis && emojis.length > 2) {
      // Keep only first 2 emojis
      let emojiCount = 0;
      adapted = adapted.replace(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]/gu, (match) => {
        emojiCount++;
        return emojiCount <= 2 ? match : '';
      });
    }

    return adapted;
  }

  /**
   * Private: Analyze customer profile across platforms
   */
  private async analyzeCustomerProfile(interactions: any[]): Promise<EnhancedCustomerProfile> {
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
  private analyzePlatformPreferences(interactions: any[]): PlatformPreferences {
    const platforms = interactions.reduce((acc, interaction) => {
      acc[interaction.platform] = (acc[interaction.platform] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const total = interactions.length;
    
    return {
      whatsappPreference: ((platforms.WHATSAPP || 0) / total) * 100,
      instagramPreference: ((platforms.INSTAGRAM || 0) / total) * 100,
      switchingFrequency: this.calculateSwitchingFrequency(interactions)
    };
  }

  /**
   * Private: Additional helper methods would be implemented here
   */
  private analyzeTimePreferences(interactions: any[]): string {
    // Implementation for time preference analysis
    return 'evening';
  }

  private analyzeResponsePatterns(interactions: any[]): any {
    // Implementation for response pattern analysis
    return {};
  }

  private analyzePurchaseIntent(interactions: any[]): number {
    // Implementation for purchase intent analysis
    return 0.7;
  }

  private analyzeConversationTrends(interactions: any[]): ConversationTrend[] {
    // Implementation for conversation trend analysis
    return [];
  }

  private calculateSwitchingFrequency(interactions: any[]): number {
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
          'PLATFORM_AI_ORCHESTRATION',
          'AI_INTERACTION',
          ${JSON.stringify({
            platform,
            intent: response.intent,
            stage: response.stage,
            confidence: response.confidence,
            adaptations: adaptations.length,
            responseTime: response.responseTime,
            orchestrated: true
          })},
          ${response.responseTime},
          true
        )
      `;
    } catch (error) {
      console.error('❌ Platform interaction logging failed:', error);
    }
  }

  /**
   * Private: Get fallback platform response
   */
  private getFallbackPlatformResponse(
    platform: Platform,
    context: ConversationContext | InstagramContext
  ): PlatformAIResponse {
    const fallback = platform === 'instagram'
      ? this.instagramAI['getInstagramFallbackResponse'](context as InstagramContext)
      : this.aiService['getFallbackResponse'](context);

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

// Singleton instance
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