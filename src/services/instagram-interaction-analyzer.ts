import { getDatabase } from '../db/adapter.js';
import { getLogger } from './logger.js';

export type StoryInteractionType = 'reply' | 'emoji' | 'question';

export interface AnalyzeStoryReplyInput {
  merchantId: string;
  customerId: string;
  storyId?: string;
  content: string;
}

export interface AnalyzeStoryReplyResult {
  interactionType: StoryInteractionType;
  saved: boolean;
}

export class InstagramInteractionAnalyzer {
  private db = getDatabase();
  private log = getLogger({ component: 'instagram-interaction-analyzer' });

  /**
   * Analyze a story reply and persist an interaction row
   */
  async analyzeStoryReply(input: AnalyzeStoryReplyInput): Promise<AnalyzeStoryReplyResult> {
    const type = this.classifyStoryReply(input.content);
    try {
      const sql = this.db.getSQL();
      await sql`
        INSERT INTO instagram_story_interactions (
          id, merchant_id, customer_id, story_id, interaction_type, content, window_expires_at, created_at
        ) VALUES (
          gen_random_uuid(),
          ${input.merchantId}::uuid,
          ${input.customerId},
          ${input.storyId ?? null},
          ${type},
          ${input.content},
          NOW() + INTERVAL '24 hours',
          NOW()
        )
      `;
      return { interactionType: type, saved: true };
    } catch (e) {
      this.log.warn('analyzeStoryReply: insert failed', { error: String(e) });
      return { interactionType: type, saved: false };
    }
  }

  /**
   * Categorize a DM message intent with lightweight heuristics
   */
  async categorizeDMIntent(message: string, _userHistory?: unknown): Promise<{ intent: 'QUESTION'|'PRAISE'|'PRICE'|'RETURN'|'GENERAL'; confidence: number }>{
    const text = (message ?? '').toLowerCase();
    if (/سعر|كم|price|cost|ثمن/.test(text)) return { intent: 'PRICE', confidence: 0.8 };
    if (/ارجاع|استرجاع|return|refund/.test(text)) return { intent: 'RETURN', confidence: 0.75 };
    if (/شكرا|يعطيك|ممتاز|حلو/.test(text)) return { intent: 'PRAISE', confidence: 0.6 };
    if (/[?؟]/.test(text)) return { intent: 'QUESTION', confidence: 0.6 };
    return { intent: 'GENERAL', confidence: 0.5 };
  }

  /**
   * Analyze comment sentiment and record in message_logs metadata if conversation exists
   */
  async analyzeCommentSentiment(merchantId: string, username: string, comment: string): Promise<{ sentiment: 'positive'|'neutral'|'negative'; saved: boolean }>{
    const text = (comment ?? '').toLowerCase();
    const positive = /(شكرا|حلو|جميل|😍|❤️|👍|🔥|ممتاز)/.test(text);
    const negative = /(سيء|رديء|خايس|ما|مو|👎|😡|💔|بطيء)/.test(text);
    const sentiment: 'positive'|'neutral'|'negative' = positive ? 'positive' : negative ? 'negative' : 'neutral';

    try {
      const sql = this.db.getSQL();
      // Find latest conversation for this user
      const conv = await sql<{ id: string }>`
        SELECT id FROM conversations
        WHERE merchant_id = ${merchantId}::uuid AND platform = 'instagram' AND lower(customer_instagram) = lower(${username})
        ORDER BY last_message_at DESC NULLS LAST, created_at DESC
        LIMIT 1
      `;
      const conversationId = conv[0]?.id;
      if (!conversationId) return { sentiment, saved: false };

      const meta = { event_type: 'comment_sentiment', sentiment };
      await sql`
        INSERT INTO message_logs (
          conversation_id, content, message_type, direction, platform, source_channel, ai_intent, ai_confidence, processing_time_ms, metadata, created_at
        ) VALUES (
          ${conversationId}::uuid, ${comment}, 'COMMENT', 'INCOMING', 'instagram', 'manychat', NULL, NULL, 0, ${JSON.stringify(meta)}::jsonb, NOW()
        )
      `;
      return { sentiment, saved: true };
    } catch (e) {
      this.log.warn('analyzeCommentSentiment failed', { error: String(e) });
      return { sentiment, saved: false };
    }
  }

