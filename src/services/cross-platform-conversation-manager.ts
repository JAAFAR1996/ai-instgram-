/**
 * ===============================================
 * Cross-Platform Conversation Manager - STEP 5 Implementation
 * Unifies conversations across WhatsApp and Instagram platforms
 * Preserves context when customers switch between platforms
 * ===============================================
 */

import { getDatabase } from '../database/connection.js';
import { getConversationAIOrchestrator, type CrossPlatformContext } from './conversation-ai-orchestrator.js';
import type { Platform } from '../types/database.js';

export interface UnifiedCustomerProfile {
  customerId: string;
  masterCustomerId: string;
  whatsappNumber?: string;
  instagramUsername?: string;
  name?: string;
  preferredPlatform: Platform;
  totalInteractions: number;
  platforms: PlatformProfile[];
  unifiedContext: UnifiedConversationContext;
  lastActivity: Date;
  tags: string[];
}

export interface PlatformProfile {
  platform: Platform;
  identifier: string; // phone number or instagram username
  conversationCount: number;
  messageCount: number;
  averageResponseTime: number;
  preferredTime: string;
  lastSeen: Date;
  stage: string;
  context: Record<string, any>;
}

export interface UnifiedConversationContext {
  cart: CartItem[];
  preferences: CustomerPreferences;
  orderHistory: OrderSummary[];
  interests: string[];
  budget: { min?: number; max?: number; currency: string };
  urgency: 'low' | 'medium' | 'high';
  language: 'arabic' | 'kurdish' | 'english';
  location?: { city: string; area?: string };
}

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  addedAt: Date;
  platform: Platform;
  notes?: string;
}

export interface CustomerPreferences {
  categories: string[];
  brands: string[];
  priceRange: { min: number; max: number };
  style: string[];
  colors: string[];
  sizes: string[];
  deliveryPreference: 'home' | 'pickup' | 'both';
  paymentMethods: string[];
  notificationTime: 'morning' | 'afternoon' | 'evening' | 'anytime';
}

export interface OrderSummary {
  orderId: string;
  total: number;
  items: number;
  date: Date;
  platform: Platform;
  status: string;
}

export interface PlatformSwitchEvent {
  fromPlatform: Platform;
  toPlatform: Platform;
  timestamp: Date;
  contextPreserved: boolean;
  reason: 'customer_initiated' | 'merchant_redirect' | 'auto_follow';
  continuityScore: number; // 0-1, how well context was preserved
}

export interface ConversationMergeResult {
  success: boolean;
  mergedConversationId: string;
  sourceConversationIds: string[];
  contextTransferred: boolean;
  conflictsResolved: number;
  dataLoss: string[];
}

export class CrossPlatformConversationManager {
  private db = getDatabase();
  private aiOrchestrator = getConversationAIOrchestrator();

