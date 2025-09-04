/**
 * ===============================================
 * Instagram Hashtag Monitor
 * - Extracts hashtags and mentions from incoming IG content
 * - Performs lightweight sentiment analysis (Arabic + emojis)
 * - Persists to hashtag_mentions and updates hashtag_trends
 * - Generates marketing_opportunities using DB assessment fn
 * ===============================================
 */

import { getDatabase } from '../db/adapter.js';
import { getLogger } from './logger.js';

export type IGSource = 'dm' | 'comment' | 'story' | 'post';

interface ProcessInput {
  merchantId: string;
  messageId: string; // reference to message_logs.mid or external id
  userId: string;    // instagram username or id (stored as text field)
  source: IGSource;
  content: string;
}

interface ProcessResult {
  hashtags: string[];
  mentions: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  insertedMentions: number;
  opportunitiesCreated: number;
}

export class InstagramHashtagMonitor {
  private db = getDatabase();
  private log = getLogger({ component: 'instagram-hashtag-monitor' });

  // Extract hashtags and mentions from text (supports Arabic letters in hashtags)
  private extract(text: string): { hashtags: string[]; mentions: string[] } {
    const t = (text ?? '').trim();
    // Hashtags: allow Arabic letters, Latin letters, digits, underscore, dot
    // Stop at whitespace or punctuation
    const hashtagRegex = /#([A-Za-z0-9_.\-\u0600-\u06FF]+)/gu;
    const mentionRegex = /@([A-Za-z0-9_.]+)/g; // Instagram usernames are latin/._/

    const hashtags = new Set<string>();
    const mentions = new Set<string>();

    let m: RegExpExecArray | null;
    while ((m = hashtagRegex.exec(t)) !== null) {
      const tag = (m[1] ?? '').trim();
      if (tag) hashtags.add('#' + tag.toLowerCase());
    }
    while ((m = mentionRegex.exec(t)) !== null) {
      const u = (m[1] ?? '').trim();
      if (u) mentions.add(u.toLowerCase());
    }

    return { hashtags: Array.from(hashtags).slice(0, 25), mentions: Array.from(mentions).slice(0, 25) };
  }

  // Lightweight sentiment analysis for Arabic/Iraqi texts with emoji signals
  private analyzeSentiment(text: string): 'positive' | 'neutral' | 'negative' {
    const t = (text ?? '').toLowerCase();
    // Emojis
    const posEmoji = ['😍','❤','❤️','👍','😊','😁','🔥','👏','💯','⭐','🥰','😄','😃'];
    const negEmoji = ['😡','😠','👎','😞','😢','😭','💔','🤬'];
    // Arabic/Iraqi positives/negatives and some English
    const posWords = [
      'حلو','حلوة','جميل','جيدة','جيد','زين','تمام','ممتاز','رائع','شكراً','ثقة','محترم','احب','نصيحة','لطيف','عروض حلوة','great','awesome','nice','love','perfect','thanks','good'
    ];
    const negWords = [
      'غالي','سيء','سيئة','رديء','رديئة','مو','ما','لا','تأخير','مشكل','مشكلة','خربان','تعبان','زفت','كارثة','سيئين','اسوأ','worst','bad','late','broken','cancel','غلط'
    ];

    let score = 0;
    for (const e of posEmoji) if (t.includes(e)) score += 2;
    for (const e of negEmoji) if (t.includes(e)) score -= 2;
    for (const w of posWords) if (t.includes(w)) score += 1;
    for (const w of negWords) if (t.includes(w)) score -= 1;

    if (score >= 2) return 'positive';
    if (score <= -2) return 'negative';
    return 'neutral';
  }

