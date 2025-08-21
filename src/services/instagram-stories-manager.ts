/**
 * ===============================================
 * Instagram Stories Manager
 * Advanced Instagram Stories integration and management
 * ===============================================
 */

import { getInstagramClient, clearInstagramClient, type InstagramCredentials } from './instagram-api.js';
import { ExpiringMap } from '../utils/expiring-map.js';
import { getDatabase } from '../database/connection.js';
import { getConversationAIOrchestrator } from './conversation-ai-orchestrator.js';
import type { InstagramContext } from './instagram-ai.js';
import { hashMerchantAndBody } from '../middleware/idempotency.js';
import { getRedisConnectionManager } from './RedisConnectionManager.js';
import { RedisUsageType } from '../config/RedisConfigurationFactory.js';

export interface StoryInteraction {
  id: string;
  type: 'story_reply' | 'story_mention' | 'story_view' | 'story_reaction';
  storyId: string;
  userId: string;
  username?: string;
  content?: string;
  mediaUrl?: string;
  timestamp: Date;
  metadata?: {
    reactionType?: string;
    storyType?: 'photo' | 'video' | 'reel';
    isPrivate?: boolean;
  };
}

export interface StoryResponse {
  type: 'text' | 'media' | 'template';
  content: string;
  mediaUrl?: string;
  quick_replies?: Array<{
    title: string;
    payload: string;
  }>;
  personalizedElements?: {
    userMention?: string;
    contextualEmojis?: string[];
    callToAction?: string;
  };
}

export interface StoryAnalytics {
  totalInteractions: number;
  uniqueUsers: number;
  responseRate: number;
  engagementTypes: {
    replies: number;
    mentions: number;
    reactions: number;
    views: number;
  };
  topInteractionTimes: string[];
  userEngagementScore: number;
}

export interface StoryTemplate {
  id: string;
  name: string;
  category: 'product_showcase' | 'engagement' | 'promo' | 'qa' | 'behind_scenes';
  template: {
    text?: string;
    mediaType?: 'image' | 'video';
    elements: {
      polls?: boolean;
      questions?: boolean;
      mentions?: string[];
      hashtags?: string[];
      stickers?: string[];
    };
  };
  responseTemplate?: StoryResponse;
}

export class InstagramStoriesManager {
  private db = getDatabase();
  private aiOrchestrator = getConversationAIOrchestrator();
  private redis = getRedisConnectionManager();

  private credentialsCache = new ExpiringMap<string, InstagramCredentials>();

  private getClient(merchantId: string) {
    return getInstagramClient(merchantId);
  }

  private async getCredentials(merchantId: string): Promise<InstagramCredentials> {
    const cached = this.credentialsCache.get(merchantId);
    if (cached && (!cached.tokenExpiresAt || cached.tokenExpiresAt > new Date())) {
      return cached;
    }

    const client = this.getClient(merchantId);
    const creds = await client.loadMerchantCredentials(merchantId);
    if (!creds) {
      throw new Error(`Instagram credentials not found for merchant: ${merchantId}`);
    }
    await client.validateCredentials(creds, merchantId);

    const ttlMs = creds.tokenExpiresAt
      ? Math.max(creds.tokenExpiresAt.getTime() - Date.now(), 0)
      : 60 * 60 * 1000;
    this.credentialsCache.set(merchantId, creds, ttlMs);
    return creds;
  }

  public clearMerchantClient(merchantId: string) {
    this.credentialsCache.delete(merchantId);
    clearInstagramClient(merchantId);
  }