  /**
   * Get unified customer profile across all platforms
   */
  public async getUnifiedCustomerProfile(
    merchantId: string,
    identifier: { phone?: string; instagram?: string }
  ): Promise<UnifiedCustomerProfile | null> {
    try {
      const sql = this.db.getSQL();

      // Find all conversations for this customer across platforms
      const conversations = await sql`
        SELECT 
          c.*,
          COUNT(ml.id) as message_count,
          MAX(ml.created_at) as last_message_at,
          AVG(EXTRACT(EPOCH FROM (ml.created_at - LAG(ml.created_at) OVER (ORDER BY ml.created_at)))) as avg_response_time
        FROM conversations c
        LEFT JOIN message_logs ml ON c.id = ml.conversation_id
        WHERE c.merchant_id = ${merchantId}::uuid
        AND (
          (${identifier.phone} IS NOT NULL AND c.customer_phone = ${identifier.phone}) OR
          (${identifier.instagram} IS NOT NULL AND c.customer_instagram = ${identifier.instagram})
        )
        GROUP BY c.id
        ORDER BY c.updated_at DESC
      `;

      if (conversations.length === 0) {
        return null;
      }

      // Generate master customer ID (use oldest conversation ID as base)
      const masterCustomerId = conversations[conversations.length - 1].id;

      // Build platform profiles
      const platformProfiles: PlatformProfile[] = [];
      const allPlatforms = [...new Set(conversations.map(c => c.platform))];

      for (const platform of allPlatforms) {
        const platformConversations = conversations.filter(c => c.platform === platform);
        const totalMessages = platformConversations.reduce((sum, c) => sum + parseInt(c.message_count), 0);
        const avgResponseTime = platformConversations.reduce((sum, c) => sum + (c.avg_response_time || 0), 0) / platformConversations.length;

        const profile: PlatformProfile = {
          platform: platform as Platform,
          identifier: platform === 'whatsapp' 
            ? platformConversations[0]?.customer_phone || ''
            : platformConversations[0]?.customer_instagram || '',
          conversationCount: platformConversations.length,
          messageCount: totalMessages,
          averageResponseTime: Math.round(avgResponseTime || 0),
          preferredTime: await this.calculatePreferredTime(merchantId, platform as Platform, platformConversations[0]?.id),
          lastSeen: new Date(platformConversations[0]?.last_message_at || platformConversations[0]?.updated_at),
          stage: platformConversations[0]?.conversation_stage || 'GREETING',
          context: JSON.parse(platformConversations[0]?.session_data || '{}')
        };

        platformProfiles.push(profile);
      }

      // Build unified context by merging platform-specific contexts
      const unifiedContext = await this.buildUnifiedContext(conversations);

      // Determine preferred platform
      const preferredPlatform = platformProfiles.reduce((prev, current) => 
        prev.messageCount > current.messageCount ? prev : current
      ).platform;

      // Calculate total interactions
      const totalInteractions = platformProfiles.reduce((sum, p) => sum + p.messageCount, 0);

      // Generate customer tags based on behavior
      const tags = await this.generateCustomerTags(conversations, platformProfiles);

      const unifiedProfile: UnifiedCustomerProfile = {
        customerId: identifier.phone || identifier.instagram || '',
        masterCustomerId,
        whatsappNumber: identifier.phone,
        instagramUsername: identifier.instagram,
        name: conversations[0]?.customer_name,
        preferredPlatform,
        totalInteractions,
        platforms: platformProfiles,
        unifiedContext,
        lastActivity: new Date(Math.max(...platformProfiles.map(p => p.lastSeen.getTime()))),
        tags
      };

      console.log(`📊 Unified profile created for customer with ${totalInteractions} interactions across ${platformProfiles.length} platforms`);
      
      return unifiedProfile;

    } catch (error) {
      console.error('❌ Failed to build unified customer profile:', error);
      return null;
    }
  }

