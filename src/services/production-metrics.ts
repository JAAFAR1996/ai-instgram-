/**
 * Production Metrics & Monitoring
 * Centralized metrics collection with alerts and notifications
 */

import { getLogger } from './logger.js';
import { getRedisConnectionManager } from './RedisConnectionManager.js';
import { RedisUsageType } from '../config/RedisConfigurationFactory.js';
import { getDatabaseJobSpool } from '../queue/db-spool.js';
import { getDatabase } from '../db/adapter.js';
import { firstOrThrow, must } from '../utils/safety.js';

const logger = getLogger({ component: 'ProductionMetrics' });

export interface ProductionMetrics {
  timestamp: number;
  system: {
    uptime: number;
    memory: NodeJS.MemoryUsage;
    cpu: number;
  };
  redis: {
    status: 'healthy' | 'degraded' | 'down';
    rateLimited: boolean;
    responseTime: number | null;
    circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    connectionCount: number;
  };
  database: {
    status: 'healthy' | 'degraded' | 'down';
    connectionCount: number;
    queryResponseTime: number | null;
    rlsDeniedCount: number;
  };
  queue: {
    spoolSize: number;
    spoolPendingJobs: number;
    drainerRunning: boolean;
    processingErrorRate: number;
  };
  security: {
    webhookVerificationFailures: number;
    internalRouteAttempts: number;
    rlsViolations: number;
  };
  business: {
    activeConversations: number;
    messagesProcessedHour: number;
    merchantCount: number;
  };
}

export interface MetricAlert {
  severity: 'warning' | 'critical';
  metric: string;
  value: number;
  threshold: number;
  message: string;
  timestamp: number;
}

export class ProductionMetricsCollector {
  private metrics: ProductionMetrics | null = null;
  private alerts: MetricAlert[] = [];
  private isCollecting = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  // Metric counters (in-memory, could be Redis in production)
  private counters = {
    webhookFailures: 0,
    internalAccess: 0,
    rlsViolations: 0,
    messagesProcessed: 0
  };

  constructor() {
    // Reset message counter every hour
    setInterval(() => {
      this.counters.messagesProcessed = 0;
    }, 60 * 60 * 1000);
  }

  /**
   * Start metrics collection
   */
  async start(intervalMs: number = 30000): Promise<void> {
    if (this.isCollecting) {
      logger.warn('Metrics collection already running');
      return;
    }

    this.isCollecting = true;
    logger.info('Starting production metrics collection', { intervalMs });

    // Initial collection
    await this.collectMetrics();

    // Set up interval
    this.intervalId = setInterval(async () => {
      try {
        await this.collectMetrics();
      } catch (error) {
        logger.error('Metrics collection error', { error: error instanceof Error ? error.message : String(error) });
      }
    }, intervalMs);
  }

  /**
   * Stop metrics collection
   */
  stop(): void {
    this.isCollecting = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    logger.info('Metrics collection stopped');
  }

