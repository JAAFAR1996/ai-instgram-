/**
 * ===============================================
 * Instagram Hashtag and Mention Processor
 * Advanced processing of hashtags and mentions in Instagram content
 * ===============================================
 */

import { getDatabase } from '../db/adapter.js';
import type { Sql } from '../types/sql.js';
import { logger } from './logger.js';

const TIMEFRAME_INTERVALS: Record<'day' | 'week' | 'month', string> = {
  day: '1 day',
  week: '7 days',
  month: '30 days'
};

export interface HashtagAnalysis {
  hashtag: string;
  frequency: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  category: 'product' | 'brand' | 'trend' | 'event' | 'generic';
  marketingValue: 'high' | 'medium' | 'low';
  suggestedActions: string[];
  relatedHashtags: string[];
}

export interface MentionAnalysis {
  mentionedUser: string;
  context: string;
  mentionType: 'customer' | 'influencer' | 'competitor' | 'brand' | 'generic';
  sentiment: 'positive' | 'neutral' | 'negative';
  engagementPotential: 'high' | 'medium' | 'low';
  suggestedResponse?: string;
  followUpActions: string[];
}

export interface ContentHashtagMentionData {
  messageId: string;
  content: string;
  hashtags: string[];
  mentions: string[];
  source: 'comment' | 'dm' | 'story' | 'post';
  timestamp: Date;
  userId: string;
  merchantId: string;
}

export interface HashtagTrendAnalysis {
  hashtag: string;
  totalUsage: number;
  recentGrowth: number; // percentage change
  topAssociatedWords: string[];
  sentimentTrend: {
    positive: number;
    neutral: number;
    negative: number;
  };
  peakUsageTimes: string[];
  competitorUsage: number;
  recommendedStrategy: string;
}

export interface HashtagStrategy {
  id: string;
  merchantId: string;
  name: string;
  targetHashtags: string[];
  monitoringKeywords: string[];
  autoResponseRules: {
    hashtag: string;
    condition: string;
    responseTemplate: string;
    isActive: boolean;
  }[];
  campaignGoals: string[];
  successMetrics: {
    engagementIncrease: number;
    reachTarget: number;
    conversionGoals: number;
  };
}

export class InstagramHashtagMentionProcessor {
  private db = getDatabase();

