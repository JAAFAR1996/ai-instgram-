import { getDatabase } from '../db/adapter.js';
import { getLogger } from './logger.js';

export interface JourneyStats {
  previousOrders: number;
  totalSpent: number;
  averageOrderValue: number;
  lastOrderAt: Date | null;
  messagesCount30d: number;
}

export interface PreferenceSignals {
  categories: string[];
  colors: string[];
  sizes: string[];
  brands: string[];
  priceSensitivity: 'low' | 'medium' | 'high';
}

export interface BehaviorPatterns {
  activeHours: Array<'morning'|'afternoon'|'evening'|'night'>;
  engagementLevel: 'low'|'medium'|'high';
}

export interface PersonalizationProfile {
  tier: 'NEW' | 'REPEAT' | 'VIP';
  journey: JourneyStats;
  preferences: PreferenceSignals;
  patterns: BehaviorPatterns;
}

function toSlot(d: Date): 'morning'|'afternoon'|'evening'|'night' {
  const h = d.getHours();
  if (h >= 6 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

export class CustomerProfiler {
  private db = getDatabase();
  private log = getLogger({ component: 'customer-profiler' });

  /** Track basic purchase stats and message volume */
  public async trackPurchaseHistory(merchantId: string, customerId: string): Promise<JourneyStats> {
    const sql = this.db.getSQL();
    const [orders, msgs] = await Promise.all([
      sql<{ cnt: number; total: number; aov: number; last_at: Date | null }>`
        SELECT COUNT(*)::int as cnt,
               COALESCE(SUM(total_amount),0)::float as total,
               COALESCE(AVG(total_amount),0)::float as aov,
               MAX(created_at) as last_at
        FROM orders
        WHERE merchant_id = ${merchantId}::uuid
          AND customer_instagram = ${customerId}
      `,
      sql<{ cnt: number }>`
        SELECT COUNT(*)::int as cnt
        FROM message_logs ml
        JOIN conversations c ON c.id = ml.conversation_id
        WHERE c.merchant_id = ${merchantId}::uuid
          AND c.customer_instagram = ${customerId}
          AND ml.created_at >= NOW() - INTERVAL '30 days'
      `
    ]);

    return {
      previousOrders: orders[0]?.cnt ?? 0,
      totalSpent: Number(orders[0]?.total ?? 0),
      averageOrderValue: Number(orders[0]?.aov ?? 0),
      lastOrderAt: orders[0]?.last_at ?? null,
      messagesCount30d: msgs[0]?.cnt ?? 0,
    };
  }

  /** Learn preferences from preferences table, behavior history, and session data */
  public async analyzePreferences(merchantId: string, customerId: string): Promise<PreferenceSignals> {
    const sql = this.db.getSQL();
    let categories: string[] = [];
    let colors: string[] = [];
    let sizes: string[] = [];
    let brands: string[] = [];
    let priceSensitivity: 'low'|'medium'|'high' = 'medium';

    try {
      const prefRows = await sql<{ data: Record<string, unknown> }>`
        SELECT data FROM customer_preferences WHERE merchant_id = ${merchantId}::uuid AND customer_id = ${customerId} LIMIT 1
      `;
      const d = prefRows[0]?.data || {};
      const obj = d as Record<string, unknown>;
      const pc = obj['preferredCategories'];
      if (Array.isArray(pc)) categories = pc.filter((v): v is string => typeof v === 'string');
      const fc = obj['favoriteColor'];
      if (typeof fc === 'string') colors.push(fc);
      const sz = obj['size'];
      if (typeof sz === 'string') sizes.push(sz);
      const br = obj['brand'];
      if (typeof br === 'string') brands.push(br);
      const psVal = obj['priceSensitivity'];
      if (typeof psVal === 'string') {
        const ps = String(psVal);
        if (ps === 'low' || ps === 'medium' || ps === 'high') priceSensitivity = ps;
      }
    } catch (e) {
      this.log.warn('analyzePreferences: preferences load failed', { error: String(e) });
    }

    // Behavior history hints
    try {
      const hist = await sql<{ metadata: Record<string, unknown> | null }>`
        SELECT metadata FROM customer_behavior_history
        WHERE merchant_id = ${merchantId}::uuid AND customer_id = ${customerId}
        ORDER BY created_at DESC LIMIT 50
      `;
      for (const h of hist) {
        const m = (h.metadata || {}) as Record<string, unknown>;
        const cat = m['category']; if (typeof cat === 'string') categories.push(cat);
        const col = m['color']; if (typeof col === 'string') colors.push(col);
        const sz = m['size']; if (typeof sz === 'string') sizes.push(sz);
        const br = m['brand']; if (typeof br === 'string') brands.push(br);
      }
    } catch (e) {
      this.log.warn('analyzePreferences: behavior history load failed', { error: String(e) });
    }

    // Normalize & trim
    const uniq = (a: string[]) => Array.from(new Set(a.filter(Boolean))).slice(0, 5);
    return {
      categories: uniq(categories),
      colors: uniq(colors),
      sizes: uniq(sizes),
      brands: uniq(brands),
      priceSensitivity,
    };
  }

  /** Detect behavioral patterns such as active hours and engagement */
  private async detectPatterns(merchantId: string, customerId: string): Promise<BehaviorPatterns> {
    const sql = this.db.getSQL();
    const rows = await sql<{ created_at: Date }>`
      SELECT ml.created_at
      FROM message_logs ml
      JOIN conversations c ON c.id = ml.conversation_id
      WHERE c.merchant_id = ${merchantId}::uuid AND c.customer_instagram = ${customerId}
      ORDER BY ml.created_at DESC LIMIT 100
    `;
    const counts = new Map<'morning'|'afternoon'|'evening'|'night', number>();
    for (const r of rows) {
      const slot = toSlot(new Date(r.created_at));
      counts.set(slot, (counts.get(slot) ?? 0) + 1);
    }
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 2);
    const engagementLevel: BehaviorPatterns['engagementLevel'] = rows.length > 60 ? 'high' : rows.length > 20 ? 'medium' : 'low';
    return { activeHours: sorted, engagementLevel };
  }

  /** Predict next purchase category based on history + preferences */
  public async predictNextPurchase(merchantId: string, customerId: string): Promise<{ category?: string; confidence: number }> {
    const journey = await this.trackPurchaseHistory(merchantId, customerId);
    const prefs = await this.analyzePreferences(merchantId, customerId);
    let cat: string | undefined;
    if (prefs.categories.length) cat = prefs.categories[0];
    // Simple heuristic: if frequent purchaser and no explicit category, use most recent order category
    if (!cat && journey.previousOrders > 0) {
      try {
        const sql = this.db.getSQL();
        const last = await sql<{ category: string | null }>`
          SELECT p.category FROM orders o
          JOIN order_items oi ON oi.order_id = o.id
          JOIN products p ON p.id = oi.product_id
          WHERE o.merchant_id = ${merchantId}::uuid AND o.customer_instagram = ${customerId}
          ORDER BY o.created_at DESC LIMIT 1
        `;
        cat = last[0]?.category ?? undefined;
      } catch {}
    }
    const conf = cat ? (journey.previousOrders > 1 ? 0.8 : 0.6) : 0.4;
    if (cat) {
      return { category: cat, confidence: conf };
    }
    return { confidence: conf };
  }

  /** Build personalization profile to drive response personalization */
  public async personalizeResponses(merchantId: string, customerId: string): Promise<PersonalizationProfile> {
    const journey = await this.trackPurchaseHistory(merchantId, customerId);
    const preferences = await this.analyzePreferences(merchantId, customerId);
    const patterns = await this.detectPatterns(merchantId, customerId);
    let tier: PersonalizationProfile['tier'] = 'NEW';
    if (journey.previousOrders >= 5 || journey.averageOrderValue >= 100) tier = 'VIP';
    else if (journey.previousOrders >= 1) tier = 'REPEAT';
    return { tier, journey, preferences, patterns };
  }
}

export default CustomerProfiler;
