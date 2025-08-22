// src/services/health-check.ts

export type HealthSnapshot = {
  ready: boolean;
  status: 'ok' | 'degraded';
  lastUpdated: number;
  details: Record<string, unknown>;
};

let SNAPSHOT: HealthSnapshot = {
  ready: false,
  status: 'degraded',
  lastUpdated: Date.now(),
  details: { reason: 'cold start' },
};

export function getHealthSnapshot(): HealthSnapshot {
  return SNAPSHOT;
}

export function setHealthSnapshot(partial: Partial<HealthSnapshot>) {
  SNAPSHOT = { ...SNAPSHOT, ...partial, lastUpdated: Date.now() };
}

export async function startHealthMonitoring(deps: {
  redisReady: () => Promise<boolean> | boolean;
  queueReady: () => Promise<boolean> | boolean;
}) {
  const [r, q] = await Promise.all([deps.redisReady(), deps.queueReady()]);
  setHealthSnapshot({
    ready: r && q,
    status: r && q ? 'ok' : 'degraded',
    details: { redis: r, queue: q },
  });
  const interval = setInterval(async () => {
    const [r2, q2] = await Promise.all([deps.redisReady(), deps.queueReady()]);
    setHealthSnapshot({
      ready: r2 && q2,
      status: r2 && q2 ? 'ok' : 'degraded',
      details: { redis: r2, queue: q2 },
    });
  }, 5000);
  interval.unref();
}

export function registerHealthRoute(app: any) {
  app.get('/health', async (c: any) => {
    if (process.env.HEALTH_FORCE_OK === '1') {
      return c.json(
        { ...getHealthSnapshot(), ready: true, status: 'ok', details: { forced: true } },
        200
      );
    }
    
    // Get production metrics
    const snap = getHealthSnapshot();
    const legacy = await getHealthCached();
    
    const productionHealth = {
      ...snap,
      redis: {
        available: legacy.circuitState === 'CLOSED',
        responseTime: legacy.redisResponseTime,
        circuitState: legacy.circuitState
      },
      queue: {
        waiting: legacy.queueStats.waiting,
        active: legacy.queueStats.active,
        errorRate: legacy.queueStats.errorRate
      },
      database: {
        connections: legacy.totalConnections,
        healthy: legacy.ok
      },
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development'
    };
    
    // Always return 200 for load balancers, include actual status in body
    return c.json(productionHealth, 200);
  });
}

// Legacy compatibility
export type HealthSnapshotLegacy = {
  ok: boolean;
  redisResponseTime: number | null;
  queueStats: { waiting: number; active: number; errorRate: number };
  circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  totalConnections: number;
  ts: number;
  reason?: string;
};

const TTL_MS = 10_000;
const CHECK_TIMEOUT_MS = 8_000;

let cache: HealthSnapshotLegacy | null = null;
let inflight: Promise<HealthSnapshotLegacy> | null = null;

function settleOnce<T>() {
  let settled = false;
  return {
    guardResolve:
      (resolve: (v: T) => void, reject: (e: any) => void, clear?: () => void) =>
      (v: T) => {
        if (settled) return;
        settled = true;
        clear?.();
        resolve(v);
      },
    guardReject:
      (resolve: (v: T) => void, reject: (e: any) => void, clear?: () => void) =>
      (e: any) => {
        if (settled) return;
        settled = true;
        clear?.();
        reject(e);
      },
  };
}

async function performChecks(): Promise<HealthSnapshotLegacy> {
  const t0 = Date.now();
  
  try {
    // استيراد ديناميكي لتجنب المراجع الدائرية
    const { getQueueManager } = await import('../queue/queue-manager.js');
    const qm = getQueueManager();

    // فحص صحة الطابور مع معالجة Redis rate limit
    let stats;
    let redisResponseTime = null;
    let circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
    
    try {
      const redisStart = Date.now();
      stats = await qm.getStats();
      redisResponseTime = Date.now() - redisStart;
      
      // تحديد حالة دائرة الحماية بناءً على صحة النظام
      circuitState = 
        stats.health === 'healthy' ? 'CLOSED' : 
        stats.health === 'degraded' ? 'HALF_OPEN' : 'OPEN';
        
    } catch (error) {
      // إذا فشل الاتصال بـ Redis، نعتبر النظام يعمل في fallback mode
      if (error?.message?.includes('max requests limit') || 
          error?.message?.includes('rate limit')) {
        // Redis rate limit - النظام يعمل لكن بدون Redis
        return {
          ok: true, // النظام يعمل
          redisResponseTime: null,
          queueStats: { waiting: 0, active: 0, errorRate: 0 },
          circuitState: 'OPEN', // Redis معطل
          totalConnections: 0,
          ts: Date.now(),
          reason: 'Redis rate limit - fallback mode active'
        };
      }
      throw error; // أخطاء أخرى
    }

    // تحويل إحصائيات الطابور للشكل المطلوب
    const queueStats = {
      waiting: stats?.queue?.waiting || 0,
      active: stats?.queue?.active || 0,
      errorRate: stats?.performance?.errorRate || 0
    };

    return {
      ok: (stats?.health !== 'unhealthy') || redisResponseTime !== null,
      redisResponseTime,
      queueStats,
      circuitState,
      totalConnections: stats?.processors?.registered || 1,
      ts: Date.now(),
    };
  } catch (error) {
    // فشل كامل - لكن نحاول معرفة السبب
    const errorMsg = String(error?.message || error);
    const isRedisIssue = errorMsg.includes('redis') || errorMsg.includes('Redis') || 
                        errorMsg.includes('rate limit') || errorMsg.includes('connection');
    
    return {
      ok: false,
      redisResponseTime: null,
      queueStats: { waiting: 0, active: 0, errorRate: isRedisIssue ? 0 : 100 },
      circuitState: 'OPEN',
      totalConnections: 0,
      ts: Date.now(),
      reason: isRedisIssue ? `Redis issue: ${errorMsg}` : errorMsg,
    };
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number, reason: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const { guardResolve, guardReject } = settleOnce<T>();
    const timer = setTimeout(
      guardReject(resolve, reject, () => clearTimeout(timer)),
      ms,
      new Error(reason)
    );
    p.then(guardResolve(resolve, reject, () => clearTimeout(timer)))
     .catch(guardReject(resolve, reject, () => clearTimeout(timer)));
  });
}

export async function getHealthCached(): Promise<HealthSnapshotLegacy> {
  const now = Date.now();
  if (cache && now - cache.ts <= TTL_MS) return cache;

  if (!inflight) {
    inflight = withTimeout(performChecks(), CHECK_TIMEOUT_MS, 'Health check timeout')
      .then(snap => {
        cache = snap;
        return snap;
      })
      .catch(err => {
        // لا نعيد رمي الخطأ مباشرة. نحافظ على لقطة فاشلة مفيدة
        const failed: HealthSnapshotLegacy = {
          ok: false,
          redisResponseTime: null,
          queueStats: { waiting: 0, active: 0, errorRate: 0 },
          circuitState: 'OPEN',
          totalConnections: 0,
          ts: Date.now(),
          reason: String(err?.message || err),
        };
        cache = failed;
        return failed;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

// لقطة جاهزة سريعاً لواجهة /health
export function getLastSnapshot(): HealthSnapshotLegacy | null {
  return cache;
}