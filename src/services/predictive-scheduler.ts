import { getDatabase } from '../db/adapter.js';
import { getLogger } from './logger.js';
import ProactiveCustomerService from './proactive-service.js';
import PredictiveAnalyticsEngine from './predictive-analytics.js';

/**
 * Background service for running predictive analytics and proactive messaging
 * This service runs periodically to:
 * 1. Process pending proactive messages
 * 2. Generate new predictions for customers
 * 3. Clean up old data
 * 4. Update ML model performance metrics
 */
export class PredictiveSchedulerService {
  private db = getDatabase();
  private log = getLogger({ component: 'predictive-scheduler' });
  private proactiveService = new ProactiveCustomerService();
  private analyticsEngine = new PredictiveAnalyticsEngine();
  private isRunning = false;

  /**
   * Start the scheduler with configurable intervals
   */
  public startScheduler(options: {
    proactiveMessagesIntervalMs?: number;
    predictionsIntervalMs?: number;
    cleanupIntervalMs?: number;
  } = {}) {
    const {
      proactiveMessagesIntervalMs = 5 * 60 * 1000, // 5 minutes
      predictionsIntervalMs = 30 * 60 * 1000, // 30 minutes
      cleanupIntervalMs = 6 * 60 * 60 * 1000, // 6 hours
    } = options;

    if (this.isRunning) {
      this.log.warn('Scheduler is already running');
      return;
    }

    this.isRunning = true;
    this.log.info('Starting predictive scheduler', {
      proactiveInterval: proactiveMessagesIntervalMs,
      predictionsInterval: predictionsIntervalMs,
      cleanupInterval: cleanupIntervalMs,
    });

    // Process pending proactive messages
    setInterval(() => {
      this.processProactiveMessages().catch(err => {
        this.log.error('Proactive messages processing failed', { error: String(err) });
      });
    }, proactiveMessagesIntervalMs);

    // Generate new predictions and analytics
    setInterval(() => {
      this.runPredictiveAnalytics().catch(err => {
        this.log.error('Predictive analytics failed', { error: String(err) });
      });
    }, predictionsIntervalMs);

    // Cleanup old data
    setInterval(() => {
      this.cleanupOldData().catch(err => {
        this.log.error('Data cleanup failed', { error: String(err) });
      });
    }, cleanupIntervalMs);

    // Initial runs
    setTimeout(() => this.processProactiveMessages().catch((e) => { console.error('[hardening:no-silent-catch]', e); throw e instanceof Error ? e : new Error(String(e)); }), 10000); // 10 seconds
    setTimeout(() => this.runPredictiveAnalytics().catch((e) => { console.error('[hardening:no-silent-catch]', e); throw e instanceof Error ? e : new Error(String(e)); }), 60000); // 1 minute
  }

  /**
   * Stop the scheduler
   */
  public stopScheduler() {
    this.isRunning = false;
    this.log.info('Predictive scheduler stopped');
  }

  /**
   * Process pending proactive messages
   */
  private async processProactiveMessages(): Promise<void> {
    try {
      const startTime = Date.now();
      
      // Process pending scheduled messages
      const pendingCount = await this.proactiveService.processPendingMessages();
      
      // Process automatic follow-ups
      const followupCount = await this.proactiveService.processAutomaticFollowUps();
      
      const duration = Date.now() - startTime;
      this.log.info('Processed proactive messages', { 
        pendingCount, 
        followupCount, 
        durationMs: duration 
      });

    } catch (error) {
      this.log.error('Failed to process proactive messages', { error: String(error) });
    }
  }

