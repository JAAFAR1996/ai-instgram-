import { getRedisConnectionManager } from './RedisConnectionManager.js';
import { RedisUsageType } from '../config/RedisConfigurationFactory.js';
import { performHealthCheck } from './RedisSimpleHealthCheck.js';
import { getManyChatService } from './manychat-api.js';

// Health check result types
export interface HealthCheckResult {
  ok: boolean;
  error?: string;
  latencyMs?: number;
}

export interface DatabaseHealthResult {
  ok: boolean;
  connected: boolean;
  error?: string;
}

export interface MemoryHealthResult {
  heapUsedMB: number;
  heapTotalMB: number;
  usagePercent: number;
  ok: boolean;
}

export interface HealthDetails {
  redis: HealthCheckResult;
  database: DatabaseHealthResult;
  memory: MemoryHealthResult;
  manychat?: HealthCheckResult;
}

export type HealthSnapshot = {
  ready: boolean;
  status: 'ok' | 'degraded';
  lastUpdated: number;
  details: HealthDetails;
};

let snapshot: HealthSnapshot = {
  ready: false,
  status: 'degraded',
  lastUpdated: 0,
  details: {
    redis: { ok: false },
    database: { ok: false, connected: false },
    memory: { heapUsedMB: 0, heapTotalMB: 0, usagePercent: 0, ok: false },
    manychat: { ok: false }
  },
};
let timer: NodeJS.Timeout | null = null;

// Simple Redis health probe using existing function
async function redisHealthProbe(): Promise<HealthCheckResult> {
  // إضافة فحص المتغير:
  if (process.env.SKIP_REDIS_HEALTH_CHECK === 'true') {
    return { ok: true }; // تجاهل health check
  }
  
  try {
    const manager = getRedisConnectionManager();
    const result = await manager.safeRedisOperation(
      RedisUsageType.HEALTH_CHECK,
      async (redis) => {
        const healthResult = await performHealthCheck(redis);
        return {
          ok: healthResult.success,
          ...(healthResult.latency && { latencyMs: healthResult.latency }),
          ...(healthResult.error && { error: healthResult.error })
        };
      }
    );
    
    if (result.ok && result.result) {
      return result.result;
    }
    return { ok: false, error: result.reason || 'Unknown error' };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown Redis error';
    return { ok: false, error: errorMessage };
  }
}

// Enhanced database health check with URL validation
async function databaseHealthProbe(): Promise<DatabaseHealthResult> {
  try {
    // First validate DATABASE_URL
    const { validateDatabaseUrl } = await import('../db/validate-database-url.js');
    const validation = validateDatabaseUrl(process.env.DATABASE_URL);
    
    if (!validation.isValid) {
      return { 
        ok: false, 
        connected: false, 
        error: `DATABASE_URL validation failed: ${validation.error}` 
      };
    }

    // Then test actual connection with recovery
    const { getDatabaseWithRecovery } = await import('../db/adapter.js');
    const db = await getDatabaseWithRecovery();
    const dbHealthy = await db.health();
    return { ok: dbHealthy, connected: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown database error';
    return { ok: false, connected: false, error: errorMessage };
  }
}

// Simple memory health check
function memoryHealthProbe(): MemoryHealthResult {
  const memUsage = process.memoryUsage();
  const memPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
  return {
    heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
    usagePercent: Math.round(memPercent),
    ok: memPercent < 90
  };
}

// ManyChat health probe
async function manychatHealthProbe(): Promise<HealthCheckResult> {
  try {
    const manyChatService = getManyChatService();
    const healthStatus = await manyChatService.getHealthStatus();
    const result: HealthCheckResult = {
      ok: healthStatus.status === 'healthy'
    };
    if (healthStatus.status !== 'healthy') {
      result.error = 'Circuit breaker issues';
    }
    return result;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'ManyChat service unavailable'
    };
  }
}

async function compute(): Promise<HealthSnapshot> {
  // فحص جميع الخدمات بالتوازي
  const [redis, database, memory, manychat] = await Promise.all([
    redisHealthProbe().catch((e) => ({ 
      ok: false, 
      error: e instanceof Error ? e.message : 'Unknown error' 
    })),
    databaseHealthProbe().catch((e) => ({ 
      ok: false, 
      connected: false,
      error: e instanceof Error ? e.message : 'Unknown error' 
    })),
    Promise.resolve(memoryHealthProbe()),
    manychatHealthProbe().catch((e) => ({
      ok: false,
      error: e instanceof Error ? e.message : 'ManyChat health check failed'
    }))
  ]);
  
  const details: HealthDetails = { redis, database, memory, manychat };
  
  // تحديد الحالة العامة
  const redisOk = details.redis.ok === true;
  const dbOk = details.database.ok === true;
  const memOk = details.memory.ok === true;
  const manychatOk = details.manychat?.ok === true;
  
  // Render يتطلب فقط database ليكون ready
  const isRender = process.env.IS_RENDER === 'true' || process.env.RENDER === 'true';
  const ok = isRender ? dbOk : (redisOk && dbOk && memOk && manychatOk);
  
  return {
    ready: ok,
    status: ok ? 'ok' : 'degraded',
    lastUpdated: Date.now(),
    details,
  };
}

export function startHealth(refreshMs = 30000) { // 30 ثانية لـ Render
  if (timer) return;
  const tick = async () => {
    try { 
      snapshot = await compute(); 
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown health check error';
      snapshot = { 
        ready: false, 
        status: 'degraded', 
        lastUpdated: Date.now(), 
        details: {
          redis: { ok: false, error: errorMessage },
          database: { ok: false, connected: false, error: errorMessage },
          memory: { heapUsedMB: 0, heapTotalMB: 0, usagePercent: 0, ok: false },
          manychat: { ok: false, error: errorMessage }
        }
      };
    }
  };
  void tick();
  timer = setInterval(tick, refreshMs);
  // make interval unref to not block process exit on Render
  if (timer && typeof timer.unref === 'function') {
    timer.unref();
  }
}

export function stopHealth() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function getHealthSnapshot(): HealthSnapshot {
  return snapshot;
}

/**
 * Reset ManyChat circuit breaker for recovery
 */
export function resetManyChatCircuitBreaker(): void {
  try {
    const manyChatService = getManyChatService();
    manyChatService.resetCircuitBreaker();
    console.log('✅ ManyChat circuit breaker reset successfully');
  } catch (error) {
    console.error('❌ Failed to reset ManyChat circuit breaker:', error);
  }
}