  /**
   * Handle customer platform switch with context preservation
   */
  public async handlePlatformSwitch(
    merchantId: string,
    fromIdentifier: { platform: Platform; id: string },
    toIdentifier: { platform: Platform; id: string },
    reason: 'customer_initiated' | 'merchant_redirect' | 'auto_follow' = 'customer_initiated'
  ): Promise<PlatformSwitchEvent> {
    try {
      console.log(`🔄 Handling platform switch: ${fromIdentifier.platform} → ${toIdentifier.platform}`);

      const sql = this.db.getSQL();
      const timestamp = new Date();

      // Get source conversation context
      const sourceConversation = await this.getLatestConversation(
        merchantId, 
        fromIdentifier.platform, 
        fromIdentifier.id
      );

      if (!sourceConversation) {
        throw new Error('Source conversation not found');
      }

      // Create or update target conversation
      const targetConversation = await this.createOrUpdateTargetConversation(
        merchantId,
        toIdentifier,
        sourceConversation
      );

      // Transfer context between platforms
      const contextTransferResult = await this.transferContext(
        sourceConversation,
        targetConversation,
        fromIdentifier.platform,
        toIdentifier.platform
      );

      // Calculate continuity score
      const continuityScore = this.calculateContinuityScore(
        sourceConversation.session_data,
        targetConversation.session_data,
        contextTransferResult
      );

      // Log the platform switch
      await sql`
        INSERT INTO platform_switches (
          merchant_id,
          from_platform,
          to_platform,
          from_identifier,
          to_identifier,
          from_conversation_id,
          to_conversation_id,
          reason,
          context_preserved,
          continuity_score,
          switch_timestamp
        ) VALUES (
          ${merchantId}::uuid,
          ${fromIdentifier.platform},
          ${toIdentifier.platform},
          ${fromIdentifier.id},
          ${toIdentifier.id},
          ${sourceConversation.id}::uuid,
          ${targetConversation.id}::uuid,
          ${reason},
          ${contextTransferResult.success},
          ${continuityScore},
          ${timestamp}
        )
      `;

      const switchEvent: PlatformSwitchEvent = {
        fromPlatform: fromIdentifier.platform,
        toPlatform: toIdentifier.platform,
        timestamp,
        contextPreserved: contextTransferResult.success,
        reason,
        continuityScore
      };

      console.log(`✅ Platform switch completed with ${(continuityScore * 100).toFixed(1)}% continuity`);
      
      return switchEvent;

    } catch (error) {
      console.error('❌ Platform switch handling failed:', error);
      
      return {
        fromPlatform: fromIdentifier.platform,
        toPlatform: toIdentifier.platform,
        timestamp: new Date(),
        contextPreserved: false,
        reason,
        continuityScore: 0
      };
    }
  }

  /**
   * Merge conversations from different platforms for the same customer
   */
  public async mergeCustomerConversations(
    merchantId: string,
    customerIdentifiers: { phone?: string; instagram?: string },
    options?: {
      preservePlatformSpecificData?: boolean;
      mergeStrategy?: 'latest_wins' | 'most_complete' | 'manual_review';
    }
  ): Promise<ConversationMergeResult> {
    try {
      console.log('🔗 Merging customer conversations across platforms...');

      const sql = this.db.getSQL();
      const mergeStrategy = options?.mergeStrategy || 'most_complete';

      // Find all conversations for this customer
      const conversations = await sql`
        SELECT c.*, COUNT(ml.id) as message_count
        FROM conversations c
        LEFT JOIN message_logs ml ON c.id = ml.conversation_id
        WHERE c.merchant_id = ${merchantId}::uuid
        AND (
          (${customerIdentifiers.phone} IS NOT NULL AND c.customer_phone = ${customerIdentifiers.phone}) OR
          (${customerIdentifiers.instagram} IS NOT NULL AND c.customer_instagram = ${customerIdentifiers.instagram})
        )
        GROUP BY c.id
        ORDER BY c.updated_at DESC
      `;

      if (conversations.length <= 1) {
        return {
          success: true,
          mergedConversationId: conversations[0]?.id || '',
          sourceConversationIds: [],
          contextTransferred: true,
          conflictsResolved: 0,
          dataLoss: []
        };
      }

      // Select primary conversation based on strategy
      const primaryConversation = this.selectPrimaryConversation(conversations, mergeStrategy);
      const secondaryConversations = conversations.filter(c => c.id !== primaryConversation.id);

      // Merge contexts
      const mergedContext = await this.mergeConversationContexts(
        [primaryConversation, ...secondaryConversations]
      );

      // Update primary conversation with merged context
      await sql`
        UPDATE conversations 
        SET 
          session_data = ${JSON.stringify(mergedContext)},
          updated_at = NOW()
        WHERE id = ${primaryConversation.id}::uuid
      `;

      // Transfer messages from secondary conversations
      for (const secondaryConv of secondaryConversations) {
        await sql`
          UPDATE message_logs 
          SET conversation_id = ${primaryConversation.id}::uuid
          WHERE conversation_id = ${secondaryConv.id}::uuid
        `;

        // Mark secondary conversation as merged
        await sql`
          UPDATE conversations 
          SET 
            conversation_stage = 'MERGED',
            session_data = jsonb_set(
              COALESCE(session_data, '{}'),
              '{merged_into}',
              to_jsonb(${primaryConversation.id})
            )
          WHERE id = ${secondaryConv.id}::uuid
        `;
      }

      // Log merge operation
      await sql`
        INSERT INTO audit_logs (
          merchant_id,
          action,
          entity_type,
          details,
          success
        ) VALUES (
          ${merchantId}::uuid,
          'CONVERSATIONS_MERGED',
          'CONVERSATION',
          ${JSON.stringify({
            primaryConversationId: primaryConversation.id,
            secondaryConversationIds: secondaryConversations.map(c => c.id),
            mergeStrategy,
            contextFields: Object.keys(mergedContext),
            timestamp: new Date().toISOString()
          })},
          true
        )
      `;

      console.log(`✅ Merged ${secondaryConversations.length} conversations into primary conversation`);

      return {
        success: true,
        mergedConversationId: primaryConversation.id,
        sourceConversationIds: secondaryConversations.map(c => c.id),
        contextTransferred: true,
        conflictsResolved: secondaryConversations.length,
        dataLoss: []
      };

    } catch (error) {
      console.error('❌ Conversation merge failed:', error);
      return {
        success: false,
        mergedConversationId: '',
        sourceConversationIds: [],
        contextTransferred: false,
        conflictsResolved: 0,
        dataLoss: [error instanceof Error ? error.message : 'Unknown error']
      };
    }
  }

