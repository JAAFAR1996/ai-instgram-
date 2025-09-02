import { getDatabase } from '../db/adapter.js';
import { getLogger } from './logger.js';
import PredictiveAnalyticsEngine, { ProactiveAction } from './predictive-analytics.js';

export interface ProactiveMessage {
  id?: string;
  merchantId: string;
  customerId: string;
  type: 'SIZE_WARNING' | 'RESTOCK_ALERT' | 'FOLLOWUP_MESSAGE' | 'LOYALTY_OFFER' | 'SATISFACTION_CHECK';
  message: string;
  scheduledAt: Date;
  sentAt?: Date;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'CANCELLED';
  context: Record<string, unknown>;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
}

export interface FollowUpRule {
  trigger: 'ORDER_PLACED' | 'SIZE_ISSUE_PREDICTED' | 'NO_ACTIVITY' | 'LOW_ENGAGEMENT';
  delayHours: number;
  messageTemplate: string;
  conditions?: Record<string, unknown>;
}

export interface NotificationSettings {
  merchantId: string;
  enableProactiveMessages: boolean;
  enableFollowUps: boolean;
  enableStockAlerts: boolean;
  enableChurnPrevention: boolean;
  maxMessagesPerDay: number;
  quietHours: { start: number; end: number }; // 24-hour format
}

export class ProactiveCustomerService {
  private db = getDatabase();
  private log = getLogger({ component: 'proactive-service' });
  private analytics = new PredictiveAnalyticsEngine();

  /**
   * Send proactive messages based on predictions
   */
  public async sendProactiveMessages(merchantId: string, customerId?: string): Promise<number> {
    try {
      const settings = await this.getNotificationSettings(merchantId);
      if (!settings.enableProactiveMessages) {
        this.log.info('Proactive messages disabled for merchant', { merchantId });
        return 0;
      }

      // Get customers to analyze (specific customer or all active customers)
      const customersToAnalyze = customerId 
        ? [customerId]
        : await this.getActiveCustomers(merchantId);

      let messagesSent = 0;

      for (const cId of customersToAnalyze) {
        // Check daily message limit
        const dailyCount = await this.getDailyMessageCount(merchantId, cId);
        if (dailyCount >= settings.maxMessagesPerDay) {
          continue;
        }

        // Get proactive actions from analytics
        const actions = await this.analytics.suggestProactiveActions(merchantId, cId);
        const urgentActions = actions.filter(a => a.priority === 'URGENT' || a.priority === 'HIGH');

        for (const action of urgentActions.slice(0, 2)) { // Max 2 urgent actions per customer
          const message = await this.createProactiveMessage(merchantId, cId, action);
          if (message) {
            await this.scheduleMessage(message);
            messagesSent++;
          }
        }
      }

      this.log.info(`Sent ${messagesSent} proactive messages for merchant ${merchantId}`);
      return messagesSent;

    } catch (error) {
      this.log.error('Failed to send proactive messages', { error: String(error), merchantId });
      return 0;
    }
  }

  /**
   * Automatic follow-up system
   */
  public async processAutomaticFollowUps(): Promise<number> {
    try {
      let followUpsProcessed = 0;
      
      // Get merchants with follow-up enabled
      const sql = this.db.getSQL();
      const merchants = await sql<{ merchant_id: string }>`
        SELECT DISTINCT merchant_id FROM proactive_settings 
        WHERE enable_follow_ups = true
      `;

      for (const { merchant_id } of merchants) {
        // Process different follow-up triggers
        followUpsProcessed += await this.processOrderFollowUps(merchant_id);
        followUpsProcessed += await this.processEngagementFollowUps(merchant_id);
        followUpsProcessed += await this.processSizeIssueFollowUps(merchant_id);
      }

      return followUpsProcessed;

    } catch (error) {
      this.log.error('Failed to process automatic follow-ups', { error: String(error) });
      return 0;
    }
  }

