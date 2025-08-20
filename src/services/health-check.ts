/**
 * ===============================================
 * Comprehensive Health Check Service
 * Production-ready health monitoring for Render deployment
 * ===============================================
 */

import { getDatabase } from '../database/connection';
import { getRedisConnectionManager } from './RedisConnectionManager';
import { RedisUsageType } from '../config/RedisConfigurationFactory';

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

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck(): Promise<HealthReport> {
    const startTime = Date.now();
    const checks: HealthCheck[] = [];

    // Database health check
    checks.push(await this.checkDatabase());
    
    // Redis health check
    checks.push(await this.checkRedis());
    
    // Memory health check
    checks.push(await this.checkMemory());
    
    // External API health check (light check) - skip in restricted environments
    if (process.env.SKIP_EXTERNAL_HEALTH !== '1') {
      checks.push(await this.checkExternalAPIs());
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
   * Quick readiness check for Render
   */
  async performReadinessCheck(): Promise<{ ready: boolean; message: string; responseTime: number }> {
    const startTime = Date.now();
    
    try {
      // Essential checks only - DB and Redis
      const dbCheck = await this.checkDatabase();
      const redisCheck = await this.checkRedis();
      
      const ready = dbCheck.status !== 'unhealthy' && redisCheck.status !== 'unhealthy';
      
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

// Singleton instance
let healthCheckInstance: HealthCheckService | null = null;

export function getHealthCheckService(): HealthCheckService {
  if (!healthCheckInstance) {
    healthCheckInstance = new HealthCheckService();
  }
  return healthCheckInstance;
}

export default getHealthCheckService;