  /**
   * Get customer journey across platforms
   */
  public async getCustomerJourney(
    merchantId: string,
    customerIdentifiers: { phone?: string; instagram?: string },
    timeRange?: { start: Date; end: Date }
  ): Promise<{
    stages: JourneyStage[];
    platformSwitches: PlatformSwitchEvent[];
    totalDuration: number;
    conversionEvents: ConversionEvent[];
    insights: JourneyInsight[];
  }> {
    try {
      const sql = this.db.getSQL();

      // Build time range filter
      const timeFilter = timeRange ? 
        sql`AND ml.created_at BETWEEN ${timeRange.start.toISOString()} AND ${timeRange.end.toISOString()}` : 
        sql`AND ml.created_at >= NOW() - INTERVAL '30 days'`;

      // Get journey stages
      const journeyData = await sql`
        SELECT 
          c.platform,
          c.conversation_stage,
          ml.created_at,
          ml.direction,
          ml.content,
          ml.ai_intent,
          c.session_data
        FROM conversations c
        JOIN message_logs ml ON c.id = ml.conversation_id
        WHERE c.merchant_id = ${merchantId}::uuid
        AND (
          (${customerIdentifiers.phone} IS NOT NULL AND c.customer_phone = ${customerIdentifiers.phone}) OR
          (${customerIdentifiers.instagram} IS NOT NULL AND c.customer_instagram = ${customerIdentifiers.instagram})
        )
        ${timeFilter}
        ORDER BY ml.created_at ASC
      `;

      // Build journey stages
      const stages: JourneyStage[] = journeyData.map(item => ({
        platform: item.platform as Platform,
        stage: item.conversation_stage,
        timestamp: new Date(item.created_at),
        direction: item.direction,
        content: item.content,
        intent: item.ai_intent,
        context: JSON.parse(item.session_data || '{}')
      }));

      // Get platform switches
      const platformSwitches = await this.getPlatformSwitches(merchantId, customerIdentifiers, timeRange);

      // Detect conversion events
      const conversionEvents = this.detectConversionEvents(stages);

      // Generate insights
      const insights = this.generateJourneyInsights(stages, platformSwitches, conversionEvents);

      // Calculate total duration
      const totalDuration = stages.length > 0 ? 
        stages[stages.length - 1].timestamp.getTime() - stages[0].timestamp.getTime() : 0;

      return {
        stages,
        platformSwitches,
        totalDuration,
        conversionEvents,
        insights
      };

    } catch (error) {
      console.error('❌ Failed to get customer journey:', error);
      return {
        stages: [],
        platformSwitches: [],
        totalDuration: 0,
        conversionEvents: [],
        insights: []
      };
    }
  }

