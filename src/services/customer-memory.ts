import { getDatabase } from '../db/adapter.js';
import { getLogger } from './logger.js';

export interface PreferencePatch {
  gender?: string | null;
  category?: string | null;
  size?: string | null;
  color?: string | null;
  brand?: string | null;
  priceSensitivity?: 'low'|'medium'|'high';
}

export interface BehaviorRecord {
  type: 'VIEW'|'ADD_TO_CART'|'PURCHASE'|'ABANDON'|'LIKE';
  productId?: string;
  metadata?: Record<string, unknown>;
}

export interface BuiltProfile {
  previousOrders: number;
  averageOrderValue: number;
  preferredCategories: string[];
  lastInteraction: Date | null;
}

export class CustomerMemoryService {
  private db = getDatabase();
  private log = getLogger({ component: 'customer-memory' });

  async savePreferences(merchantId: string, customerId: string, patch: PreferencePatch): Promise<void> {
    const sql = this.db.getSQL();
    try {
      await sql`
        INSERT INTO customer_preferences (merchant_id, customer_id, data)
        VALUES (${merchantId}::uuid, ${customerId}, ${JSON.stringify(patch)}::jsonb)
        ON CONFLICT (merchant_id, customer_id)
        DO UPDATE SET data = COALESCE(customer_preferences.data,'{}'::jsonb) || ${JSON.stringify(patch)}::jsonb, updated_at = NOW()
      `;
    } catch (e) {
      this.log.warn('savePreferences failed', { error: String(e) });
    }
  }

  async recordBehavior(merchantId: string, customerId: string, rec: BehaviorRecord): Promise<void> {
    const sql = this.db.getSQL();
    try {
      await sql`
        INSERT INTO customer_behavior_history (merchant_id, customer_id, event_type, product_id, metadata, created_at)
        VALUES (${merchantId}::uuid, ${customerId}, ${rec.type}, ${rec.productId ?? null}, ${JSON.stringify(rec.metadata || {})}::jsonb, NOW())
      `;
    } catch (e) {
      this.log.warn('recordBehavior failed', { error: String(e) });
    }
  }

  async buildProfile(merchantId: string, customerId: string): Promise<BuiltProfile> {
    const sql = this.db.getSQL();
    try {
      const [orders, prefs] = await Promise.all([
        sql<{ cnt: number; aov: number }>`
          SELECT COUNT(*)::int as cnt, COALESCE(AVG(total_amount),0)::float as aov
          FROM orders WHERE merchant_id = ${merchantId}::uuid AND customer_instagram = ${customerId}
        `,
        sql<{ data: Record<string, unknown>; updated_at: Date }>`
          SELECT data, updated_at FROM customer_preferences WHERE merchant_id = ${merchantId}::uuid AND customer_id = ${customerId} LIMIT 1
        `,
      ]);

      const previousOrders = orders[0]?.cnt || 0;
      const averageOrderValue = Number(orders[0]?.aov || 0);
      const preferredCategories = Array.isArray((prefs[0]?.data as Record<string, unknown> | undefined)?.preferredCategories)
        ? ((prefs[0]?.data as { preferredCategories?: string[] } | undefined)?.preferredCategories as string[])
        : [];
      const lastInteraction = prefs[0]?.updated_at ?? null;

      return { previousOrders, averageOrderValue, preferredCategories, lastInteraction };
    } catch (e) {
      this.log.warn('buildProfile failed', { error: String(e) });
      return { previousOrders: 0, averageOrderValue: 0, preferredCategories: [], lastInteraction: null };
    }
  }
}

export default CustomerMemoryService;