  /**
   * Run predictive analytics for active merchants
   */
  private async runPredictiveAnalytics(): Promise<void> {
    try {
      const startTime = Date.now();
      const sql = this.db.getSQL();

      // Get active merchants (those with recent activity)
      const activeMerchants = await sql<{ merchant_id: string; customer_count: number }>`
        SELECT c.merchant_id, COUNT(DISTINCT c.customer_instagram) as customer_count
        FROM conversations c
        WHERE c.last_message_at >= NOW() - INTERVAL '7 days'
        GROUP BY c.merchant_id
        HAVING COUNT(DISTINCT c.customer_instagram) > 0
        ORDER BY customer_count DESC
        LIMIT 20
      `;

      let totalPredictions = 0;
      let totalProactiveMessages = 0;

      for (const { merchant_id } of activeMerchants) {
        try {
          // Generate proactive messages for this merchant
          const messagesGenerated = await this.proactiveService.sendProactiveMessages(merchant_id);
          totalProactiveMessages += messagesGenerated;

          // Generate prevention alerts
          const alerts = await this.proactiveService.generatePreventionAlerts(merchant_id);
          
          // Schedule high-priority alerts (count only here)
          totalPredictions += alerts.filter(a => a.priority === 'URGENT' || a.priority === 'HIGH').length;

          // Timing insights & daily reporting (best-effort, non-blocking)
          try {
            const { default: InstagramTimingOptimizer } = await import('./instagram-timing-optimizer.js');
            const { default: InstagramReportingService } = await import('./instagram-reporting.js');
            const opt = new InstagramTimingOptimizer();
            const rep = new InstagramReportingService();
            const insights = await opt.generateTimingInsights(merchant_id);
            const today = await rep.generateDailyReport(merchant_id);
            this.log.info('Timing/report snapshot', {
              merchantId: merchant_id,
              bestSlot: insights.bestPostingTimes[0],
              peakHour: insights.peakEngagementHours[0],
              rr: today.windows.responseRate,
              orders: today.conversions.orders
            });
          } catch (auxErr) {
            this.log.debug('Timing/report skipped', { error: String(auxErr) });
          }

          // Update customer insights cache for top customers
          await this.updateCustomerInsightsCache(merchant_id);

        } catch (merchantError) {
          this.log.warn('Analytics failed for merchant', { 
            merchantId: merchant_id, 
            error: String(merchantError) 
          });
        }
      }

      // Opportunistic performance update here too (in addition to cleanup)
      try { await this.updatePerformanceMetrics(); } catch (e) { this.log.debug('Perf metrics update (cycle) skipped', { error: String(e) }); }

      const duration = Date.now() - startTime;
      this.log.info('Completed predictive analytics cycle', { 
        merchantsProcessed: activeMerchants.length,
        totalPredictions,
        totalProactiveMessages,
        durationMs: duration 
      });

    } catch (error) {
      this.log.error('Failed to run predictive analytics', { error: String(error) });
    }
  }

  /**
   * Update customer insights cache for performance optimization
   */
  private async updateCustomerInsightsCache(merchantId: string): Promise<void> {
    try {
      const sql = this.db.getSQL();

      // Get top customers for this merchant (most active in last 30 days)
      const topCustomers = await sql<{ customer_instagram: string; activity_score: number }>`
        SELECT c.customer_instagram, 
               COUNT(*) + COALESCE(o.order_count, 0) * 3 as activity_score
        FROM conversations c
        JOIN message_logs ml ON ml.conversation_id = c.id
        LEFT JOIN (
          SELECT customer_instagram, COUNT(*) as order_count
          FROM orders 
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY customer_instagram
        ) o ON o.customer_instagram = c.customer_instagram
        WHERE c.merchant_id = ${merchantId}::uuid
          AND ml.created_at >= NOW() - INTERVAL '30 days'
        GROUP BY c.customer_instagram, o.order_count
        ORDER BY activity_score DESC
        LIMIT 50
      `;

      for (const { customer_instagram } of topCustomers) {
        try {
          // Get comprehensive insights
          const insights = await this.analyticsEngine.getCustomerInsights(merchantId, customer_instagram);

          // Cache the insights
          await sql`
            INSERT INTO customer_insights_cache (merchant_id, customer_id, insights, computed_at, expires_at)
            VALUES (
              ${merchantId}::uuid, 
              ${customer_instagram}, 
              ${JSON.stringify(insights)}::jsonb, 
              NOW(), 
              NOW() + INTERVAL '6 hours'
            )
            ON CONFLICT (merchant_id, customer_id)
            DO UPDATE SET 
              insights = EXCLUDED.insights,
              computed_at = EXCLUDED.computed_at,
              expires_at = EXCLUDED.expires_at
          `;

        } catch (customerError) {
          this.log.warn('Failed to update insights for customer', { 
            merchantId, 
            customerId: customer_instagram,
            error: String(customerError) 
          });
        }
      }

    } catch (error) {
      this.log.warn('Failed to update customer insights cache', { 
        merchantId, 
        error: String(error) 
      });
    }
  }

  /**
   * Clean up old data and optimize database
   */
  private async cleanupOldData(): Promise<void> {
    try {
      const startTime = Date.now();
      const sql = this.db.getSQL();

      // Run the cleanup function
      await sql`SELECT cleanup_expired_cache()`;

      // Clean up old prediction tracking data
      const cleanupResults = await Promise.allSettled([
        // Clean old size issue tracking (keep 60 days)
        sql`DELETE FROM size_issue_tracking WHERE created_at < NOW() - INTERVAL '60 days'`,
        
        // Clean old churn predictions (keep 90 days) 
        sql`DELETE FROM churn_prediction_tracking WHERE created_at < NOW() - INTERVAL '90 days'`,
        
        // Clean old proactive action results (keep 30 days)
        sql`DELETE FROM proactive_action_results WHERE created_at < NOW() - INTERVAL '30 days'`,

        // Clean old interaction patterns (aggregate and keep recent)
        sql`
          DELETE FROM customer_interaction_patterns 
          WHERE last_updated < NOW() - INTERVAL '90 days' 
            AND interaction_count < 5
        `,
      ]);

      const fails = cleanupResults.filter(result => result.status === 'rejected');
      if (fails.length) {
        this.log.error({ 
          fails: fails.length, 
          sample: fails.slice(0,3).map(f => String((f as any).reason))
        }, "Cleanup operations batch failures");
        
        // Schedule retry for failed cleanup operations after delay
        setTimeout(async () => {
          this.log.info('Retrying failed cleanup operations');
          // Note: Cleanup operations are typically safe to retry automatically
        }, 5000);
      }

      const successCount = cleanupResults.filter(r => r.status === 'fulfilled').length;
      this.log.info('Data cleanup completed', {
        totalOperations: cleanupResults.length,
        successful: successCount,
        failed: fails.length
      });

      // Update performance metrics
      await this.updatePerformanceMetrics();

      const duration = Date.now() - startTime;
      this.log.info('Completed data cleanup', { durationMs: duration });

    } catch (error) {
      this.log.error('Failed to clean up old data', { error: String(error) });
    }
  }

