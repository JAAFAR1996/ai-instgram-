/**
 * ===============================================
 * Cross-Platform Conversation Manager - STEP 5 Implementation
 * Unifies conversations across WhatsApp and Instagram platforms
 * Preserves context when customers switch between platforms
 * ===============================================
 */

import { getDatabase } from '../db/adapter.js';
// ✅ تم إزالة DBRow لأنه غير مستخدم في هذا الملف
import type { 
  ConversationSession,
  UnifiedConversationContext,
  CustomerPreferences,
  CartItem
} from '../types/conversations.js';
import type { ConversationRow } from '../types/database-rows.js';
import { emptyPreferences } from '../types/conversations.js';
import { toInt } from '../types/common.js';
import type { Platform } from '../types/database.js';
import type { Sql, SqlFragment } from '../types/sql.js';
import { logger } from './logger.js';
import { must } from '../utils/safety.js';

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
  context: Record<string, unknown>;
}

// Using imported UnifiedConversationContext from conversations.ts

// CartItem interface moved to conversations.ts for consistency

// Using imported CustomerPreferences from conversations.ts

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

  private static jsonParseSafe<T = unknown>(v: unknown, fallback: T): T {
    try {
      if (typeof v === 'string') return JSON.parse(v) as T;
      if (v && typeof v === 'object') return v as T;
      return fallback;
    } catch {
      return fallback;
    }
  }

  /**
   * Get unified customer profile across all platforms
   */
  public async getUnifiedCustomerProfile(
    merchantId: string,
    identifier: { phone?: string; instagram?: string }
  ): Promise<UnifiedCustomerProfile | null> {
    try {
      const sql: Sql = this.db.getSQL();
      // ✅ Parameterized conditions (بدون string concatenation)
      const whereParts: SqlFragment[] = [sql`c.merchant_id = ${merchantId}::uuid`];
      if (identifier.phone) whereParts.push(sql`c.customer_phone = ${identifier.phone}`);
      if (identifier.instagram) whereParts.push(sql`c.customer_instagram = ${identifier.instagram}`);

      const conversations = await sql<{
        id: string;
        customer_name: string;
        customer_phone: string;
        customer_instagram: string;
        platform: string;
        conversation_stage: string;
        session_data: string;
        created_at: string;
        updated_at: string;
        message_count: string;
        last_message_at: string;
        avg_response_time: number;
      }>`
        SELECT
          c.*,
          COUNT(ml.id) AS message_count,
          MAX(ml.created_at) AS last_message_at,
          /* ✅ احسب الفاصل الزمني داخل كل محادثة فقط */
          AVG(
            EXTRACT(
              EPOCH FROM (
                ml.created_at - LAG(ml.created_at) OVER (PARTITION BY c.id ORDER BY ml.created_at)
              )
            )
          ) AS avg_response_time
        FROM conversations c
        LEFT JOIN message_logs ml ON c.id = ml.conversation_id
        WHERE ${whereParts.join(' AND ')}
        GROUP BY c.id
        ORDER BY c.updated_at DESC
      `;

      if (conversations.length === 0) {
        return null;
      }

      // Generate master customer ID (use oldest conversation ID as base)
      const last = conversations[conversations.length - 1];
      if (!last) throw new Error('No conversations');
      const masterCustomerId = last.id;

      // Build platform profiles
      const platformProfiles: PlatformProfile[] = [];
      const allPlatforms = [...new Set(conversations.map(c => c.platform))];

      for (const platform of allPlatforms) {
        const platformConversations = conversations.filter(c => c.platform === platform);
        const totalMessages = platformConversations.reduce((sum, c) => sum + parseInt(c.message_count), 0);
        const avgResponseTimeRaw = platformConversations.reduce((sum, c) => sum + (c.avg_response_time || 0), 0) / Math.max(1, platformConversations.length);
        const avgResponseTime = Number.isFinite(avgResponseTimeRaw) ? Math.max(0, Math.round(avgResponseTimeRaw)) : 0;

        const profile: PlatformProfile = {
          platform: platform as Platform,
          identifier: platform === 'whatsapp' 
            ? platformConversations[0]?.customer_phone ?? ''
            : platformConversations[0]?.customer_instagram ?? '',
          conversationCount: platformConversations.length,
          messageCount: totalMessages,
          averageResponseTime: Math.round(Number.isFinite(avgResponseTime) ? (avgResponseTime || 0) : 0),
          preferredTime: await this.calculatePreferredTime(),
          lastSeen: new Date(platformConversations[0]?.last_message_at || platformConversations[0]?.updated_at || new Date().toISOString()),
          stage: platformConversations[0]?.conversation_stage || 'GREETING',
          context: CrossPlatformConversationManager.jsonParseSafe(platformConversations[0]?.session_data, {} as Record<string, unknown>)
        };

        platformProfiles.push(profile);
      }

      // Build unified context by merging platform-specific contexts
      const unifiedContext = await this.buildUnifiedContext(conversations);

      // Determine preferred platform
      const preferredPlatform = platformProfiles.length
        ? platformProfiles.reduce((prev, current) => prev.messageCount > current.messageCount ? prev : current).platform
        : 'whatsapp';

      // Calculate total interactions
      const totalInteractions = platformProfiles.reduce((sum, p) => sum + p.messageCount, 0);

      // Generate customer tags based on behavior
      const tags = await this.generateCustomerTags(conversations, platformProfiles);

      const unifiedProfile: UnifiedCustomerProfile = {
        customerId: identifier.phone || identifier.instagram ?? '',
        masterCustomerId,
        whatsappNumber: identifier.phone ?? '',
        instagramUsername: identifier.instagram ?? '',
        name: conversations[0]?.customer_name ?? '',
        preferredPlatform,
        totalInteractions,
        platforms: platformProfiles,
        unifiedContext,
        lastActivity: new Date(Math.max(...platformProfiles.map(p => p.lastSeen.getTime()))),
        tags
      };

      logger.info(`📊 Unified profile created for customer with ${totalInteractions} interactions across ${platformProfiles.length} platforms`);
      
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
      logger.info(`🔄 Handling platform switch: ${fromIdentifier.platform} → ${toIdentifier.platform}`);

      const sql: Sql = this.db.getSQL();
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

      logger.info(`✅ Platform switch completed with ${(continuityScore * 100).toFixed(1)}% continuity`);
      
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
      logger.info('🔗 Merging customer conversations across platforms...');

      const sql: Sql = this.db.getSQL();
      const mergeStrategy = options?.mergeStrategy || 'most_complete';
      const whereMerge: SqlFragment[] = [sql`c.merchant_id = ${merchantId}::uuid`];
      if (customerIdentifiers.phone) whereMerge.push(sql`c.customer_phone = ${customerIdentifiers.phone}`);
      if (customerIdentifiers.instagram) whereMerge.push(sql`c.customer_instagram = ${customerIdentifiers.instagram}`);
      const conversations = await sql<{
        id: string;
        message_count: string;
        customer_name: string;
        platform: string;
        updated_at: string;
        session_data: string;
      }>`
        SELECT c.*, COUNT(ml.id) AS message_count
        FROM conversations c
        LEFT JOIN message_logs ml ON c.id = ml.conversation_id
        WHERE ${whereMerge.join(' AND ')}
        GROUP BY c.id
        ORDER BY c.updated_at DESC
      `;

      if (conversations.length <= 1) {
        return {
          success: true,
          mergedConversationId: conversations[0]?.id ?? '',
          sourceConversationIds: [],
          contextTransferred: true,
          conflictsResolved: 0,
          dataLoss: []
        };
      }

      // Select primary conversation based on strategy
      const primaryConversation = this.selectPrimaryConversation(conversations as ConversationRow[], mergeStrategy);
      const secondaryConversations = conversations.filter(c => c.id !== primaryConversation.id) as ConversationRow[];

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

      logger.info(`✅ Merged ${secondaryConversations.length} conversations into primary conversation`);

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
      const sql: Sql = this.db.getSQL();
      const cjWhere: SqlFragment[] = [sql`c.merchant_id = ${merchantId}::uuid`];
      if (customerIdentifiers.phone) cjWhere.push(sql`c.customer_phone = ${customerIdentifiers.phone}`);
      if (customerIdentifiers.instagram) cjWhere.push(sql`c.customer_instagram = ${customerIdentifiers.instagram}`);
      const timeFilter = timeRange
        ? sql`AND ml.created_at BETWEEN ${timeRange.start} AND ${timeRange.end}`
        : sql`AND ml.created_at >= NOW() - INTERVAL '30 days'`;
      const journeyData = await sql<{
        platform: string;
        conversation_stage: string;
        created_at: string;
        direction: string;
        content: string;
        ai_intent: string;
        session_data: string;
      }>`
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
        WHERE ${cjWhere.join(' AND ')}
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
        context: CrossPlatformConversationManager.jsonParseSafe(item.session_data, {} as Record<string, unknown>)
      }));

      // Get platform switches
      const platformSwitches = await this.getPlatformSwitches(merchantId, customerIdentifiers, timeRange);

      // Detect conversion events
      const conversionEvents = this.detectConversionEvents(stages);

      // Generate insights
      const insights = this.generateJourneyInsights(stages, platformSwitches, conversionEvents);

      // Calculate total duration
      const totalDuration = stages.length > 1
        ? stages[stages.length - 1]!.timestamp.getTime() - stages[0]!.timestamp.getTime()
        : 0;

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
    customerProfile: UnifiedCustomerProfile,
    messageType: 'text' | 'media' | 'template' | 'urgent'
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
        WHATSAPP: this.getWhatsAppMessageScore(messageType),
        INSTAGRAM: this.getInstagramMessageScore(messageType)
      };

      // Consider time-based preferences
      const timeBasedScores = await this.getTimeBasedPlatformPreferences();

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

      logger.info(`🎯 Platform recommendation: ${recommendedPlatform} (${(confidence * 100).toFixed(1)}% confidence)`);

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
  private async buildUnifiedContext(conversations: Array<{ platform: string; created_at: string; session_data: string }>): Promise<UnifiedConversationContext> {
    const contexts = conversations.map(c => CrossPlatformConversationManager.jsonParseSafe<ConversationSession>(c.session_data, {} as ConversationSession));
    
    // Merge cart items from all platforms
    const allCartItems: CartItem[] = [];
    contexts.forEach((ctx, index) => {
      // تطبيع آمن لعناصر السلة بغض النظر عن النوع القادم
      const rawCart: unknown =
        (ctx as { cart?: unknown }).cart ?? [];
      const items: unknown[] = Array.isArray(rawCart) ? rawCart : [];
      items.forEach((it) => {
        const c = it as Partial<CartItem>;
        if (
          c &&
          typeof c.productId === 'string' &&
          typeof c.name === 'string' &&
          typeof c.price === 'number' &&
          typeof c.quantity === 'number'
        ) {
          allCartItems.push({
            ...c as CartItem,
            platform: conversations[index]!.platform as Platform,
            addedAt: new Date((c as { addedAt?: string | Date }).addedAt || conversations[index]!.created_at)
          });
        }
      });
    });

          // Merge preferences (latest wins for conflicts)
      const mergedPreferences: CustomerPreferences = contexts.reduce<CustomerPreferences>((merged, ctx) => {
        const p = (ctx.preferences ?? {}) as Partial<CustomerPreferences>;
        return {
          categories: Array.from(new Set([...(merged.categories), ...(p.categories ?? [])])),
          brands:     Array.from(new Set([...(merged.brands),     ...(p.brands ?? [])])),
          priceRange: {
            min: Math.min(merged.priceRange.min, p.priceRange?.min ?? merged.priceRange.min),
            max: Math.max(merged.priceRange.max, p.priceRange?.max ?? merged.priceRange.max)
          },
          style:      Array.from(new Set([...(merged.style),  ...(p.style ?? [])])),
          colors:     Array.from(new Set([...(merged.colors), ...(p.colors ?? [])])),
          sizes:      Array.from(new Set([...(merged.sizes),  ...(p.sizes ?? [])])),
          deliveryPreference: p.deliveryPreference ?? merged.deliveryPreference,
          paymentMethods: Array.from(new Set([...(merged.paymentMethods), ...(p.paymentMethods ?? [])])),
          notificationTime: p.notificationTime ?? merged.notificationTime
        };
      }, emptyPreferences());

    // Extract interests from conversation content
    const interests = contexts.flatMap(c => c.interests ?? []).filter((x): x is string => typeof x === 'string');

    const result: UnifiedConversationContext = {
      cart: allCartItems,
      preferences: mergedPreferences,
      interests: (interests.filter(Boolean) as string[]),
      budget: (contexts.find((ctx) => (ctx as ConversationSession)?.budget) as ConversationSession | undefined)?.budget ?? { currency: 'IQD' },
      urgency: (contexts.find((ctx) => (ctx as ConversationSession)?.urgency) as ConversationSession | undefined)?.urgency ?? 'medium',
      context: {} as Record<string, unknown>
    };
    
    const location = (contexts.find((ctx) => (ctx as ConversationSession)?.location) as ConversationSession | undefined)?.location;
    if (location) {
      result.location = location;
    }
    
    return result;
  }

  /**
   * Private: Additional helper methods would be implemented here
   */
  private async calculatePreferredTime(): Promise<string> {
    // Implementation for calculating preferred interaction time
    return 'evening';
  }

  private async generateCustomerTags(_conversations: Array<{ session_data: string }>, platformProfiles: PlatformProfile[]): Promise<string[]> {
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

  private async getLatestConversation(merchantId: string, platform: Platform, identifier: string): Promise<ConversationRow | null> {
    const sql: Sql = this.db.getSQL();

    // ✅ أصلح شرط المنصة (كان يقارن المتغيّر نفسه بسلسلة ثابتة)
          const conversations = await sql.unsafe<ConversationRow>(`
      SELECT * FROM conversations
      WHERE merchant_id = ${merchantId}::uuid
      AND platform = ${platform}
      AND (
        (platform = 'whatsapp' AND customer_phone = ${identifier}) OR
        (platform = 'instagram' AND customer_instagram = ${identifier})
      )
      ORDER BY updated_at DESC
      LIMIT 1
    `);

          return (conversations as ConversationRow[])[0] ?? null;
  }

  private async createOrUpdateTargetConversation(
    merchantId: string,
    targetIdentifier: { platform: Platform; id: string },
    sourceConversation: ConversationRow
  ): Promise<ConversationRow> {
    const sql: Sql = this.db.getSQL();

    // Check if target conversation already exists
    const existing = await this.getLatestConversation(merchantId, targetIdentifier.platform, targetIdentifier.id);
    
    if (existing) {
      return existing;
    }

    // Create new conversation
          const result = await sql<ConversationRow>`
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

          return must((result as ConversationRow[])[0], 'no conversation');
  }

  private async transferContext(
    sourceConversation: ConversationRow,
    targetConversation: ConversationRow,
    fromPlatform: Platform,
    toPlatform: Platform
  ): Promise<{ success: boolean; transferredFields: string[] }> {
    try {
      const sourceContext = CrossPlatformConversationManager.jsonParseSafe<ConversationSession>(sourceConversation.session_data, {} as ConversationSession);
      const targetContext = CrossPlatformConversationManager.jsonParseSafe<ConversationSession>(targetConversation.session_data, {} as ConversationSession);

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

      const sql: Sql = this.db.getSQL();
      await sql`        UPDATE conversations 
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
    transferResult: { success: boolean; transferredFields: string[] }
  ): number {
    if (!transferResult.success) return 0;

    try {
      const sourceContext = CrossPlatformConversationManager.jsonParseSafe<Record<string, unknown>>(sourceData, {});

      const sourceFields = Object.keys(sourceContext);
      const preservedFields = transferResult.transferredFields;

      if (sourceFields.length === 0) return 1; // Nothing to preserve

      return preservedFields.length / sourceFields.length;
    } catch {
      return 0.5; // Partial success if parsing fails
    }
  }

  private selectPrimaryConversation(conversations: ConversationRow[], strategy: string): ConversationRow {
    switch (strategy) {
      case 'latest_wins':
        return must(conversations[0], 'no conversation'); // Already sorted by updated_at DESC
      case 'most_complete':
        return conversations.reduce((prev, current) => 
          toInt(current.message_count, 0) > toInt(prev.message_count, 0) ? current : prev
        );
      default:
        return must(conversations[0], 'no conversation');
    }
  }

  private async mergeConversationContexts(conversations: ConversationRow[]): Promise<ConversationSession> {
    const mergedContext: ConversationSession = {
      cart: [],
      preferences: {
        categories: [],
        brands: [],
        priceRange: { min: 0, max: 0 },
        style: [],
        colors: [],
        sizes: [],
        deliveryPreference: 'both',
        paymentMethods: [],
        notificationTime: 'anytime'
      }
      // mergedFrom يُدار على مستوى النوع (اختياري) عند الحاجة
    };

    for (const conversation of conversations) {
      const session = CrossPlatformConversationManager.jsonParseSafe<ConversationSession>(conversation.session_data, {} as ConversationSession);

      // Merge cart items
      if (Array.isArray(session.cart)) {
        (mergedContext.cart ??= []).push(...(session.cart ?? []));
      }

      // Merge preferences (later conversations override earlier ones)
      if (session.preferences && typeof session.preferences === 'object') {
        const newPrefs = { ...(mergedContext.preferences ?? {}), ...(session.preferences ?? {}) } as CustomerPreferences;
        mergedContext.preferences = newPrefs;
      }

      // Merge other context
      if ((session as ConversationSession).context && typeof (session as ConversationSession).context === 'object') {
        mergedContext.context = { ...mergedContext.context, ...((session as ConversationSession).context as Record<string, unknown>) };
      }
    }

    // إزالة العناصر المكررة في السلة بناءً على (productId + platform)
    const seen = new Set<string>();
    mergedContext.cart = (mergedContext.cart ?? []).filter((it) => {
      const key = `${(it as { productId?: string; id?: string }).productId || (it as { id?: string }).id}-${(it as { platform?: string }).platform ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return mergedContext;
  }

  private async getPlatformSwitches(
    merchantId: string,
    customerIdentifiers: { phone?: string; instagram?: string },
    timeRange?: { start: Date; end: Date }
  ): Promise<PlatformSwitchEvent[]> {
    try {
      const sql: Sql = this.db.getSQL();
      const swWhere: SqlFragment[] = [sql`merchant_id = ${merchantId}::uuid`];
      if (customerIdentifiers.phone) swWhere.push(sql`(from_identifier = ${customerIdentifiers.phone} OR to_identifier = ${customerIdentifiers.phone})`);
      if (customerIdentifiers.instagram) swWhere.push(sql`(from_identifier = ${customerIdentifiers.instagram} OR to_identifier = ${customerIdentifiers.instagram})`);
      const swTime = timeRange ? sql`AND switch_timestamp BETWEEN ${timeRange.start} AND ${timeRange.end}` : sql``;
      const switches = await sql<{
        from_platform: string;
        to_platform: string;
        switch_timestamp: string;
        context_preserved: boolean;
        reason: string;
        continuity_score: number;
      }>`
        SELECT * FROM platform_switches
        WHERE ${swWhere.join(' AND ')}
        ${swTime}
        ORDER BY switch_timestamp ASC
      `;

      return switches.map(s => ({
        fromPlatform: s.from_platform as Platform,
        toPlatform: s.to_platform as Platform,
        timestamp: new Date(s.switch_timestamp),
        contextPreserved: s.context_preserved,
        reason: s.reason as 'customer_initiated' | 'merchant_redirect' | 'auto_follow',
        continuityScore: s.continuity_score
      }));
    } catch (error) {
      console.error('❌ Failed to get platform switches:', error);
      return [];
    }
  }

  private detectConversionEvents(_stages: JourneyStage[]): ConversionEvent[] {
    // Implementation for detecting conversion events (purchases, inquiries, etc.)
    return [];
  }

  private generateJourneyInsights(
    _stages: JourneyStage[],
    _switches: PlatformSwitchEvent[],
    _conversions: ConversionEvent[]
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

  private getWhatsAppMessageScore(messageType: string): number {
    // WhatsApp is better for detailed, formal communications
    const scores = {
      text: 0.8,
      media: 0.6,
      template: 0.9,
      urgent: 0.9
    };
    return scores[messageType as keyof typeof scores] || 0.5;
  }

  private getInstagramMessageScore(messageType: string): number {
    // Instagram is better for visual, casual communications
    const scores = {
      text: 0.6,
      media: 0.9,
      template: 0.7,
      urgent: 0.4
    };
    return scores[messageType as keyof typeof scores] || 0.5;
  }

  private async getTimeBasedPlatformPreferences(): Promise<{ WHATSAPP: number; INSTAGRAM: number }> {
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
  context: Record<string, unknown>;
}

interface ConversionEvent {
  type: 'inquiry' | 'order' | 'payment' | 'review';
  timestamp: Date;
  platform: Platform;
  value?: number;
  details: Record<string, unknown>;
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

// Using imported types from conversations.ts