  /**
   * Recommend optimal platform for customer engagement
   */
  public async recommendOptimalPlatform(
    merchantId: string,
    customerProfile: UnifiedCustomerProfile,
    messageType: 'text' | 'media' | 'template' | 'urgent',
    timeOfDay?: 'morning' | 'afternoon' | 'evening'
  ): Promise<{
    recommendedPlatform: Platform;
    confidence: number;
    reasons: string[];
    alternativePlatform?: Platform;
  }> {
    try {
      // Analyze customer's platform usage patterns
      const platformAnalysis = this.analyzePlatformPreferences(customerProfile);

      // Consider message type appropriateness
      const messageTypeScores = {
        WHATSAPP: this.getWhatsAppMessageScore(messageType, customerProfile),
        INSTAGRAM: this.getInstagramMessageScore(messageType, customerProfile)
      };

      // Consider time-based preferences
      const timeBasedScores = timeOfDay ? 
        await this.getTimeBasedPlatformPreferences(merchantId, customerProfile.customerId, timeOfDay) :
        { WHATSAPP: 0.5, INSTAGRAM: 0.5 };

      // Calculate final scores
      const finalScores = {
        WHATSAPP: (platformAnalysis.whatsappScore * 0.4) + (messageTypeScores.WHATSAPP * 0.4) + (timeBasedScores.WHATSAPP * 0.2),
        INSTAGRAM: (platformAnalysis.instagramScore * 0.4) + (messageTypeScores.INSTAGRAM * 0.4) + (timeBasedScores.INSTAGRAM * 0.2)
      };

      const recommendedPlatform: Platform = finalScores.WHATSAPP > finalScores.INSTAGRAM ? 'whatsapp' : 'instagram';
      const confidence = Math.max(finalScores.WHATSAPP, finalScores.INSTAGRAM);
      const alternativePlatform: Platform = recommendedPlatform === 'whatsapp' ? 'instagram' : 'whatsapp';

      // Generate reasons
      const reasons = this.generateRecommendationReasons(
        recommendedPlatform,
        customerProfile,
        messageType,
        platformAnalysis
      );

      console.log(`🎯 Platform recommendation: ${recommendedPlatform} (${(confidence * 100).toFixed(1)}% confidence)`);

      return {
        recommendedPlatform,
        confidence,
        reasons,
        alternativePlatform
      };

    } catch (error) {
      console.error('❌ Platform recommendation failed:', error);
      return {
        recommendedPlatform: customerProfile.preferredPlatform,
        confidence: 0.5,
        reasons: ['Using customer\'s preferred platform as fallback'],
        alternativePlatform: customerProfile.preferredPlatform === 'whatsapp' ? 'instagram' : 'whatsapp'
      };
    }
  }

  /**
   * Private: Build unified context from multiple conversations
   */
  private async buildUnifiedContext(conversations: any[]): Promise<UnifiedConversationContext> {
    const contexts = conversations.map(c => JSON.parse(c.session_data || '{}'));
    
    // Merge cart items from all platforms
    const allCartItems: CartItem[] = [];
    contexts.forEach((ctx, index) => {
      if (ctx.cart) {
        ctx.cart.forEach((item: any) => {
          allCartItems.push({
            ...item,
            platform: conversations[index].platform,
            addedAt: new Date(item.addedAt || conversations[index].created_at)
          });
        });
      }
    });

    // Merge preferences (latest wins for conflicts)
    const mergedPreferences: CustomerPreferences = contexts.reduce((merged, ctx) => {
      if (ctx.preferences) {
        return { ...merged, ...ctx.preferences };
      }
      return merged;
    }, {
      categories: [],
      brands: [],
      priceRange: { min: 0, max: 1000000 },
      style: [],
      colors: [],
      sizes: [],
      deliveryPreference: 'both',
      paymentMethods: [],
      notificationTime: 'anytime'
    });

    // Extract interests from conversation content
    const interests = [...new Set(contexts.flatMap(ctx => ctx.interests || []))];

    return {
      cart: allCartItems,
      preferences: mergedPreferences,
      orderHistory: [], // Would be populated from order system
      interests,
      budget: contexts.find(ctx => ctx.budget)?.budget || { currency: 'IQD' },
      urgency: contexts.find(ctx => ctx.urgency)?.urgency || 'medium',
      language: 'arabic',
      location: contexts.find(ctx => ctx.location)?.location
    };
  }

