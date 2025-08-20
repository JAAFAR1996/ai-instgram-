/**
 * ===============================================
 * Redis Latency and Queue Monitoring Service
 * Production-grade Redis and DLQ monitoring
 * ===============================================
 */

import { getLogger } from './logger.js';
import { withRedisTimeout } from '../utils/timeout.js';
import { getDLQMonitoring } from '../queue/dead-letter.js';

interface RedisLatencyMetrics {
  ping: number;
  set: number;
  get: number;
  del: number;
  hgetall: number;
  rpush: number;
  lpop: number;
}

interface RedisStats {
  connected: boolean;
  latency: RedisLatencyMetrics;
  memory: {
    used: number;
    peak: number;
    fragmentation: number;
  };
  connections: {
    current: number;
    total: number;
    rejected: number;
  };
  commandStats: {
    totalCommands: number;
    opsPerSecond: number;
  };
  keyspace: {
    totalKeys: number;
    expires: number;
  };
}

interface MonitoringAlerts {
  highLatency: boolean;
  dlqCapacity: boolean;
  redisConnections: boolean;
  memoryUsage: boolean;
}

const logger = getLogger({ component: 'RedisMonitoring' });

export class RedisMonitor {
  private redisConnection: any = null;
  private metrics: RedisStats = this.getDefaultMetrics();
  private lastCheck = 0;
  private alerts: MonitoringAlerts = {
    highLatency: false,
    dlqCapacity: false,
    redisConnections: false,
    memoryUsage: false
  };

  // Configurable thresholds
  private thresholds = {
    latencyWarning: parseInt(process.env.REDIS_LATENCY_WARNING_MS || '100'),
    latencyCritical: parseInt(process.env.REDIS_LATENCY_CRITICAL_MS || '500'),
    dlqCapacityWarning: parseInt(process.env.DLQ_CAPACITY_WARNING_PCT || '70'),
    dlqCapacityCritical: parseInt(process.env.DLQ_CAPACITY_CRITICAL_PCT || '90'),
    memoryWarning: parseInt(process.env.REDIS_MEMORY_WARNING_PCT || '80'),
    memoryCritical: parseInt(process.env.REDIS_MEMORY_CRITICAL_PCT || '95'),
    connectionsWarning: parseInt(process.env.REDIS_CONNECTIONS_WARNING || '80'),
    connectionsCritical: parseInt(process.env.REDIS_CONNECTIONS_CRITICAL || '95')
  };

  constructor(redisConnection?: any) {
    this.redisConnection = redisConnection;
  }

  /**
   * Set Redis connection for monitoring
   */
  setRedisConnection(connection: any): void {
    this.redisConnection = connection;
  }

  /**
   * Perform comprehensive Redis health check with latency measurement
   */
  async performHealthCheck(): Promise<{
    redis: RedisStats;
    dlq: ReturnType<typeof getDLQMonitoring>;
    alerts: MonitoringAlerts;
    timestamp: number;
  }> {
    const timestamp = Date.now();
    
    try {
      // Measure Redis latency
      if (this.redisConnection) {
        await this.measureRedisLatency();
        await this.collectRedisStats();
      } else {
        logger.warn('Redis connection not available for monitoring');
        this.metrics.connected = false;
      }

      // Get DLQ monitoring data
      const dlqData = getDLQMonitoring();

      // Update alerts
      this.updateAlerts(dlqData);

      this.lastCheck = timestamp;

      return {
        redis: this.metrics,
        dlq: dlqData,
        alerts: this.alerts,
        timestamp
      };
    } catch (error) {
      logger.error('Redis health check failed', error);
      this.metrics.connected = false;
      this.alerts.redisConnections = true;
      
      return {
        redis: this.metrics,
        dlq: getDLQMonitoring(),
        alerts: this.alerts,
        timestamp
      };
    }
  }

  /**
   * Measure Redis operation latencies
   */
  private async measureRedisLatency(): Promise<void> {
    const testKey = `health_check_${Date.now()}`;
    const testValue = 'test_value';

    try {
      // Ping latency
      const pingStart = Date.now();
      await withRedisTimeout(this.redisConnection.ping(), 'ping');
      this.metrics.latency.ping = Date.now() - pingStart;

      // SET latency
      const setStart = Date.now();
      await withRedisTimeout(this.redisConnection.set(testKey, testValue, 'EX', 30), 'set');
      this.metrics.latency.set = Date.now() - setStart;

      // GET latency
      const getStart = Date.now();
      await withRedisTimeout(this.redisConnection.get(testKey), 'get');
      this.metrics.latency.get = Date.now() - getStart;

      // DEL latency
      const delStart = Date.now();
      await withRedisTimeout(this.redisConnection.del(testKey), 'del');
      this.metrics.latency.del = Date.now() - delStart;

      // Hash operations latency
      const hashKey = `hash_${testKey}`;
      const hsetStart = Date.now();
      await withRedisTimeout(this.redisConnection.hset(hashKey, 'field1', 'value1', 'field2', 'value2'), 'hset');
      
      const hgetallStart = Date.now();
      await withRedisTimeout(this.redisConnection.hgetall(hashKey), 'hgetall');
      this.metrics.latency.hgetall = Date.now() - hgetallStart;

      await withRedisTimeout(this.redisConnection.del(hashKey), 'cleanup hash');

      // List operations latency
      const listKey = `list_${testKey}`;
      const rpushStart = Date.now();
      await withRedisTimeout(this.redisConnection.rpush(listKey, 'item1', 'item2'), 'rpush');
      this.metrics.latency.rpush = Date.now() - rpushStart;

      const lpopStart = Date.now();
      await withRedisTimeout(this.redisConnection.lpop(listKey), 'lpop');
      this.metrics.latency.lpop = Date.now() - lpopStart;

      await withRedisTimeout(this.redisConnection.del(listKey), 'cleanup list');

      this.metrics.connected = true;

      logger.debug('Redis latency measured', {
        ping: this.metrics.latency.ping,
        set: this.metrics.latency.set,
        get: this.metrics.latency.get,
        del: this.metrics.latency.del
      });

    } catch (error) {
      logger.error('Redis latency measurement failed', error);
      this.metrics.connected = false;
      throw error;
    }
  }

