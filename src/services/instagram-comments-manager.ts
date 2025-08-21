/**
 * ===============================================
 * Instagram Comments Manager
 * Advanced Instagram Comments management and AI responses
 * ===============================================
 */

import { getInstagramClient, clearInstagramClient, type InstagramAPICredentials } from './instagram-api.js';
import { ExpiringMap } from '../utils/expiring-map.js';
import { getDatabase } from '../database/connection.js';
import { getConversationAIOrchestrator } from './conversation-ai-orchestrator.js';
import type { InstagramContext } from './instagram-ai.js';
import { hashMerchantAndBody } from '../middleware/idempotency.js';
import { getRedisConnectionManager } from './RedisConnectionManager.js';
import { RedisUsageType } from '../config/RedisConfigurationFactory.js';
import { createLogger } from './logger.js';

export interface CommentInteraction {
  id: string;
  postId: string;
  parentCommentId?: string; // For replies to comments
  userId: string;
  username: string;
  content: string;
  timestamp: Date;
  isReply: boolean;
  sentimentScore?: number;
  metadata?: {
    postType?: 'photo' | 'video' | 'reel' | 'carousel';
    postUrl?: string;
    isInfluencerComment?: boolean;
    hasHashtags?: boolean;
    mentionsCount?: number;
    isLiked?: boolean;
  };
}

export interface CommentResponse {
  type: 'reply' | 'like' | 'dm_invite' | 'none';
  content?: string;
  shouldInviteToDM?: boolean;
  dmInviteMessage?: string;
  confidence: number;
  reasoning: string;
}

export interface CommentAnalytics {
  totalComments: number;
  responseRate: number;
  averageResponseTime: number; // in minutes
  sentimentBreakdown: {
    positive: number;
    neutral: number;
    negative: number;
  };
  salesInquiries: number;
  dmConversions: number;
  topCommentingUsers: Array<{
    username: string;
    commentCount: number;
    engagementScore: number;
  }>;
  performanceByPostType: {
    [key: string]: {
      comments: number;
      responses: number;
      conversions: number;
    };
  };
}

export interface CommentModerationRule {
  id: string;
  name: string;
  trigger: {
    type: 'keyword' | 'sentiment' | 'spam' | 'user_type';
    value: string | number;
    operator: 'contains' | 'equals' | 'greater_than' | 'less_than';
  };
  action: {
    type: 'auto_reply' | 'hide' | 'flag' | 'invite_dm';
    template?: string;
    priority: number;
  };
  isActive: boolean;
}

export class InstagramCommentsManager {
  private logger = createLogger({ component: 'InstagramCommentsManager' });
  private db = getDatabase();
  private aiOrchestrator = getConversationAIOrchestrator();
  private redis = getRedisConnectionManager();
  private credentialsCache = new ExpiringMap<string, InstagramAPICredentials>();

  private getClient(merchantId: string) {
    return getInstagramClient(merchantId);
  }

