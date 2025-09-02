import { getDatabase } from '../db/adapter.js';
import { getLogger } from './logger.js';
import CustomerProfiler, { PersonalizationProfile } from './customer-profiler.js';

export interface SizeIssuesPrediction {
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  confidence: number;
  suggestedActions: string[];
  alternativeSizes?: string[];
  reasonCodes: ('HISTORY_MISMATCH' | 'SIZE_CONFLICT' | 'CATEGORY_PATTERN' | 'FREQUENT_RETURNS')[];
}

export interface ChurnRiskPrediction {
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  churnProbability: number;
  daysToPredictedChurn?: number;
  retentionActions: string[];
  riskFactors: string[];
}

export interface ProactiveAction {
  type: 'SIZE_WARNING' | 'RESTOCK_ALERT' | 'FOLLOWUP_MESSAGE' | 'LOYALTY_OFFER';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  message: string;
  scheduledAt?: Date;
  context: Record<string, unknown>;
}

export interface TimingOptimization {
  bestContactTime: 'morning' | 'afternoon' | 'evening' | 'night';
  bestDayOfWeek: string;
  confidence: number;
  responseRate: number;
}

export class PredictiveAnalyticsEngine {
  private db = getDatabase();
  private log = getLogger({ component: 'predictive-analytics' });
  private profiler = new CustomerProfiler();

  /**
   * Predict size-related issues before they occur
   * Analyzes purchase history, returns, and product categories
   */
  public async predictSizeIssues(
    merchantId: string, 
    customerId: string, 
    proposedProductId?: string,
    proposedSize?: string
  ): Promise<SizeIssuesPrediction> {
    try {
      const sql = this.db.getSQL();
      const reasonCodes: SizeIssuesPrediction['reasonCodes'] = [];
      const suggestedActions: string[] = [];
      let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
      let confidence = 0.5;

      // Get customer's historical size patterns
      const sizeHistory = await sql<{ size: string; category: string; returned: boolean; rating?: number }>`
        SELECT p.size, p.category, 
               CASE WHEN r.id IS NOT NULL THEN true ELSE false END as returned,
               r.rating
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN products p ON p.id = oi.product_id
        LEFT JOIN returns r ON r.order_id = o.id
        WHERE o.merchant_id = ${merchantId}::uuid 
          AND o.customer_instagram = ${customerId}
          AND p.size IS NOT NULL
        ORDER BY o.created_at DESC
        LIMIT 10
      `;

      if (sizeHistory.length === 0) {
        return {
          riskLevel: 'MEDIUM',
          confidence: 0.3,
          suggestedActions: ['اطلب من العميل تأكيد المقاس', 'اقترح جدول المقاسات'],
          reasonCodes: [],
        };
      }

      // Analyze return patterns by size
      const returnsBySize = new Map<string, number>();
      const totalBySizes = new Map<string, number>();
      
      for (const item of sizeHistory) {
        const size = item.size || 'unknown';
        totalBySizes.set(size, (totalBySizes.get(size) || 0) + 1);
        if (item.returned) {
          returnsBySize.set(size, (returnsBySize.get(size) || 0) + 1);
        }
      }

      // Check for size inconsistency
      const uniqueSizes = Array.from(totalBySizes.keys());
      if (uniqueSizes.length > 3) {
        reasonCodes.push('SIZE_CONFLICT');
        riskLevel = 'MEDIUM';
        confidence += 0.2;
        suggestedActions.push('تحقق من جدول المقاسات مع العميل');
      }

      // Check for frequent returns
      const totalOrders = sizeHistory.length;
      const totalReturns = sizeHistory.filter(h => h.returned).length;
      const returnRate = totalReturns / totalOrders;

      if (returnRate > 0.3) {
        reasonCodes.push('FREQUENT_RETURNS');
        riskLevel = 'HIGH';
        confidence += 0.3;
        suggestedActions.push('اتصل بالعميل قبل الشحن', 'اقترح استرداد مجاني');
      }

      // If analyzing a specific product
      if (proposedProductId && proposedSize) {
        const productInfo = await sql<{ category: string; brand: string }>`
          SELECT category, brand FROM products WHERE id = ${proposedProductId} LIMIT 1
        `;

        const info = productInfo[0];
        if (info) {
          // Check category-specific patterns
          const categoryHistory = sizeHistory.filter(h => h.category === info.category);
          if (categoryHistory.length > 0) {
            const commonSizeInCategory = this.getMostCommonSize(categoryHistory.map(h => h.size));
            if (commonSizeInCategory && commonSizeInCategory !== proposedSize) {
              reasonCodes.push('CATEGORY_PATTERN');
              riskLevel = 'MEDIUM';
              confidence += 0.25;
              suggestedActions.push(`المقاس المعتاد للعميل في ${info.category} هو ${commonSizeInCategory}`);
            }
          }
        }
      }

      // Suggest alternative sizes
      const alternativeSizes: string[] = [];
      if (uniqueSizes.length > 0) {
        // Get sizes with lowest return rate
        const sizesBySuccess = uniqueSizes
          .map(size => ({
            size,
            successRate: 1 - ((returnsBySize.get(size) || 0) / (totalBySizes.get(size) || 1))
          }))
          .sort((a, b) => b.successRate - a.successRate)
          .slice(0, 2)
          .map(s => s.size);
        
        alternativeSizes.push(...sizesBySuccess);
      }

      const result: SizeIssuesPrediction = {
        riskLevel,
        confidence: Math.min(confidence, 1),
        suggestedActions,
        reasonCodes,
      };
      if (alternativeSizes.length > 0) {
        result.alternativeSizes = alternativeSizes;
      }
      return result;

    } catch (error) {
      this.log.warn('Size issues prediction failed', { error: String(error) });
      return {
        riskLevel: 'MEDIUM',
        confidence: 0.1,
        suggestedActions: ['تحقق يدوياً من المقاس مع العميل'],
        reasonCodes: [],
      };
    }
  }

