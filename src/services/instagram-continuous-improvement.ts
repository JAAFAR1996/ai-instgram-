import { getDatabase } from '../db/adapter.js';
import { getLogger } from './logger.js';

export interface StrategyRecord {
  strategyId: string;
  variantId?: string;
  success: boolean;
  context?: Record<string, unknown>;
}

export class ContinuousImprovementEngine {
  private db = getDatabase();
  private log = getLogger({ component: 'continuous-improvement' });

  /**
   * Track performance of a response strategy/variant (logged to audit_logs)
   */
  async trackStrategyPerformance(rec: StrategyRecord): Promise<void> {
    const sql = this.db.getSQL();
    await sql`
      INSERT INTO audit_logs (
        action, resource_type, resource_id, new_values, status, created_at
      ) VALUES (
        'STRATEGY_PERFORMANCE', 'AI_RESPONSE', ${rec.strategyId},
        ${JSON.stringify({ variantId: rec.variantId, success: rec.success, context: rec.context || {} })}::jsonb,
        ${rec.success ? 'SUCCESS' : 'FAILED'}, NOW()
      )
    `;
  }

  /**
   * Run a simple A/B test: choose the best-performing variant based on past success rate
   */
  async runABTests(strategyId: string, variants: string[]): Promise<string> {
    try {
      const sql = this.db.getSQL();
      const rows = await sql<{ variant: string; success_rate: number; trials: number }>`
        WITH perf AS (
          SELECT (new_values->>'variantId') as variant,
                 COUNT(*) as trials,
                 AVG(CASE WHEN status = 'SUCCESS' THEN 1.0 ELSE 0.0 END) as success_rate
          FROM audit_logs
          WHERE action = 'STRATEGY_PERFORMANCE' AND resource_id = ${strategyId}
          GROUP BY (new_values->>'variantId')
        )
        SELECT variant, success_rate, trials FROM perf
      `;
      const map = new Map<string, { rate: number; trials: number }>();
      for (const r of rows) if (r.variant) map.set(r.variant, { rate: Number(r.success_rate || 0), trials: Number(r.trials || 0) });
      // Handle edge cases
      if (variants.length === 0) return '';
      if (variants.length === 1) return variants[0]!;

      // Epsilon-greedy selection
      const epsilon = 0.1;
      if (Math.random() < epsilon) return variants[Math.floor(Math.random() * variants.length)]!;
      let best = variants[0] ?? '';
      let bestRate = -1;
      for (const v of variants) {
        const rate = map.get(v)?.rate ?? 0.5; // default prior
        if (rate > bestRate) { best = v; bestRate = rate; }
      }
      return best;
    } catch (e) {
      this.log.warn('runABTests failed', { error: String(e) });
      return variants.length ? (variants[Math.floor(Math.random() * variants.length)] ?? '') : '';
    }
  }

  /**
   * Compute winner variant and write a system event
   */
  async updateSuccessfulStrategies(strategyId: string): Promise<{ winner?: string }> {
    const sql = this.db.getSQL();
    const rows = await sql<{ variant: string; success_rate: number; trials: number }>`
      SELECT (new_values->>'variantId') as variant,
             AVG(CASE WHEN status='SUCCESS' THEN 1.0 ELSE 0.0 END) as success_rate,
             COUNT(*) as trials
      FROM audit_logs
      WHERE action = 'STRATEGY_PERFORMANCE' AND resource_id = ${strategyId}
      GROUP BY (new_values->>'variantId')
      ORDER BY success_rate DESC, trials DESC
      LIMIT 1
    `;
    const winner = rows[0]?.variant;
    if (winner) {
      await sql`
        INSERT INTO audit_logs (action, resource_type, resource_id, new_values, status, created_at)
        VALUES ('SYSTEM_EVENT','AI_RESPONSE', ${strategyId}, ${JSON.stringify({ winner })}::jsonb, 'SUCCESS', NOW())
      `;
    }
    if (winner) {
      return { winner };
    }
    return {};
  }

  /**
   * Suggest optimization hints based on recent performance and quality scores
   */
  async suggestOptimizations(merchantId: string): Promise<string[]> {
    try {
      const sql = this.db.getSQL();
      const q = await sql<{ avg_q: number | null }>`
        SELECT AVG((ml.metadata->>'quality_score')::float) as avg_q
        FROM message_logs ml
        JOIN conversations c ON c.id = ml.conversation_id
        WHERE c.merchant_id = ${merchantId}::uuid AND ml.direction='OUTGOING' AND ml.created_at >= NOW() - INTERVAL '7 days'
      `;
      const avg = Number(q[0]?.avg_q || 0);
      const hints: string[] = [];
      if (!avg || avg < 0.6) hints.push('خفّض الحرارة قليلاً واجعل الردود أكثر وضوحاً');
      else hints.push('حافظ على النبرة الحالية مع مزيد من التخصيص');
      return hints;
    } catch (e) {
      this.log.warn('suggestOptimizations failed', { error: String(e) });
      return ['تحقق من جودة الردود خلال هذا الأسبوع وفعّل تخصيصاً أكبر للطلبات الشائعة'];
    }
  }
}

export default ContinuousImprovementEngine;
