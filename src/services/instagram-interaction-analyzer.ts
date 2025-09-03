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
          ${input.storyId || null},
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
    const text = (message || '').toLowerCase();
    if (/سعر|كم|price|cost|ثمن/.test(text)) return { intent: 'PRICE', confidence: 0.8 };
    if (/ارجاع|استرجاع|return|refund/.test(text)) return { intent: 'RETURN', confidence: 0.75 };
    if (/شكرا|يعطيك|ممتاز|حلو/.test(text)) return { intent: 'PRAISE', confidence: 0.6 };
    if (/[?؟]/.test(text)) return { intent: 'QUESTION', confidence: 0.6 };
    return { intent: 'GENERAL', confidence: 0.5 };
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
    const text = (content || '').toLowerCase();
    if (/سعر|كم|price|cost|ثمن/.test(text)) return 'question';
    if (/😍|❤️|👍|🔥|⭐/.test(content)) return 'emoji';
    return 'reply';
  }
}

export default InstagramInteractionAnalyzer;