  /**
   * Predict customer churn risk based on engagement patterns
   */
  public async predictCustomerChurn(merchantId: string, customerId: string): Promise<ChurnRiskPrediction> {
    try {
      const sql = this.db.getSQL();
      const riskFactors: string[] = [];
      const retentionActions: string[] = [];

      // Get customer activity in last 90 days
      const activityData = await sql<{ 
        last_message_days_ago: number;
        message_frequency: number;
        last_order_days_ago: number | null;
        total_orders: number;
        avg_order_value: number;
        engagement_trend: number;
      }>`
        WITH recent_messages AS (
          SELECT COUNT(*) as msg_count,
                 EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))/86400 as last_msg_days,
                 EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))/86400 as msg_span_days
          FROM message_logs ml
          JOIN conversations c ON c.id = ml.conversation_id
          WHERE c.merchant_id = ${merchantId}::uuid 
            AND c.customer_instagram = ${customerId}
            AND ml.created_at >= NOW() - INTERVAL '90 days'
        ),
        recent_orders AS (
          SELECT COUNT(*) as order_count,
                 EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))/86400 as last_order_days,
                 AVG(total_amount) as avg_amount
          FROM orders
          WHERE merchant_id = ${merchantId}::uuid 
            AND customer_instagram = ${customerId}
            AND created_at >= NOW() - INTERVAL '90 days'
        ),
        engagement_trend AS (
          SELECT COUNT(*) as recent_msgs
          FROM message_logs ml
          JOIN conversations c ON c.id = ml.conversation_id
          WHERE c.merchant_id = ${merchantId}::uuid 
            AND c.customer_instagram = ${customerId}
            AND ml.created_at >= NOW() - INTERVAL '30 days'
        )
        SELECT 
          rm.last_msg_days as last_message_days_ago,
          CASE WHEN rm.msg_span_days > 0 THEN rm.msg_count / rm.msg_span_days * 7 ELSE 0 END as message_frequency,
          ro.last_order_days as last_order_days_ago,
          ro.order_count as total_orders,
          ro.avg_amount as avg_order_value,
          et.recent_msgs as engagement_trend
        FROM recent_messages rm
        CROSS JOIN recent_orders ro  
        CROSS JOIN engagement_trend et
      `;

      if (!activityData[0]) {
        return {
          riskLevel: 'MEDIUM',
          churnProbability: 0.4,
          retentionActions: ['إعادة تفعيل العميل بعرض خاص'],
          riskFactors: ['عدم وجود بيانات كافية'],
        };
      }

      const data = activityData[0];
      let churnProbability = 0.1; // Base probability

      // Factor 1: Days since last message
      if (data.last_message_days_ago > 30) {
        churnProbability += 0.3;
        riskFactors.push('عدم التفاعل لأكثر من 30 يوم');
        retentionActions.push('أرسل رسالة "نشتاقلك"', 'اعرض خصم حصري');
      } else if (data.last_message_days_ago > 14) {
        churnProbability += 0.15;
        riskFactors.push('قلة التفاعل مؤخراً');
        retentionActions.push('ذكر العميل بمنتجات جديدة');
      }

      // Factor 2: Message frequency decline
      if (data.message_frequency < 1) {
        churnProbability += 0.2;
        riskFactors.push('تراجع تكرار الرسائل');
        retentionActions.push('استطلاع رأي العميل', 'اقترح منتجات مناسبة');
      }

      // Factor 3: No recent orders
      if (data.last_order_days_ago === null || data.last_order_days_ago > 60) {
        churnProbability += 0.25;
        riskFactors.push('لا توجد طلبات حديثة');
        retentionActions.push('عرض خصم لإعادة الشراء', 'عرض شحن مجاني');
      }

      // Factor 4: Low engagement trend
      if (data.engagement_trend < 2) {
        churnProbability += 0.15;
        riskFactors.push('تراجع التفاعل الشهري');
        retentionActions.push('محتوى تفاعلي جديد', 'استبيان تحسين الخدمة');
      }

      // Determine risk level
      let riskLevel: ChurnRiskPrediction['riskLevel'];
      if (churnProbability >= 0.7) riskLevel = 'HIGH';
      else if (churnProbability >= 0.4) riskLevel = 'MEDIUM';
      else riskLevel = 'LOW';

      // Calculate days to predicted churn (rough estimate)
      const base: ChurnRiskPrediction = {
        riskLevel,
        churnProbability: Math.min(churnProbability, 1),
        retentionActions,
        riskFactors,
      };
      if (churnProbability > 0.5) {
        const days = Math.max(7, Math.floor(30 - (data.last_message_days_ago || 0)));
        base.daysToPredictedChurn = days;
      }
      return base;

    } catch (error) {
      this.log.warn('Churn prediction failed', { error: String(error) });
      return {
        riskLevel: 'MEDIUM',
        churnProbability: 0.5,
        retentionActions: ['تحليل يدوي لحالة العميل'],
        riskFactors: ['خطأ في التحليل'],
      };
    }
  }