  /**
   * Private: Additional helper methods would be implemented here
   */
  private async calculatePreferredTime(merchantId: string, platform: Platform, conversationId: string): Promise<string> {
    // Implementation for calculating preferred interaction time
    return 'evening';
  }

  private async generateCustomerTags(conversations: any[], platformProfiles: PlatformProfile[]): Promise<string[]> {
    const tags: string[] = [];
    
    // Multi-platform user
    if (platformProfiles.length > 1) {
      tags.push('multi-platform');
    }

    // High engagement
    const totalMessages = platformProfiles.reduce((sum, p) => sum + p.messageCount, 0);
    if (totalMessages > 50) {
      tags.push('high-engagement');
    } else if (totalMessages > 20) {
      tags.push('medium-engagement');
    }

    // Platform preferences
    if (platformProfiles.some(p => p.platform === 'instagram' && p.messageCount > 10)) {
      tags.push('instagram-active');
    }
    if (platformProfiles.some(p => p.platform === 'whatsapp' && p.messageCount > 10)) {
      tags.push('whatsapp-active');
    }

    return tags;
  }

  private async getLatestConversation(merchantId: string, platform: Platform, identifier: string): Promise<any> {
    const sql = this.db.getSQL();
    
    const conversations = await sql`
      SELECT * FROM conversations
      WHERE merchant_id = ${merchantId}::uuid
      AND platform = ${platform}
      AND (
        (${platform} = 'whatsapp' AND customer_phone = ${identifier}) OR
        (${platform} = 'instagram' AND customer_instagram = ${identifier})
      )
      ORDER BY updated_at DESC
      LIMIT 1
    `;

    return conversations[0] || null;
  }

  private async createOrUpdateTargetConversation(
    merchantId: string,
    targetIdentifier: { platform: Platform; id: string },
    sourceConversation: any
  ): Promise<any> {
    const sql = this.db.getSQL();

    // Check if target conversation already exists
    const existing = await this.getLatestConversation(merchantId, targetIdentifier.platform, targetIdentifier.id);
    
    if (existing) {
      return existing;
    }

    // Create new conversation
    const result = await sql`
      INSERT INTO conversations (
        merchant_id,
        customer_phone,
        customer_instagram,
        customer_name,
        platform,
        conversation_stage,
        session_data
      ) VALUES (
        ${merchantId}::uuid,
        ${targetIdentifier.platform === 'whatsapp' ? targetIdentifier.id : null},
        ${targetIdentifier.platform === 'instagram' ? targetIdentifier.id : null},
        ${sourceConversation.customer_name},
        ${targetIdentifier.platform},
        ${sourceConversation.conversation_stage},
        ${sourceConversation.session_data}
      ) RETURNING *
    `;

    return result[0];
  }

  private async transferContext(
    sourceConversation: any,
    targetConversation: any,
    fromPlatform: Platform,
    toPlatform: Platform
  ): Promise<{ success: boolean; transferredFields: string[] }> {
    try {
      const sourceContext = JSON.parse(sourceConversation.session_data || '{}');
      const targetContext = JSON.parse(targetConversation.session_data || '{}');

      // Merge contexts intelligently
      const mergedContext = {
        ...targetContext,
        ...sourceContext,
        platformTransfer: {
          from: fromPlatform,
          to: toPlatform,
          transferredAt: new Date().toISOString()
        }
      };

      const sql = this.db.getSQL();
      await sql`
        UPDATE conversations 
        SET session_data = ${JSON.stringify(mergedContext)}
        WHERE id = ${targetConversation.id}::uuid
      `;

      return {
        success: true,
        transferredFields: Object.keys(sourceContext)
      };
    } catch (error) {
      console.error('❌ Context transfer failed:', error);
      return {
        success: false,
        transferredFields: []
      };
    }
  }

