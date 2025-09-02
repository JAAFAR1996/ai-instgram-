import { getDatabase } from '../db/adapter.js';
import { getLogger } from './logger.js';

export interface TimingInsights {
  bestPostingTimes: string[]; // e.g., ['evening','afternoon']
  peakEngagementHours: string[]; // hour strings like '17','18'
  customerActiveHours: Map<string, string[]>; // customerId -> top time slots
  optimalResponseWindows: string[]; // e.g., ['12-16','17-21']
}

type TimeSlot = 'morning' | 'afternoon' | 'evening' | 'night';

export class InstagramTimingOptimizer {
  private db = getDatabase();
  private log = getLogger({ component: 'instagram-timing-optimizer' });

  private slotForHour(h: number): TimeSlot {
    if (h >= 6 && h <= 11) return 'morning';
    if (h >= 12 && h <= 16) return 'afternoon';
    if (h >= 17 && h <= 21) return 'evening';
    return 'night';
  }

  /**
   * Generate aggregate timing insights per merchant
   */
  async generateTimingInsights(merchantId: string): Promise<TimingInsights> {
    const sql = this.db.getSQL();
    // 1) Customer active hour slots
    const rows = await sql<{ customer_instagram: string; h: number }>`
      SELECT c.customer_instagram, EXTRACT(HOUR FROM ml.created_at)::int as h
      FROM message_logs ml
      JOIN conversations c ON c.id = ml.conversation_id
      WHERE c.merchant_id = ${merchantId}::uuid AND ml.direction in ('INCOMING','OUTGOING')
        AND ml.created_at >= NOW() - INTERVAL '30 days'
    `;

    const active = new Map<string, Map<TimeSlot, number>>();
    for (const r of rows) {
      const slot = this.slotForHour(Number(r.h));
      if (!active.has(r.customer_instagram)) active.set(r.customer_instagram, new Map());
      const m = active.get(r.customer_instagram)!;
      m.set(slot, (m.get(slot) || 0) + 1);
    }
    const customerActiveHours = new Map<string, string[]>();
    for (const [cid, m] of active.entries()) {
      const top = Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
      customerActiveHours.set(cid, top);
    }

    // 2) Peak engagement hours (responses after outgoing)
    const engage = await sql<{ h: number; responses: number }>`
      WITH times AS (
        SELECT EXTRACT(HOUR FROM ml.created_at)::int as h,
               ml.direction,
               LAG(ml.direction) OVER (PARTITION BY ml.conversation_id ORDER BY ml.created_at) as prev_dir
        FROM message_logs ml
        JOIN conversations c ON c.id = ml.conversation_id
        WHERE c.merchant_id = ${merchantId}::uuid AND ml.created_at >= NOW() - INTERVAL '30 days'
      )
      SELECT h, COUNT(*)::int as responses
      FROM times
      WHERE direction = 'INCOMING' AND prev_dir = 'OUTGOING'
      GROUP BY h
      ORDER BY responses DESC
      LIMIT 4
    `;
    const peakEngagementHours = engage.map(r => String(r.h));

    // 3) Best posting time slots by response ratio
    const slots = await sql<{ slot: string; responses: number; sent: number }>`
      WITH slot_times AS (
        SELECT CASE
                 WHEN EXTRACT(HOUR FROM ml.created_at) BETWEEN 6 AND 11 THEN 'morning'
                 WHEN EXTRACT(HOUR FROM ml.created_at) BETWEEN 12 AND 16 THEN 'afternoon'
                 WHEN EXTRACT(HOUR FROM ml.created_at) BETWEEN 17 AND 21 THEN 'evening'
                 ELSE 'night'
               END as slot,
               ml.direction,
               LAG(ml.direction) OVER (PARTITION BY ml.conversation_id ORDER BY ml.created_at) as prev_dir
        FROM message_logs ml
        JOIN conversations c ON c.id = ml.conversation_id
        WHERE c.merchant_id = ${merchantId}::uuid AND ml.created_at >= NOW() - INTERVAL '30 days'
      )
      SELECT slot,
             COUNT(CASE WHEN direction = 'INCOMING' AND prev_dir = 'OUTGOING' THEN 1 END)::int as responses,
             COUNT(CASE WHEN direction = 'OUTGOING' THEN 1 END)::int as sent
      FROM slot_times
      GROUP BY slot
      HAVING COUNT(CASE WHEN direction = 'OUTGOING' THEN 1 END) > 0
      ORDER BY (COUNT(CASE WHEN direction = 'INCOMING' AND prev_dir = 'OUTGOING' THEN 1 END)::float/
                NULLIF(COUNT(CASE WHEN direction = 'OUTGOING' THEN 1 END),0)) DESC
    `;
    const bestPostingTimes = slots.map(s => s.slot);
    const optimalResponseWindows = bestPostingTimes.map(s => (s === 'morning' ? '6-11' : s === 'afternoon' ? '12-16' : s === 'evening' ? '17-21' : '22-5'));

    const insights: TimingInsights = {
      bestPostingTimes,
      peakEngagementHours,
      customerActiveHours,
      optimalResponseWindows
    };

    try {
      this.log.info('Timing insights generated', { merchantId, topSlot: bestPostingTimes[0], topHour: peakEngagementHours[0] });
    } catch {}

    return insights;
  }
}

export default InstagramTimingOptimizer;

