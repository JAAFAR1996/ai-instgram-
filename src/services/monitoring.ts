/**
 * ===============================================
 * Monitoring Service for WhatsApp Quality & Performance
 * Tracks quality rating, performance metrics, and alerts
 * ===============================================
 */

import { getDatabase } from '../database/connection.js';
import type { Platform, QualityStatus, QualityMetrics } from '../types/database.js';
import { getLogger } from './logger.js';

const logger = getLogger({ component: 'MonitoringService' });

export interface QualityCheck {
  merchantId: string;
  platform: Platform;
  qualityRating?: number;
  messagingQualityScore?: number;
  status: QualityStatus;
  metrics: {
    messagesSent24h: number;
    messagesDelivered24h: number;
    messagesRead24h: number;
    userInitiatedConversations24h: number;
    businessInitiatedConversations24h: number;
    blockRate24h: number;
    reportRate24h: number;
    avgResponseTimeMinutes?: number;
    responseRate24h: number;
    templateViolations24h: number;
    policyViolations24h: number;
  };
  recommendations: string[];
  alerts: QualityAlert[];
}

export interface QualityAlert {
  level: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  action: string;
  impact: string;
}

export interface PerformanceMetrics {
  endpoint: string;
  method: string;
  responseTime: number;
  statusCode: number;
  timestamp: Date;
  merchantId?: string;
  errorMessage?: string;
}

interface SystemPerformanceRow {
  avg_response_time: number | null;
  error_rate: number | null;
  total_requests: number | null;
  avg_memory_usage: number | null;
}

interface ActiveConnectionsRow {
  active_connections: string;
}

interface QualityStatsRow {
  messages_sent_24h: number;
  messages_delivered_24h: number;
  messages_read_24h: number;
  user_initiated_conversations_24h: number;
  business_initiated_conversations_24h: number;
  avg_response_time_minutes: number | null;
}

interface QualityTrendRow {
  date: string;
  quality_rating: number | null;
  status: QualityStatus;
  messages_sent_24h: number;
  delivery_rate: number;
  response_rate: number;
}

export class MonitoringService {
  private db = getDatabase();

  /**
   * Check WhatsApp Business API quality rating
   */
  public async checkWhatsAppQuality(merchantId: string): Promise<QualityCheck> {
    try {
      const sql = this.db.getSQL() as any;
      
      // Get recent metrics for the merchant
      const metrics = await this.calculateQualityMetrics(merchantId, 'whatsapp');
      
      // Determine quality status
      const status = this.determineQualityStatus(metrics);
      
      // Generate recommendations
      const recommendations = this.generateRecommendations(metrics, status);
      
      // Generate alerts
      const alerts = this.generateAlerts(metrics, status);
      
      // Store quality check results
      await this.storeQualityMetrics(merchantId, 'whatsapp', metrics, status);
      
      return {
        merchantId,
        platform: 'whatsapp',
        qualityRating: metrics.qualityRating,
        messagingQualityScore: metrics.messagingQualityScore,
        status,
        metrics,
        recommendations,
        alerts
      };
    } catch (error) {
      logger.error('WhatsApp quality check failed', error, {
        merchantId,
        platform: 'whatsapp',
        event: 'checkWhatsAppQuality'
      });
      throw new Error('Failed to check WhatsApp quality');
    }
  }

  /**
   * Check Instagram messaging quality
   */
  public async checkInstagramQuality(merchantId: string): Promise<QualityCheck> {
    try {
      const metrics = await this.calculateQualityMetrics(merchantId, 'instagram');
      const status = this.determineQualityStatus(metrics);
      const recommendations = this.generateRecommendations(metrics, status);
      const alerts = this.generateAlerts(metrics, status);
      
      await this.storeQualityMetrics(merchantId, 'instagram', metrics, status);
      
      return {
        merchantId,
        platform: 'instagram',
        status,
        metrics,
        recommendations,
        alerts
      };
    } catch (error) {
      logger.error('Instagram quality check failed', error, {
        merchantId,
        platform: 'instagram',
        event: 'checkInstagramQuality'
      });
      throw new Error('Failed to check Instagram quality');
    }
  }