  /**
   * Process hashtags and mentions from content
   */
  public async processContent(data: ContentHashtagMentionData): Promise<{
    success: boolean;
    hashtagAnalyses: HashtagAnalysis[];
    mentionAnalyses: MentionAnalysis[];
    suggestedActions: string[];
    error?: string;
  }> {
    try {
      logger.info(`#️⃣ Processing content with ${data.hashtags.length} hashtags and ${data.mentions.length} mentions`);

      // Extract and validate hashtags/mentions
      const extractedHashtags = this.extractHashtags(data.content);
      const extractedMentions = this.extractMentions(data.content);

      // Combine with provided data
      const allHashtags = Array.from(new Set([...data.hashtags, ...extractedHashtags]));
      const allMentions = Array.from(new Set([...data.mentions, ...extractedMentions]));

      // Limit processing to prevent excessive concurrency
      const MAX_ITEMS = 5;
      const limitedHashtags = allHashtags.slice(0, MAX_ITEMS);
      if (allHashtags.length > MAX_ITEMS) {
        console.warn(
          `⚠️ Received ${allHashtags.length} hashtags, processing first ${MAX_ITEMS} only`
        );
      }

      const limitedMentions = allMentions.slice(0, MAX_ITEMS);
      if (allMentions.length > MAX_ITEMS) {
        console.warn(
          `⚠️ Received ${allMentions.length} mentions, processing first ${MAX_ITEMS} only`
        );
      }

      // Analyze hashtags
      const hashtagAnalyses = await Promise.all(
        limitedHashtags.map(hashtag => this.analyzeHashtag(hashtag, data))
      );

      // Analyze mentions
      const mentionAnalyses = await Promise.all(
        limitedMentions.map(mention => this.analyzeMention(mention, data))
      );

      // Store the analysis results
      await this.storeHashtagMentionData(data, hashtagAnalyses, mentionAnalyses);

      // Generate suggested actions
      const suggestedActions = this.generateSuggestedActions(hashtagAnalyses, mentionAnalyses, data);

      // Update trending data
      await this.updateTrendingData(limitedHashtags, data.merchantId);

      // Check for marketing opportunities
      await this.checkMarketingOpportunities(hashtagAnalyses, mentionAnalyses, data);

      logger.info(
        `✅ Processed ${limitedHashtags.length} hashtags and ${limitedMentions.length} mentions`
      );

      return {
        success: true,
        hashtagAnalyses,
        mentionAnalyses,
        suggestedActions
      };
    } catch (error) {
      console.error('❌ Hashtag/mention processing failed:', error);
      return {
        success: false,
        hashtagAnalyses: [],
        mentionAnalyses: [],
        suggestedActions: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Analyze hashtag trends for merchant
   */
  public async getHashtagTrends(
    merchantId: string,
    timeframe: 'day' | 'week' | 'month' = 'week'
  ): Promise<HashtagTrendAnalysis[]> {
    try {
      const sql: Sql = this.db.getSQL();
      const intervalValue = TIMEFRAME_INTERVALS[timeframe] || TIMEFRAME_INTERVALS.week;
      const trends = await sql.unsafe<{
        hashtag: string;
        total_usage: string;
        avg_sentiment: string;
        positive_count: string;
        neutral_count: string;
        negative_count: string;
        usage_hours: number[];
      }>(`
        SELECT
          hashtag,
          COUNT(*) as total_usage,
          AVG(CASE
            WHEN hm.sentiment = 'positive' THEN 1
            WHEN hm.sentiment = 'negative' THEN -1
            ELSE 0
          END) as avg_sentiment,
          COUNT(CASE WHEN hm.sentiment = 'positive' THEN 1 END) as positive_count,
          COUNT(CASE WHEN hm.sentiment = 'neutral' THEN 1 END) as neutral_count,
          COUNT(CASE WHEN hm.sentiment = 'negative' THEN 1 END) as negative_count,
          ARRAY_AGG(DISTINCT EXTRACT(HOUR FROM hm.created_at)) as usage_hours
        FROM hashtag_mentions hm
        WHERE hm.merchant_id = ${merchantId}::uuid
        AND hm.hashtag IS NOT NULL
        AND hm.created_at >= NOW() - ${intervalValue}::interval
        GROUP BY hashtag
        HAVING COUNT(*) >= 2
        ORDER BY total_usage DESC
        LIMIT 20
      `);

      // Process trends in parallel using Promise.allSettled
      const trendProcessingPromises = trends.map(async (trend) => {
        try {
          const trendData = (trend as unknown) as { hashtag: string; total_usage: string; avg_sentiment: string; positive_count: string; neutral_count: string; negative_count: string; usage_hours: number[] };
          
          // Calculate growth and get associated words in parallel
          const [recentGrowth, associatedWords] = await Promise.all([
            this.calculateHashtagGrowth(trendData.hashtag, merchantId, timeframe),
            this.getAssociatedWords(trendData.hashtag, merchantId)
          ]);

          return {
            hashtag: trendData.hashtag,
            totalUsage: Number(trendData.total_usage),
            recentGrowth,
            topAssociatedWords: associatedWords.slice(0, 5),
            sentimentTrend: {
              positive: Number(trendData.positive_count),
              neutral: Number(trendData.neutral_count),
              negative: Number(trendData.negative_count)
            },
            peakUsageTimes: (trendData.usage_hours || []).map((hour: number) => `${Number(hour)}:00`),
            competitorUsage: 0, // Would need competitor tracking
            recommendedStrategy: Number(trendData.total_usage) > 10 
              ? 'استراتيجية تركيز عالية - استخدم هذا الهاشتاغ في المحتوى الترويجي'
              : 'استراتيجية مراقبة - تابع نمو هذا الهاشتاغ'
          };
        } catch (error) {
          logger.error(`Failed to process trend for hashtag: ${trend.hashtag}`, error);
          return null;
        }
      });

      const trendResults = await Promise.allSettled(trendProcessingPromises);
      const trendAnalyses: HashtagTrendAnalysis[] = trendResults
        .filter((result): result is PromiseFulfilledResult<HashtagTrendAnalysis> => 
          result.status === 'fulfilled' && result.value !== null
        )
        .map(result => result.value);

      return trendAnalyses;
    } catch (error) {
      console.error('❌ Get hashtag trends failed:', error);
      return [];
    }
  }

  /**
   * Create hashtag monitoring strategy
   */
  public async createHashtagStrategy(
    merchantId: string,
    strategy: Omit<HashtagStrategy, 'id'>
  ): Promise<string> {
    try {
      const sql: Sql = this.db.getSQL();
      const result = await sql<{ id: string }>`
        INSERT INTO hashtag_strategies (
          merchant_id,
          name,
          target_hashtags,
          monitoring_keywords,
          auto_response_rules,
          campaign_goals,
          success_metrics,
          created_at
        ) VALUES (
          ${merchantId}::uuid,
          ${strategy.name},
          ${JSON.stringify(strategy.targetHashtags)},
          ${JSON.stringify(strategy.monitoringKeywords)},
          ${JSON.stringify(strategy.autoResponseRules)},
          ${JSON.stringify(strategy.campaignGoals)},
          ${JSON.stringify(strategy.successMetrics)},
          NOW()
        )
        RETURNING id
      `;

      const strategyId = ((result[0] as unknown) as { id: string })?.id ?? '';
      logger.info(`✅ Hashtag strategy created: ${strategy.name} (${strategyId})`);
      return strategyId;
    } catch (error) {
      console.error('❌ Create hashtag strategy failed:', error);
      throw error;
    }
  }

  /**
   * Get hashtag performance analytics
   */
  public async getHashtagAnalytics(
    merchantId: string,
    dateRange?: { from: Date; to: Date }
  ): Promise<{
    totalHashtagsUsed: number;
    topPerformingHashtags: Array<{
      hashtag: string;
      usage: number;
      engagement: number;
      sentiment: number;
    }>;
    mentionAnalytics: {
      totalMentions: number;
      influencerMentions: number;
      customerMentions: number;
      competitorMentions: number;
    };
    trendingHashtags: string[];
    recommendedHashtags: string[];
  }> {
    try {
      const sql: Sql = this.db.getSQL();

      const dateFilter = dateRange
        ? sql`AND created_at BETWEEN ${dateRange.from} AND ${dateRange.to}`
        : sql`AND created_at >= NOW() - INTERVAL '30 days'`;
      const hashtagStats = await sql.unsafe<{
        hashtag: string;
        usage_count: string;
        avg_engagement: string;
        sentiment_score: string;
      }>(`
        SELECT
          hashtag,
          COUNT(*) as usage_count,
          AVG(engagement_score) as avg_engagement,
          AVG(CASE
            WHEN sentiment = 'positive' THEN 1
            WHEN sentiment = 'negative' THEN -1
            ELSE 0
          END) as sentiment_score
        FROM hashtag_mentions
        WHERE merchant_id = ${merchantId}::uuid
        AND hashtag IS NOT NULL
        ${dateFilter}
        GROUP BY hashtag
        ORDER BY usage_count DESC, avg_engagement DESC
        LIMIT 10
      `);

      // Get mention statistics
      const mentionStats = await sql.unsafe<{
        mention_type: string;
        count: string;
      }>(`
        SELECT
          mention_type,
          COUNT(*) as count
        FROM hashtag_mentions
        WHERE merchant_id = ${merchantId}::uuid
        AND mentioned_user IS NOT NULL
        ${dateFilter}
        GROUP BY mention_type
      `);

      // Get trending hashtags (growing in usage)
      const trendingHashtags = await this.identifyTrendingHashtags(merchantId);

      // Generate recommended hashtags based on performance
      const recommendedHashtags = await this.generateHashtagRecommendations(merchantId);

      return {
        totalHashtagsUsed: hashtagStats.length,
        topPerformingHashtags: hashtagStats.map(stat => ({
          hashtag: ((stat as unknown) as { hashtag: string; usage_count: string; avg_engagement: string; sentiment_score: string })?.hashtag ?? '',
          usage: Number(((stat as unknown) as { hashtag: string; usage_count: string; avg_engagement: string; sentiment_score: string })?.usage_count ?? 0),
          engagement: Number(((stat as unknown) as { hashtag: string; usage_count: string; avg_engagement: string; sentiment_score: string })?.avg_engagement ?? 0),
          sentiment: Number(((stat as unknown) as { hashtag: string; usage_count: string; avg_engagement: string; sentiment_score: string })?.sentiment_score ?? 0)
        })),
        mentionAnalytics: {
          totalMentions: mentionStats.reduce((sum, stat) => sum + Number(((stat as unknown) as { mention_type: string; count: string })?.count ?? 0), 0),
          influencerMentions: Number((mentionStats.find(s => ((s as unknown) as { mention_type: string })?.mention_type === 'influencer') as { count: string } | undefined)?.count ?? 0),
          customerMentions: Number((mentionStats.find(s => ((s as unknown) as { mention_type: string })?.mention_type === 'customer') as { count: string } | undefined)?.count ?? 0),
          competitorMentions: Number((mentionStats.find(s => ((s as unknown) as { mention_type: string })?.mention_type === 'competitor') as { count: string } | undefined)?.count ?? 0)
        },
        trendingHashtags,
        recommendedHashtags
      };
    } catch (error) {
      console.error('❌ Hashtag analytics failed:', error);
      throw error;
    }
  }

  /**
   * Private: Extract hashtags from content
   */
  private extractHashtags(content: string): string[] {
    // يشمل العربية + الأرقام/الحروف والشرطة السفلية
    const hashtagRegex = /#[\u0600-\u06FF\w]+/g;
    const matches = content.match(hashtagRegex) || [];
    return matches.map(hashtag => hashtag.toLowerCase().substring(1)); // Remove # symbol
  }

  /**
   * Private: Extract mentions from content
   */
  private extractMentions(content: string): string[] {
    const mentionRegex = /@[\u0600-\u06FF\w]+/g;
    const matches = content.match(mentionRegex) || [];
    return matches.map(mention => mention.substring(1)); // Remove @ symbol
  }

  /**
   * Private: Analyze individual hashtag
   */
  private async analyzeHashtag(
    hashtag: string,
    data: ContentHashtagMentionData
  ): Promise<HashtagAnalysis> {
    try {
      // Get hashtag frequency and context
      const frequency = await this.getHashtagFrequency(hashtag, data.merchantId);
      
      // Analyze sentiment based on context
      const sentiment = this.analyzeHashtagSentiment(hashtag, data.content);
      
      // Categorize hashtag
      const category = this.categorizeHashtag(hashtag);
      
      // Determine marketing value
      const marketingValue = this.assessMarketingValue(hashtag, category, frequency);
      
      // Generate suggested actions
      const suggestedActions = this.generateHashtagActions(hashtag, category, sentiment);
      
      // Find related hashtags
      const relatedHashtags = await this.findRelatedHashtags(hashtag, data.merchantId);

      return {
        hashtag,
        frequency,
        sentiment,
        category,
        marketingValue,
        suggestedActions,
        relatedHashtags
      };
    } catch (error) {
      console.error(`❌ Hashtag analysis failed for #${hashtag}:`, error);
      return {
        hashtag,
        frequency: 0,
        sentiment: 'neutral',
        category: 'generic',
        marketingValue: 'low',
        suggestedActions: [],
        relatedHashtags: []
      };
    }
  }

  /**
   * Private: Analyze individual mention
   */
  private async analyzeMention(
    mention: string,
    data: ContentHashtagMentionData
  ): Promise<MentionAnalysis> {
    try {
      // Determine mention type
      const mentionType = await this.categorizeMention(mention, data.merchantId);
      
      // Analyze sentiment
      const sentiment = this.analyzeMentionSentiment(mention, data.content);
      
      // Assess engagement potential
      const engagementPotential = this.assessEngagementPotential(mention, mentionType, sentiment);
      
      // Generate suggested response
      const suggestedResponse = this.generateMentionResponse(mention, mentionType, sentiment, data);
      
      // Determine follow-up actions
      const followUpActions = this.generateMentionActions(mention, mentionType, sentiment);

      return {
        mentionedUser: mention,
        context: data.content,
        mentionType,
        sentiment,
        engagementPotential,
        suggestedResponse,
        followUpActions
      };
    } catch (error) {
      console.error(`❌ Mention analysis failed for @${mention}:`, error);
      return {
        mentionedUser: mention,
        context: data.content,
        mentionType: 'generic',
        sentiment: 'neutral',
        engagementPotential: 'low',
        followUpActions: []
      };
    }
  }

  /**
   * Private: Categorize hashtag
   */
  private categorizeHashtag(hashtag: string): 'product' | 'brand' | 'trend' | 'event' | 'generic' {
    const productKeywords = ['منتج', 'سعر', 'تسوق', 'عرض', 'product', 'price', 'shopping', 'sale'];
    const brandKeywords = ['براند', 'ماركة', 'brand', 'logo', 'company'];
    const trendKeywords = ['ترند', 'موضة', 'جديد', 'trend', 'fashion', 'new', 'viral'];
    const eventKeywords = ['حدث', 'مناسبة', 'عيد', 'event', 'occasion', 'celebration'];

    const lowerHashtag = hashtag.toLowerCase();

    if (productKeywords.some(keyword => lowerHashtag.includes(keyword))) {
      return 'product';
    }
    if (brandKeywords.some(keyword => lowerHashtag.includes(keyword))) {
      return 'brand';
    }
    if (trendKeywords.some(keyword => lowerHashtag.includes(keyword))) {
      return 'trend';
    }
    if (eventKeywords.some(keyword => lowerHashtag.includes(keyword))) {
      return 'event';
    }

    return 'generic';
  }

  /**
   * Private: Analyze hashtag sentiment
   */
  private analyzeHashtagSentiment(_hashtag: string, content: string): 'positive' | 'neutral' | 'negative' {
    const positiveWords = ['حب', 'عجب', 'جميل', 'رائع', 'ممتاز', 'love', 'amazing', 'great', 'excellent'];
    const negativeWords = ['سيء', 'مش عاجب', 'غلط', 'خطأ', 'bad', 'terrible', 'wrong', 'awful'];

    const lowerContent = content.toLowerCase();

    const positiveCount = positiveWords.filter(word => lowerContent.includes(word)).length;
    const negativeCount = negativeWords.filter(word => lowerContent.includes(word)).length;

    if (positiveCount > negativeCount) return 'positive';
    if (negativeCount > positiveCount) return 'negative';
    return 'neutral';
  }

  /**
   * Private: Assess marketing value
   */
  private assessMarketingValue(
    hashtag: string,
    category: string,
    frequency: number
  ): 'high' | 'medium' | 'low' {
    if (frequency === 0) {
      return 'low';
    }
    if (category === 'product' || category === 'brand') {
      return frequency > 5 ? 'high' : 'medium';
    }
    if (category === 'trend' && frequency > 3) {
      return 'high';
    }
    if (frequency > 10) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Private: Generate hashtag actions
   */
  private generateHashtagActions(
    hashtag: string,
    category: string,
    sentiment: string
  ): string[] {
    const actions: string[] = [];

    if (category === 'product' && sentiment === 'positive') {
      actions.push('إنشاء محتوى إضافي للمنتج');
      actions.push('تشجيع العملاء على استخدام الهاشتاغ');
    }

    if (category === 'trend') {
      actions.push('متابعة الترند والمشاركة فيه');
      actions.push('إنشاء محتوى يواكب الترند');
    }

    if (sentiment === 'negative') {
      actions.push('متابعة الهاشتاغ ومعالجة المشاكل');
      actions.push('تحسين الخدمة أو المنتج');
    }

    if (actions.length === 0) {
      actions.push('مراقبة الهاشتاغ للفرص المستقبلية');
    }

    return actions;
  }

  /**
   * Private: Store hashtag/mention data with batch processing
   */
  private async storeHashtagMentionData(
    data: ContentHashtagMentionData,
    hashtagAnalyses: HashtagAnalysis[],
    mentionAnalyses: MentionAnalysis[]
  ): Promise<void> {
    try {
      const sql: Sql = this.db.getSQL();
      const BATCH_SIZE = 10; // Process in batches of 10

      // Process hashtag data in batches
      const hashtagBatches = this.chunkArray(hashtagAnalyses, BATCH_SIZE);
      const hashtagBatchPromises = hashtagBatches.map(async (batch) => {
        try {
          const batchPromises = batch.map(analysis => sql`
            INSERT INTO hashtag_mentions (
              message_id,
              merchant_id,
              hashtag,
              mentioned_user,
              content,
              source,
              sentiment,
              category,
              marketing_value,
              engagement_score,
              user_id,
              created_at
            ) VALUES (
              ${data.messageId},
              ${data.merchantId}::uuid,
              ${analysis.hashtag},
              NULL,
              ${data.content},
              ${data.source},
              ${analysis.sentiment},
              ${analysis.category},
              ${analysis.marketingValue},
              ${this.calculateEngagementScore(analysis)},
              ${data.userId},
              ${data.timestamp}
            )
            ON CONFLICT (message_id, hashtag) DO UPDATE SET
              sentiment = EXCLUDED.sentiment,
              updated_at = NOW()
          `);
          return Promise.allSettled(batchPromises);
        } catch (error) {
          logger.error('Failed to process hashtag batch:', error);
          return Promise.resolve([]);
        }
      });

      // Process mention data in batches
      const mentionBatches = this.chunkArray(mentionAnalyses, BATCH_SIZE);
      const mentionBatchPromises = mentionBatches.map(async (batch) => {
        try {
          const batchPromises = batch.map(analysis => sql`
            INSERT INTO hashtag_mentions (
              message_id,
              merchant_id,
              hashtag,
              mentioned_user,
              content,
              source,
              sentiment,
              mention_type,
              engagement_potential,
              engagement_score,
              user_id,
              created_at
            ) VALUES (
              ${data.messageId},
              ${data.merchantId}::uuid,
              NULL,
              ${analysis.mentionedUser},
              ${data.content},
              ${data.source},
              ${analysis.sentiment},
              ${analysis.mentionType},
              ${analysis.engagementPotential},
              ${this.calculateMentionEngagementScore(analysis)},
              ${data.userId},
              ${data.timestamp}
            )
            ON CONFLICT (message_id, mentioned_user) DO UPDATE SET
              sentiment = EXCLUDED.sentiment,
              updated_at = NOW()
          `);
          return Promise.allSettled(batchPromises);
        } catch (error) {
          logger.error('Failed to process mention batch:', error);
          return Promise.resolve([]);
        }
      });

      // Execute all batches in parallel
      const [hashtagResults, mentionResults] = await Promise.allSettled([
        Promise.allSettled(hashtagBatchPromises),
        Promise.allSettled(mentionBatchPromises)
      ]);

      // Log results
      if (hashtagResults.status === 'fulfilled') {
        const successfulHashtagBatches = hashtagResults.value.filter(result => result.status === 'fulfilled').length;
        logger.info(`✅ Processed ${successfulHashtagBatches}/${hashtagBatches.length} hashtag batches successfully`);
      }

      if (mentionResults.status === 'fulfilled') {
        const successfulMentionBatches = mentionResults.value.filter(result => result.status === 'fulfilled').length;
        logger.info(`✅ Processed ${successfulMentionBatches}/${mentionBatches.length} mention batches successfully`);
      }

    } catch (error) {
      logger.error('❌ Store hashtag/mention data failed:', error);
    }
  }

  /**
   * Private: Helper method to chunk array into batches
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Private: Calculate engagement score for hashtag
   */
  private calculateEngagementScore(analysis: HashtagAnalysis): number {
    let score = 50; // Base score

    // Marketing value bonus
    if (analysis.marketingValue === 'high') score += 30;
    else if (analysis.marketingValue === 'medium') score += 15;

    // Sentiment bonus/penalty
    if (analysis.sentiment === 'positive') score += 20;
    else if (analysis.sentiment === 'negative') score -= 20;

    // Category bonus
    if (analysis.category === 'product' || analysis.category === 'brand') score += 15;

    // Frequency bonus
    score += Math.min(analysis.frequency * 2, 20);

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Private: Calculate engagement score for mention
   */
  private calculateMentionEngagementScore(analysis: MentionAnalysis): number {
    let score = 50; // Base score

    // Engagement potential bonus
    if (analysis.engagementPotential === 'high') score += 30;
    else if (analysis.engagementPotential === 'medium') score += 15;

    // Sentiment bonus/penalty
    if (analysis.sentiment === 'positive') score += 20;
    else if (analysis.sentiment === 'negative') score -= 10;

    // Mention type bonus
    if (analysis.mentionType === 'influencer') score += 25;
    else if (analysis.mentionType === 'customer') score += 15;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Private: Get other helper methods...
   */
  private async getHashtagFrequency(hashtag: string, merchantId: string): Promise<number> {
    try {
      const sql: Sql = this.db.getSQL();
      const result = await sql`
        SELECT COUNT(*) as frequency
        FROM hashtag_mentions
        WHERE hashtag = ${hashtag}
        AND merchant_id = ${merchantId}::uuid
        AND created_at >= NOW() - INTERVAL '30 days'
      `;
      return Number(((result[0] as unknown) as { frequency: string })?.frequency || 0);
    } catch (error) {
      console.error('Error getting hashtag frequency:', error);
      return 0;
    }
  }

  private async calculateHashtagGrowth(
    hashtag: string,
    merchantId: string,
    timeframe: 'day' | 'week' | 'month'
  ): Promise<number> {
    try {
      const sql: Sql = this.db.getSQL();
      const intervalValue = TIMEFRAME_INTERVALS[timeframe] || TIMEFRAME_INTERVALS.week;
      const result = await sql`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= NOW() - ${intervalValue}::interval) AS current_count,
          COUNT(*) FILTER (
            WHERE created_at >= NOW() - ${intervalValue}::interval * 2
              AND created_at < NOW() - ${intervalValue}::interval
          ) AS previous_count
        FROM hashtag_mentions
        WHERE hashtag = ${hashtag}
          AND merchant_id = ${merchantId}::uuid
      `;

      const current = Number(((result[0] as unknown) as { current_count: string })?.current_count || 0);
      const previous = Number(((result[0] as unknown) as { previous_count: string })?.previous_count || 0);

      if (previous === 0) {
        return current > 0 ? 100 : 0;
      }
      return ((current - previous) / previous) * 100;
    } catch (error) {
      console.error('Error calculating hashtag growth:', error);
      return 0;
    }
  }

  private async getAssociatedWords(hashtag: string, merchantId: string): Promise<string[]> {
    // Would analyze content that includes this hashtag
    return ['منتج', 'جديد', 'عرض']; // Placeholder
  }

  private generateHashtagStrategy(trend: any): string {
    if (Number(trend.total_usage) > 10) {
      return 'استراتيجية تركيز عالية - استخدم هذا الهاشتاغ في المحتوى الترويجي';
    }
    return 'استراتيجية مراقبة - تابع نمو هذا الهاشتاغ';
  }

  private async categorizeMention(mention: string, merchantId: string): Promise<'customer' | 'influencer' | 'competitor' | 'brand' | 'generic'> {
    // Would check against known user types/influencers database
    return 'customer'; // Placeholder
  }

  private analyzeMentionSentiment(mention: string, content: string): 'positive' | 'neutral' | 'negative' {
    return this.analyzeHashtagSentiment(mention, content);
  }

  private assessEngagementPotential(mention: string, type: string, sentiment: string): 'high' | 'medium' | 'low' {
    if (type === 'influencer' && sentiment === 'positive') return 'high';
    if (type === 'customer' && sentiment !== 'negative') return 'medium';
    return 'low';
  }

  private generateMentionResponse(mention: string, type: string, sentiment: string, data: any): string {
    if (type === 'customer' && sentiment === 'positive') {
      return `شكراً @${mention} لك! نقدر تفاعلك معنا 💕`;
    }
    if (sentiment === 'negative') {
      return `مرحباً @${mention}، نعتذر عن أي إزعاج. راسلنا خاص نحل المشكلة 🙏`;
    }
    return `أهلاً @${mention}! شكراً لذكرنا 🌹`;
  }

  private generateMentionActions(mention: string, type: string, sentiment: string): string[] {
    const actions: string[] = [];
    
    if (type === 'influencer') {
      actions.push('التواصل للتعاون المحتمل');
      actions.push('متابعة المحتوى المستقبلي');
    }
    
    if (sentiment === 'negative') {
      actions.push('معالجة المشكلة المطروحة');
      actions.push('متابعة حل الشكوى');
    }
    
    if (sentiment === 'positive') {
      actions.push('تشجيع المزيد من التفاعل');
      actions.push('مشاركة المحتوى الإيجابي');
    }

    return actions;
  }

  private generateSuggestedActions(
    hashtagAnalyses: HashtagAnalysis[],
    mentionAnalyses: MentionAnalysis[],
    data: ContentHashtagMentionData
  ): string[] {
    const actions: string[] = [];

    // High-value hashtags
    const highValueHashtags = hashtagAnalyses.filter(h => h.marketingValue === 'high');
    if (highValueHashtags.length > 0) {
      actions.push(`استخدم الهاشتاغات عالية القيمة: ${highValueHashtags.map(h => '#' + h.hashtag).join(', ')}`);
    }

    // Influencer mentions
    const influencerMentions = mentionAnalyses.filter(m => m.mentionType === 'influencer');
    if (influencerMentions.length > 0) {
      actions.push('فرصة تعاون مع المؤثرين المذكورين');
    }

    // Negative sentiment
    const negativeItems = [...hashtagAnalyses, ...mentionAnalyses].filter(item => item.sentiment === 'negative');
    if (negativeItems.length > 0) {
      actions.push('متابعة وحل المشاكل المطروحة في المحتوى');
    }

    return actions;
  }

  private async updateTrendingData(hashtags: string[], merchantId: string): Promise<void> {
    try {
      const sql: Sql = this.db.getSQL();
      if (hashtags.length === 0) return;

      const values = hashtags.map(tag =>
        sql`(${merchantId}::uuid, ${tag}, 1, CURRENT_DATE)`
      );

      await sql`
        INSERT INTO hashtag_trends (
          merchant_id,
          hashtag,
          usage_count,
          date
        ) VALUES ${(sql as any).join(values, sql`, `)}
        ON CONFLICT (merchant_id, hashtag, date)
        DO UPDATE SET
          usage_count = hashtag_trends.usage_count + EXCLUDED.usage_count,
          updated_at = NOW()
      `;
    } catch (error) {
      console.error('❌ Update trending data failed:', error);
    }
  }

  private async checkMarketingOpportunities(
    hashtagAnalyses: HashtagAnalysis[],
    mentionAnalyses: MentionAnalysis[],
    data: ContentHashtagMentionData
  ): Promise<void> {
    try {
      const highValueHashtags = hashtagAnalyses.filter(h => h.marketingValue === 'high');
      const influencerMentions = mentionAnalyses.filter(m => m.mentionType === 'influencer');

      if (highValueHashtags.length > 0 || influencerMentions.length > 0) {
        const sql: Sql = this.db.getSQL();

        await sql`
          INSERT INTO marketing_opportunities (
            merchant_id,
            opportunity_type,
            source_content,
            hashtags,
            mentions,
            priority,
            status,
            created_at
          ) VALUES (
            ${data.merchantId}::uuid,
            'HASHTAG_MENTION_OPPORTUNITY',
            ${data.content},
            ${JSON.stringify(highValueHashtags.map(h => h.hashtag))},
            ${JSON.stringify(influencerMentions.map(m => m.mentionedUser))},
            ${influencerMentions.length > 0 ? 'HIGH' : 'MEDIUM'},
            'NEW',
            NOW()
          )
        `;

        logger.info(`📈 Marketing opportunity identified from hashtags/mentions`);
      }
    } catch (error) {
      console.error('❌ Check marketing opportunities failed:', error);
    }
  }

  private async findRelatedHashtags(hashtag: string, merchantId: string): Promise<string[]> {
    try {
      const sql: Sql = this.db.getSQL();

      const related = await sql`
        SELECT DISTINCT hm2.hashtag
        FROM hashtag_mentions hm1
        JOIN hashtag_mentions hm2 ON hm1.message_id = hm2.message_id
        WHERE hm1.hashtag = ${hashtag}
        AND hm1.merchant_id = ${merchantId}::uuid
        AND hm2.hashtag != ${hashtag}
        AND hm2.hashtag IS NOT NULL
        GROUP BY hm2.hashtag
        ORDER BY COUNT(*) DESC
        LIMIT 5
      `;

      return related.map(row => ((row as unknown) as { hashtag: string })?.hashtag ?? '');
    } catch {
      return [];
    }
  }

  private async identifyTrendingHashtags(merchantId: string): Promise<string[]> {
    // Would implement sophisticated trending analysis
    return ['ترند_اليوم', 'منتجات_جديدة']; // Placeholder
  }

  private async generateHashtagRecommendations(merchantId: string): Promise<string[]> {
    // Would analyze successful hashtags and suggest similar ones
    return ['تسوق_ذكي', 'عروض_خاصة']; // Placeholder
  }
}

// Singleton instance
let hashtagMentionProcessorInstance: InstagramHashtagMentionProcessor | null = null;

/**
 * Get Instagram Hashtag Mention Processor instance
 */
export function getInstagramHashtagMentionProcessor(): InstagramHashtagMentionProcessor {
  if (!hashtagMentionProcessorInstance) {
    hashtagMentionProcessorInstance = new InstagramHashtagMentionProcessor();
  }
  return hashtagMentionProcessorInstance;
}

export default InstagramHashtagMentionProcessor;