  /**
   * Suggest proactive actions based on predictions
   */
  public async suggestProactiveActions(
    merchantId: string, 
    customerId: string,
    context?: { pendingOrderId?: string; productId?: string }
  ): Promise<ProactiveAction[]> {
    try {
      const actions: ProactiveAction[] = [];

      // Get predictions
      const [sizeRisk, churnRisk] = await Promise.all([
        this.predictSizeIssues(merchantId, customerId, context?.productId),
        this.predictCustomerChurn(merchantId, customerId),
      ]);

      // Size-related actions
      if (sizeRisk.riskLevel === 'HIGH') {
        actions.push({
          type: 'SIZE_WARNING',
          priority: 'HIGH',
          message: `تنبيه: العميل ${customerId} قد يواجه مشكلة في المقاس. ${sizeRisk.suggestedActions.join(' - ')}`,
          context: { sizeRisk, customerId, merchantId },
        });
      }

      // Churn prevention actions
      if (churnRisk.riskLevel === 'HIGH') {
        const urgency = churnRisk.daysToPredictedChurn && churnRisk.daysToPredictedChurn < 7 ? 'URGENT' : 'HIGH';
        actions.push({
          type: 'FOLLOWUP_MESSAGE',
          priority: urgency,
          message: `عميل معرض لخطر فقدانه! ${churnRisk.retentionActions[0] || 'تواصل فوري'}`,
          scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
          context: { churnRisk, customerId, merchantId },
        });
      } else if (churnRisk.riskLevel === 'MEDIUM') {
        actions.push({
          type: 'LOYALTY_OFFER',
          priority: 'MEDIUM',
          message: `اقترح عرض خاص للعميل ${customerId} - ${churnRisk.retentionActions[0] || 'خصم حصري'}`,
          scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // In 3 days
          context: { churnRisk, customerId, merchantId },
        });
      }

      // Check for low stock items in customer's preferences
      const profile = await this.profiler.personalizeResponses(merchantId, customerId);
      if (profile.preferences.categories.length > 0) {
        const sql = this.db.getSQL();
        const lowStockItems = await sql<{ name_ar: string; stock_level: number; id: string }>`
          SELECT name_ar, stock_level, id
          FROM products
          WHERE merchant_id = ${merchantId}::uuid
            AND category = ANY(${profile.preferences.categories})
            AND stock_level > 0 AND stock_level <= 3
          ORDER BY stock_level ASC
          LIMIT 3
        `;

        for (const item of lowStockItems) {
          actions.push({
            type: 'RESTOCK_ALERT',
            priority: 'MEDIUM',
            message: `المنتج "${item.name_ar}" أوشك على النفاد (${item.stock_level} قطع) - العميل ${customerId} مهتم بهذه الفئة`,
            context: { productId: item.id, stockLevel: item.stock_level, customerId, merchantId },
          });
        }
      }

      return actions.sort((a, b) => {
        const priorities = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
        return priorities[b.priority] - priorities[a.priority];
      });

    } catch (error) {
      this.log.warn('Proactive actions suggestion failed', { error: String(error) });
      return [];
    }
  }

