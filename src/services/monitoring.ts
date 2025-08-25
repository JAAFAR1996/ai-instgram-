/**
 * ===============================================
 * Monitoring Service for WhatsApp Quality & Performance
 * Tracks quality rating, performance metrics, and alerts
 * ===============================================
 */

import { getDatabase } from '../db/adapter.js';
import type { Sql } from '../types/sql.js';
import type { Platform, QualityStatus } from '../types/database.js';
import type { DIContainer } from '../container/index.js';
import type { Pool } from 'pg';
import { getLogger } from './logger.js';
import { telemetry } from './telemetry.js';
import { must } from '../utils/safety.js';
import { getRedisMonitor } from './redis-monitoring.js';

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
  [key: string]: unknown;
}

interface ActiveConnectionsRow {
  active_connections: string;
  [key: string]: unknown;
}

interface QualityStatsRow {
  messages_sent_24h: number;
  messages_delivered_24h: number;
  messages_read_24h: number;
  user_initiated_conversations_24h: number;
  business_initiated_conversations_24h: number;
  avg_response_time_minutes: number | null;
  [key: string]: unknown;
}

interface QualityTrendRow {
  date: string;
  quality_rating: number | null;
  status: QualityStatus;
  messages_sent_24h: number;
  delivery_rate: number;
  response_rate: number;
  [key: string]: unknown;
}

interface CalculatedQualityMetrics {
  messagesSent24h: number;
  messagesDelivered24h: number;
  messagesRead24h: number;
  userInitiatedConversations24h: number;
  businessInitiatedConversations24h: number;
  blockRate24h: number;
  reportRate24h: number;
  avgResponseTimeMinutes: number;
  responseRate24h: number;
  templateViolations24h: number;
  policyViolations24h: number;
  qualityRating: number;
  messagingQualityScore: number;
}

export class MonitoringService {
  private db!: ReturnType<typeof getDatabase>;
  private logger!: ReturnType<typeof getLogger>;
  private healthCheckInterval?: NodeJS.Timeout | undefined;
  private redisMonitor = getRedisMonitor();

  constructor(container?: DIContainer) {
    if (container) {
      // this.pool = container.get<Pool>('pool'); // Reserved for future use
      this.logger = container.get<ReturnType<typeof getLogger>>('logger');
      this.initializeFromContainer();
    } else {
      this.initializeLegacy();
    }
  }

  private initializeFromContainer(): void {
    // Services will be injected via container when available
    // For now, fallback to legacy methods
    this.initializeLegacy();
  }

  private initializeLegacy(): void {
    this.db = getDatabase();
    this.logger = getLogger({ component: 'MonitoringService' });
  }

  /**
   * Set Redis connection for monitoring
   */
  public setRedisConnection(redisConnection: any): void {
    this.redisMonitor.setRedisConnection(redisConnection);
  }

  /**
   * Get database connection with proper connection pooling
   */
  private async getDbConnection() {
    return await this.db.connect();
  }