  /**
   * Update subscriber engagement score (0..100) based on recent interactions
   */
  async updateSubscriberEngagementForUsername(merchantId: string, username: string): Promise<number> {
    try {
      const sql = this.db.getSQL();
      // Aggregate interactions: DMs from message_logs + story interactions (last 30d)
      const rows = await sql<{ dms: number; comments: number; stories: number }>`
        WITH d AS (
          SELECT COUNT(*)::int AS c
          FROM message_logs ml
          JOIN conversations c ON c.id = ml.conversation_id
          WHERE c.merchant_id = ${merchantId}::uuid
            AND c.platform = 'instagram'
            AND lower(c.customer_instagram) = lower(${username})
            AND ml.created_at >= NOW() - INTERVAL '30 days'
        ),
        cm AS (
          SELECT COUNT(*)::int AS c
          FROM message_logs ml
          JOIN conversations c ON c.id = ml.conversation_id
          WHERE c.merchant_id = ${merchantId}::uuid
            AND c.platform = 'instagram'
            AND lower(c.customer_instagram) = lower(${username})
            AND ml.message_type = 'COMMENT'
            AND ml.created_at >= NOW() - INTERVAL '30 days'
        ),
        si AS (
          SELECT COUNT(*)::int AS c
          FROM instagram_story_interactions si
          WHERE si.merchant_id = ${merchantId}::uuid
            AND si.customer_id = ${username}
            AND si.created_at >= NOW() - INTERVAL '30 days'
        )
        SELECT (SELECT c FROM d) AS dms, (SELECT c FROM cm) AS comments, (SELECT c FROM si) AS stories
      `;
      const r = rows[0] || { dms: 0, comments: 0, stories: 0 };
      const score = Math.max(0, Math.min(100, (r.dms * 3) + (r.comments * 4) + (r.stories * 2)));

      await sql`
        UPDATE manychat_subscribers
        SET engagement_score = ${score}, last_interaction_at = NOW(), updated_at = NOW()
        WHERE merchant_id = ${merchantId}::uuid AND lower(instagram_username) = lower(${username})
      `;
      return score;
    } catch (e) {
      this.log.debug('updateSubscriberEngagementForUsername skipped', { error: String(e) });
      return 0;
    }
  }

  /**
   * Track user behavior rollups for analytics (per 24h window)
   */
  async trackUserBehavior(merchantId: string, username: string, _interaction: 'dm'|'comment'|'story'): Promise<void> {
    try {
      const sql = this.db.getSQL();
      const now = new Date();
      const hour = now.getHours();
      const dayOfWeek = now.getDay();
      
      await sql`
        INSERT INTO customer_interaction_patterns (
          merchant_id, customer_id, interaction_hour, day_of_week, response_rate, interaction_count, last_updated
        ) VALUES (
          ${merchantId}::uuid, ${username}, ${hour}, ${dayOfWeek}, 1.0, 1, NOW()
        )
        ON CONFLICT (merchant_id, customer_id, interaction_hour, day_of_week)
        DO UPDATE SET
          interaction_count = customer_interaction_patterns.interaction_count + 1,
          response_rate = (customer_interaction_patterns.response_rate * customer_interaction_patterns.interaction_count + 1.0) / (customer_interaction_patterns.interaction_count + 1),
          last_updated = NOW()
      `;
    } catch (e) {
      this.log.debug('trackUserBehavior skipped', { error: String(e) });
    }
  }

  /**
   * Compute a simple engagement score from recent interactions
   */
  async calculateEngagementScore(merchantId: string, customerId: string): Promise<number> {
    try {
      const sql = this.db.getSQL();
      const rows = await sql<{ cnt_7d: number; cnt_30d: number }>`
        WITH r7 AS (
          SELECT COUNT(*)::int AS c FROM instagram_story_interactions
          WHERE merchant_id = ${merchantId}::uuid AND customer_id = ${customerId} AND created_at >= NOW() - INTERVAL '7 days'
        ),
        r30 AS (
          SELECT COUNT(*)::int AS c FROM instagram_story_interactions
          WHERE merchant_id = ${merchantId}::uuid AND customer_id = ${customerId} AND created_at >= NOW() - INTERVAL '30 days'
        )
        SELECT (SELECT c FROM r7) AS cnt_7d, (SELECT c FROM r30) AS cnt_30d
      `;
      const r = rows[0] || { cnt_7d: 0, cnt_30d: 0 };
      // Simple score: recent interactions weighted higher
      return Math.min(1, (r.cnt_7d * 0.1) + (r.cnt_30d * 0.02));
    } catch {
      return 0.0;
    }
  }

  /**
   * Predict purchase intent from recent interaction counts
   */
  async predictPurchaseIntent(merchantId: string, customerId: string): Promise<'LOW'|'MEDIUM'|'HIGH'> {
    const score = await this.calculateEngagementScore(merchantId, customerId);
    if (score >= 0.6) return 'HIGH';
    if (score >= 0.25) return 'MEDIUM';
    return 'LOW';
  }

  private classifyStoryReply(content: string): StoryInteractionType {
    const text = (content ?? '').toLowerCase();
    if (/سعر|كم|price|cost|ثمن/.test(text)) return 'question';
    if (/😍|❤️|👍|🔥|⭐/.test(content)) return 'emoji';
    return 'reply';
  }
}

export default InstagramInteractionAnalyzer;