  /**
   * Log performance metrics
   */
  public async logPerformanceMetrics(metrics: PerformanceMetrics): Promise<void> {
    try {
      const sql = this.db.getSQL() as any;
      
      await sql`
        INSERT INTO audit_logs (
          merchant_id,
          action,
          entity_type,
          details,
          execution_time_ms,
          success,
          error_message
        ) VALUES (
          ${metrics.merchantId || null}::uuid,
          'PERFORMANCE_METRIC',
          'API_ENDPOINT',
          ${JSON.stringify({
            endpoint: metrics.endpoint,
            method: metrics.method,
            statusCode: metrics.statusCode,
            timestamp: metrics.timestamp
          })},
          ${metrics.responseTime},
          ${metrics.statusCode < 400},
          ${metrics.errorMessage || null}
        )
      `;
    } catch (error) {
      logger.error('Performance logging failed', error, {
        merchantId: metrics.merchantId,
        endpoint: metrics.endpoint,
        event: 'logPerformanceMetrics'
      });
    }
  }

  /**
   * Alert on low quality ratings
   */
  public async alertOnLowQuality(merchantId: string, platform: Platform): Promise<void> {
    try {
      const qualityCheck = platform === 'whatsapp' 
        ? await this.checkWhatsAppQuality(merchantId)
        : await this.checkInstagramQuality(merchantId);
      
      const criticalAlerts = qualityCheck.alerts.filter(alert => alert.level === 'CRITICAL');
      
      if (criticalAlerts.length > 0) {
        await this.sendQualityAlert(merchantId, platform, criticalAlerts);
      }
    } catch (error) {
      logger.error('Quality alert failed', error, {
        merchantId,
        platform,
        event: 'alertOnLowQuality'
      });
    }
  }

  /**
   * Get quality trends for merchant
   */
  public async getQualityTrends(
    merchantId: string, 
    platform: Platform, 
    days: number = 30
  ): Promise<Array<{
    date: string;
    qualityRating?: number;
    status: QualityStatus;
    messagesSent: number;
    deliveryRate: number;
    responseRate: number;
  }>> {
    try {
      const sql = this.db.getSQL() as any;
      
      const trends = await sql<QualityTrendRow>
      `
        SELECT
          DATE(created_at) as date,
          quality_rating,
          status,
          messages_sent_24h,
          CASE
            WHEN messages_sent_24h > 0
            THEN (messages_delivered_24h::float / messages_sent_24h * 100)
            ELSE 0
          END as delivery_rate,
          response_rate_24h * 100 as response_rate
        FROM quality_metrics
        WHERE merchant_id = ${merchantId}::uuid
        AND platform = ${platform}
        AND created_at >= NOW() - INTERVAL '${days} days'
        ORDER BY created_at DESC
      `;
      
      return trends.map(trend => ({
        date: trend.date,
        qualityRating: trend.quality_rating ?? undefined,
        status: trend.status,
        messagesSent: trend.messages_sent_24h,
        deliveryRate: Math.round(trend.delivery_rate * 100) / 100,
        responseRate: Math.round(trend.response_rate * 100) / 100
      }));
    } catch (error) {
      logger.error('Error getting quality trends', error, {
        merchantId,
        platform,
        event: 'getQualityTrends'
      });
      throw new Error('Failed to get quality trends');
    }
  }

  /**
   * Get system-wide performance metrics
   */
  public async getSystemPerformance(): Promise<{
    averageResponseTime: number;
    errorRate: number;
    throughput: number;
    activeConnections: number;
    memoryUsage: number;
  }> {
    try {
      const sql = this.db.getSQL() as any;
      
      const performance = await sql<SystemPerformanceRow>
      `
        SELECT
          AVG(execution_time_ms) as avg_response_time,
          (COUNT(*) FILTER (WHERE success = false)::float / COUNT(*) * 100) as error_rate,
          COUNT(*) as total_requests,
          AVG(memory_usage_mb) as avg_memory_usage
        FROM audit_logs
        WHERE created_at >= NOW() - INTERVAL '5 minutes'
        AND action LIKE '%API_%'
      `;

      const connections = await sql<ActiveConnectionsRow>
      `
        SELECT count(*) as active_connections
        FROM pg_stat_activity
        WHERE state = 'active'
      `;
      
      const result = performance[0];
      
      return {
        averageResponseTime: Math.round(result.avg_response_time || 0),
        errorRate: Math.round((result.error_rate || 0) * 100) / 100,
        throughput: Math.round((result.total_requests || 0) / 5), // requests per minute
        activeConnections: parseInt(connections[0].active_connections),
        memoryUsage: Math.round((result.avg_memory_usage || 0) * 100) / 100
      };
    } catch (error) {
      logger.error('Error getting system performance', error, {
        event: 'getSystemPerformance'
      });
      throw new Error('Failed to get system performance');
    }
  }

