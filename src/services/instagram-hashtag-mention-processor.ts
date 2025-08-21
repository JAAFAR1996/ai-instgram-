/**
 * ===============================================
 * Instagram Hashtag and Mention Processor
 * Advanced processing of hashtags and mentions in Instagram content
 * ===============================================
 */

import { getDatabase } from '../database/connection.js';
import { getConversationAIOrchestrator } from './conversation-ai-orchestrator.js';

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
  private aiOrchestrator = getConversationAIOrchestrator();

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
      console.log(`#️⃣ Processing content with ${data.hashtags.length} hashtags and ${data.mentions.length} mentions`);

      // Extract and validate hashtags/mentions
      const extractedHashtags = this.extractHashtags(data.content);
      const extractedMentions = this.extractMentions(data.content);

      // Combine with provided data
      const allHashtags = [...new Set([...data.hashtags, ...extractedHashtags])];
      const allMentions = [...new Set([...data.mentions, ...extractedMentions])];

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

      console.log(
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
      const sql = this.db.getSQL();

      const intervalValue = TIMEFRAME_INTERVALS[timeframe] || TIMEFRAME_INTERVALS.week;

      const trends = await sql`
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
      `;

      const trendAnalyses: HashtagTrendAnalysis[] = [];

      for (const trend of trends) {
        // Calculate growth (simplified - would need historical data)
        const recentGrowth = await this.calculateHashtagGrowth(trend.hashtag, merchantId, timeframe);

        // Get associated words
        const associatedWords = await this.getAssociatedWords(trend.hashtag, merchantId);

        trendAnalyses.push({
          hashtag: trend.hashtag,
          totalUsage: Number(trend.total_usage),
          recentGrowth,
          topAssociatedWords: associatedWords.slice(0, 5),
          sentimentTrend: {
            positive: Number(trend.positive_count),
            neutral: Number(trend.neutral_count),
            negative: Number(trend.negative_count)
          },
          peakUsageTimes: trend.usage_hours.map((hour: number) => `${hour}:00`),
          competitorUsage: 0, // Would need competitor tracking
          recommendedStrategy: this.generateHashtagStrategy(trend)
        });
      }

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
      const sql = this.db.getSQL();

      const result = await sql`
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

      const strategyId = result[0].id;
      console.log(`✅ Hashtag strategy created: ${strategy.name} (${strategyId})`);
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
      const sql = this.db.getSQL();

      const dateFilter = dateRange 
        ? sql`AND created_at BETWEEN ${dateRange.from} AND ${dateRange.to}`
        : sql`AND created_at >= NOW() - INTERVAL '30 days'`;

      // Get hashtag performance
      const hashtagStats = await sql`
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
      `;

      // Get mention statistics
      const mentionStats = await sql`
        SELECT 
          mention_type,
          COUNT(*) as count
        FROM hashtag_mentions
        WHERE merchant_id = ${merchantId}::uuid
        AND mentioned_user IS NOT NULL
        ${dateFilter}
        GROUP BY mention_type
      `;

      // Get trending hashtags (growing in usage)
      const trendingHashtags = await this.identifyTrendingHashtags(merchantId);

      // Generate recommended hashtags based on performance
      const recommendedHashtags = await this.generateHashtagRecommendations(merchantId);

      return {
        totalHashtagsUsed: hashtagStats.length,
        topPerformingHashtags: hashtagStats.map(stat => ({
          hashtag: stat.hashtag,
          usage: Number(stat.usage_count),
          engagement: Number(stat.avg_engagement) || 0,
          sentiment: Number(stat.sentiment_score) || 0
        })),
        mentionAnalytics: {
          totalMentions: mentionStats.reduce((sum, stat) => sum + Number(stat.count), 0),
          influencerMentions: Number(mentionStats.find(s => s.mention_type === 'influencer')?.count || 0),
          customerMentions: Number(mentionStats.find(s => s.mention_type === 'customer')?.count || 0),
          competitorMentions: Number(mentionStats.find(s => s.mention_type === 'competitor')?.count || 0)
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
  private analyzeHashtagSentiment(hashtag: string, content: string): 'positive' | 'neutral' | 'negative' {
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
   * Private: Store hashtag/mention data
   */
  private async storeHashtagMentionData(
    data: ContentHashtagMentionData,
    hashtagAnalyses: HashtagAnalysis[],
    mentionAnalyses: MentionAnalysis[]
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();

      // Store hashtag data concurrently
      const hashtagInsertPromises = hashtagAnalyses.map(analysis => sql`
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
      await Promise.all(hashtagInsertPromises);

      // Store mention data concurrently
      const mentionInsertPromises = mentionAnalyses.map(analysis => sql`
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
      await Promise.all(mentionInsertPromises);
    } catch (error) {
      console.error('❌ Store hashtag/mention data failed:', error);
    }
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
      const sql = this.db.getSQL();
      const result = await sql`
        SELECT COUNT(*) as frequency
        FROM hashtag_mentions
        WHERE hashtag = ${hashtag}
        AND merchant_id = ${merchantId}::uuid
        AND created_at >= NOW() - INTERVAL '30 days'
      `;
      return Number(result[0]?.frequency || 0);
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
      const sql = this.db.getSQL();
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

      const current = Number(result[0]?.current_count || 0);
      const previous = Number(result[0]?.previous_count || 0);

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
      const sql = this.db.getSQL();
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
        ) VALUES ${sql.join(values, sql`, `)}
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
        const sql = this.db.getSQL();

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

        console.log(`📈 Marketing opportunity identified from hashtags/mentions`);
      }
    } catch (error) {
      console.error('❌ Check marketing opportunities failed:', error);
    }
  }

  private async findRelatedHashtags(hashtag: string, merchantId: string): Promise<string[]> {
    try {
      const sql = this.db.getSQL();

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

      return related.map(row => row.hashtag);
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