  // Heuristic engagement score per message (0..100)
  private computeEngagementScore(text: string): number {
    const t = (text ?? '').trim();
    if (!t) return 30;
    let score = 40;
    const length = Math.min(t.length, 400);
    // base on length (more context → higher)
    score += Math.floor(length / 20);
    // emojis boost
    const emojis = (t.match(/[\p{Extended_Pictographic}]/gu) || []).length;
    score += Math.min(20, emojis * 3);
    // hashtags boost a little
    const hashCount = (t.match(/#/g) || []).length;
    score += Math.min(10, hashCount * 2);
    // mentions boost a bit
    const mentionCount = (t.match(/@/g) || []).length;
    score += Math.min(10, mentionCount * 2);
    // clamp
    return Math.max(0, Math.min(100, score));
  }

  // Insert hashtag_mentions rows and update hashtag_trends for today
  private async persistMentions(input: ProcessInput, hashtags: string[], mentions: string[], sentiment: 'positive'|'neutral'|'negative'): Promise<number> {
    if ((!hashtags || hashtags.length === 0) && (!mentions || mentions.length === 0)) return 0;
    const sql = this.db.getSQL();

    let inserted = 0;
    // Precompute row engagement once
    const rowEngagement = this.computeEngagementScore(input.content ?? '');

    // Insert hashtags
    for (const tag of hashtags) {
      try {
        await sql`
          INSERT INTO hashtag_mentions (
            message_id, merchant_id, hashtag, mentioned_user, content, source, sentiment, user_id, processing_status, engagement_score
          ) VALUES (
            ${input.messageId}, ${input.merchantId}::uuid, ${tag}, NULL, ${input.content}, ${input.source}, ${sentiment}, ${input.userId}, 'processed', ${rowEngagement}
          )
          ON CONFLICT (message_id, hashtag) DO NOTHING
        `;
        inserted += 1;
        await this.updateDailyTrend(input.merchantId, tag, input.userId);
      } catch (e) {
        this.log.warn('insert hashtag_mentions failed (hashtag)', { error: String(e) });
      }
    }

    // Insert mentions (@user)
    for (const user of mentions) {
      try {
        await sql`
          INSERT INTO hashtag_mentions (
            message_id, merchant_id, hashtag, mentioned_user, content, source, sentiment, user_id, processing_status, engagement_score
          ) VALUES (
            ${input.messageId}, ${input.merchantId}::uuid, NULL, ${user}, ${input.content}, ${input.source}, ${sentiment}, ${input.userId}, 'processed', ${rowEngagement}
          )
          ON CONFLICT (message_id, mentioned_user) DO NOTHING
        `;
        inserted += 1;
      } catch (e) {
        this.log.warn('insert hashtag_mentions failed (mention)', { error: String(e) });
      }
    }

    return inserted;
  }

  // Upsert today's hashtag_trends counters and sentiment breakdown from hashtag_mentions
  private async updateDailyTrend(merchantId: string, hashtag: string, userId: string): Promise<void> {
    const sql = this.db.getSQL();
    try {
      await sql`
        WITH counts AS (
          SELECT 
            COUNT(*) FILTER (WHERE sentiment = 'positive')::int AS pos,
            COUNT(*) FILTER (WHERE sentiment = 'neutral')::int AS neu,
            COUNT(*) FILTER (WHERE sentiment = 'negative')::int AS neg,
            COUNT(DISTINCT user_id)::int AS uniq
          FROM hashtag_mentions
          WHERE merchant_id = ${merchantId}::uuid
            AND hashtag = ${hashtag}
            AND created_at::date = CURRENT_DATE
        )
        INSERT INTO hashtag_trends (
          merchant_id, hashtag, date, usage_count, unique_users, sentiment_breakdown, growth_rate, trending_score, engagement_score
        ) VALUES (
          ${merchantId}::uuid, ${hashtag}, CURRENT_DATE, 1, 1, '{"positive":0,"neutral":0,"negative":0}'::jsonb, 0, 0, 0
        )
        ON CONFLICT (merchant_id, hashtag, date)
        DO UPDATE SET
          usage_count = hashtag_trends.usage_count + 1,
          unique_users = counts.uniq,
          sentiment_breakdown = jsonb_build_object('positive', counts.pos, 'neutral', counts.neu, 'negative', counts.neg),
          updated_at = NOW()
        FROM counts
      `;
    } catch (e) {
      this.log.debug('updateDailyTrend failed', { error: String(e) });
    }
  }

  // Create a marketing opportunity if assessment suggests non-low priority
  private async maybeCreateOpportunity(merchantId: string, content: string, platform: 'INSTAGRAM', hashtags: string[], mentions: string[]): Promise<number> {
    const sql = this.db.getSQL();
    try {
      const assess = await sql<{ assessment: Record<string, unknown> }>`
        SELECT assess_marketing_opportunity(${merchantId}::uuid, ${content}, ${platform}) AS assessment
      `;
      const a = assess?.[0]?.assessment as Record<string, unknown>;
      if (!a) return 0;

      let priority: 'LOW'|'MEDIUM'|'HIGH'|'URGENT' = (String((a as { priority?: unknown }).priority || 'LOW').toUpperCase() as 'LOW'|'MEDIUM'|'HIGH'|'URGENT') || 'LOW';
      let est = Number(a.estimated_value || 0);
      const conversion = Number(a.conversion_probability || 0);

      // Boost priority if any hashtag matches active strategies
      try {
        if (hashtags.length) {
          const rows = await sql<{ tag: string }>`
            SELECT DISTINCT lower(value)::text AS tag
            FROM hashtag_strategies, jsonb_array_elements_text(target_hashtags) AS value
            WHERE merchant_id = ${merchantId}::uuid
              AND is_active = TRUE
          `;
          const targets = new Set(rows.map(r => (r.tag ?? '').toLowerCase()));
          const hit = hashtags.some(h => targets.has(h.toLowerCase()));
          if (hit && priority !== 'URGENT') priority = 'HIGH';
          if (hit && est < 100) est = Math.max(est, 100);
        }
      } catch {}

      if (priority === 'LOW') return 0;

      await sql`
        INSERT INTO marketing_opportunities (
          merchant_id, opportunity_type, source_platform, source_content,
          hashtags, mentions, priority, status, estimated_value, conversion_probability, action_items
        ) VALUES (
          ${merchantId}::uuid,
          ${hashtags.length ? 'HASHTAG_ENGAGEMENT' : 'MENTION_ENGAGEMENT'},
          ${platform},
          ${content},
          ${JSON.stringify(hashtags)},
          ${JSON.stringify(mentions)},
          ${priority},
          'NEW',
          ${est},
          ${conversion},
          ${JSON.stringify(a.recommended_actions || [])}
        )
      `;
      return 1;
    } catch (e) {
      this.log.debug('maybeCreateOpportunity failed', { error: String(e) });
      return 0;
    }
  }

  // Public: Process inbound text for hashtags/mentions/sentiment and persist
  public async processInboundText(input: ProcessInput): Promise<ProcessResult> {
    const { hashtags, mentions } = this.extract(input.content ?? '');
    const sentiment = this.analyzeSentiment(input.content ?? '');

    const insertedMentions = await this.persistMentions(input, hashtags, mentions, sentiment);
    let opportunitiesCreated = 0;
    try {
      opportunitiesCreated = await this.maybeCreateOpportunity(
        input.merchantId,
        input.content,
        'INSTAGRAM',
        hashtags,
        mentions
      );
    } catch {}

    return { hashtags, mentions, sentiment, insertedMentions, opportunitiesCreated };
  }

  // Background: Aggregate recent trends (recompute counters for last 24h)
  public async aggregateRecentTrends(): Promise<{ updated: number }> {
    try {
      const sql = this.db.getSQL();
      const res = await sql<{ updated: number }>`
        WITH daily AS (
          SELECT 
            merchant_id,
            hashtag,
            CURRENT_DATE AS date,
            COUNT(*)::int AS usage_count,
            COUNT(DISTINCT user_id)::int AS unique_users,
            COUNT(*) FILTER (WHERE sentiment = 'positive')::int AS pos,
            COUNT(*) FILTER (WHERE sentiment = 'neutral')::int AS neu,
            COUNT(*) FILTER (WHERE sentiment = 'negative')::int AS neg
          FROM hashtag_mentions
          WHERE created_at >= NOW() - INTERVAL '24 hours'
            AND hashtag IS NOT NULL
          GROUP BY merchant_id, hashtag
        ), prev AS (
          SELECT merchant_id, hashtag, date, usage_count
          FROM hashtag_trends
          WHERE date = CURRENT_DATE - INTERVAL '1 day'
        ), upsert AS (
          INSERT INTO hashtag_trends (
            merchant_id, hashtag, date, usage_count, unique_users, sentiment_breakdown, growth_rate, trending_score, engagement_score
          )
          SELECT 
            d.merchant_id, d.hashtag, d.date, d.usage_count, d.unique_users,
            jsonb_build_object('positive', d.pos, 'neutral', d.neu, 'negative', d.neg) as sentiment_breakdown,
            CASE WHEN p.usage_count IS NULL THEN 0
                 ELSE ROUND( ((d.usage_count - p.usage_count)::decimal / GREATEST(p.usage_count, 1)) * 100, 2 ) END as growth_rate,
            LEAST(100, (d.usage_count * 2) + (d.pos - d.neg) + COALESCE(CASE WHEN p.usage_count IS NULL THEN 0 ELSE ((d.usage_count - p.usage_count) * 5) END, 0))::decimal(5,2) as trending_score,
            0 as engagement_score
          FROM daily d
          LEFT JOIN prev p ON p.merchant_id = d.merchant_id AND p.hashtag = d.hashtag
          ON CONFLICT (merchant_id, hashtag, date)
          DO UPDATE SET
            usage_count = EXCLUDED.usage_count,
            unique_users = EXCLUDED.unique_users,
            sentiment_breakdown = EXCLUDED.sentiment_breakdown,
            growth_rate = EXCLUDED.growth_rate,
            trending_score = EXCLUDED.trending_score,
            updated_at = NOW()
          RETURNING 1
        )
        SELECT COUNT(*)::int AS updated FROM upsert
      `;
      return { updated: res?.[0]?.updated ?? 0 };
    } catch (e) {
      this.log.warn('aggregateRecentTrends failed', { error: String(e) });
      return { updated: 0 };
    }
  }

  // Start periodic aggregation scheduler
  public startScheduler(options: { aggregationIntervalMs?: number } = {}): void {
    const { aggregationIntervalMs = 15 * 60 * 1000 } = options; // default 15 min
    this.log.info('Starting hashtag monitor scheduler', { aggregationIntervalMs });
    setInterval(() => {
      this.aggregateRecentTrends().catch(err => {
        this.log.debug('scheduled aggregateRecentTrends error', { error: String(err) });
      });
    }, aggregationIntervalMs);
  }
}

// Singleton accessor
let monitorInstance: InstagramHashtagMonitor | null = null;
export function getInstagramHashtagMonitor(): InstagramHashtagMonitor {
  if (!monitorInstance) monitorInstance = new InstagramHashtagMonitor();
  return monitorInstance;
}

export default InstagramHashtagMonitor;