  /**
   * Private: Calculate quality metrics for a merchant
   */
  private async calculateQualityMetrics(merchantId: string, platform: Platform): Promise<any> {
    try {
      const sql = this.db.getSQL() as any;
      
      const stats = await sql<QualityStatsRow>
      `
        SELECT
          COUNT(*) FILTER (WHERE direction = 'OUTGOING') as messages_sent_24h,
          COUNT(*) FILTER (WHERE direction = 'OUTGOING' AND delivery_status = 'DELIVERED') as messages_delivered_24h,
          COUNT(*) FILTER (WHERE direction = 'OUTGOING' AND delivery_status = 'READ') as messages_read_24h,
          COUNT(DISTINCT c.id) FILTER (WHERE ml.direction = 'INCOMING') as user_initiated_conversations_24h,
          COUNT(DISTINCT c.id) FILTER (WHERE ml.direction = 'OUTGOING') as business_initiated_conversations_24h,
          AVG(ai_response_time_ms)::int / 60000 as avg_response_time_minutes
        FROM message_logs ml
        JOIN conversations c ON ml.conversation_id = c.id
        WHERE c.merchant_id = ${merchantId}::uuid
        AND ml.platform = ${platform}
        AND ml.created_at >= NOW() - INTERVAL '24 hours'
      `;
      
      const result = stats[0];
      
      // Calculate rates
      const deliveryRate = result.messages_sent_24h > 0 
        ? result.messages_delivered_24h / result.messages_sent_24h 
        : 1;
      
      const readRate = result.messages_sent_24h > 0 
        ? result.messages_read_24h / result.messages_sent_24h 
        : 1;
      
      const responseRate = result.user_initiated_conversations_24h > 0
        ? result.business_initiated_conversations_24h / result.user_initiated_conversations_24h
        : 1;
      
      // Calculate quality scores (simplified algorithm)
      const messagingQualityScore = (deliveryRate * 0.4 + readRate * 0.3 + responseRate * 0.3);
      const qualityRating = Math.min(messagingQualityScore * 1.1, 1); // Boost slightly
      
      return {
        messagesSent24h: result.messages_sent_24h || 0,
        messagesDelivered24h: result.messages_delivered_24h || 0,
        messagesRead24h: result.messages_read_24h || 0,
        userInitiatedConversations24h: result.user_initiated_conversations_24h || 0,
        businessInitiatedConversations24h: result.business_initiated_conversations_24h || 0,
        blockRate24h: 0, // Would need external API data
        reportRate24h: 0, // Would need external API data
        avgResponseTimeMinutes: result.avg_response_time_minutes || 0,
        responseRate24h: Math.min(responseRate, 1),
        templateViolations24h: 0, // Would track separately
        policyViolations24h: 0, // Would track separately
        qualityRating: Math.round(qualityRating * 100) / 100,
        messagingQualityScore: Math.round(messagingQualityScore * 100) / 100
      };
    } catch (error) {
      logger.error('Error calculating quality metrics', error, {
        merchantId,
        platform,
        event: 'calculateQualityMetrics'
      });
      throw error;
    }
  }

  /**
   * Private: Determine quality status based on metrics
   */
  private determineQualityStatus(metrics: any): QualityStatus {
    const qualityRating = metrics.qualityRating || 0;
    
    if (qualityRating >= 0.9) return 'EXCELLENT';
    if (qualityRating >= 0.8) return 'GOOD';
    if (qualityRating >= 0.6) return 'MEDIUM';
    if (qualityRating >= 0.4) return 'LOW';
    return 'CRITICAL';
  }

  /**
   * Private: Generate recommendations based on metrics
   */
  private generateRecommendations(metrics: any, status: QualityStatus): string[] {
    const recommendations: string[] = [];
    
    if (metrics.responseRate24h < 0.8) {
      recommendations.push('تحسين سرعة الرد على الرسائل لتحسين التفاعل مع العملاء');
    }
    
    if (metrics.avgResponseTimeMinutes > 30) {
      recommendations.push('تقليل وقت الاستجابة لأقل من 30 دقيقة');
    }
    
    if (status === 'LOW' || status === 'CRITICAL') {
      recommendations.push('مراجعة استراتيجية المراسلة وتحسين جودة المحتوى');
      recommendations.push('تجنب إرسال رسائل غير مرغوبة أو غير ذات صلة');
    }
    
    if (metrics.messagesSent24h > 1000) {
      recommendations.push('مراقبة حد الرسائل اليومي لتجنب القيود');
    }
    
    return recommendations;
  }

