/**
 * =============================================== 
 * Comprehensive Health Check Service
 * Production-ready health monitoring with background caching
 * منع multiple resolves وsnapshot-based responses
 * ===============================================
 */

import { getDatabase } from '../database/connection.js';
import { getRedisConnectionManager } from './RedisConnectionManager.js';
import { RedisUsageType } from '../config/RedisConfigurationFactory.js';
import { safeAsync, wrapError } from '../boot/error-handlers.js';

/**
 * withTimeout - منع multiple resolves في العمليات غير المتزامنة
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, context: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    
    const safeResolve = (value: T) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    
    const safeReject = (reason: any) => {
      if (settled) return;
      settled = true;
      reject(reason);
    };
    
    // Set timeout
    const timeoutId = setTimeout(() => {
      const err = new Error(`[health] ${context} timed out after ${timeoutMs}ms`);
      (err as any).code = 'HEALTH_TIMEOUT';
      safeReject(err);
    }, timeoutMs);
    
    // Handle the actual promise
    promise
      .then((result) => {
        clearTimeout(timeoutId);
        safeResolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        safeReject(error);
      });
  });
}

export interface HealthCheck {
  name: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  responseTime: number;
  message?: string;
  details?: Record<string, any>;
}

export interface HealthReport {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  checks: HealthCheck[];
  summary: {
    healthy: number;
    unhealthy: number;
    degraded: number;
    totalResponseTime: number;
  };
}

export class HealthCheckService {
  private startTime = Date.now();
  private cachedHealthReport: HealthReport | null = null;
  private lastHealthCheckTime = 0;
  private readonly CACHE_DURATION_MS = 30000; // 30 seconds cache
  private healthUpdateInterval: ReturnType<typeof setInterval> | null = null;
  private isUpdating = false;

  constructor() {
    // Start background health updates
    this.startBackgroundUpdates();
  }

  /**
   * Start background health snapshot updates
   */
  private startBackgroundUpdates(): void {
    // Initial update
    this.updateHealthSnapshot();
    
    // Schedule regular updates
    this.healthUpdateInterval = setInterval(() => {
      this.updateHealthSnapshot();
    }, this.CACHE_DURATION_MS);
    
    // لا تُبقي العملية حيّة لوحدها
    (this.healthUpdateInterval as any).unref?.();
  }

  /**
   * Stop background updates (for graceful shutdown)
   */
  public stopBackgroundUpdates(): void {
    if (this.healthUpdateInterval) {
      clearInterval(this.healthUpdateInterval);
      this.healthUpdateInterval = null;
    }
  }

  /**
   * Update health snapshot in background
   */
  private async updateHealthSnapshot(): Promise<void> {
    if (this.isUpdating) return; // Prevent concurrent updates
    
    this.isUpdating = true;
    try {
      const healthReport = await this.performActualHealthCheck();
      this.cachedHealthReport = healthReport;
      this.lastHealthCheckTime = Date.now();
    } catch (error) {
      const wrappedError = wrapError(error, 'updateHealthSnapshot');
      console.error('[HealthCheck] Failed to update snapshot:', wrappedError.message);
    } finally {
      this.isUpdating = false;
    }
  }

  /**
   * Get cached health report (fast response)
   */
  async performHealthCheck(): Promise<HealthReport> {
    const now = Date.now();
    
    // Return cached result if available and fresh
    if (this.cachedHealthReport && (now - this.lastHealthCheckTime) < this.CACHE_DURATION_MS) {
      return this.cachedHealthReport;
    }
    
    // If no cache or stale, wait for fresh data (with timeout)
    if (!this.cachedHealthReport || this.isUpdating) {
      try {
        const fresh = await withTimeout(this.performActualHealthCheck(), 5000, 'health check update');
        this.cachedHealthReport = fresh;
        this.lastHealthCheckTime = Date.now();
        return fresh;
      } catch (error) {
        console.warn('[HealthCheck] Failed to get fresh data, returning emergency report');
        return this.getEmergencyHealthReport();
      }
    }
    
    return this.cachedHealthReport;
  }

  /**
   * Emergency health report when all else fails
   */
  private getEmergencyHealthReport(): HealthReport {
    return {
      status: 'degraded',
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      version: process.env.APP_VERSION || '2.0.0',
      environment: process.env.NODE_ENV || 'production',
      checks: [{
        name: 'emergency_fallback',
        status: 'degraded',
        responseTime: 0,
        message: 'Using emergency fallback - health checks unavailable'
      }],
      summary: {
        healthy: 0,
        unhealthy: 0,
        degraded: 1,
        totalResponseTime: 0
      }
    };
  }

  /**
   * Perform actual comprehensive health check
   */
  private async performActualHealthCheck(): Promise<HealthReport> {
    const startTime = Date.now();
    const checks: HealthCheck[] = [];

    // Database health check with timeout
    const dbCheck = await safeAsync(async () => {
      return await withTimeout(this.checkDatabase(), 3000, 'database check');
    }, 'database health check');
    if (dbCheck) checks.push(dbCheck);
    
    // Redis health check with timeout
    const redisCheck = await safeAsync(async () => {
      return await withTimeout(this.checkRedis(), 3000, 'redis check');
    }, 'redis health check');
    if (redisCheck) checks.push(redisCheck);
    
    // Memory health check (always fast)
    const memCheck = await safeAsync(async () => {
      return await this.checkMemory();
    }, 'memory health check');
    if (memCheck) checks.push(memCheck);
    
    // External API health check (light check) - skip in restricted environments
    const skip = /^(1|true|yes)$/i.test(process.env.SKIP_EXTERNAL_HEALTH ?? '');
    if (!skip) {
      const apiCheck = await safeAsync(async () => {
        return await withTimeout(this.checkExternalAPIs(), 2000, 'external APIs check');
      }, 'external APIs health check');
      if (apiCheck) checks.push(apiCheck);
    }

    const summary = {
      healthy: checks.filter(c => c.status === 'healthy').length,
      unhealthy: checks.filter(c => c.status === 'unhealthy').length,
      degraded: checks.filter(c => c.status === 'degraded').length,
      totalResponseTime: Date.now() - startTime
    };

    // Determine overall status
    let overallStatus: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';
    if (summary.unhealthy > 0) {
      overallStatus = 'unhealthy';
    } else if (summary.degraded > 0) {
      overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      version: process.env.APP_VERSION || '2.0.0',
      environment: process.env.NODE_ENV || 'production',
      checks,
      summary
    };
  }

  /**
   * Quick readiness check for Render (uses cached data)
   */
  async performReadinessCheck(): Promise<{ ready: boolean; message: string; responseTime: number }> {
    const startTime = Date.now();
    
    try {
      // Use cached health report for fast response
      const healthReport = await this.performHealthCheck();
      
      // Consider ready if no unhealthy critical services (DB, Redis)
      const criticalChecks = healthReport.checks.filter(check => 
        check.name === 'database' || check.name === 'redis'
      );
      
      const hasUnhealthyCritical = criticalChecks.some(check => check.status === 'unhealthy');
      const ready = !hasUnhealthyCritical && healthReport.status !== 'unhealthy';
      
      return {
        ready,
        message: ready 
          ? 'Service is ready to accept traffic' 
          : 'Service not ready - critical dependencies unhealthy',
        responseTime: Date.now() - startTime
      };
    } catch (error) {
      return {
        ready: false,
        message: `Readiness check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        responseTime: Date.now() - startTime
      };
    }
  }

  /**
   * Database connectivity check
   */
  private async checkDatabase(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      const db = getDatabase();
      const sql = db.getSQL();
      
      // Simple connectivity test
      const result = await sql`SELECT 1 as test, now() as timestamp`;
      
      if (result.length > 0 && result[0].test === 1) {
        return {
          name: 'database',
          status: 'healthy',
          responseTime: Date.now() - startTime,
          details: {
            timestamp: result[0].timestamp,
            connectionPool: 'active'
          }
        };
      } else {
        return {
          name: 'database',
          status: 'unhealthy',
          responseTime: Date.now() - startTime,
          message: 'Database query returned unexpected result'
        };
      }
      
    } catch (error) {
      return {
        name: 'database',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        message: `Database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Redis connectivity check
   */
  private async checkRedis(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      const redisManager = getRedisConnectionManager();
      const redis = await redisManager.getConnection(RedisUsageType.HEALTH_CHECK);
      
      // Test basic operations
      const testKey = `health_check_${Date.now()}`;
      const testValue = 'ok';
      
      await redis.setex(testKey, 10, testValue);
      const retrieved = await redis.get(testKey);
      await redis.del(testKey);
      
      if (retrieved === testValue) {
        // Get connection stats
        const stats = redisManager.getConnectionStats();
        
        return {
          name: 'redis',
          status: 'healthy',
          responseTime: Date.now() - startTime,
          details: {
            activeConnections: stats.activeConnections,
            totalConnections: stats.totalConnections,
            averageHealthScore: stats.averageHealthScore
          }
        };
      } else {
        return {
          name: 'redis',
          status: 'unhealthy',
          responseTime: Date.now() - startTime,
          message: 'Redis read/write test failed'
        };
      }
      
    } catch (error) {
      return {
        name: 'redis',
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        message: `Redis connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Memory usage check
   */
  private async checkMemory(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      const memUsage = process.memoryUsage();
      const totalMB = Math.round(memUsage.rss / 1024 / 1024);
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
      
      // Alert if using more than 400MB for Render free tier
      const memoryThresholdMB = parseInt(process.env.MEMORY_THRESHOLD_MB || '400');
      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      
      if (totalMB > memoryThresholdMB * 1.5) {
        status = 'unhealthy';
      } else if (totalMB > memoryThresholdMB) {
        status = 'degraded';
      }
      
      return {
        name: 'memory',
        status,
        responseTime: Date.now() - startTime,
        message: status !== 'healthy' ? `Memory usage: ${totalMB}MB (threshold: ${memoryThresholdMB}MB)` : undefined,
        details: {
          rss: `${totalMB}MB`,
          heapUsed: `${heapUsedMB}MB`,
          heapTotal: `${heapTotalMB}MB`,
          thresholdMB: memoryThresholdMB
        }
      };
      
    } catch (error) {
      return {
        name: 'memory',
        status: 'degraded',
        responseTime: Date.now() - startTime,
        message: `Memory check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * External APIs availability check (lightweight)
   */
  private async checkExternalAPIs(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      // Light DNS check only - 2 second timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      try {
        const response = await fetch('https://graph.facebook.com/', {
          method: 'HEAD',
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        return {
          name: 'external_apis',
          status: 'healthy',
          responseTime: Date.now() - startTime,
          details: { facebook_graph: 'reachable' }
        };
        
      } catch (fetchError) {
        clearTimeout(timeoutId);
        
        return {
          name: 'external_apis',
          status: 'degraded',
          responseTime: Date.now() - startTime,
          message: 'External API connectivity degraded'
        };
      }
      
    } catch (error) {
      return {
        name: 'external_apis',
        status: 'degraded',
        responseTime: Date.now() - startTime,
        message: 'External API check failed'
      };
    }
  }
}

// Singleton instance with proper cleanup
let healthCheckInstance: HealthCheckService | null = null;

export function getHealthCheckService(): HealthCheckService {
  if (!healthCheckInstance) {
    healthCheckInstance = new HealthCheckService();
    
    // Register cleanup for multiple shutdown signals
    const cleanup = () => {
      if (healthCheckInstance) {
        healthCheckInstance.stopBackgroundUpdates();
      }
    };
    process.once('beforeExit', cleanup);
    process.once('SIGTERM', cleanup);
    process.once('SIGINT', cleanup);
  }
  return healthCheckInstance;
}

/**
 * For testing or explicit cleanup
 */
export function resetHealthCheckService(): void {
  if (healthCheckInstance) {
    healthCheckInstance.stopBackgroundUpdates();
    healthCheckInstance = null;
  }
}

export default getHealthCheckService;