  /**
   * Optimize timing for customer contact
   */
  public async optimizeTiming(merchantId: string, customerId: string): Promise<TimingOptimization> {
    try {
      const sql = this.db.getSQL();

      // Analyze message response patterns
      const responsePatterns = await sql<{
        hour_slot: string;
        day_of_week: number;
        responses: number;
        total_sent: number;
      }>`
        WITH message_times AS (
          SELECT 
            CASE 
              WHEN EXTRACT(HOUR FROM ml.created_at) BETWEEN 6 AND 11 THEN 'morning'
              WHEN EXTRACT(HOUR FROM ml.created_at) BETWEEN 12 AND 16 THEN 'afternoon'
              WHEN EXTRACT(HOUR FROM ml.created_at) BETWEEN 17 AND 21 THEN 'evening'
              ELSE 'night'
            END as hour_slot,
            EXTRACT(DOW FROM ml.created_at) as day_of_week,
            ml.direction,
            LAG(ml.direction) OVER (ORDER BY ml.created_at) as prev_direction
          FROM message_logs ml
          JOIN conversations c ON c.id = ml.conversation_id
          WHERE c.merchant_id = ${merchantId}::uuid 
            AND c.customer_instagram = ${customerId}
            AND ml.created_at >= NOW() - INTERVAL '60 days'
          ORDER BY ml.created_at
        )
        SELECT 
          hour_slot,
          day_of_week,
          COUNT(CASE WHEN direction = 'INCOMING' AND prev_direction = 'OUTGOING' THEN 1 END) as responses,
          COUNT(CASE WHEN direction = 'OUTGOING' THEN 1 END) as total_sent
        FROM message_times
        WHERE direction IN ('INCOMING', 'OUTGOING')
        GROUP BY hour_slot, day_of_week
        HAVING COUNT(CASE WHEN direction = 'OUTGOING' THEN 1 END) > 0
        ORDER BY responses::float / NULLIF(total_sent, 0) DESC
      `;

      if (responsePatterns.length === 0) {
        return {
          bestContactTime: 'afternoon',
          bestDayOfWeek: 'Monday',
          confidence: 0.1,
          responseRate: 0,
        };
      }

      const first = responsePatterns[0];
      if (!first) {
        return {
          bestContactTime: 'afternoon',
          bestDayOfWeek: 'Monday',
          confidence: 0.1,
          responseRate: 0,
        };
      }
      const responseRate = first.total_sent > 0 ? first.responses / first.total_sent : 0;
      
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const bestDay = dayNames[first.day_of_week] || 'Monday';

      return {
        bestContactTime: first.hour_slot as TimingOptimization['bestContactTime'],
        bestDayOfWeek: bestDay,
        confidence: Math.min(responsePatterns.length / 10, 1), // More data = higher confidence
        responseRate: Math.min(responseRate, 1),
      };

    } catch (error) {
      this.log.warn('Timing optimization failed', { error: String(error) });
      return {
        bestContactTime: 'afternoon',
        bestDayOfWeek: 'Monday',
        confidence: 0.1,
        responseRate: 0,
      };
    }
  }

  /**
   * Helper method to find the most common size
   */
  private getMostCommonSize(sizes: (string | null)[]): string | null {
    if (sizes.length === 0) return null;
    
    const counts = new Map<string, number>();
    for (const size of sizes) {
      if (size) {
        counts.set(size, (counts.get(size) || 0) + 1);
      }
    }

    let maxCount = 0;
    let mostCommon: string | null = null;
    
    for (const [size, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = size;
      }
    }

    return mostCommon;
  }

  /**
   * Comprehensive prediction analysis for a customer
   */
  public async getCustomerInsights(merchantId: string, customerId: string): Promise<{
    profile: PersonalizationProfile;
    sizeRisk: SizeIssuesPrediction;
    churnRisk: ChurnRiskPrediction;
    actions: ProactiveAction[];
    timing: TimingOptimization;
  }> {
    const [profile, sizeRisk, churnRisk, actions, timing] = await Promise.all([
      this.profiler.personalizeResponses(merchantId, customerId),
      this.predictSizeIssues(merchantId, customerId),
      this.predictCustomerChurn(merchantId, customerId),
      this.suggestProactiveActions(merchantId, customerId),
      this.optimizeTiming(merchantId, customerId),
    ]);

    return { profile, sizeRisk, churnRisk, actions, timing };
  }
}

export default PredictiveAnalyticsEngine;