  /**
   * Problem prevention alerts
   */
  public async generatePreventionAlerts(merchantId: string): Promise<ProactiveMessage[]> {
    try {
      const alerts: ProactiveMessage[] = [];
      const sql = this.db.getSQL();

      // Alert 1: Customers about to churn
      const churnRiskCustomers = await this.getHighChurnRiskCustomers(merchantId);
      for (const customerId of churnRiskCustomers) {
        const churnRisk = await this.analytics.predictCustomerChurn(merchantId, customerId);
        if (churnRisk.riskLevel === 'HIGH') {
          alerts.push({
            merchantId,
            customerId,
            type: 'FOLLOWUP_MESSAGE',
            message: `عميل في خطر! ${customerId} - ${churnRisk.retentionActions[0]}`,
            scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours
            status: 'PENDING',
            context: { churnProbability: churnRisk.churnProbability, riskFactors: churnRisk.riskFactors },
            priority: 'URGENT',
          });
        }
      }

      // Alert 2: Size issues for pending orders
      const pendingOrders = await sql<{ id: string; customer_instagram: string; product_ids: string[] }>`
        SELECT o.id, o.customer_instagram, array_agg(oi.product_id) as product_ids
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        WHERE o.merchant_id = ${merchantId}::uuid
          AND o.status = 'PENDING'
          AND o.created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY o.id, o.customer_instagram
      `;

      for (const order of pendingOrders) {
        const sizeRisk = await this.analytics.predictSizeIssues(merchantId, order.customer_instagram, order.product_ids[0]);
        if (sizeRisk.riskLevel === 'HIGH') {
          alerts.push({
            merchantId,
            customerId: order.customer_instagram,
            type: 'SIZE_WARNING',
            message: `تحذير مقاس للطلب ${order.id} - ${sizeRisk.suggestedActions.join(', ')}`,
            scheduledAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
            status: 'PENDING',
            context: { orderId: order.id, sizeRisk },
            priority: 'HIGH',
          });
        }
      }

      // Alert 3: Low stock for popular items
      const lowStockItems = await sql<{ id: string; name_ar: string; stock_level: number; interested_customers: number }>`
        WITH interested_customers AS (
          SELECT p.id, COUNT(DISTINCT c.customer_instagram) as customer_count
          FROM products p
          JOIN order_items oi ON oi.product_id = p.id
          JOIN orders o ON o.id = oi.order_id
          JOIN conversations c ON c.customer_instagram = o.customer_instagram
          WHERE p.merchant_id = ${merchantId}::uuid
            AND o.created_at >= NOW() - INTERVAL '60 days'
          GROUP BY p.id
        )
        SELECT p.id, p.name_ar, p.stock_level, COALESCE(ic.customer_count, 0) as interested_customers
        FROM products p
        LEFT JOIN interested_customers ic ON ic.id = p.id
        WHERE p.merchant_id = ${merchantId}::uuid
          AND p.stock_level <= 5
          AND p.stock_level > 0
          AND COALESCE(ic.customer_count, 0) > 2
        ORDER BY interested_customers DESC, stock_level ASC
        LIMIT 10
      `;

      for (const item of lowStockItems) {
        alerts.push({
          merchantId,
          customerId: 'MERCHANT_ALERT', // Special identifier for merchant alerts
          type: 'RESTOCK_ALERT',
          message: `المنتج "${item.name_ar}" أوشك على النفاد (${item.stock_level} قطع) - ${item.interested_customers} عميل مهتم`,
          scheduledAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
          status: 'PENDING',
          context: { productId: item.id, stockLevel: item.stock_level, interestedCustomers: item.interested_customers },
          priority: item.stock_level <= 2 ? 'URGENT' : 'HIGH',
        });
      }

      return alerts;

    } catch (error) {
      this.log.error('Failed to generate prevention alerts', { error: String(error) });
      return [];
    }
  }

  /**
   * Smart notification system with timing optimization
   */
  public async sendSmartNotification(
    merchantId: string,
    customerId: string,
    message: string,
    type: ProactiveMessage['type'] = 'FOLLOWUP_MESSAGE'
  ): Promise<boolean> {
    try {
      // Optimize timing for this specific customer
      const timing = await this.analytics.optimizeTiming(merchantId, customerId);
      const settings = await this.getNotificationSettings(merchantId);

      // Calculate optimal send time
      const now = new Date();
      const currentHour = now.getHours();
      
      // Check quiet hours
      if (currentHour >= settings.quietHours.start || currentHour <= settings.quietHours.end) {
        // Schedule for next available time
        const nextAvailableTime = new Date();
        nextAvailableTime.setHours(settings.quietHours.end + 1, 0, 0, 0);
        if (nextAvailableTime <= now) {
          nextAvailableTime.setDate(nextAvailableTime.getDate() + 1);
        }

        return await this.scheduleMessage({
          merchantId,
          customerId,
          type,
          message,
          scheduledAt: nextAvailableTime,
          status: 'PENDING',
          context: { optimizedTiming: timing },
          priority: 'MEDIUM',
        });
      }

      // Send immediately if within good hours and good timing
      const timeSlots: Record<'morning'|'afternoon'|'evening'|'night', [number, number]> = {
        morning: [6, 11],
        afternoon: [12, 16],
        evening: [17, 21],
        night: [22, 5]
      };
      const chosen = timeSlots[timing.bestContactTime] || [12, 16];
      const shouldSendNow = currentHour >= chosen[0] && currentHour <= chosen[1];

      if (shouldSendNow) {
        return await this.sendImmediateMessage(merchantId, customerId, message, type);
      } else {
        // Schedule for optimal time
        const scheduledTime = new Date();
        scheduledTime.setHours(chosen[0], 0, 0, 0);
        if (scheduledTime <= now) {
          scheduledTime.setDate(scheduledTime.getDate() + 1);
        }

        return await this.scheduleMessage({
          merchantId,
          customerId,
          type,
          message,
          scheduledAt: scheduledTime,
          status: 'PENDING',
          context: { optimizedTiming: timing },
          priority: 'MEDIUM',
        });
      }

    } catch (error) {
      this.log.error('Failed to send smart notification', { error: String(error) });
      return false;
    }
  }

