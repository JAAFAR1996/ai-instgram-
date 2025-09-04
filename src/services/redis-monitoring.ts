/**
 * ===============================================
 * Redis Monitoring Service
 * Health checks and performance monitoring for Redis
 * ===============================================
 */

import { getLogger } from './logger.js';
import type { Redis } from 'ioredis';

const logger = getLogger();

export interface RedisHealthMetrics {
  connected: boolean;
  responseTime: number;
  memoryUsage: number;
  connectedClients: number;
  commandsProcessed: number;
  keyspaceHits: number;
  keyspaceMisses: number;
  usedMemoryPeak: number;
}

export interface RedisAlerts {
  highMemoryUsage: boolean;
  slowResponseTime: boolean;
  connectionIssues: boolean;
  highErrorRate: boolean;
}

export interface RedisMonitoringReport {
  timestamp: number;
  redis: RedisHealthMetrics;
  dlq: {
    queue: {
      size: number;
      processing: number;
      failed: number;
    };
  };
  alerts: RedisAlerts;
  healthy: boolean;
}

export class RedisMonitor {
  private redis?: Redis;
  private alerts: RedisAlerts = {
    highMemoryUsage: false,
    slowResponseTime: false,
    connectionIssues: false,
    highErrorRate: false
  };

  constructor(redisConnection?: Redis) {
    if (redisConnection) {
      this.redis = redisConnection;
    }
  }

  setRedisConnection(redis: Redis): void {
    this.redis = redis;
  }

  async performHealthCheck(): Promise<RedisMonitoringReport> {
    const timestamp = Date.now();
    
    try {
      const startTime = Date.now();
      
      // Basic connectivity check
      if (!this.redis) {
        throw new Error('Redis connection not available');
      }

      // Test basic operation
      await this.redis.ping();
      const responseTime = Date.now() - startTime;

      // Get Redis info
      const info = await this.redis.info();
      const stats = this.parseRedisInfo(info);

      // Check thresholds and set alerts
      this.checkThresholds(stats, responseTime);

      const report: RedisMonitoringReport = {
        timestamp,
        redis: {
          connected: true,
          responseTime,
          memoryUsage: stats.used_memory ?? 0,
          connectedClients: stats.connected_clients ?? 0,
          commandsProcessed: stats.total_commands_processed ?? 0,
          keyspaceHits: stats.keyspace_hits ?? 0,
          keyspaceMisses: stats.keyspace_misses ?? 0,
          usedMemoryPeak: stats.used_memory_peak ?? 0,
        },
        dlq: {
          queue: {
            size: 0, // Would be filled by DLQ service
            processing: 0,
            failed: 0
          }
        },
        alerts: { ...this.alerts },
        healthy: this.isHealthy()
      };

      return report;

    } catch (error) {
      this.alerts.connectionIssues = true;
      
      logger.error('Redis health check failed', error, {
        component: 'RedisMonitor',
        method: 'performHealthCheck'
      });
      
      return {
        timestamp,
        redis: {
          connected: false,
          responseTime: -1,
          memoryUsage: 0,
          connectedClients: 0,
          commandsProcessed: 0,
          keyspaceHits: 0,
          keyspaceMisses: 0,
          usedMemoryPeak: 0,
        },
        dlq: {
          queue: {
            size: 0,
            processing: 0,
            failed: 0
          }
        },
        alerts: { ...this.alerts },
        healthy: false
      };
    }
  }

  private parseRedisInfo(info: string): Record<string, number> {
    const stats: Record<string, number> = {};
    
    const lines = info.split('\r\n');
    for (const line of lines) {
      if (line.includes(':')) {
        const [key, value] = line.split(':');
        if (value !== undefined) {
          const numValue = parseInt(value, 10);
          if (!Number.isNaN(numValue) && typeof key === 'string') {
            stats[key] = numValue;
          }
        }
      }
    }
    
    return stats;
  }

  private checkThresholds(stats: Record<string, number>, responseTime: number): void {
    // Reset alerts
    this.alerts = {
      highMemoryUsage: false,
      slowResponseTime: false,
      connectionIssues: false,
      highErrorRate: false
    };

    // Memory usage threshold (80% of max memory)
    const maxMemory = stats.maxmemory ?? 0;
    const usedMemory = stats.used_memory ?? 0;
    if (maxMemory > 0 && (usedMemory / maxMemory) > 0.8) {
      this.alerts.highMemoryUsage = true;
    }

    // Response time threshold (500ms)
    if (responseTime > 500) {
      this.alerts.slowResponseTime = true;
    }

    // Hit rate threshold (< 90%)
    const hits = stats.keyspace_hits ?? 0;
    const misses = stats.keyspace_misses ?? 0;
    const total = hits + misses;
    if (total > 0 && (hits / total) < 0.9) {
      logger.warn('Redis hit rate below threshold', {
        hitRate: (hits / total) * 100,
        hits,
        misses
      });
    }
  }

  getAlerts(): RedisAlerts {
    return { ...this.alerts };
  }

  isHealthy(): boolean {
    return !Object.values(this.alerts).some(alert => alert === true);
  }
}

// Export singleton instance
let redisMonitorInstance: RedisMonitor | null = null;

/**
 * Get Redis monitor instance
 */
export function getRedisMonitor(redisConnection?: Redis): RedisMonitor {
  if (!redisMonitorInstance) {
    redisMonitorInstance = new RedisMonitor(redisConnection);
  } else if (redisConnection) {
    redisMonitorInstance.setRedisConnection(redisConnection);
  }
  return redisMonitorInstance;
}

/**
 * Create monitoring middleware for periodic checks
 */
export function startRedisMonitoring(intervalMs: number = 30000): NodeJS.Timer {
  const monitor = getRedisMonitor();

  const interval = setInterval(async () => {
    try {
      const health = await monitor.performHealthCheck();

      if (!monitor.isHealthy()) {
        logger.warn('Redis monitoring detected issues', {
          alerts: health.alerts,
          dlqSize: health.dlq.queue.size,
          redisConnected: health.redis.connected
        });
      }
    } catch (error) {
      logger.error('Redis monitoring check failed', error);
    }
  }, intervalMs);
  interval.unref();
  return interval;
}

export default RedisMonitor;