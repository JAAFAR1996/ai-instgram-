import { getDatabase } from '../db/adapter.js';
import { getLogger } from './logger.js';
import InstagramTimingOptimizer from './instagram-timing-optimizer.js';

export interface DailyReport {
  date: string;
  windows: { sent: number; responded: number; responseRate: number };
  interactions: { incoming: number; outgoing: number; responsePairs: number };
  conversions: { orders: number; revenue: number; conversionRate: number };
  personalization: { avgQualityScore?: number; improvedCount?: number };
  optimalTimes: { bestPostingTimes: string[]; peakHours: string[] };
}

export class InstagramReportingService {
  private db = getDatabase();
  private log = getLogger({ component: 'instagram-reporting' });
  private optimizer = new InstagramTimingOptimizer();

  async generateDailyReport(merchantId: string, day: Date = new Date()): Promise<DailyReport> {
    const sql = this.db.getSQL();
    const dayStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 0, 0, 0));
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    // Interactions
    const inter = await sql<{ incoming: number; outgoing: number; responses: number }>`
      WITH base AS (
        SELECT ml.*, LAG(ml.direction) OVER (PARTITION BY ml.conversation_id ORDER BY ml.created_at) as prev_dir
        FROM message_logs ml
        JOIN conversations c ON c.id = ml.conversation_id
        WHERE c.merchant_id = ${merchantId}::uuid AND ml.created_at >= ${dayStart} AND ml.created_at < ${dayEnd}
      )
      SELECT COUNT(CASE WHEN direction='INCOMING' THEN 1 END)::int as incoming,
             COUNT(CASE WHEN direction='OUTGOING' THEN 1 END)::int as outgoing,
             COUNT(CASE WHEN direction='INCOMING' AND prev_dir='OUTGOING' THEN 1 END)::int as responses
      FROM base
    `;
    const incoming = inter[0]?.incoming || 0;
    const outgoing = inter[0]?.outgoing || 0;
    const responsePairs = inter[0]?.responses || 0;

    // Window utilization proxy (sent vs responded)
    const windows = {
      sent: outgoing,
      responded: responsePairs,
      responseRate: outgoing > 0 ? Math.round((responsePairs / outgoing) * 100) : 0
    };

    // Conversions
    const conv = await sql<{ orders: number; revenue: number }>`
      SELECT COUNT(*)::int as orders, COALESCE(SUM(total_amount),0)::float as revenue
      FROM orders
      WHERE merchant_id = ${merchantId}::uuid AND created_at >= ${dayStart} AND created_at < ${dayEnd}
    `;
    const orders = conv[0]?.orders || 0;
    const revenue = Number(conv[0]?.revenue || 0);
    const conversionRate = incoming > 0 ? Math.round((orders / incoming) * 100) : 0;

    // Personalization effectiveness (quality_score metadata)
    const q = await sql<{ avg_q: number | null; improved: number }>`
      SELECT AVG((ml.metadata->>'quality_score')::float) as avg_q,
             COUNT(CASE WHEN (ml.metadata->>'quality_improved')::bool = true THEN 1 END)::int as improved
      FROM message_logs ml
      JOIN conversations c ON c.id = ml.conversation_id
      WHERE c.merchant_id = ${merchantId}::uuid AND ml.direction='OUTGOING'
        AND ml.created_at >= ${dayStart} AND ml.created_at < ${dayEnd}
    `;

    // Optimal times summary
    const timing = await this.optimizer.generateTimingInsights(merchantId);

    const report: DailyReport = {
      date: dayStart.toISOString().slice(0, 10),
      windows,
      interactions: { incoming, outgoing, responsePairs },
      conversions: { orders, revenue, conversionRate },
      personalization: { avgQualityScore: q[0]?.avg_q || undefined, improvedCount: q[0]?.improved },
      optimalTimes: { bestPostingTimes: timing.bestPostingTimes.slice(0, 2), peakHours: timing.peakEngagementHours.slice(0, 3) }
    };

    try { this.log.info('Daily report generated', { merchantId, date: report.date, rr: windows.responseRate, orders }); } catch {}
    return report;
  }

  async generateWeeklyReport(merchantId: string, ref: Date = new Date()): Promise<DailyReport[]> {
    const days: DailyReport[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(ref.getTime() - i * 24 * 60 * 60 * 1000);
      // eslint-disable-next-line no-await-in-loop
      days.push(await this.generateDailyReport(merchantId, d));
    }
    return days;
  }

  async generateMonthlyReport(merchantId: string, ref: Date = new Date()): Promise<DailyReport[]> {
    const days: DailyReport[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(ref.getTime() - i * 24 * 60 * 60 * 1000);
      // eslint-disable-next-line no-await-in-loop
      days.push(await this.generateDailyReport(merchantId, d));
    }
    return days;
  }
}

export default InstagramReportingService;