  private calculateContinuityScore(
    sourceData: string,
    targetData: string,
    transferResult: { success: boolean; transferredFields: string[] }
  ): number {
    if (!transferResult.success) return 0;

    try {
      const sourceContext = JSON.parse(sourceData || '{}');
      const targetContext = JSON.parse(targetData || '{}');

      const sourceFields = Object.keys(sourceContext);
      const preservedFields = transferResult.transferredFields;

      if (sourceFields.length === 0) return 1; // Nothing to preserve

      return preservedFields.length / sourceFields.length;
    } catch {
      return 0.5; // Partial success if parsing fails
    }
  }

  private selectPrimaryConversation(conversations: any[], strategy: string): any {
    switch (strategy) {
      case 'latest_wins':
        return conversations[0]; // Already sorted by updated_at DESC
      case 'most_complete':
        return conversations.reduce((prev, current) => 
          parseInt(current.message_count) > parseInt(prev.message_count) ? current : prev
        );
      default:
        return conversations[0];
    }
  }

  private async mergeConversationContexts(conversations: any[]): Promise<any> {
    const mergedContext: any = {
      cart: [],
      preferences: {},
      context: {},
      mergedFrom: conversations.map(c => ({
        id: c.id,
        platform: c.platform,
        mergedAt: new Date().toISOString()
      }))
    };

    for (const conversation of conversations) {
      let session;
      try {
        session = typeof conversation.session_data === 'string'
          ? JSON.parse(conversation.session_data)
          : conversation.session_data || {};
      } catch (error) {
        console.error('❌ Failed to parse session data for conversation', conversation.id, error);
        session = {};
      }

      // Merge cart items
      if (session.cart) {
        mergedContext.cart.push(...session.cart);
      }

      // Merge preferences (later conversations override earlier ones)
      if (session.preferences) {
        mergedContext.preferences = { ...mergedContext.preferences, ...session.preferences };
      }

      // Merge other context
      if (session.context) {
        mergedContext.context = { ...mergedContext.context, ...session.context };
      }
    }

    return mergedContext;
  }

  private async getPlatformSwitches(
    merchantId: string,
    customerIdentifiers: { phone?: string; instagram?: string },
    timeRange?: { start: Date; end: Date }
  ): Promise<PlatformSwitchEvent[]> {
    try {
      const sql = this.db.getSQL();
      
      const timeFilter = timeRange
        ? sql`AND switch_timestamp BETWEEN ${timeRange.start.toISOString()} AND ${timeRange.end.toISOString()}`
        : sql``;

      const switches = await sql`
        SELECT * FROM platform_switches
        WHERE merchant_id = ${merchantId}::uuid
        AND (
          (${customerIdentifiers.phone} IS NOT NULL AND 
           (from_identifier = ${customerIdentifiers.phone} OR to_identifier = ${customerIdentifiers.phone})) OR
          (${customerIdentifiers.instagram} IS NOT NULL AND 
           (from_identifier = ${customerIdentifiers.instagram} OR to_identifier = ${customerIdentifiers.instagram}))
        )
        ${timeFilter}
        ORDER BY switch_timestamp ASC
      `;

      return switches.map(s => ({
        fromPlatform: s.from_platform as Platform,
        toPlatform: s.to_platform as Platform,
        timestamp: new Date(s.switch_timestamp),
        contextPreserved: s.context_preserved,
        reason: s.reason,
        continuityScore: s.continuity_score
      }));
    } catch (error) {
      console.error('❌ Failed to get platform switches:', error);
      return [];
    }
  }

