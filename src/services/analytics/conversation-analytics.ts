import { getDatabase } from '../../db/adapter.js';

export interface TimeRange { days?: number; from?: Date; to?: Date }

export class ConversationAnalytics {
  private db = getDatabase();

  async generateMerchantDashboard(merchantId: string, timeRange: TimeRange = { days: 30 }) {
    const sql = this.db.getSQL();
    const from = timeRange.from || new Date(Date.now() - (timeRange.days || 30) * 86400000);
    const to = timeRange.to || new Date();

    const [conv, prod, perf] = await Promise.all([
      sql<{ total: number; converted: number; avg_messages: number }>`
        SELECT COUNT(*)::int as total,
               COALESCE(SUM(CASE WHEN converted_to_order THEN 1 ELSE 0 END),0)::int as converted,
               COALESCE(AVG(message_count),0)::float as avg_messages
        FROM conversations
        WHERE merchant_id = ${merchantId}::uuid AND created_at BETWEEN ${from} AND ${to}
      `,
      sql<{ category: string | null; inquiries: number }>`
        SELECT (c.session_data->>'category') as category,
               COUNT(*)::int as inquiries
        FROM message_logs ml
        JOIN conversations c ON c.id = ml.conversation_id
        WHERE c.merchant_id = ${merchantId}::uuid 
          AND ml.created_at BETWEEN ${from} AND ${to}
        GROUP BY 1
        ORDER BY inquiries DESC
        LIMIT 10
      `,
      sql<{ avg_ms: number }>`
        SELECT COALESCE(AVG(processing_time_ms),0)::float as avg_ms
        FROM message_logs ml
        JOIN conversations c ON c.id = ml.conversation_id
        WHERE c.merchant_id = ${merchantId}::uuid AND ml.direction = 'OUTGOING' AND ml.created_at BETWEEN ${from} AND ${to}
      `
    ]);

    return {
      summary: {
        totalConversations: conv[0]?.total || 0,
        conversionRate: conv[0]?.total ? ((conv[0]!.converted / conv[0]!.total) * 100) : 0,
        averageResponseTime: perf[0]?.avg_ms || 0,
      },
      productInsights: {
        mostInquiredCategories: prod.map(p => ({ category: p.category, inquiries: p.inquiries }))
      }
    };
  }
}

export default ConversationAnalytics;