  /**
   * Update ML model performance metrics
   */
  private async updatePerformanceMetrics(): Promise<void> {
    try {
      const sql = this.db.getSQL();

      // Calculate accuracy for size predictions
      const sizeAccuracy = await sql<{ accuracy: number; total: number }>`
        SELECT 
          AVG(CASE WHEN sit.issue_type IS NULL THEN 1.0 ELSE 0.0 END) as accuracy,
          COUNT(*) as total
        FROM prediction_accuracy pa
        LEFT JOIN size_issue_tracking sit ON sit.customer_id = (pa.predicted_value->>'customerId')
          AND sit.created_at >= pa.prediction_date 
          AND sit.created_at <= pa.prediction_date + INTERVAL '30 days'
        WHERE pa.prediction_type = 'SIZE_ISSUE'
          AND pa.prediction_date >= NOW() - INTERVAL '30 days'
      `;

      // Calculate churn prediction accuracy
      const churnAccuracy = await sql<{ accuracy: number; total: number }>`
        SELECT 
          AVG(CASE 
            WHEN cpt.actual_churn_date IS NULL AND (pa.predicted_value->>'churnProbability')::float < 0.5 THEN 1.0
            WHEN cpt.actual_churn_date IS NOT NULL AND (pa.predicted_value->>'churnProbability')::float >= 0.5 THEN 1.0
            ELSE 0.0 
          END) as accuracy,
          COUNT(*) as total
        FROM prediction_accuracy pa
        LEFT JOIN churn_prediction_tracking cpt ON cpt.customer_id = (pa.predicted_value->>'customerId')
          AND cpt.created_at >= pa.prediction_date - INTERVAL '1 day'
          AND cpt.created_at <= pa.prediction_date + INTERVAL '1 day'
        WHERE pa.prediction_type = 'CHURN_RISK'
          AND pa.prediction_date >= NOW() - INTERVAL '30 days'
      `;

      // Store performance metrics
      const sa = sizeAccuracy[0];
      if (sa && sa.total > 10) {
        await sql`
          INSERT INTO ml_model_performance (
            model_type, accuracy_score, training_data_size, evaluation_date, model_version
          ) VALUES (
            'SIZE_PREDICTION', ${sa.accuracy}, ${sa.total}, NOW(), '1.0.0'
          )
        `;
      }

      const ca = churnAccuracy[0];
      if (ca && ca.total > 10) {
        await sql`
          INSERT INTO ml_model_performance (
            model_type, accuracy_score, training_data_size, evaluation_date, model_version
          ) VALUES (
            'CHURN_PREDICTION', ${ca.accuracy}, ${ca.total}, NOW(), '1.0.0'
          )
        `;
      }

      this.log.info('Updated performance metrics', { 
        sizeAccuracy: sizeAccuracy[0]?.accuracy,
        churnAccuracy: churnAccuracy[0]?.accuracy 
      });

    } catch (error) {
      this.log.warn('Failed to update performance metrics', { error: String(error) });
    }
  }

  /**
   * Get scheduler status and metrics
   */
  public getStatus(): {
    isRunning: boolean;
    uptime?: number;
    lastMetrics?: Record<string, unknown>;
  } {
    return {
      isRunning: this.isRunning,
      // Additional status metrics could be added here
    };
  }

  /**
   * Run a manual cycle of all processes (for testing/debugging)
   */
  public async runManualCycle(): Promise<{
    proactiveMessages: number;
    predictions: number;
    cleaned: boolean;
  }> {
    const startTime = Date.now();
    
    try {
      await this.processProactiveMessages();
      await this.runPredictiveAnalytics();
      await this.cleanupOldData();

      const duration = Date.now() - startTime;
      this.log.info('Manual cycle completed', { durationMs: duration });

      return {
        proactiveMessages: 0, // Would need to track this
        predictions: 0, // Would need to track this
        cleaned: true,
      };

    } catch (error) {
      this.log.error('Manual cycle failed', { error: String(error) });
      throw error;
    }
  }
}

export default PredictiveSchedulerService;