  private async getCredentials(merchantId: string): Promise<InstagramAPICredentials> {
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

  public clearClient(merchantId?: string) {
    if (merchantId) {
      this.credentialsCache.delete(merchantId);
      clearInstagramClient(merchantId);
    } else {
      this.credentialsCache.clear();
    }
  }

  /**
   * Process new comment interaction
   */
  public async processComment(
    comment: CommentInteraction,
    merchantId: string
  ): Promise<{ success: boolean; responseGenerated: boolean; actionTaken?: string; error?: string }> {
    try {
      this.logger.info('Processing Instagram comment', {
        username: comment.username,
        preview: comment.content.substring(0, 50),
        merchantId
      });

      // 🔒 Idempotency check - prevent duplicate comment processing
      const bodyForHash = {
        merchantId,
        commentId: comment.id,
        postId: comment.postId,
        content: comment.content,
        userId: comment.userId,
        timestamp: comment.timestamp.toISOString()
      };
      const idempotencyKey = `ig:comment_process:${hashMerchantAndBody(merchantId, bodyForHash)}`;
      
      const redis = await this.redis.getConnection(RedisUsageType.IDEMPOTENCY);
      const existingResult = await redis.get(idempotencyKey);

      if (existingResult) {
        this.logger.info('Idempotent comment processing detected', { idempotencyKey });
        try {
          return JSON.parse(existingResult);
        } catch (error) {
                    this.logger.warn({ err: error, idempotencyKey }, 'Failed to parse cached comment processing result');
        }
      }

      // Store comment in database
      await this.storeComment(comment, merchantId);

      // Analyze comment sentiment and content
      const analysis = await this.analyzeComment(comment, merchantId);

      // Check moderation rules
      const moderationAction = await this.checkModerationRules(comment, merchantId);

      if (moderationAction && moderationAction.action.type === 'hide') {
        this.logger.warn('Comment hidden due to moderation rule', {
          ruleName: moderationAction.rule.name
        });
        return {
          success: true,
          responseGenerated: false,
          actionTaken: 'hidden'
        };
      }

      // Generate intelligent response
      const response = await this.generateCommentResponse(comment, analysis, merchantId);

      let actionTaken = 'none';
      let responseGenerated = false;

      // Execute response action
      if (response.type === 'reply' && response.content) {
        const replyResult = await this.replyToComment(comment.id, response.content, merchantId);
        if (replyResult) {
          responseGenerated = true;
          actionTaken = 'replied';
          await this.logCommentResponse(comment.id, response.content, 'reply', merchantId);
        }
      } else if (response.type === 'dm_invite' && response.dmInviteMessage) {
        const inviteResult = await this.inviteCommentToDM(comment, response.dmInviteMessage, merchantId);
        if (inviteResult) {
          responseGenerated = true;
          actionTaken = 'dm_invited';
          await this.logCommentResponse(comment.id, response.dmInviteMessage, 'dm_invite', merchantId);
        }
      } else if (response.type === 'like') {
        // Like the comment (if supported by API)
        actionTaken = 'liked';
        await this.logCommentResponse(comment.id, '', 'like', merchantId);
      }

      // Update analytics
      await this.updateCommentAnalytics(merchantId, comment, response);

      // Check for sales opportunity
      if (analysis.isSalesInquiry) {
        await this.createSalesOpportunity(comment, merchantId);
      }

      this.logger.info('Comment processed', {
        actionTaken,
        confidence: response.confidence
      });

      const successResult = {
        success: true,
        responseGenerated,
        actionTaken
      };

      // 💾 Cache successful result for idempotency (24 hours TTL)
      await redis.setex(idempotencyKey, 86400, JSON.stringify(successResult));
      this.logger.info('Cached comment processing result', { idempotencyKey });

      return successResult;
    } catch (error) {
      this.logger.error('Comment processing failed', error, { merchantId, commentId: comment.id });
      return {
        success: false,
        responseGenerated: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Analyze comment content and sentiment
   */
  public async analyzeComment(
    comment: CommentInteraction,
    merchantId: string
  ): Promise<{
    sentiment: 'positive' | 'neutral' | 'negative';
    sentimentScore: number;
    isSalesInquiry: boolean;
    isComplaint: boolean;
    isSpam: boolean;
    keywords: string[];
    urgencyLevel: 'low' | 'medium' | 'high';
    recommendedAction: 'reply' | 'dm_invite' | 'escalate' | 'ignore';
  }> {
    try {
      // Use AI to analyze comment
      const analysisPrompt = `تحليل التعليق التالي من Instagram:
      
      التعليق: "${comment.content}"
      المستخدم: @${comment.username}
      
      قم بتحليل:
      1. المشاعر (إيجابي/محايد/سلبي) ودرجة من 0-100
      2. هل هو استفسار للشراء؟
      3. هل هو شكوى؟
      4. هل هو رسالة غير مرغوب فيها؟
      5. الكلمات المفتاحية
      6. مستوى الأولوية
      7. الإجراء المقترح`;

      const context: InstagramContext = {
        merchantId,
        customerId: comment.userId,
        platform: 'instagram',
        stage: 'GREETING',
        cart: [],
        preferences: {},
        conversationHistory: [],
        interactionType: 'comment',
        merchantSettings: {
          businessName: '',
          businessCategory: '',
          workingHours: {},
          paymentMethods: [],
          deliveryFees: {},
          autoResponses: {}
        }
      };

      const aiResult = await this.aiOrchestrator.generatePlatformResponse(
        analysisPrompt,
        context,
        'instagram'
      );

      // Parse AI response or use fallback analysis
      const fallbackAnalysis = this.performFallbackAnalysis(comment);

      // Store analysis results
      await this.storeCommentAnalysis(comment.id, fallbackAnalysis, merchantId);

      return fallbackAnalysis;
    } catch (error) {
      this.logger.error('Comment analysis failed', error, { merchantId, commentId: comment.id });
      return this.performFallbackAnalysis(comment);
    }
  }

  /**
   * Generate intelligent response to comment
   */
  public async generateCommentResponse(
    comment: CommentInteraction,
    analysis: any,
    merchantId: string
  ): Promise<CommentResponse> {
    try {
      // Determine response strategy based on analysis
      if (analysis.isSpam) {
        return {
          type: 'none',
          confidence: 95,
          reasoning: 'Comment identified as spam'
        };
      }

      if (analysis.isComplaint) {
        return {
          type: 'dm_invite',
          dmInviteMessage: `مرحباً @${comment.username} 🌹 نعتذر عن أي إزعاج! راسلنا خاص عشان نحل المشكلة بأسرع وقت ممكن 💙`,
          shouldInviteToDM: true,
          confidence: 85,
          reasoning: 'Complaint detected - inviting to private conversation'
        };
      }

      if (analysis.isSalesInquiry) {
        const shouldInvite = this.shouldInviteToDM(comment, analysis);
        
        if (shouldInvite) {
          return {
            type: 'dm_invite',
            dmInviteMessage: `أهلاً @${comment.username}! 🛍️ راح أرسلك رسالة خاصة بكل التفاصيل والأسعار الخاصة ✨`,
            shouldInviteToDM: true,
            confidence: 90,
            reasoning: 'Sales inquiry detected - inviting to DM for detailed discussion'
          };
        } else {
          // Public reply for simple sales questions
          const responsePrompt = `اكتب رد قصير ومشجع على التعليق: "${comment.content}" من @${comment.username}. 
          يجب أن يكون الرد:
          - ودود ومرحب
          - قصير (أقل من 50 حرف)
          - يحتوي على دعوة مهذبة للرسائل الخاصة
          - مناسب للعرض العام`;

          const context: InstagramContext = {
            merchantId,
            customerId: comment.userId,
            platform: 'instagram',
            stage: 'GREETING',
            cart: [],
            preferences: {},
            conversationHistory: [],
            interactionType: 'comment',
            merchantSettings: {
              businessName: '',
              businessCategory: '',
              workingHours: {},
              paymentMethods: [],
              deliveryFees: {},
              autoResponses: {}
            }
          };

          const aiResult = await this.aiOrchestrator.generatePlatformResponse(
            responsePrompt,
            context,
            'instagram'
          );

          return {
            type: 'reply',
            content: aiResult.response.message,
            confidence: 80,
            reasoning: 'Public reply to sales inquiry'
          };
        }
      }

      // Handle positive engagement
      if (analysis.sentiment === 'positive') {
        const positiveResponses = [
          `شكراً لك @${comment.username}! 🥰💕`,
          `نورتي @${comment.username}! ✨😍`,
          `أسعدنا تعليقك @${comment.username}! 🌹`,
          `@${comment.username} شكراً حبيبتي! 💙✨`
        ];

        const randomResponse = positiveResponses[Math.floor(Math.random() * positiveResponses.length)];

        return {
          type: 'reply',
          content: randomResponse,
          confidence: 70,
          reasoning: 'Positive engagement response'
        };
      }

      // Default: like the comment
      return {
        type: 'like',
        confidence: 50,
        reasoning: 'Default engagement action'
      };
    } catch (error) {
      this.logger.error('Comment response generation failed', error, { merchantId, commentId: comment.id });
      return {
        type: 'none',
        confidence: 0,
        reasoning: 'Response generation failed'
      };
    }
  }

  /**
   * Get comment analytics for merchant
   */
  public async getCommentAnalytics(
    merchantId: string,
    dateRange?: { from: Date; to: Date }
  ): Promise<CommentAnalytics> {
    try {
      const sql = this.db.getSQL();

      const dateFilter = dateRange 
        ? sql`AND created_at BETWEEN ${dateRange.from} AND ${dateRange.to}`
        : sql`AND created_at >= NOW() - INTERVAL '30 days'`;

      // Get basic comment stats
      const basicStats = await sql`
        SELECT 
          COUNT(*) as total_comments,
          AVG(sentiment_score) as avg_sentiment,
          COUNT(CASE WHEN sentiment_score > 60 THEN 1 END) as positive,
          COUNT(CASE WHEN sentiment_score BETWEEN 30 AND 60 THEN 1 END) as neutral,
          COUNT(CASE WHEN sentiment_score < 30 THEN 1 END) as negative,
          COUNT(CASE WHEN is_sales_inquiry = true THEN 1 END) as sales_inquiries
        FROM comment_interactions
        WHERE merchant_id = ${merchantId}::uuid
        ${dateFilter}
      `;

      // Get response stats
      const responseStats = await sql`
        SELECT 
          COUNT(CASE WHEN cr.response_type IS NOT NULL THEN 1 END) as responses,
          AVG(EXTRACT(EPOCH FROM (cr.created_at - ci.created_at))/60) as avg_response_time
        FROM comment_interactions ci
        LEFT JOIN comment_responses cr ON ci.id = cr.comment_id
        WHERE ci.merchant_id = ${merchantId}::uuid
        ${dateFilter}
      `;

      // Get top commenting users
      const topUsers = await sql`
        SELECT 
          username,
          COUNT(*) as comment_count,
          AVG(sentiment_score) as engagement_score
        FROM comment_interactions
        WHERE merchant_id = ${merchantId}::uuid
        ${dateFilter}
        AND username IS NOT NULL
        GROUP BY username
        ORDER BY comment_count DESC
        LIMIT 10
      `;

      // Get performance by post type
      const postTypeStats = await sql`
        SELECT 
          COALESCE((metadata->>'postType')::text, 'unknown') as post_type,
          COUNT(*) as comments,
          COUNT(CASE WHEN cr.response_type IS NOT NULL THEN 1 END) as responses,
          COUNT(CASE WHEN ci.is_sales_inquiry = true THEN 1 END) as conversions
        FROM comment_interactions ci
        LEFT JOIN comment_responses cr ON ci.id = cr.comment_id
        WHERE ci.merchant_id = ${merchantId}::uuid
        ${dateFilter}
        GROUP BY COALESCE((metadata->>'postType')::text, 'unknown')
      `;

      const stats = basicStats[0] || {};
      const responseData = responseStats[0] || {};

      return {
        totalComments: Number(stats.total_comments) || 0,
        responseRate: stats.total_comments > 0 
          ? (Number(responseData.responses) / Number(stats.total_comments)) * 100 
          : 0,
        averageResponseTime: Number(responseData.avg_response_time) || 0,
        sentimentBreakdown: {
          positive: Number(stats.positive) || 0,
          neutral: Number(stats.neutral) || 0,
          negative: Number(stats.negative) || 0
        },
        salesInquiries: Number(stats.sales_inquiries) || 0,
        dmConversions: 0, // Would need additional tracking
        topCommentingUsers: topUsers.map(user => ({
          username: user.username,
          commentCount: Number(user.comment_count),
          engagementScore: Number(user.engagement_score) || 0
        })),
        performanceByPostType: postTypeStats.reduce((acc, stat) => {
          acc[stat.post_type] = {
            comments: Number(stat.comments),
            responses: Number(stat.responses),
            conversions: Number(stat.conversions)
          };
          return acc;
        }, {} as any)
      };
    } catch (error) {
      this.logger.error('Comment analytics failed', error, { merchantId });
      throw error;
    }
  }

  /**
   * Create or update comment moderation rule
   */
  public async createModerationRule(
    merchantId: string,
    rule: Omit<CommentModerationRule, 'id'>
  ): Promise<string> {
    try {
      const sql = this.db.getSQL();

      const result = await sql`
        INSERT INTO comment_moderation_rules (
          merchant_id,
          name,
          trigger_config,
          action_config,
          is_active,
          created_at
        ) VALUES (
          ${merchantId}::uuid,
          ${rule.name},
          ${JSON.stringify(rule.trigger)},
          ${JSON.stringify(rule.action)},
          ${rule.isActive},
          NOW()
        )
        RETURNING id
      `;

      const ruleId = result[0].id;
      this.logger.info('Comment moderation rule created', { ruleName: rule.name, ruleId });
      return ruleId;
    } catch (error) {
      this.logger.error('Moderation rule creation failed', error, { merchantId, rule: rule.name });
      throw error;
    }
  }

  /**
   * Private: Store comment in database
   */
  private async storeComment(comment: CommentInteraction, merchantId: string): Promise<void> {
    try {
      const sql = this.db.getSQL();

      await sql`
        INSERT INTO comment_interactions (
          id,
          merchant_id,
          post_id,
          parent_comment_id,
          user_id,
          username,
          content,
          timestamp,
          is_reply,
          metadata,
          created_at
        ) VALUES (
          ${comment.id},
          ${merchantId}::uuid,
          ${comment.postId},
          ${comment.parentCommentId || null},
          ${comment.userId},
          ${comment.username},
          ${comment.content},
          ${comment.timestamp},
          ${comment.isReply},
          ${comment.metadata ? JSON.stringify(comment.metadata) : null},
          NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          content = EXCLUDED.content,
          updated_at = NOW()
      `;
    } catch (error) {
      this.logger.error('Store comment failed', error, { merchantId, commentId: comment.id });
      throw error;
    }
  }

  /**
   * Private: Perform fallback comment analysis
   */
  private performFallbackAnalysis(comment: CommentInteraction): any {
    const content = comment.content.toLowerCase();

    // Sales inquiry keywords
    const salesKeywords = [
      'سعر', 'كم', 'متوفر', 'أريد', 'اشتري', 'طلب', 'توصيل',
      'price', 'how much', 'available', 'want', 'buy', 'order'
    ];

    // Complaint keywords
    const complaintKeywords = [
      'شكوى', 'مشكلة', 'غلط', 'خطأ', 'سيء', 'مش عاجبني',
      'complaint', 'problem', 'issue', 'wrong', 'bad', 'terrible'
    ];

    // Positive keywords
    const positiveKeywords = [
      'حلو', 'جميل', 'رائع', 'ممتاز', 'أحبه', 'عجبني',
      'nice', 'beautiful', 'amazing', 'excellent', 'love', 'great'
    ];

    const isSalesInquiry = salesKeywords.some(keyword => content.includes(keyword));
    const isComplaint = complaintKeywords.some(keyword => content.includes(keyword));
    const hasPositiveWords = positiveKeywords.some(keyword => content.includes(keyword));

    let sentiment: 'positive' | 'neutral' | 'negative' = 'neutral';
    let sentimentScore = 50;

    if (hasPositiveWords && !isComplaint) {
      sentiment = 'positive';
      sentimentScore = 75;
    } else if (isComplaint) {
      sentiment = 'negative';
      sentimentScore = 25;
    }

    return {
      sentiment,
      sentimentScore,
      isSalesInquiry,
      isComplaint,
      isSpam: false, // Basic spam detection could be added
      keywords: [],
      urgencyLevel: isComplaint ? 'high' : isSalesInquiry ? 'medium' : 'low',
      recommendedAction: isComplaint ? 'dm_invite' : isSalesInquiry ? 'reply' : 'like'
    };
  }

  /**
   * Private: Check if should invite to DM
   */
  private shouldInviteToDM(comment: CommentInteraction, analysis: any): boolean {
    // Invite to DM for detailed sales inquiries
    const detailedInquiryKeywords = [
      'سعر', 'أسعار', 'كم', 'توصيل', 'طلب', 'اشتري',
      'price', 'prices', 'delivery', 'order', 'buy'
    ];

    const content = comment.content.toLowerCase();
    return detailedInquiryKeywords.some(keyword => content.includes(keyword));
  }

  /**
   * Private: Reply to comment
   */
  private async replyToComment(
    commentId: string,
    replyText: string,
    merchantId: string
  ): Promise<boolean> {
    try {
      const instagramClient = this.getClient(merchantId);
      const credentials = await this.getCredentials(merchantId);

      const result = await instagramClient.replyToComment(credentials, merchantId, commentId, replyText);
      return result.success;
    } catch (error) {
      this.logger.error('Reply to comment failed', error, { merchantId, commentId });
      return false;
    }
  }

  /**
   * Private: Invite commenter to DM
   */
  private async inviteCommentToDM(
    comment: CommentInteraction,
    inviteMessage: string,
    merchantId: string
  ): Promise<boolean> {
    try {
      const instagramClient = this.getClient(merchantId);
      const credentials = await this.getCredentials(merchantId);

      // Reply to comment with DM invitation
      const replyResult = await instagramClient.replyToComment(credentials, merchantId, comment.id, inviteMessage);
      
      if (replyResult.success) {
        // Send DM to user
        const dmResult = await instagramClient.sendMessage(credentials, merchantId, {
          recipientId: comment.userId,
          messageType: 'text',
          content: `مرحباً ${comment.username}! شكراً لتعليقك 🌹 كيف أقدر أساعدك؟`
        });

        return dmResult.success;
      }

      return false;
    } catch (error) {
      this.logger.error('Invite to DM failed', error, { merchantId, commentId: comment.id });
      return false;
    }
  }

  /**
   * Private: Store comment analysis
   */
  private async storeCommentAnalysis(
    commentId: string,
    analysis: any,
    merchantId: string
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();

      await sql`
        UPDATE comment_interactions
        SET 
          sentiment_score = ${analysis.sentimentScore},
          is_sales_inquiry = ${analysis.isSalesInquiry},
          is_complaint = ${analysis.isComplaint},
          is_spam = ${analysis.isSpam},
          urgency_level = ${analysis.urgencyLevel},
          analysis_data = ${JSON.stringify(analysis)},
          updated_at = NOW()
        WHERE id = ${commentId}
        AND merchant_id = ${merchantId}::uuid
      `;
    } catch (error) {
      this.logger.error('Store comment analysis failed', error, { merchantId, commentId });
    }
  }

  /**
   * Private: Log comment response
   */
  private async logCommentResponse(
    commentId: string,
    responseContent: string,
    responseType: string,
    merchantId: string
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();

      await sql`
        INSERT INTO comment_responses (
          comment_id,
          merchant_id,
          response_type,
          response_content,
          created_at
        ) VALUES (
          ${commentId},
          ${merchantId}::uuid,
          ${responseType},
          ${responseContent},
          NOW()
        )
      `;
    } catch (error) {
      this.logger.error('Log comment response failed', error, { merchantId, commentId });
    }
  }

  /**
   * Private: Check moderation rules
   */
  private async checkModerationRules(
    comment: CommentInteraction,
    merchantId: string
  ): Promise<{ rule: CommentModerationRule; action: any } | null> {
    try {
      const sql = this.db.getSQL();

      const rules = await sql`
        SELECT *
        FROM comment_moderation_rules
        WHERE merchant_id = ${merchantId}::uuid
        AND is_active = true
        ORDER BY (action_config->>'priority')::int DESC
      `;

      for (const ruleData of rules) {
        let triggerConfig;
        try {
          triggerConfig = JSON.parse(ruleData.trigger_config);
        } catch (err) {
          console.error(`❌ Invalid trigger_config for rule ${ruleData.id}:`, err);
          continue;
        }

        let actionConfig;
        try {
          actionConfig = JSON.parse(ruleData.action_config);
        } catch (err) {
          console.error(`❌ Invalid action_config for rule ${ruleData.id}:`, err);
          continue;
        }

        const rule: CommentModerationRule = {
          id: ruleData.id,
          name: ruleData.name,
          trigger: triggerConfig,
          action: actionConfig,
          isActive: ruleData.is_active
        };

        if (this.evaluateRule(rule, comment)) {
          return { rule, action: rule.action };
        }
      }

      return null;
    } catch (error) {
      this.logger.error('Check moderation rules failed', error, { merchantId });
      return null;
    }
  }

  /**
   * Private: Evaluate moderation rule
   */
  private evaluateRule(rule: CommentModerationRule, comment: CommentInteraction): boolean {
    try {
      const { trigger } = rule;
      const content = comment.content.toLowerCase();

      switch (trigger.type) {
        case 'keyword':
          return trigger.operator === 'contains' 
            ? content.includes(String(trigger.value).toLowerCase())
            : content === String(trigger.value).toLowerCase();
        
        case 'sentiment':
          const sentimentScore = comment.sentimentScore || 50;
          if (trigger.operator === 'less_than') {
            return sentimentScore < Number(trigger.value);
          } else if (trigger.operator === 'greater_than') {
            return sentimentScore > Number(trigger.value);
          }
          break;
        
        case 'spam':
          // Basic spam detection logic
          const spamKeywords = ['spam', 'promotional', 'link', 'follow4follow'];
          return spamKeywords.some(keyword => content.includes(keyword));
        
        default:
          return false;
      }

      return false;
    } catch (error) {
      this.logger.error('Rule evaluation failed', error, { ruleId: rule.id });
      return false;
    }
  }

  /**
   * Private: Update comment analytics
   */
  private async updateCommentAnalytics(
    merchantId: string,
    comment: CommentInteraction,
    response: CommentResponse
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();

      await sql`
        INSERT INTO daily_analytics (
          merchant_id,
          date,
          platform,
          comments_received,
          comments_responded,
          response_rate
        ) VALUES (
          ${merchantId}::uuid,
          CURRENT_DATE,
          'instagram',
          1,
          ${response.type !== 'none' ? 1 : 0},
          ${response.type !== 'none' ? 100.0 : 0.0}
        )
        ON CONFLICT (merchant_id, date, platform)
        DO UPDATE SET
          comments_received = daily_analytics.comments_received + 1,
          comments_responded = daily_analytics.comments_responded + ${response.type !== 'none' ? 1 : 0},
          response_rate = (daily_analytics.comments_responded::float / daily_analytics.comments_received::float) * 100,
          updated_at = NOW()
      `;
    } catch (error) {
      this.logger.error('Update comment analytics failed', error, { merchantId });
    }
  }

  /**
   * Private: Create sales opportunity from comment
   */
  private async createSalesOpportunity(
    comment: CommentInteraction,
    merchantId: string
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
          ${comment.userId},
          'instagram',
          'COMMENT_INQUIRY',
          'NEW',
          ${JSON.stringify({ 
            commentId: comment.id, 
            postId: comment.postId,
            commentContent: comment.content,
            source: 'comment' 
          })},
          NOW()
        )
        ON CONFLICT (merchant_id, customer_id, source_platform)
        DO UPDATE SET
          status = 'ACTIVE',
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `;
    } catch (error) {
      this.logger.error('Create sales opportunity failed', error, { merchantId, commentId: comment.id });
    }
  }
}

// Singleton instance
let commentsManagerInstance: InstagramCommentsManager | null = null;

/**
 * Get Instagram Comments Manager instance
 */
export function getInstagramCommentsManager(): InstagramCommentsManager {
  if (!commentsManagerInstance) {
    commentsManagerInstance = new InstagramCommentsManager();
  }
  return commentsManagerInstance;
}

export default InstagramCommentsManager;