  /**
   * Private: Generate alerts based on metrics
   */
  private generateAlerts(metrics: any, status: QualityStatus): QualityAlert[] {
    const alerts: QualityAlert[] = [];
    
    if (status === 'CRITICAL') {
      alerts.push({
        level: 'CRITICAL',
        message: 'جودة المراسلة منخفضة جداً',
        action: 'إيقاف إرسال الرسائل ومراجعة الاستراتيجية',
        impact: 'قد يتم حظر رقم واتساب'
      });
    }
    
    if (status === 'LOW') {
      alerts.push({
        level: 'WARNING',
        message: 'جودة المراسلة منخفضة',
        action: 'تحسين محتوى الرسائل وسرعة الرد',
        impact: 'انخفاض وصول الرسائل'
      });
    }
    
    if (metrics.avgResponseTimeMinutes > 60) {
      alerts.push({
        level: 'WARNING',
        message: 'وقت الاستجابة طويل جداً',
        action: 'تحسين سرعة الرد أو تفعيل الردود التلقائية',
        impact: 'تراجع رضا العملاء'
      });
    }
    
    return alerts;
  }

  /**
   * Private: Store quality metrics in database
   */
  private async storeQualityMetrics(
    merchantId: string,
    platform: Platform,
    metrics: any,
    status: QualityStatus
  ): Promise<void> {
    try {
      const sql = this.db.getSQL() as any;
      
      await sql`
        INSERT INTO quality_metrics (
          merchant_id,
          platform,
          quality_rating,
          messaging_quality_score,
          messages_sent_24h,
          messages_delivered_24h,
          messages_read_24h,
          user_initiated_conversations_24h,
          business_initiated_conversations_24h,
          block_rate_24h,
          report_rate_24h,
          avg_response_time_minutes,
          response_rate_24h,
          template_violations_24h,
          policy_violations_24h,
          status,
          last_quality_check
        ) VALUES (
          ${merchantId}::uuid,
          ${platform},
          ${metrics.qualityRating},
          ${metrics.messagingQualityScore},
          ${metrics.messagesSent24h},
          ${metrics.messagesDelivered24h},
          ${metrics.messagesRead24h},
          ${metrics.userInitiatedConversations24h},
          ${metrics.businessInitiatedConversations24h},
          ${metrics.blockRate24h},
          ${metrics.reportRate24h},
          ${metrics.avgResponseTimeMinutes},
          ${metrics.responseRate24h},
          ${metrics.templateViolations24h},
          ${metrics.policyViolations24h},
          ${status},
          NOW()
        )
        ON CONFLICT (merchant_id, platform, DATE(created_at))
        DO UPDATE SET
          quality_rating = EXCLUDED.quality_rating,
          messaging_quality_score = EXCLUDED.messaging_quality_score,
          messages_sent_24h = EXCLUDED.messages_sent_24h,
          messages_delivered_24h = EXCLUDED.messages_delivered_24h,
          messages_read_24h = EXCLUDED.messages_read_24h,
          user_initiated_conversations_24h = EXCLUDED.user_initiated_conversations_24h,
          business_initiated_conversations_24h = EXCLUDED.business_initiated_conversations_24h,
          response_rate_24h = EXCLUDED.response_rate_24h,
          status = EXCLUDED.status,
          last_quality_check = NOW(),
          updated_at = NOW()
      `;
    } catch (error) {
      logger.error('Error storing quality metrics', error, {
        merchantId,
        platform,
        event: 'storeQualityMetrics'
      });
    }
  }

  /**
   * Private: Send quality alert notification
   */
  private async sendQualityAlert(
    merchantId: string,
    platform: Platform,
    alerts: QualityAlert[]
  ): Promise<void> {
    try {
      // In a real implementation, this would:
      // 1. Send email notification to merchant
      // 2. Create in-app notification
      // 3. Send SMS alert for critical issues
      // 4. Log alert in audit system
      
      logger.info('Quality alert for merchant', {
        merchantId,
        platform,
        alerts,
        event: 'sendQualityAlert'
      });
      
      const sql = this.db.getSQL() as any;
      
      for (const alert of alerts) {
        await sql`
          INSERT INTO audit_logs (
            merchant_id,
            action,
            entity_type,
            details,
            success
          ) VALUES (
            ${merchantId}::uuid,
            'QUALITY_ALERT',
            'QUALITY_METRIC',
            ${JSON.stringify({
              platform,
              level: alert.level,
              message: alert.message,
              action: alert.action,
              impact: alert.impact
            })},
            true
          )
        `;
      }
    } catch (error) {
      logger.error('Error sending quality alert', error, {
        merchantId,
        platform,
        event: 'sendQualityAlert'
      });
    }
  }
}

// Singleton instance
let monitoringInstance: MonitoringService | null = null;

/**
 * Get monitoring service instance
 */
export function getMonitoringService(): MonitoringService {
  if (!monitoringInstance) {
    monitoringInstance = new MonitoringService();
  }
  return monitoringInstance;
}

export default MonitoringService;