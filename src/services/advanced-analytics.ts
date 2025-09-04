import { getDatabase } from '../db/adapter.js';
import { getLogger } from './logger.js';
import { telemetry } from './telemetry.js';

export interface AIInteractionMetric {
  merchantId: string;
  customerId: string;
  conversationId?: string;
  model?: string;
  intent?: string;
  latencyMs?: number;
  tokens?: { prompt: number; completion: number };
  qualityScore?: number; // 0..1
  improved?: boolean;
}

export interface AnalyticsSummary {
  windowDays: number;
  responseAccuracyRate: number; // 0..1
  satisfactionScore: number; // 0..1
  conversionRate: number; // 0..1
  engagementQuality: {
    responseRate: number; // 0..1
    avgResponseTimeMinutes: number;
  };
}

export class AdvancedAnalyticsService {
  private db = getDatabase();
  private log = getLogger({ component: 'advanced-analytics' });

  /**
   * Lightweight recording of AI interaction metrics to telemetry and audit logs (SYSTEM_EVENT)
   */
  async recordAIInteraction(m: AIInteractionMetric): Promise<void> {
    try {
      if (m.model && typeof m.latencyMs === 'number') {
        telemetry.recordAIRequest(m.model, true, m.latencyMs, m.tokens);
      }
    } catch {}

    try {
      const sql = this.db.getSQL();
      await sql`
        INSERT INTO audit_logs (
          merchant_id, action, resource_type, resource_id, new_values, status, created_at
        ) VALUES (
          ${m.merchantId}::uuid,
          'SYSTEM_EVENT',
          'SYSTEM',
          'AI_ANALYTICS',
          ${JSON.stringify({
            customerId: m.customerId,
            conversationId: m.conversationId,
            model: m.model,
            intent: m.intent,
            latencyMs: m.latencyMs,
            tokens: m.tokens,
            qualityScore: m.qualityScore,
            improved: m.improved,
          })}::jsonb,
          'SUCCESS',
          NOW()
        )
      `;
    } catch (e) {
      this.log.warn('recordAIInteraction audit log failed', { error: String(e) });
    }
  }

  /**
   * Compute high-level analytics without new tables. Uses message_logs and orders only.
   */
  async computeSummary(merchantId: string, windowDays = 30): Promise<AnalyticsSummary> {
    const sql = this.db.getSQL();

    // Response accuracy rate from message_logs metadata.quality_score
    const accuracyRows = await sql<{ total: number; good: number }>`
      WITH ms AS (
        SELECT (metadata->>'quality_score')::float AS q
        FROM message_logs ml
        JOIN conversations c ON c.id = ml.conversation_id
        WHERE c.merchant_id = ${merchantId}::uuid
          AND ml.direction = 'OUTGOING'
          AND ml.created_at >= NOW() - INTERVAL ${String(windowDays)} || ' days'
      )
      SELECT COUNT(*)::int AS total,
             COUNT(CASE WHEN q IS NOT NULL AND q >= 0.7 THEN 1 END)::int AS good
      FROM ms
    `;
    const totalOut = accuracyRows[0]?.total ?? 0;
    const goodOut = accuracyRows[0]?.good ?? 0;
    const responseAccuracyRate = totalOut > 0 ? goodOut / totalOut : 0;

    // Conversion rate: customers with any order in window / active conversations in window
    const convRows = await sql<{ convs: number; buyers: number }>`
      WITH convs AS (
        SELECT DISTINCT c.customer_instagram AS cid
        FROM conversations c
        JOIN message_logs ml ON ml.conversation_id = c.id
        WHERE c.merchant_id = ${merchantId}::uuid
          AND ml.created_at >= NOW() - INTERVAL ${String(windowDays)} || ' days'
      ),
      buyers AS (
        SELECT DISTINCT o.customer_instagram AS cid
        FROM orders o
        WHERE o.merchant_id = ${merchantId}::uuid
          AND o.created_at >= NOW() - INTERVAL ${String(windowDays)} || ' days'
      )
      SELECT (SELECT COUNT(*) FROM convs)::int AS convs,
             (SELECT COUNT(*) FROM convs c JOIN buyers b ON b.cid = c.cid)::int AS buyers
    `;
    const convs = convRows[0]?.convs ?? 0;
    const buyers = convRows[0]?.buyers ?? 0;
    const conversionRate = convs > 0 ? buyers / convs : 0;

    // Engagement: response rate and average response time (simplified)
    const engageRows = await sql<{ responses: number; sent: number; avg_minutes: number | null }>`
      WITH times AS (
        SELECT ml.created_at, ml.direction,
               LAG(ml.direction) OVER (PARTITION BY ml.conversation_id ORDER BY ml.created_at) AS prev_dir,
               EXTRACT(EPOCH FROM (ml.created_at - LAG(ml.created_at) OVER (PARTITION BY ml.conversation_id ORDER BY ml.created_at)))/60 AS delta_min
        FROM message_logs ml
        JOIN conversations c ON c.id = ml.conversation_id
        WHERE c.merchant_id = ${merchantId}::uuid
          AND ml.created_at >= NOW() - INTERVAL ${String(windowDays)} || ' days'
      )
      SELECT COUNT(CASE WHEN direction = 'INCOMING' AND prev_dir = 'OUTGOING' THEN 1 END)::int AS responses,
             COUNT(CASE WHEN direction = 'OUTGOING' THEN 1 END)::int AS sent,
             AVG(CASE WHEN direction = 'INCOMING' AND prev_dir = 'OUTGOING' THEN delta_min END)::float AS avg_minutes
      FROM times
    `;
    const sent = engageRows[0]?.sent ?? 0;
    const responses = engageRows[0]?.responses ?? 0;
    const responseRate = sent > 0 ? responses / sent : 0;
    const avgResponseTimeMinutes = Math.max(0, Math.round((engageRows[0]?.avg_minutes ?? 0) * 10) / 10);

    // Satisfaction score: blend of accuracy and engagement
    const satisfactionScore = Math.min(1, (responseAccuracyRate * 0.6) + (responseRate * 0.4));

    return {
      windowDays,
      responseAccuracyRate,
      satisfactionScore,
      conversionRate,
      engagementQuality: {
        responseRate,
        avgResponseTimeMinutes,
      },
    };
  }
}

export default AdvancedAnalyticsService;