  private detectConversionEvents(stages: JourneyStage[]): ConversionEvent[] {
    // Implementation for detecting conversion events (purchases, inquiries, etc.)
    return [];
  }

  private generateJourneyInsights(
    stages: JourneyStage[],
    switches: PlatformSwitchEvent[],
    conversions: ConversionEvent[]
  ): JourneyInsight[] {
    // Implementation for generating journey insights
    return [];
  }

  private analyzePlatformPreferences(profile: UnifiedCustomerProfile): {
    whatsappScore: number;
    instagramScore: number;
  } {
    const whatsappProfile = profile.platforms.find(p => p.platform === 'whatsapp');
    const instagramProfile = profile.platforms.find(p => p.platform === 'instagram');

    const whatsappScore = whatsappProfile ? 
      (whatsappProfile.messageCount / profile.totalInteractions) : 0;
    const instagramScore = instagramProfile ? 
      (instagramProfile.messageCount / profile.totalInteractions) : 0;

    return { whatsappScore, instagramScore };
  }

  private getWhatsAppMessageScore(messageType: string, profile: UnifiedCustomerProfile): number {
    // WhatsApp is better for detailed, formal communications
    const scores = {
      text: 0.8,
      media: 0.6,
      template: 0.9,
      urgent: 0.9
    };
    return scores[messageType as keyof typeof scores] || 0.5;
  }

  private getInstagramMessageScore(messageType: string, profile: UnifiedCustomerProfile): number {
    // Instagram is better for visual, casual communications
    const scores = {
      text: 0.6,
      media: 0.9,
      template: 0.7,
      urgent: 0.4
    };
    return scores[messageType as keyof typeof scores] || 0.5;
  }

  private async getTimeBasedPlatformPreferences(
    merchantId: string,
    customerId: string,
    timeOfDay: string
  ): Promise<{ WHATSAPP: number; INSTAGRAM: number }> {
    // Implementation for time-based platform preferences
    return { WHATSAPP: 0.5, INSTAGRAM: 0.5 };
  }

  private generateRecommendationReasons(
    platform: Platform,
    profile: UnifiedCustomerProfile,
    messageType: string,
    analysis: { whatsappScore: number; instagramScore: number }
  ): string[] {
    const reasons: string[] = [];

    if (platform === 'whatsapp') {
      if (analysis.whatsappScore > 0.6) {
        reasons.push('Customer prefers WhatsApp communication');
      }
      if (messageType === 'urgent') {
        reasons.push('WhatsApp is better for urgent messages');
      }
      if (messageType === 'template') {
        reasons.push('WhatsApp supports rich template messages');
      }
    } else {
      if (analysis.instagramScore > 0.6) {
        reasons.push('Customer is more active on Instagram');
      }
      if (messageType === 'media') {
        reasons.push('Instagram is optimal for visual content');
      }
      if (profile.tags.includes('instagram-active')) {
        reasons.push('Customer shows high Instagram engagement');
      }
    }

    return reasons;
  }
}

// Additional interfaces
interface JourneyStage {
  platform: Platform;
  stage: string;
  timestamp: Date;
  direction: string;
  content: string;
  intent?: string;
  context: any;
}

interface ConversionEvent {
  type: 'inquiry' | 'order' | 'payment' | 'review';
  timestamp: Date;
  platform: Platform;
  value?: number;
  details: any;
}

interface JourneyInsight {
  type: 'pattern' | 'preference' | 'opportunity' | 'risk';
  message: string;
  confidence: number;
  actionable: boolean;
}

// Singleton instance
let crossPlatformManagerInstance: CrossPlatformConversationManager | null = null;

/**
 * Get cross-platform conversation manager instance
 */
export function getCrossPlatformConversationManager(): CrossPlatformConversationManager {
  if (!crossPlatformManagerInstance) {
    crossPlatformManagerInstance = new CrossPlatformConversationManager();
  }
  return crossPlatformManagerInstance;
}

export default CrossPlatformConversationManager;