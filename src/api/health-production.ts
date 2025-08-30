/**
 * ===============================================
 * Production Health Check API
 * Comprehensive health monitoring for ManyChat integration
 * ===============================================
 */

// Using any types for Fastify to avoid import issues
type FastifyInstance = any;
type FastifyRequest = any; 
type FastifyReply = any;
import { getDatabase } from '../db/adapter.js';
import { getInstagramManyChatBridge } from '../services/instagram-manychat-bridge.js';
import { getManyChatService } from '../services/manychat-api.js';
import { getLogger } from '../services/logger.js';

const logger = getLogger({ component: 'HealthProductionAPI' });

interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  component: string;
  details?: Record<string, unknown>;
  timestamp: string;
  responseTime?: number;
}

interface ProductionHealthStatus {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  checks: HealthCheckResult[];
  summary: {
    healthy: number;
    degraded: number;
    unhealthy: number;
    total: number;
  };
  deployment: {
    commit?: string;
    timestamp: string;
    uptime: string;
  };
}

export async function setupProductionHealthAPI(fastify: FastifyInstance) {
  
  /**
   * Comprehensive production health check
   */
  fastify.get('/health/production', async (_request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    const checks: HealthCheckResult[] = [];
    
    try {
      logger.info('🔍 Running production health check');
      
      // 1. Database Health Check
      const dbCheck = await checkDatabaseHealth();
      checks.push(dbCheck);
      
      // 2. Required Tables Check
      const tablesCheck = await checkRequiredTables();
      checks.push(tablesCheck);
      
      // 3. ManyChat Service Health
      const manyChatCheck = await checkManyChatHealth();
      checks.push(manyChatCheck);
      
      // 4. Instagram Bridge Health
      const bridgeCheck = await checkBridgeHealth();
      checks.push(bridgeCheck);
      
      // 5. Circuit Breaker Status
      const circuitCheck = await checkCircuitBreakerStatus();
      checks.push(circuitCheck);
      
      // Calculate overall status
      const summary = {
        healthy: checks.filter(c => c.status === 'healthy').length,
        degraded: checks.filter(c => c.status === 'degraded').length,
        unhealthy: checks.filter(c => c.status === 'unhealthy').length,
        total: checks.length
      };
      
      let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      if (summary.unhealthy > 0) {
        overallStatus = 'unhealthy';
      } else if (summary.degraded > 0) {
        overallStatus = 'degraded';
      }
      
      const response: ProductionHealthStatus = {
        overall: overallStatus,
        checks,
        summary,
        deployment: {
          commit: process.env.RENDER_GIT_COMMIT?.substring(0, 8) || 'unknown',
          timestamp: new Date().toISOString(),
          uptime: `${Math.floor(process.uptime())} seconds`
        }
      };
      
      const statusCode = overallStatus === 'healthy' ? 200 : 
                        overallStatus === 'degraded' ? 200 : 503;
      
      logger.info(`✅ Production health check completed`, {
        overall: overallStatus,
        healthy: summary.healthy,
        degraded: summary.degraded,
        unhealthy: summary.unhealthy,
        responseTime: Date.now() - startTime
      });
      
      return reply.status(statusCode).send(response);
      
    } catch (error) {
      logger.error('❌ Production health check failed', error);
      
      return reply.status(500).send({
        overall: 'unhealthy',
        checks: [{
          status: 'unhealthy' as const,
          component: 'health-check',
          details: { error: error instanceof Error ? error.message : String(error) },
          timestamp: new Date().toISOString()
        }],
        summary: { healthy: 0, degraded: 0, unhealthy: 1, total: 1 },
        deployment: {
          commit: process.env.RENDER_GIT_COMMIT?.substring(0, 8) || 'unknown',
          timestamp: new Date().toISOString(),
          uptime: `${Math.floor(process.uptime())} seconds`
        }
      });
    }
  });

  /**
   * Quick health check for load balancers
   */
  fastify.get('/health/quick', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const db = getDatabase();
      await db.query('SELECT 1');
      
      return reply.send({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    } catch (error) {
      return reply.status(503).send({
        status: 'unhealthy',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
    }
  });
}

// Helper functions for health checks

async function checkDatabaseHealth(): Promise<HealthCheckResult> {
  const startTime = Date.now();
  
  try {
    const db = getDatabase();
    await db.query('SELECT 1');
    
    return {
      status: 'healthy',
      component: 'database',
      details: { connection: 'active' },
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      component: 'database',
      details: { error: error instanceof Error ? error.message : String(error) },
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime
    };
  }
}

async function checkRequiredTables(): Promise<HealthCheckResult> {
  const startTime = Date.now();
  
  try {
    const db = getDatabase();
    const requiredTables = ['messages', 'message_followups'];
    const missingTables: string[] = [];
    
    for (const table of requiredTables) {
      try {
        await db.query(`SELECT 1 FROM ${table} LIMIT 1`);
      } catch (error) {
        if (error instanceof Error && error.message.includes('does not exist')) {
          missingTables.push(table);
        }
      }
    }
    
    if (missingTables.length === 0) {
      return {
        status: 'healthy',
        component: 'database-tables',
        details: { tables: requiredTables, status: 'all_exist' },
        timestamp: new Date().toISOString(),
        responseTime: Date.now() - startTime
      };
    } else {
      return {
        status: 'unhealthy',
        component: 'database-tables',
        details: { 
          missing: missingTables,
          required: requiredTables,
          message: 'Run database migration to create missing tables'
        },
        timestamp: new Date().toISOString(),
        responseTime: Date.now() - startTime
      };
    }
  } catch (error) {
    return {
      status: 'unhealthy',
      component: 'database-tables',
      details: { error: error instanceof Error ? error.message : String(error) },
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime
    };
  }
}

async function checkManyChatHealth(): Promise<HealthCheckResult> {
  const startTime = Date.now();
  
  try {
    const manyChatService = getManyChatService();
    const health = await manyChatService.getHealthStatus();
    
    return {
      status: health.status === 'healthy' ? 'healthy' : 
              health.status === 'degraded' ? 'degraded' : 'unhealthy',
      component: 'manychat-service',
      details: {
        circuitBreaker: health.circuitBreaker || 'unknown',
        rateLimit: health.rateLimit || { current: 0, limit: 100 }
      },
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      component: 'manychat-service',
      details: { error: error instanceof Error ? error.message : String(error) },
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime
    };
  }
}

async function checkBridgeHealth(): Promise<HealthCheckResult> {
  const startTime = Date.now();
  
  try {
    const bridge = getInstagramManyChatBridge();
    const health = await bridge.getHealthStatus();
    
    return {
      status: health.status,
      component: 'instagram-bridge',
      details: {
        manyChat: health.manyChat?.status || 'unknown',
        localAI: health.localAI,
        instagram: health.instagram
      },
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      component: 'instagram-bridge',
      details: { error: error instanceof Error ? error.message : String(error) },
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime
    };
  }
}

async function checkCircuitBreakerStatus(): Promise<HealthCheckResult> {
  const startTime = Date.now();
  
  try {
    const manyChatService = getManyChatService();
    const health = await manyChatService.getHealthStatus();
    
    const cbState = health.circuitBreaker?.state || 'unknown';
    const isHealthy = cbState === 'CLOSED';
    const isDegraded = cbState === 'HALF_OPEN';
    
    return {
      status: isHealthy ? 'healthy' : isDegraded ? 'degraded' : 'unhealthy',
      component: 'circuit-breaker',
      details: {
        state: cbState,
        status: health.status
      },
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      component: 'circuit-breaker',
      details: { error: error instanceof Error ? error.message : String(error) },
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime
    };
  }
}