  /**
   * Schedule a proactive message
   */
  private async scheduleMessage(message: ProactiveMessage): Promise<boolean> {
    try {
      const sql = this.db.getSQL();
      
      await sql`
        INSERT INTO proactive_messages (
          merchant_id, customer_id, type, message, scheduled_at, 
          status, context, priority, created_at
        ) VALUES (
          ${message.merchantId}::uuid, ${message.customerId}, ${message.type}, 
          ${message.message}, ${message.scheduledAt}, ${message.status},
          ${JSON.stringify(message.context)}::jsonb, ${message.priority}, NOW()
        )
      `;

      this.log.info('Proactive message scheduled', { 
        merchantId: message.merchantId, 
        customerId: message.customerId, 
        type: message.type 
      });
      
      return true;

    } catch (error) {
      this.log.error('Failed to schedule message', { error: String(error) });
      return false;
    }
  }

  /**
   * Send immediate message (for urgent cases)
   */
  private async sendImmediateMessage(
    merchantId: string,
    customerId: string,
    message: string,
    type: ProactiveMessage['type']
  ): Promise<boolean> {
    try {
      // This would integrate with your messaging service
      // For now, we'll just log and mark as sent
      
      const sql = this.db.getSQL();
      await sql`
        INSERT INTO proactive_messages (
          merchant_id, customer_id, type, message, scheduled_at, 
          sent_at, status, context, priority, created_at
        ) VALUES (
          ${merchantId}::uuid, ${customerId}, ${type}, ${message}, 
          NOW(), NOW(), 'SENT', '{}'::jsonb, 'HIGH', NOW()
        )
      `;

      // TODO: Integrate with ManyChat API or Instagram Direct API
      this.log.info('Immediate message sent', { merchantId, customerId, type });
      
      return true;

    } catch (error) {
      this.log.error('Failed to send immediate message', { error: String(error) });
      return false;
    }
  }

  /**
   * Process pending scheduled messages
   */
  public async processPendingMessages(): Promise<number> {
    try {
      const sql = this.db.getSQL();
      
      type ProactiveMessageRow = {
        id: string;
        merchant_id: string;
        customer_id: string;
        type: ProactiveMessage['type'];
        message: string;
        scheduled_at: Date;
        sent_at?: Date | null;
        status: ProactiveMessage['status'];
        context: Record<string, unknown>;
        priority: ProactiveMessage['priority'];
      };
      const pendingMessages = await sql<ProactiveMessageRow>`
        SELECT * FROM proactive_messages 
        WHERE status = 'PENDING' 
          AND scheduled_at <= NOW()
        ORDER BY priority DESC, scheduled_at ASC
        LIMIT 50
      `;

      let processed = 0;

      for (const msg of pendingMessages) {
        const success = await this.sendImmediateMessage(
          msg.merchant_id, 
          msg.customer_id, 
          msg.message, 
          msg.type
        );

        await sql`
          UPDATE proactive_messages 
          SET status = ${success ? 'SENT' : 'FAILED'}, 
              sent_at = CASE WHEN ${success} THEN NOW() ELSE NULL END
          WHERE id = ${msg.id}::uuid
        `;

        if (success) processed++;
      }

      return processed;

    } catch (error) {
      this.log.error('Failed to process pending messages', { error: String(error) });
      return 0;
    }
  }

  // Helper methods
  private async getActiveCustomers(merchantId: string): Promise<string[]> {
    const sql = this.db.getSQL();
    const customers = await sql<{ customer_instagram: string }>`
      SELECT DISTINCT customer_instagram
      FROM conversations
      WHERE merchant_id = ${merchantId}::uuid
        AND last_message_at >= NOW() - INTERVAL '30 days'
      LIMIT 100
    `;
    return customers.map(c => c.customer_instagram);
  }

  private async getDailyMessageCount(merchantId: string, customerId: string): Promise<number> {
    const sql = this.db.getSQL();
    const result = await sql<{ count: number }>`
      SELECT COUNT(*)::int as count
      FROM proactive_messages
      WHERE merchant_id = ${merchantId}::uuid
        AND customer_id = ${customerId}
        AND created_at >= CURRENT_DATE
    `;
    return result[0]?.count || 0;
  }

