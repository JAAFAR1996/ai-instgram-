/**
 * ===============================================
 * Production Monitoring System
 * نظام المراقبة الإنتاجي الشامل
 * ===============================================
 */

import { Pool } from 'pg';
import { getLogger } from './logger.js';
import { getHealthSnapshot } from './health-check.js';

const log = getLogger({ component: 'production-monitoring' });

export interface SystemMetrics {
  timestamp: Date;
  uptime_seconds: number;
  memory_usage_mb: number;
  cpu_usage_percent?: number;
  active_connections: number;
  total_merchants: number;
  active_merchants_24h: number;
  total_conversations_24h: number;
  total_messages_24h: number;
  ai_responses_24h: number;
  queue_jobs_pending: number;
  queue_jobs_completed_24h: number;
  queue_jobs_failed_24h: number;
  avg_response_time_ms: number;
  error_rate_24h: number;
}

export interface MerchantMetrics {
  merchant_id: string;
  business_name: string;
  conversations_24h: number;
  messages_24h: number;
  ai_responses_24h: number;
  avg_response_time_ms: number;
  last_activity_at: Date;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
}

export interface PlatformHealth {
  status: 'healthy' | 'degraded' | 'critical';
  components: {
    database: { status: string; response_time_ms?: number };
    redis: { status: string; response_time_ms?: number };
    queue: { status: string; pending_jobs?: number };
    ai_service: { status: string; avg_response_time_ms?: number };
  };
  alerts: string[];
}

export class ProductionMonitoringService {
  private pool: Pool;
  private metricsCache: Map<string, any> = new Map();
  private cacheTimeout = 60000; // 1 minute cache

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * جمع مقاييس النظام الشاملة
   * Collect comprehensive system metrics
   */
  async getSystemMetrics(): Promise<SystemMetrics> {
    const cacheKey = 'system_metrics';
    const cached = this.metricsCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      const client = await this.pool.connect();
      
      try {
        // Get basic system info
        const uptime = process.uptime();
        const memUsage = process.memoryUsage();
        const poolStats = {
          totalCount: this.pool.totalCount || 0,
          idleCount: this.pool.idleCount || 0,
          waitingCount: this.pool.waitingCount || 0
        };
        
        // Database queries for metrics
        const [
          merchantsResult,
          activeMerchantsResult,
          conversationsResult,
          messagesResult,
          aiResponsesResult
        ] = await Promise.all([
          client.query('SELECT COUNT(*) as total FROM merchants WHERE subscription_status = $1', ['ACTIVE']),
          client.query(`
            SELECT COUNT(DISTINCT merchant_id) as active 
            FROM conversations 
            WHERE last_message_at > NOW() - INTERVAL '24 hours'
          `),
          client.query(`
            SELECT COUNT(*) as total 
            FROM conversations 
            WHERE created_at > NOW() - INTERVAL '24 hours'
          `),
          client.query(`
            SELECT COUNT(*) as total 
            FROM message_logs 
            WHERE created_at > NOW() - INTERVAL '24 hours'
          `),
          client.query(`
            SELECT COUNT(*) as total, AVG(ai_response_time_ms) as avg_time
            FROM message_logs 
            WHERE ai_processed = true 
            AND created_at > NOW() - INTERVAL '24 hours'
          `)
        ]);

        const metrics: SystemMetrics = {
          timestamp: new Date(),
          uptime_seconds: Math.floor(uptime),
          memory_usage_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
          active_connections: poolStats.totalCount,
          total_merchants: parseInt(merchantsResult.rows[0]?.total || '0'),
          active_merchants_24h: parseInt(activeMerchantsResult.rows[0]?.active || '0'),
          total_conversations_24h: parseInt(conversationsResult.rows[0]?.total || '0'),
          total_messages_24h: parseInt(messagesResult.rows[0]?.total || '0'),
          ai_responses_24h: parseInt(aiResponsesResult.rows[0]?.total || '0'),
          queue_jobs_pending: 0, // Will be updated by queue service
          queue_jobs_completed_24h: 0,
          queue_jobs_failed_24h: 0,
          avg_response_time_ms: parseFloat(aiResponsesResult.rows[0]?.avg_time || '0'),
          error_rate_24h: 0 // Will be calculated from logs
        };

        // Cache the result
        this.metricsCache.set(cacheKey, {
          timestamp: Date.now(),
          data: metrics
        });

        return metrics;
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      log.error('Failed to collect system metrics', { error });
      throw error;
    }
  }

  /**
   * جمع مقاييس التجار
   * Collect merchant metrics
   */
  async getMerchantMetrics(limit: number = 50): Promise<MerchantMetrics[]> {
    const cacheKey = `merchant_metrics_${limit}`;
    const cached = this.metricsCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }

