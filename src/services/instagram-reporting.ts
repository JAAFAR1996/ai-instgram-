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
    const incoming = inter[0]?.incoming ?? 0;
    const outgoing = inter[0]?.outgoing ?? 0;
    const responsePairs = inter[0]?.responses ?? 0;

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
    const orders = conv[0]?.orders ?? 0;
    const revenue = Number(conv[0]?.revenue ?? 0);
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

    const personalization: DailyReport['personalization'] = {};
    if (q[0]?.avg_q != null) personalization.avgQualityScore = Number(q[0].avg_q);
    if (typeof q[0]?.improved === 'number') personalization.improvedCount = q[0].improved;

    const report: DailyReport = {
      date: dayStart.toISOString().slice(0, 10),
      windows,
      interactions: { incoming, outgoing, responsePairs },
      conversions: { orders, revenue, conversionRate },
      personalization,
      optimalTimes: { bestPostingTimes: timing.bestPostingTimes.slice(0, 2), peakHours: timing.peakEngagementHours.slice(0, 3) }
    };

    try { this.log.info('Daily report generated', { merchantId, date: report.date, rr: windows.responseRate, orders }); } catch {}
    return report;
  }

  async generateWeeklyReport(merchantId: string, ref: Date = new Date()): Promise<DailyReport[]> {
    // Generate all dates for the week
    const dates = Array.from({ length: 7 }, (_, i) => 
      new Date(ref.getTime() - (6 - i) * 24 * 60 * 60 * 1000)
    );
    
    // Process all dates concurrently for better performance
    const days = await Promise.all(
      dates.map(date => this.generateDailyReport(merchantId, date))
    );
    
    return days;
  }

  async generateMonthlyReport(merchantId: string, ref: Date = new Date()): Promise<DailyReport[]> {
    // Generate all dates for the month (30 days)
    const dates = Array.from({ length: 30 }, (_, i) => 
      new Date(ref.getTime() - (29 - i) * 24 * 60 * 60 * 1000)
    );
    
    // Process dates in smaller concurrent batches to avoid overwhelming the database
    const batchSize = 5;
    const results: DailyReport[] = [];
    
    for (let i = 0; i < dates.length; i += batchSize) {
      const batch = dates.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(date => this.generateDailyReport(merchantId, date))
      );
      results.push(...batchResults);
      
      // Small delay between batches to prevent database overload
      if (i + batchSize < dates.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return results;
  }
}

export default InstagramReportingService;