  /**
   * Process story interaction (reply, mention, etc.)
   */
  public async processStoryInteraction(
    interaction: StoryInteraction,
    merchantId: string
  ): Promise<{ success: boolean; responseGenerated: boolean; error?: string }> {
    try {
      console.log(`📱 Processing Instagram story ${interaction.type}: ${interaction.id}`);

      // 🔒 Idempotency check - prevent duplicate story processing
      const bodyForHash = {
        merchantId,
        interactionId: interaction.id,
        storyId: interaction.storyId,
        type: interaction.type,
        userId: interaction.userId,
        content: interaction.content,
        date: new Date().toISOString().slice(0, 10)
      };
      const idempotencyKey = `ig:story_process:${hashMerchantAndBody(merchantId, bodyForHash)}`;
      
      const redis = await this.redis.getConnection(RedisUsageType.IDEMPOTENCY);
      const existingResult = await redis.get(idempotencyKey);
      
      if (existingResult) {
        console.log(`🔒 Idempotent story processing detected: ${idempotencyKey}`);
        return JSON.parse(existingResult);
      }

      // Store the interaction
      await this.storeStoryInteraction(interaction, merchantId);

      // Run post-processing tasks concurrently
      const [responseResult, analyticsResult, salesResult] =
        await Promise.allSettled([
          this.generateStoryResponse(interaction, merchantId),
          this.updateStoryAnalytics(merchantId, interaction),
          interaction.content
            ? this.analyzeSalesOpportunity(interaction, merchantId)
            : Promise.resolve()
        ]);

      const responseGenerated =
        responseResult.status === 'fulfilled' ? responseResult.value : false;
      if (responseResult.status === 'rejected') {
        console.error(
          'Failed to generate story response:',
          responseResult.reason
        );
      }
      if (analyticsResult.status === 'rejected') {
        console.error(
          'Failed to update story analytics:',
          analyticsResult.reason
        );
      }
      if (interaction.content && salesResult.status === 'rejected') {
        console.error(
          'Failed to analyze sales opportunity:',
          salesResult.reason
        );
      }

      const successResult = {
        success: true,
        responseGenerated
      };

      // 💾 Cache successful result for idempotency (24 hours TTL)
      await redis.setex(idempotencyKey, 86400, JSON.stringify(successResult));
      console.log(`💾 Cached story processing result: ${idempotencyKey}`);

      return successResult;
    } catch (error) {
      console.error('❌ Story interaction processing failed:', error);
      return {
        success: false,
        responseGenerated: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Generate intelligent response to story interaction
   */
  public async generateStoryResponse(
    interaction: StoryInteraction,
    merchantId: string
  ): Promise<boolean> {
    try {
      // Skip automatic responses for certain interaction types
      if (interaction.type === 'story_view') {
        console.log('📊 Story view recorded - no response needed');
        return false;
      }

      // Find or create conversation for this user
      const conversation = await this.findOrCreateStoryConversation(
        merchantId,
        interaction.userId,
        interaction.username
      );

      if (!conversation) {
        throw new Error('Failed to create conversation for story interaction');
      }

      // Build context for AI response
      const context = await this.buildStoryContext(
        merchantId,
        interaction,
        conversation.id
      );

      // Generate AI response based on interaction type and content
      let prompt = '';
      switch (interaction.type) {
        case 'story_reply':
          prompt = this.buildStoryReplyPrompt(interaction);
          break;
        case 'story_mention':
          prompt = this.buildStoryMentionPrompt(interaction);
          break;
        case 'story_reaction':
          prompt = this.buildStoryReactionPrompt(interaction);
          break;
        default:
          console.log(`⚠️ Unsupported story interaction type: ${interaction.type}`);
          return false;
      }

      if (!prompt) {
        return false;
      }

      // Generate AI response
      const aiResult = await this.aiOrchestrator.generatePlatformResponse(
        prompt,
        context,
        'instagram'
      );

      // Personalize the response for story context
      const personalizedResponse = this.personalizeStoryResponse(
        aiResult.response.message,
        interaction
      );

      // Send response via Instagram API
      const instagramClient = this.getClient(merchantId);
      const credentials = await this.getCredentials(merchantId);

      const sendResult = await instagramClient.sendMessage(credentials, merchantId, {
        recipientId: interaction.userId,
        messageType: 'text',
        content: personalizedResponse,
        quickReplies: this.generateQuickReplies(interaction)
      });

      if (sendResult.success) {
        // Store the response in conversation
        await this.storeStoryResponse(
          conversation.id,
          personalizedResponse,
          interaction.type,
          sendResult.messageId
        );

        console.log(`✅ Story response sent: ${personalizedResponse.substring(0, 50)}...`);
        return true;
      } else {
        console.error('❌ Failed to send story response:', sendResult.error);
        return false;
      }
    } catch (error) {
      console.error('❌ Story response generation failed:', error);
      return false;
    }
  }

  /**
   * Analyze story interaction for sales opportunities
   */
  public async analyzeSalesOpportunity(
    interaction: StoryInteraction,
    merchantId: string
  ): Promise<void> {
    try {
      if (!interaction.content) return;

      const salesKeywords = [
        'سعر', 'كم', 'متوفر', 'أريد', 'اشتري', 'طلب', 'توصيل',
        'price', 'how much', 'available', 'want', 'buy', 'order', 'deliver'
      ];

      const text = interaction.content.toLowerCase();
      const isSalesInquiry = salesKeywords.some(keyword => text.includes(keyword));

      if (isSalesInquiry) {
        console.log(`💰 Sales opportunity detected in story ${interaction.type}`);

        // Tag conversation as sales opportunity
        await this.tagSalesOpportunity(merchantId, interaction.userId, interaction.type);

        // Send proactive sales assistance
        await this.sendSalesAssistance(merchantId, interaction);
      }
    } catch (error) {
      console.error('❌ Sales opportunity analysis failed:', error);
    }
  }

  /**
   * Get story analytics for merchant
   */
  public async getStoryAnalytics(
    merchantId: string,
    dateRange?: { from: Date; to: Date }
  ): Promise<StoryAnalytics> {
    try {
      const sql = this.db.getSQL();

      const dateFilter = dateRange 
        ? sql`AND created_at BETWEEN ${dateRange.from.toISOString()} AND ${dateRange.to.toISOString()}`
        : sql`AND created_at >= NOW() - INTERVAL '30 days'`;

      // Get aggregated interaction counts with unique users
      const analytics = await sql`
        SELECT
          COUNT(*) as total_interactions,
          COUNT(DISTINCT user_id) as unique_users,
          COUNT(*) FILTER (WHERE interaction_type = 'story_reply') as replies,
          COUNT(*) FILTER (WHERE interaction_type = 'story_mention') as mentions,
          COUNT(*) FILTER (WHERE interaction_type = 'story_reaction') as reactions,
          COUNT(*) FILTER (WHERE interaction_type = 'story_view') as views
        FROM story_interactions
        WHERE merchant_id = ${merchantId}::uuid
        ${dateFilter}
      `;

      // Calculate engagement metrics
      const totalInteractions = Number(analytics[0]?.total_interactions || 0);
      const uniqueUsers = Number(analytics[0]?.unique_users || 0);

      // Get response rate
      const responseData = await sql`
        SELECT 
          COUNT(CASE WHEN ai_response_sent = true THEN 1 END) as responses,
          COUNT(*) as total
        FROM story_interactions
        WHERE merchant_id = ${merchantId}::uuid
        ${dateFilter}
        AND interaction_type IN ('story_reply', 'story_mention')
      `;

      const responseRate = responseData.length > 0 
        ? (Number(responseData[0].responses) / Number(responseData[0].total)) * 100
        : 0;

      // Get peak interaction times
      const timeData = await sql`
        SELECT 
          EXTRACT(HOUR FROM created_at) as hour,
          COUNT(*) as count
        FROM story_interactions
        WHERE merchant_id = ${merchantId}::uuid
        ${dateFilter}
        GROUP BY EXTRACT(HOUR FROM created_at)
        ORDER BY count DESC
        LIMIT 3
      `;

      const topInteractionTimes = timeData.map(time => `${time.hour}:00`);

      // Calculate engagement score (0-100)
      const userEngagementScore = Math.min(100, 
        (totalInteractions / Math.max(uniqueUsers, 1)) * 10
      );

      return {
        totalInteractions,
        uniqueUsers,
        responseRate,
        engagementTypes: {
          replies: Number(analytics[0]?.replies || 0),
          mentions: Number(analytics[0]?.mentions || 0),
          reactions: Number(analytics[0]?.reactions || 0),
          views: Number(analytics[0]?.views || 0)
        },
        topInteractionTimes,
        userEngagementScore
      };
    } catch (error) {
      console.error('❌ Story analytics failed:', error);
      throw error;
    }
  }

  /**
   * Create interactive story templates
   */
  public async createStoryTemplate(
    merchantId: string,
    template: Omit<StoryTemplate, 'id'>
  ): Promise<string> {
    try {
      const sql = this.db.getSQL();

      const result = await sql`
        INSERT INTO story_templates (
          merchant_id,
          name,
          category,
          template_data,
          response_template,
          created_at
        ) VALUES (
          ${merchantId}::uuid,
          ${template.name},
          ${template.category},
          ${JSON.stringify(template.template)},
          ${template.responseTemplate ? JSON.stringify(template.responseTemplate) : null},
          NOW()
        )
        RETURNING id
      `;

      const templateId = result[0].id;
      console.log(`✅ Story template created: ${template.name} (${templateId})`);
      return templateId;
    } catch (error) {
      console.error('❌ Story template creation failed:', error);
      throw error;
    }
  }

  /**
   * Get story templates for merchant
   */
  public async getStoryTemplates(
    merchantId: string,
    category?: string
  ): Promise<StoryTemplate[]> {
    try {
      const sql = this.db.getSQL();

      const categoryFilter = category 
        ? sql`AND category = ${category}`
        : sql``;

      const templates = await sql`
        SELECT *
        FROM story_templates
        WHERE merchant_id = ${merchantId}::uuid
        ${categoryFilter}
        ORDER BY created_at DESC
      `;

      return templates.map(template => ({
        id: template.id,
        name: template.name,
        category: template.category,
        template: JSON.parse(template.template_data),
        responseTemplate: template.response_template 
          ? JSON.parse(template.response_template) 
          : undefined
      }));
    } catch (error) {
      console.error('❌ Get story templates failed:', error);
      return [];
    }
  }

  /**
   * Private: Store story interaction in database
   */
  private async storeStoryInteraction(
    interaction: StoryInteraction,
    merchantId: string
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();

      await sql`
        INSERT INTO story_interactions (
          id,
          merchant_id,
          interaction_type,
          story_id,
          user_id,
          username,
          content,
          media_url,
          metadata,
          created_at
        ) VALUES (
          ${interaction.id},
          ${merchantId}::uuid,
          ${interaction.type},
          ${interaction.storyId},
          ${interaction.userId},
          ${interaction.username || null},
          ${interaction.content || null},
          ${interaction.mediaUrl || null},
          ${interaction.metadata ? JSON.stringify(interaction.metadata) : null},
          ${interaction.timestamp}
        )
        ON CONFLICT (id) DO NOTHING
      `;
    } catch (error) {
      console.error('❌ Store story interaction failed:', error);
      throw error;
    }
  }

  /**
   * Private: Find or create conversation for story interaction
   */
  private async findOrCreateStoryConversation(
    merchantId: string,
    userId: string,
    username?: string
  ): Promise<{ id: string; isNew: boolean } | null> {
    try {
      const sql = this.db.getSQL();

      // Try to find existing conversation
      const existing = await sql`
        SELECT id
        FROM conversations
        WHERE merchant_id = ${merchantId}::uuid
        AND customer_instagram = ${userId}
        AND platform = 'instagram'
        AND ended_at IS NULL
        ORDER BY last_message_at DESC
        LIMIT 1
      `;

      if (existing.length > 0) {
        return { id: existing[0].id, isNew: false };
      }

      // Create new conversation for story interaction
      const newConversation = await sql`
        INSERT INTO conversations (
          merchant_id,
          customer_instagram,
          customer_name,
          platform,
          conversation_stage,
          session_data,
          last_message_at,
          source_type
        ) VALUES (
          ${merchantId}::uuid,
          ${userId},
          ${username || null},
          'instagram',
          'GREETING',
          '{"cart": [], "preferences": {}, "context": {"source": "story"}, "interaction_count": 1}',
          NOW(),
          'STORY'
        )
        RETURNING id
      `;

      return { id: newConversation[0].id, isNew: true };
    } catch (error) {
      console.error('❌ Failed to find/create story conversation:', error);
      return null;
    }
  }

  /**
   * Private: Build AI context for story interaction
   */
  private async buildStoryContext(
    merchantId: string,
    interaction: StoryInteraction,
    conversationId: string
  ): Promise<InstagramContext> {
    try {
      const sql = this.db.getSQL();

      // Get merchant and conversation data
      const data = await sql`
        SELECT 
          c.*,
          m.business_name,
          m.business_category
        FROM conversations c
        JOIN merchants m ON c.merchant_id = m.id
        WHERE c.id = ${conversationId}::uuid
      `;

      const conversation = data[0];

        // Get recent conversation history
        const messageHistory = await sql`
        SELECT 
          CASE 
            WHEN direction = 'INCOMING' THEN 'user'
            ELSE 'assistant'
          END as role,
          content,
          created_at as timestamp
        FROM message_logs
        WHERE conversation_id = ${conversationId}::uuid
        ORDER BY created_at DESC
        LIMIT 5
        `;

        let session: any = {};
        try {
          session = typeof conversation.session_data === 'string'
            ? JSON.parse(conversation.session_data)
            : conversation.session_data || {};
        } catch (error) {
          console.error('❌ Failed to parse session data for conversation', conversationId, error);
        }

        return {
        merchantId,
        customerId: interaction.userId,
        platform: 'instagram',
        stage: conversation.conversation_stage,
        cart: session.cart || [],
        preferences: session.preferences || {},
        conversationHistory: messageHistory.reverse().map(msg => ({
          role: msg.role,
          content: msg.content,
          timestamp: new Date(msg.timestamp)
        })),
        interactionType: 'story_mention',
        mediaContext: { mediaId: interaction.storyId },
        merchantSettings: {
          businessName: conversation.business_name,
          businessCategory: conversation.business_category,
          workingHours: {},
          paymentMethods: [],
          deliveryFees: {},
          autoResponses: {}
        }
      };
    } catch (error) {
      console.error('❌ Build story context failed:', error);
      throw error;
    }
  }

  /**
   * Private: Build prompt for story reply
   */
  private buildStoryReplyPrompt(interaction: StoryInteraction): string {
    return `تم الرد على الستوري: "${interaction.content}". اكتب رد ودود ومشجع للتفاعل، مع دعوة مهذبة للمحادثة الخاصة إذا كان الرد يبدو كاستفسار عن المنتجات.`;
  }

  /**
   * Private: Build prompt for story mention
   */
  private buildStoryMentionPrompt(interaction: StoryInteraction): string {
    return `تم ذكرنا في ستوري للمستخدم @${interaction.username}. اكتب رسالة شكر أنيقة وترحيب، مع دعوة للتواصل لمناقشة المنتجات أو الخدمات.`;
  }

  /**
   * Private: Build prompt for story reaction
   */
  private buildStoryReactionPrompt(interaction: StoryInteraction): string {
    const reactionType = interaction.metadata?.reactionType || 'إعجاب';
    return `تفاعل المستخدم مع الستوري بـ${reactionType}. اكتب رسالة شكر قصيرة وودودة.`;
  }

  /**
   * Private: Personalize response for story context
   */
  private personalizeStoryResponse(
    response: string,
    interaction: StoryInteraction
  ): string {
    let personalizedResponse = response;

    // Add user mention if available
    if (interaction.username) {
      personalizedResponse = `@${interaction.username} ${personalizedResponse}`;
    }

    // Add story-specific emoji context
    const storyEmojis = ['📱', '✨', '💫', '🌟', '💝'];
    const randomEmoji = storyEmojis[Math.floor(Math.random() * storyEmojis.length)];
    
    if (!personalizedResponse.includes('📱') && !personalizedResponse.includes('✨')) {
      personalizedResponse += ` ${randomEmoji}`;
    }

    return personalizedResponse;
  }

  /**
   * Private: Generate quick replies for story interactions
   */
  private generateQuickReplies(interaction: StoryInteraction): Array<{content_type: 'text', title: string, payload: string}> {
    const baseReplies = [
      { content_type: 'text' as const, title: 'منتجاتنا 🛍️', payload: 'SHOW_PRODUCTS' },
      { content_type: 'text' as const, title: 'أسعار 💰', payload: 'SHOW_PRICES' }
    ];

    if (interaction.type === 'story_reply' && interaction.content) {
      baseReplies.unshift({
        content_type: 'text' as const,
        title: 'المزيد 💬',
        payload: 'TELL_MORE'
      });
    }

    return baseReplies;
  }

  /**
   * Private: Store story response
   */
  private async storeStoryResponse(
    conversationId: string,
    content: string,
    interactionType: string,
    messageId?: string
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();

      await sql`
        INSERT INTO message_logs (
          conversation_id,
          direction,
          platform,
          message_type,
          content,
          platform_message_id,
          ai_processed,
          delivery_status,
          metadata
        ) VALUES (
          ${conversationId}::uuid,
          'OUTGOING',
          'instagram',
          'STORY_RESPONSE',
          ${content},
          ${messageId || null},
          true,
          'SENT',
          ${JSON.stringify({ interactionType, isStoryResponse: true })}
        )
      `;

      // Update conversation last message time
      await sql`
        UPDATE conversations
        SET 
          last_message_at = NOW(),
          message_count = message_count + 1
        WHERE id = ${conversationId}::uuid
      `;
    } catch (error) {
      console.error('❌ Store story response failed:', error);
      throw error;
    }
  }

  /**
   * Private: Update story analytics
   */
  private async updateStoryAnalytics(
    merchantId: string,
    interaction: StoryInteraction
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();
      const redis = await this.redis.getConnection(RedisUsageType.CACHING);

      // Ensure unique users per day using Redis set
      const today = new Date().toISOString().slice(0, 10);
      const uniqueKey = `story:users:${merchantId}:${today}`;
      const isNewUser = await redis.sadd(uniqueKey, interaction.userId);
      if (isNewUser === 1) {
        await redis.expire(uniqueKey, 86400);
      }
      const uniqueIncrement = isNewUser === 1 ? 1 : 0;

      // Update daily analytics
      await sql`
        INSERT INTO daily_analytics (
          merchant_id,
          date,
          platform,
          story_interactions,
          unique_story_users
        ) VALUES (
          ${merchantId}::uuid,
          CURRENT_DATE,
          'instagram',
          1,
          ${uniqueIncrement}
        )
        ON CONFLICT (merchant_id, date, platform)
        DO UPDATE SET
          story_interactions = daily_analytics.story_interactions + 1,
          unique_story_users = daily_analytics.unique_story_users + ${uniqueIncrement},
          updated_at = NOW()
      `;
    } catch (error) {
      console.error('❌ Update story analytics failed:', error);
    }
  }