  /**
   * Collect all metrics
   */
  private async collectMetrics(): Promise<void> {
    const startTime = Date.now();

    try {
      const [redisMetrics, dbMetrics, queueMetrics, businessMetrics] = await Promise.all([
        this.collectRedisMetrics(),
        this.collectDatabaseMetrics(),
        this.collectQueueMetrics(),
        this.collectBusinessMetrics()
      ]);

      this.metrics = {
        timestamp: Date.now(),
        system: this.collectSystemMetrics(),
        redis: redisMetrics,
        database: dbMetrics,
        queue: queueMetrics,
        security: {
          webhookVerificationFailures: this.counters.webhookFailures,
          internalRouteAttempts: this.counters.internalAccess,
          rlsViolations: this.counters.rlsViolations
        },
        business: businessMetrics
      };

      // Check for alerts
      this.checkAlerts(this.metrics);

      const collectionTime = Date.now() - startTime;
      logger.debug('Metrics collected', { collectionTimeMs: collectionTime });

    } catch (error) {
      logger.error('Failed to collect metrics', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Collect system metrics
   */
  private collectSystemMetrics() {
    return {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage().user / 1000000 // Convert to seconds
    };
  }

  /**
   * Collect Redis metrics
   */
  private async collectRedisMetrics() {
    const startTime = Date.now();
    
    try {
      const redisManager = getRedisConnectionManager();
      const client = await redisManager.getConnection(RedisUsageType.CACHING);
      
      await client.ping();
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'healthy' as const,
        rateLimited: false,
        responseTime,
        circuitState: 'CLOSED' as const,
        connectionCount: 1 // Could be enhanced to track actual connections
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isRateLimit = errorMessage.includes('max requests limit') || 
                         errorMessage.includes('rate limit');
      
      return {
        status: isRateLimit ? 'degraded' as const : 'down' as const,
        rateLimited: isRateLimit,
        responseTime: null,
        circuitState: isRateLimit ? 'OPEN' as const : 'OPEN' as const,
        connectionCount: 0
      };
    }
  }

  /**
   * Collect database metrics
   */
  private async collectDatabaseMetrics() {
    const startTime = Date.now();
    
    try {
      const db = getDatabase();
      const sql = db.getSQL();
      
      // Simple ping query
      await sql`SELECT 1`;
      const responseTime = Date.now() - startTime;
      
      // Get connection stats
      const [connStats] = await sql`
        SELECT count(*) as active_connections
        FROM pg_stat_activity 
        WHERE state = 'active'
      `;
      
      return {
        status: 'healthy' as const,
        connectionCount: parseInt(String(must(connStats?.active_connections, 'missing active_connections'))),
        queryResponseTime: responseTime,
        rlsDeniedCount: this.counters.rlsViolations
      };
      
    } catch (error) {
      return {
        status: 'down' as const,
        connectionCount: 0,
        queryResponseTime: null,
        rlsDeniedCount: this.counters.rlsViolations
      };
    }
  }

  /**
   * Collect queue metrics
   */
  private async collectQueueMetrics() {
    try {
      const spool = getDatabaseJobSpool();
      const spoolStats = await spool.getSpoolStats();
      
      return {
        spoolSize: spoolStats.total,
        spoolPendingJobs: spoolStats.pending,
        drainerRunning: true, // Could check actual drainer status
        processingErrorRate: 0 // Could be calculated from error counters
      };
      
    } catch (error) {
      return {
        spoolSize: 0,
        spoolPendingJobs: 0,
        drainerRunning: false,
        processingErrorRate: 100
      };
    }
  }

  /**
   * Collect business metrics
   */
  private async collectBusinessMetrics() {
    try {
      const db = getDatabase();
      const sql = db.getSQL();
      
      await sql`SET LOCAL app.admin_mode = 'true'`;
      
      const [conversations, merchants] = await Promise.all([
        sql`SELECT COUNT(*) as count FROM conversations WHERE is_active = true`,
        sql`SELECT COUNT(*) as count FROM merchants WHERE is_active = true`
      ]);
      
      return {
        activeConversations: parseInt(String(firstOrThrow(conversations).count)),
        messagesProcessedHour: this.counters.messagesProcessed,
                  merchantCount: parseInt(String(firstOrThrow(merchants).count))
      };
      
    } catch (error) {
      return {
        activeConversations: 0,
        messagesProcessedHour: this.counters.messagesProcessed,
        merchantCount: 0
      };
    }
  }

  /**
   * Check metrics against thresholds and generate alerts
   */
  private checkAlerts(metrics: ProductionMetrics): void {
    const newAlerts: MetricAlert[] = [];

    // Memory usage alert
    const memoryUsage = (metrics.system.memory.heapUsed / metrics.system.memory.heapTotal) * 100;
    if (memoryUsage > 90) {
      newAlerts.push({
        severity: 'critical',
        metric: 'memory_usage',
        value: memoryUsage,
        threshold: 90,
        message: `High memory usage: ${memoryUsage.toFixed(1)}%`,
        timestamp: Date.now()
      });
    } else if (memoryUsage > 75) {
      newAlerts.push({
        severity: 'warning',
        metric: 'memory_usage',
        value: memoryUsage,
        threshold: 75,
        message: `Elevated memory usage: ${memoryUsage.toFixed(1)}%`,
        timestamp: Date.now()
      });
    }

    // Redis alerts
    if (metrics.redis.rateLimited) {
      newAlerts.push({
        severity: 'critical',
        metric: 'redis_rate_limited',
        value: 1,
        threshold: 0,
        message: 'Redis rate limit exceeded - fallback mode active',
        timestamp: Date.now()
      });
    }

    if (metrics.redis.responseTime && metrics.redis.responseTime > 1000) {
      newAlerts.push({
        severity: 'warning',
        metric: 'redis_response_time',
        value: metrics.redis.responseTime,
        threshold: 1000,
        message: `Slow Redis response: ${metrics.redis.responseTime}ms`,
        timestamp: Date.now()
      });
    }

    // Database alerts
    if (metrics.database.status === 'down') {
      newAlerts.push({
        severity: 'critical',
        metric: 'database_down',
        value: 1,
        threshold: 0,
        message: 'Database connection failed',
        timestamp: Date.now()
      });
    }

    if (metrics.database.rlsDeniedCount > 10) {
      newAlerts.push({
        severity: 'warning',
        metric: 'rls_violations',
        value: metrics.database.rlsDeniedCount,
        threshold: 10,
        message: `High RLS violation count: ${metrics.database.rlsDeniedCount}`,
        timestamp: Date.now()
      });
    }

    // Queue alerts
    if (metrics.queue.spoolPendingJobs > 100) {
      newAlerts.push({
        severity: 'warning',
        metric: 'spool_backlog',
        value: metrics.queue.spoolPendingJobs,
        threshold: 100,
        message: `Job spool backlog: ${metrics.queue.spoolPendingJobs} pending jobs`,
        timestamp: Date.now()
      });
    }

    // Security alerts
    if (metrics.security.webhookVerificationFailures > 5) {
      newAlerts.push({
        severity: 'critical',
        metric: 'webhook_security_failures',
        value: metrics.security.webhookVerificationFailures,
        threshold: 5,
        message: `Multiple webhook signature failures: ${metrics.security.webhookVerificationFailures}`,
        timestamp: Date.now()
      });
    }

    // Add new alerts
    for (const alert of newAlerts) {
      this.alerts.unshift(alert);
      logger.warn('Production alert triggered', { ...alert });
      
      // Send notification (implement based on your notification system)
      this.sendNotification(alert);
    }

    // Keep only last 100 alerts
    this.alerts = this.alerts.slice(0, 100);
  }

  /**
   * Send alert notification
   */
  private async sendNotification(alert: MetricAlert): Promise<void> {
    // Implementation depends on your notification system
    // Examples: Slack, Discord, Email, PagerDuty, etc.
    
    logger.info('Alert notification', {
      severity: alert.severity,
      metric: alert.metric,
      message: alert.message,
      // In production, send to external service
      shouldSendExternal: process.env.NODE_ENV === 'production'
    });
  }

  /**
   * Increment metric counter
   */
  public incrementCounter(metric: keyof typeof this.counters): void {
    if (this.counters.hasOwnProperty(metric)) {
      this.counters[metric]++;
    }
  }

  /**
   * Get current metrics
   */
  public getCurrentMetrics(): ProductionMetrics | null {
    return this.metrics;
  }

  /**
   * Get recent alerts
   */
  public getAlerts(limit: number = 20): MetricAlert[] {
    return this.alerts.slice(0, limit);
  }

  /**
   * Get metrics for dashboard/monitoring
   */
  public getMetricsForMonitoring() {
    return {
      metrics: this.metrics,
      alerts: this.getAlerts(10),
      counters: this.counters,
      isCollecting: this.isCollecting
    };
  }
}

// Singleton instance
let metricsInstance: ProductionMetricsCollector | null = null;

export function getProductionMetrics(): ProductionMetricsCollector {
  if (!metricsInstance) {
    metricsInstance = new ProductionMetricsCollector();
  }
  return metricsInstance;
}

export default ProductionMetricsCollector;