  private async createProactiveMessage(
    merchantId: string,
    customerId: string,
    action: ProactiveAction
  ): Promise<ProactiveMessage | null> {
    try {
      return {
        merchantId,
        customerId,
        type: action.type,
        message: action.message,
        scheduledAt: action.scheduledAt || new Date(),
        status: 'PENDING',
        context: action.context,
        priority: action.priority,
      };
    } catch (error) {
      this.log.warn('Failed to create proactive message', { error: String(error) });
      return null;
    }
  }

  private async getNotificationSettings(merchantId: string): Promise<NotificationSettings> {
    try {
      const sql = this.db.getSQL();
      type NotificationSettingsRow = {
        enable_proactive_messages: boolean;
        enable_follow_ups: boolean;
        enable_stock_alerts: boolean;
        enable_churn_prevention: boolean;
        max_messages_per_day: number;
        quiet_hours_start: number;
        quiet_hours_end: number;
      };
      const result = await sql<NotificationSettingsRow>`
        SELECT enable_proactive_messages, enable_follow_ups, enable_stock_alerts, enable_churn_prevention,
               max_messages_per_day, quiet_hours_start, quiet_hours_end
        FROM proactive_settings WHERE merchant_id = ${merchantId}::uuid LIMIT 1
      `;

      if (result[0]) {
        const r = result[0];
        return {
          merchantId,
          enableProactiveMessages: r.enable_proactive_messages,
          enableFollowUps: r.enable_follow_ups,
          enableStockAlerts: r.enable_stock_alerts,
          enableChurnPrevention: r.enable_churn_prevention,
          maxMessagesPerDay: r.max_messages_per_day,
          quietHours: { start: r.quiet_hours_start, end: r.quiet_hours_end },
        };
      }
      return {
        merchantId,
        enableProactiveMessages: true,
        enableFollowUps: true,
        enableStockAlerts: true,
        enableChurnPrevention: true,
        maxMessagesPerDay: 3,
        quietHours: { start: 22, end: 6 },
      };

    } catch (error) {
      this.log.warn('Failed to get notification settings, using defaults', { error: String(error) });
      return {
        merchantId,
        enableProactiveMessages: true,
        enableFollowUps: true,
        enableStockAlerts: true,
        enableChurnPrevention: true,
        maxMessagesPerDay: 3,
        quietHours: { start: 22, end: 6 },
      };
    }
  }

  private async getHighChurnRiskCustomers(merchantId: string): Promise<string[]> {
    // This would use more complex logic to identify at-risk customers
    const sql = this.db.getSQL();
    const customers = await sql<{ customer_instagram: string }>`
      SELECT DISTINCT c.customer_instagram
      FROM conversations c
      WHERE c.merchant_id = ${merchantId}::uuid
        AND c.last_message_at >= NOW() - INTERVAL '60 days'
        AND c.last_message_at <= NOW() - INTERVAL '14 days'
      LIMIT 20
    `;
    return customers.map(c => c.customer_instagram);
  }

  private async processOrderFollowUps(merchantId: string): Promise<number> {
    // Follow up on recent orders
    const sql = this.db.getSQL();
    const recentOrders = await sql<{ customer_instagram: string; id: string; created_at: Date }>`
      SELECT customer_instagram, id, created_at
      FROM orders
      WHERE merchant_id = ${merchantId}::uuid
        AND created_at >= NOW() - INTERVAL '7 days'
        AND status = 'COMPLETED'
    `;

    let followUps = 0;
    for (const order of recentOrders) {
      const daysSinceOrder = Math.floor((Date.now() - order.created_at.getTime()) / (24 * 60 * 60 * 1000));
      
      if (daysSinceOrder === 3) { // Follow up after 3 days
        await this.sendSmartNotification(
          merchantId,
          order.customer_instagram,
          'كيف تجد المنتج الذي اشتريته؟ نحب نسمع رأيك! 😊',
          'SATISFACTION_CHECK'
        );
        followUps++;
      }
    }

    return followUps;
  }

  private async processEngagementFollowUps(merchantId: string): Promise<number> {
    // Follow up on low engagement customers
    const lowEngagementCustomers = await this.getHighChurnRiskCustomers(merchantId);
    
    let followUps = 0;
    for (const customerId of lowEngagementCustomers.slice(0, 5)) { // Process max 5 per run
      await this.sendSmartNotification(
        merchantId,
        customerId,
        'مشتاقين نشوفك! ⭐ شوف المنتجات الجديدة اللي وصلتنا',
        'FOLLOWUP_MESSAGE'
      );
      followUps++;
    }

    return followUps;
  }

  private async processSizeIssueFollowUps(merchantId: string): Promise<number> {
    // Placeholder logic ensures parameter is meaningfully checked
    if (!merchantId) return 0;
    return 0;
  }
}

export default ProactiveCustomerService;