  /**
   * Private: Tag sales opportunity
   */
  private async tagSalesOpportunity(
    merchantId: string,
    userId: string,
    interactionType: string
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();

      await sql`
        INSERT INTO sales_opportunities (
          merchant_id,
          customer_id,
          source_platform,
          opportunity_type,
          status,
          metadata,
          created_at
        ) VALUES (
          ${merchantId}::uuid,
          ${userId},
          'instagram',
          'STORY_INTERACTION',
          'NEW',
          ${JSON.stringify({ interactionType, source: 'story' })},
          NOW()
        )
        ON CONFLICT (merchant_id, customer_id, source_platform)
        DO UPDATE SET
          status = 'ACTIVE',
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `;
    } catch (error) {
      console.error('❌ Tag sales opportunity failed:', error);
    }
  }

  /**
   * Private: Send sales assistance for story interactions
   */
  private async sendSalesAssistance(
    merchantId: string,
    interaction: StoryInteraction
  ): Promise<void> {
    try {
      const instagramClient = this.getClient(merchantId);
      const credentials = await this.getCredentials(merchantId);

      const assistanceMessage = `شكراً لاهتمامك! 🛍️ يسعدني أساعدك في اختيار المنتج المناسب. راسلني هنا وراح أرسلك كل التفاصيل والأسعار ✨`;

      await instagramClient.sendMessage(credentials, merchantId, {
        recipientId: interaction.userId,
        messageType: 'text',
        content: assistanceMessage,
        quickReplies: [
          { content_type: 'text', title: 'كتالوج المنتجات 📋', payload: 'CATALOG' },
          { content_type: 'text', title: 'الأسعار 💰', payload: 'PRICES' },
          { content_type: 'text', title: 'التوصيل 🚚', payload: 'DELIVERY' }
        ]
      });

      console.log(`💼 Sales assistance sent for story interaction: ${interaction.type}`);
    } catch (error) {
      console.error('❌ Send sales assistance failed:', error);
    }
  }
}

// Singleton instance
let storiesManagerInstance: InstagramStoriesManager | null = null;

/**
 * Get Instagram Stories Manager instance
 */
export function getInstagramStoriesManager(): InstagramStoriesManager {
  if (!storiesManagerInstance) {
    storiesManagerInstance = new InstagramStoriesManager();
  }
  return storiesManagerInstance;
}

export default InstagramStoriesManager;