    try {
      const client = await this.pool.connect();
      
      try {
        const result = await client.query(`
          SELECT 
            m.id as merchant_id,
            m.business_name,
            m.subscription_status as status,
            m.last_activity_at,
            COALESCE(c.conversations_24h, 0) as conversations_24h,
            COALESCE(ml.messages_24h, 0) as messages_24h,
            COALESCE(ml.ai_responses_24h, 0) as ai_responses_24h,
            COALESCE(ml.avg_response_time_ms, 0) as avg_response_time_ms
          FROM merchants m
          LEFT JOIN (
            SELECT 
              merchant_id,
              COUNT(*) as conversations_24h
            FROM conversations 
            WHERE created_at > NOW() - INTERVAL '24 hours'
            GROUP BY merchant_id
          ) c ON m.id = c.merchant_id
          LEFT JOIN (
            SELECT 
              c.merchant_id,
              COUNT(*) as messages_24h,
              COUNT(*) FILTER (WHERE ml.ai_processed = true) as ai_responses_24h,
              AVG(ml.ai_response_time_ms) FILTER (WHERE ml.ai_processed = true) as avg_response_time_ms
            FROM message_logs ml
            JOIN conversations c ON ml.conversation_id = c.id
            WHERE ml.created_at > NOW() - INTERVAL '24 hours'
            GROUP BY c.merchant_id
          ) ml ON m.id = ml.merchant_id
          WHERE m.subscription_status = 'ACTIVE'
          ORDER BY COALESCE(ml.messages_24h, 0) DESC
          LIMIT $1
        `, [limit]);

        const metrics = result.rows.map(row => ({
          merchant_id: row.merchant_id,
          business_name: row.business_name,
          conversations_24h: parseInt(row.conversations_24h),
          messages_24h: parseInt(row.messages_24h),
          ai_responses_24h: parseInt(row.ai_responses_24h),
          avg_response_time_ms: parseFloat(row.avg_response_time_ms || '0'),
          last_activity_at: new Date(row.last_activity_at),
          status: row.status
        }));

        // Cache the result
        this.metricsCache.set(cacheKey, {
          timestamp: Date.now(),
          data: metrics
        });

        return metrics;
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      log.error('Failed to collect merchant metrics', { error });
      throw error;
    }
  }

  /**
   * فحص صحة المنصة
   * Check platform health
   */
  async getPlatformHealth(): Promise<PlatformHealth> {
    const health = getHealthSnapshot();
    const alerts: string[] = [];
    
    // Check database health
    let dbStatus = 'healthy';
    let dbResponseTime: number | undefined;
    
    try {
      const start = Date.now();
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      dbResponseTime = Date.now() - start;
      
      if (dbResponseTime > 1000) {
        dbStatus = 'degraded';
        alerts.push('Database response time is high');
      }
    } catch (error) {
      dbStatus = 'critical';
      alerts.push('Database connection failed');
    }

    // Check Redis health
    let redisStatus = 'healthy';
    if (!health.details.redis.ok) {
      redisStatus = health.details.redis.error ? 'critical' : 'degraded';
      if (health.details.redis.error) {
        alerts.push(`Redis error: ${health.details.redis.error}`);
      }
    }

    // Check memory usage
    const memUsage = process.memoryUsage();
    const memUsageMB = memUsage.heapUsed / 1024 / 1024;
    if (memUsageMB > 500) {
      alerts.push('High memory usage detected');
    }

    // Determine overall status
    let overallStatus: 'healthy' | 'degraded' | 'critical' = 'healthy';
    if (dbStatus === 'critical' || redisStatus === 'critical') {
      overallStatus = 'critical';
    } else if (dbStatus === 'degraded' || redisStatus === 'degraded' || alerts.length > 0) {
      overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      components: {
        database: { status: dbStatus, response_time_ms: dbResponseTime },
        redis: { status: redisStatus },
        queue: { status: 'healthy', pending_jobs: 0 },
        ai_service: { status: 'healthy', avg_response_time_ms: 0 }
      },
      alerts
    };
  }

  /**
   * تسجيل حدث مراقبة
   * Log monitoring event
   */
  async logMonitoringEvent(event: {
    type: 'alert' | 'warning' | 'info';
    component: string;
    message: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    try {
      const client = await this.pool.connect();
      
      try {
        await client.query(`
          INSERT INTO audit_logs (
            action, entity_type, details, success, created_at
          ) VALUES ($1, $2, $3, $4, $5)
        `, [
          `monitoring_${event.type}`,
          event.component,
          JSON.stringify({
            message: event.message,
            ...event.metadata
          }),
          true,
          new Date()
        ]);
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      log.error('Failed to log monitoring event', { error, event });
    }
  }

  /**
   * تنظيف الكاش
   * Clear cache
   */
  clearCache(): void {
    this.metricsCache.clear();
  }

  /**
   * إحصائيات الأداء السريعة
   * Quick performance stats
   */
  async getQuickStats(): Promise<{
    merchants: number;
    conversations_today: number;
    messages_today: number;
    ai_responses_today: number;
    uptime_hours: number;
  }> {
    try {
      const client = await this.pool.connect();
      
      try {
        const result = await client.query(`
          SELECT 
            (SELECT COUNT(*) FROM merchants WHERE subscription_status = 'ACTIVE') as merchants,
            (SELECT COUNT(*) FROM conversations WHERE created_at > CURRENT_DATE) as conversations_today,
            (SELECT COUNT(*) FROM message_logs WHERE created_at > CURRENT_DATE) as messages_today,
            (SELECT COUNT(*) FROM message_logs WHERE ai_processed = true AND created_at > CURRENT_DATE) as ai_responses_today
        `);

        const row = result.rows[0];
        
        return {
          merchants: parseInt(row.merchants || '0'),
          conversations_today: parseInt(row.conversations_today || '0'),
          messages_today: parseInt(row.messages_today || '0'),
          ai_responses_today: parseInt(row.ai_responses_today || '0'),
          uptime_hours: Math.floor(process.uptime() / 3600)
        };
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      log.error('Failed to get quick stats', { error });
      return {
        merchants: 0,
        conversations_today: 0,
        messages_today: 0,
        ai_responses_today: 0,
        uptime_hours: 0
      };
    }
  }
}

// Singleton instance
let monitoringService: ProductionMonitoringService | null = null;

export function getMonitoringService(pool: Pool): ProductionMonitoringService {
  if (!monitoringService) {
    monitoringService = new ProductionMonitoringService(pool);
  }
  return monitoringService;
}