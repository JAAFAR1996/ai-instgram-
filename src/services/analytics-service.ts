/**
 * ===============================================
 * Analytics Service
 * Records analytics events in database and provides aggregation helpers
 * ===============================================
 */

import { getDatabase } from '../database/connection.js';

export interface AnalyticsEvent {
  type: string;
  merchantId?: string;
  data?: Record<string, any>;
}

export interface AnalyticsRecordResult {
  success: boolean;
  total?: number;
  error?: string;
}

export class AnalyticsService {
  private db = getDatabase();

  /**
   * Record analytics event and return total count for event type
   */
  async recordEvent(event: AnalyticsEvent): Promise<AnalyticsRecordResult> {
    const sql = this.db.getSQL();

    try {
      await sql`
        INSERT INTO analytics_events (
          event_type,
          merchant_id,
          metadata
        ) VALUES (
          ${event.type},
          ${event.merchantId || null},
          ${event.data ? JSON.stringify(event.data) : '{}'}
        )
      `;

      const [row] = await sql`
        SELECT COUNT(*) as count FROM analytics_events
        WHERE event_type = ${event.type}
      `;

      return { success: true, total: parseInt(row.count) };
    } catch (error) {
      console.error('❌ Analytics event recording failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

// Singleton instance
let analyticsServiceInstance: AnalyticsService | null = null;

export function getAnalyticsService(): AnalyticsService {
  if (!analyticsServiceInstance) {
    analyticsServiceInstance = new AnalyticsService();
  }
  return analyticsServiceInstance;
}