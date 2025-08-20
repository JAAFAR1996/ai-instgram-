// src/services/health-check.ts

export type HealthSnapshot = {
  ok: boolean;
  redisResponseTime: number | null;
  queueStats: { waiting: number; active: number; errorRate: number };
  circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  totalConnections: number;
  ts: number; // epoch ms
  reason?: string;
};

const TTL_MS = 10_000;           // صلاحية الكاش
const CHECK_TIMEOUT_MS = 8_000;  // مهلة الفحص

let cache: HealthSnapshot | null = null;
let inflight: Promise<HealthSnapshot> | null = null;

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

async function performChecks(): Promise<HealthSnapshot> {
  const t0 = Date.now();
  
  try {
    // استيراد ديناميكي لتجنب المراجع الدائرية
    const { getQueueManager } = await import('../queue/queue-manager.js');
    const qm = getQueueManager();

    // قياس Redis response time (محاكاة)
    const redisStart = Date.now();
    const stats = await qm.getStats();
    const redisResponseTime = Date.now() - redisStart;

    // تحويل إحصائيات الطابور للشكل المطلوب
    const queueStats = {
      waiting: stats.queue.waiting || 0,
      active: stats.queue.active || 0,
      errorRate: stats.performance.errorRate || 0
    };

    // تحديد حالة دائرة الحماية بناءً على صحة النظام
    const circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 
      stats.health === 'healthy' ? 'CLOSED' : 
      stats.health === 'degraded' ? 'HALF_OPEN' : 'OPEN';

    return {
      ok: stats.health !== 'unhealthy',
      redisResponseTime,
      queueStats,
      circuitState,
      totalConnections: stats.processors.registered || 1,
      ts: Date.now(),
    };
  } catch (error) {
    return {
      ok: false,
      redisResponseTime: null,
      queueStats: { waiting: 0, active: 0, errorRate: 100 },
      circuitState: 'OPEN',
      totalConnections: 0,
      ts: Date.now(),
      reason: String(error?.message || error),
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

export async function getHealthCached(): Promise<HealthSnapshot> {
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
        const failed: HealthSnapshot = {
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
export function getLastSnapshot(): HealthSnapshot | null {
  return cache;
}