  /**
   * Check WhatsApp Business API quality rating
   */
  public async checkWhatsAppQuality(merchantId: string): Promise<QualityCheck> {
    try {
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
      
      // Record telemetry
      telemetry.recordServiceControl(merchantId, 'quality_check', true);
      telemetry.trackEvent('quality_check_completed', {
        platform: 'whatsapp',
        status,
        quality_rating: metrics.qualityRating || 0
      });
      
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
      this.logger.error('WhatsApp quality check failed', error, {
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
      
      // Record telemetry
      telemetry.recordServiceControl(merchantId, 'quality_check', true);
      telemetry.trackEvent('quality_check_completed', {
        platform: 'instagram',
        status,
        quality_rating: metrics.qualityRating || 0
      });
      
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
      const sql: Sql = this.db.getSQL();
      
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

      // Record telemetry
      telemetry.recordDatabaseQuery('audit_logs_insert', true, 0);
      telemetry.trackEvent('performance_metric_logged', {
        endpoint: metrics.endpoint,
        method: metrics.method,
        status_code: metrics.statusCode,
        response_time: metrics.responseTime
      });
    } catch (error) {
      this.logger.error('Performance logging failed', error, {
        merchantId: metrics.merchantId ?? '',
        endpoint: metrics.endpoint,
        event: 'logPerformanceMetrics'
      });
      telemetry.recordDatabaseQuery('audit_logs_insert', false, 0);
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
      const sql: Sql = this.db.getSQL();

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

      return trends.map((trend: QualityTrendRow) => ({
        date: trend.date,
        ...(trend.quality_rating != null ? { qualityRating: trend.quality_rating } : {}),
        status: trend.status as QualityStatus,
        messagesSent: parseInt(String(trend.messages_sent_24h)),
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
   * Comprehensive system health check
   */
  public async getSystemHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'critical';
    services: Array<{
      name: string;
      status: 'up' | 'down' | 'degraded';
      responseTime: number;
      error?: string;
    }>;
    metrics: {
      averageResponseTime: number;
      errorRate: number;
      throughput: number;
      activeConnections: number;
      memoryUsage: number;
      redisStatus: 'connected' | 'disconnected';
      dbStatus: 'connected' | 'disconnected';
    };
  }> {
    try {
      const [performance, services] = await Promise.all([
        this.getSystemPerformance(),
        this.checkServiceHealth()
      ]);

      const overallStatus = this.determineOverallHealth(performance, services);

      telemetry.trackEvent('system_health_check', {
        status: overallStatus,
        service_count: services.length,
        healthy_services: services.filter(s => s.status === 'up').length
      });

      return {
        status: overallStatus,
        services,
        metrics: {
          ...performance,
          redisStatus: services.find(s => s.name === 'redis')?.status === 'up' ? 'connected' : 'disconnected',
          dbStatus: services.find(s => s.name === 'database')?.status === 'up' ? 'connected' : 'disconnected'
        }
      };
    } catch (error) {
      this.logger.error('System health check failed', error);
      return {
        status: 'critical',
        services: [],
        metrics: {
          averageResponseTime: 0,
          errorRate: 100,
          throughput: 0,
          activeConnections: 0,
          memoryUsage: 0,
          redisStatus: 'disconnected',
          dbStatus: 'disconnected'
        }
      };
    }
  }

  /**
   * Check individual service health
   */
  private async checkServiceHealth(): Promise<Array<{
    name: string;
    status: 'up' | 'down' | 'degraded';
    responseTime: number;
    error?: string;
  }>> {
    const services: Array<{
      name: string;
      status: 'up' | 'down' | 'degraded';
      responseTime: number;
      error?: string;
    }> = [];
    
    // Database health check
    try {
      const start = Date.now();
      const sql: Sql = this.db.getSQL();
      await sql`SELECT 1`;
      const responseTime = Date.now() - start;
      
      services.push({
        name: 'database',
        status: responseTime < 100 ? 'up' : 'degraded',
        responseTime
      });
      
      telemetry.recordDatabaseQuery('health_check', true, responseTime);
    } catch (error: unknown) {
      services.push({
        name: 'database',
        status: 'down',
        responseTime: 0,
        error: (error as { message?: string })?.message ?? 'unknown'
      });
      telemetry.recordDatabaseQuery('health_check', false, 0);
    }

    // Redis health check using RedisMonitor
    try {
      const redisHealth = await this.redisMonitor.performHealthCheck();
      
      services.push({
        name: 'redis',
        status: redisHealth.healthy ? 'up' : 'degraded',
        responseTime: redisHealth.redis.responseTime
      });
      
      // Log Redis alerts if any
      if (!redisHealth.healthy) {
        this.logger.warn('Redis health check detected issues', {
          alerts: redisHealth.alerts,
          responseTime: redisHealth.redis.responseTime,
          memoryUsage: redisHealth.redis.memoryUsage
        });
      }
    } catch (error: unknown) {
      services.push({
        name: 'redis',
        status: 'down',
        responseTime: 0,
        error: (error as { message?: string })?.message ?? 'unknown'
      });
      
      this.logger.error('Redis health check failed', error, {
        component: 'MonitoringService',
        method: 'checkServiceHealth'
      });
    }

    return services;
  }

  /**
   * Determine overall system health
   */
  private determineOverallHealth(
    performance: Awaited<ReturnType<typeof this.getSystemPerformance>>,
    services: Array<{ status: string }>
  ): 'healthy' | 'degraded' | 'critical' {
    const downServices = services.filter(s => s.status === 'down');
    const degradedServices = services.filter(s => s.status === 'degraded');

    if (downServices.length > 0 || performance.errorRate > 50) {
      return 'critical';
    }
    
    if (degradedServices.length > 0 || performance.errorRate > 10 || performance.averageResponseTime > 2000) {
      return 'degraded';
    }

    return 'healthy';
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
      const sql: Sql = this.db.getSQL();
      
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
      const connectionResult = connections[0];
      
      const metrics = {
        averageResponseTime: Math.round(result?.avg_response_time || 0),
        errorRate: Math.round((result?.error_rate || 0) * 100) / 100,
        throughput: Math.round((result?.total_requests || 0) / 5), // requests per minute
        activeConnections: parseInt(connectionResult?.active_connections || '0'),
        memoryUsage: Math.round((result?.avg_memory_usage || 0) * 100) / 100
      };

      // Record system metrics to telemetry
      telemetry.trackEvent('system_performance_check', {
        avg_response_time: metrics.averageResponseTime,
        error_rate: metrics.errorRate,
        throughput: metrics.throughput,
        active_connections: metrics.activeConnections
      });

      return metrics;
    } catch (error) {
      this.logger.error('Error getting system performance', error, {
        event: 'getSystemPerformance'
      });
      telemetry.trackEvent('system_performance_check_failed', {});
      throw new Error('Failed to get system performance');
    }
  }

  /**
   * Private: Calculate quality metrics for a merchant
   */
  private async calculateQualityMetrics(merchantId: string, platform: Platform): Promise<CalculatedQualityMetrics> {
    try {
      const sql: Sql = this.db.getSQL();
      
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
      const deliveryRate = (result?.messages_sent_24h ?? 0) > 0 
        ? must(result).messages_delivered_24h / must(result).messages_sent_24h 
        : 1;
      
      const readRate = (result?.messages_sent_24h ?? 0) > 0 
        ? must(result).messages_read_24h / must(result).messages_sent_24h 
        : 1;
      
      const responseRate = (result?.user_initiated_conversations_24h ?? 0) > 0
        ? must(result).business_initiated_conversations_24h / must(result).user_initiated_conversations_24h
        : 1;
      
      // Calculate quality scores (simplified algorithm)
      const messagingQualityScore = (deliveryRate * 0.4 + readRate * 0.3 + responseRate * 0.3);
      const qualityRating = Math.min(messagingQualityScore * 1.1, 1); // Boost slightly
      
      return {
        messagesSent24h: result?.messages_sent_24h || 0,
        messagesDelivered24h: result?.messages_delivered_24h || 0,
        messagesRead24h: result?.messages_read_24h || 0,
        userInitiatedConversations24h: result?.user_initiated_conversations_24h || 0,
        businessInitiatedConversations24h: result?.business_initiated_conversations_24h || 0,
        blockRate24h: 0, // Would need external API data
        reportRate24h: 0, // Would need external API data
        avgResponseTimeMinutes: result?.avg_response_time_minutes || 0,
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
  private determineQualityStatus(metrics: CalculatedQualityMetrics): QualityStatus {
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
  private generateRecommendations(metrics: CalculatedQualityMetrics, status: QualityStatus): string[] {
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
  private generateAlerts(metrics: CalculatedQualityMetrics, status: QualityStatus): QualityAlert[] {
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
    metrics: CalculatedQualityMetrics,
    status: QualityStatus
  ): Promise<void> {
    try {
      const sql: Sql = this.db.getSQL();
      
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
      
      const sql: Sql = this.db.getSQL();
      
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

  /**
   * Cleanup resources and close connections
   */
  async dispose(): Promise<void> {
    try {
      // Close database connections
      await this.db.close();
      
      // Clear health check interval if exists
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = undefined;
      }
      
      this.logger.info('Monitoring service resources cleaned up successfully');
    } catch (error) {
      this.logger.error('Error during monitoring service cleanup', error);
      throw error;
    }
  }
}

/**
 * Real-time monitoring middleware for API endpoints
 */
export function createPerformanceMiddleware(monitoringService: MonitoringService) {
  return (req: { path?: string; url?: string; method: string; merchantId?: string }, res: { end: (...args: unknown[]) => void; statusCode: number }, next: () => void) => {
    const startTime = Date.now();
    const originalEnd = res.end;

    res.end = function(...args: unknown[]) {
      const responseTime = Date.now() - startTime;
      const metrics: PerformanceMetrics = {
        endpoint: req.path || req.url || 'unknown',
        method: req.method,
        responseTime,
        statusCode: res.statusCode,
        timestamp: new Date(),
        merchantId: req.merchantId ?? '',
        errorMessage: res.statusCode >= 400 && args[0] ? String(args[0]) : ''
      };

      // Log async to avoid blocking response
      monitoringService.logPerformanceMetrics(metrics).catch(err => {
        // Use console.error as fallback since logger is private
        console.error('Performance logging failed:', err);
      });

      originalEnd.apply(this, args as Parameters<typeof originalEnd>);
    };

    next();
  };
}

// Factory function for DI container
export function createMonitoringService(container: DIContainer): MonitoringService {
  return new MonitoringService(container);
}

// Singleton instance (legacy support)
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