  /**
   * Collect Redis server statistics
   */
  private async collectRedisStats(): Promise<void> {
    try {
      const info = await withRedisTimeout(this.redisConnection.info('all'), 'info');
      const infoLines = String(info).split('\r\n');
      const infoObj: Record<string, string> = {};

      infoLines.forEach((line: string) => {
        if (line.includes(':')) {
          const [key, value] = line.split(':');
          infoObj[key] = value;
        }
      });

      // Memory stats
      this.metrics.memory = {
        used: parseInt(infoObj.used_memory || '0'),
        peak: parseInt(infoObj.used_memory_peak || '0'),
        fragmentation: parseFloat(infoObj.mem_fragmentation_ratio || '1.0')
      };

      // Connection stats
      this.metrics.connections = {
        current: parseInt(infoObj.connected_clients || '0'),
        total: parseInt(infoObj.total_connections_received || '0'),
        rejected: parseInt(infoObj.rejected_connections || '0')
      };

      // Command stats
      this.metrics.commandStats = {
        totalCommands: parseInt(infoObj.total_commands_processed || '0'),
        opsPerSecond: parseFloat(infoObj.instantaneous_ops_per_sec || '0')
      };

      // Keyspace stats
      const keyspaceInfo = infoObj.db0 || '';
      const keysMatch = keyspaceInfo.match(/keys=(\d+)/);
      const expiresMatch = keyspaceInfo.match(/expires=(\d+)/);
      
      this.metrics.keyspace = {
        totalKeys: keysMatch ? parseInt(keysMatch[1]) : 0,
        expires: expiresMatch ? parseInt(expiresMatch[1]) : 0
      };

    } catch (error) {
      logger.error('Failed to collect Redis stats', error);
    }
  }

  /**
   * Update monitoring alerts based on current metrics
   */
  private updateAlerts(dlqData: ReturnType<typeof getDLQMonitoring>): void {
    const previousAlerts = { ...this.alerts };

    // High latency alert
    const avgLatency = (
      this.metrics.latency.ping + 
      this.metrics.latency.set + 
      this.metrics.latency.get
    ) / 3;
    this.alerts.highLatency = avgLatency > this.thresholds.latencyCritical;

    // DLQ capacity alert
    this.alerts.dlqCapacity = dlqData.queue.utilization > this.thresholds.dlqCapacityCritical;

    // Redis connections alert
    this.alerts.redisConnections = !this.metrics.connected || 
      this.metrics.connections.current > this.thresholds.connectionsCritical;

    // Memory usage alert
    const memoryUsagePct = this.metrics.memory.peak > 0 ? 
      (this.metrics.memory.used / this.metrics.memory.peak) * 100 : 0;
    this.alerts.memoryUsage = memoryUsagePct > this.thresholds.memoryCritical;

    // Log new alerts
    Object.keys(this.alerts).forEach(alertType => {
      const current = (this.alerts as any)[alertType];
      const previous = (previousAlerts as any)[alertType];
      
      if (current && !previous) {
        logger.error(`NEW ALERT: ${alertType}`, {
          alertType,
          metrics: this.getAlertContext(alertType as keyof MonitoringAlerts)
        });
      } else if (!current && previous) {
        logger.info(`ALERT RESOLVED: ${alertType}`, { alertType });
      }
    });
  }

  /**
   * Get context for specific alert type
   */
  private getAlertContext(alertType: keyof MonitoringAlerts): any {
    switch (alertType) {
      case 'highLatency':
        return { latency: this.metrics.latency };
      case 'dlqCapacity':
        return { dlqSize: getDLQMonitoring().queue };
      case 'redisConnections':
        return { connections: this.metrics.connections };
      case 'memoryUsage':
        return { memory: this.metrics.memory };
      default:
        return {};
    }
  }

  /**
   * Get default metrics structure
   */
  private getDefaultMetrics(): RedisStats {
    return {
      connected: false,
      latency: {
        ping: 0,
        set: 0,
        get: 0,
        del: 0,
        hgetall: 0,
        rpush: 0,
        lpop: 0
      },
      memory: {
        used: 0,
        peak: 0,
        fragmentation: 1.0
      },
      connections: {
        current: 0,
        total: 0,
        rejected: 0
      },
      commandStats: {
        totalCommands: 0,
        opsPerSecond: 0
      },
      keyspace: {
        totalKeys: 0,
        expires: 0
      }
    };
  }

  /**
   * Get current metrics without performing a check
   */
  getMetrics(): RedisStats {
    return { ...this.metrics };
  }

  /**
   * Get current alerts
   */
  getAlerts(): MonitoringAlerts {
    return { ...this.alerts };
  }

  /**
   * Check if monitoring is healthy
   */
  isHealthy(): boolean {
    return !Object.values(this.alerts).some(alert => alert === true);
  }
}

// Export singleton instance
let redisMonitorInstance: RedisMonitor | null = null;

/**
 * Get Redis monitor instance
 */
export function getRedisMonitor(redisConnection?: any): RedisMonitor {
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
  
  return setInterval(async () => {
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
}

export default RedisMonitor;