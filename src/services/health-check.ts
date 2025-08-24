export type HealthSnapshot = {
  ready: boolean;
  status: 'ok' | 'degraded';
  lastUpdated: number;
  details: Record<string, unknown>;
};

let snapshot: HealthSnapshot = {
  ready: false,
  status: 'degraded',
  lastUpdated: 0,
  details: {},
};
let timer: NodeJS.Timeout | null = null;

import { getRedisConnectionManager } from './RedisConnectionManager.js';
import { RedisUsageType } from '../config/RedisConfigurationFactory.js';

// Simple Redis health probe (simplified from RedisHealthChecker)
async function redisHealthProbe() {
  try {
    const manager = getRedisConnectionManager();
    const result = await manager.safeRedisOperation(
      'health_check',
      RedisUsageType.HEALTH_CHECK,
      async (redis) => {
        const key = `hc:${Date.now()}`;
        const value = 'health_check';
        const start = Date.now();
        
        await redis.set(key, value, 'EX', 5);
        const got = await redis.get(key);
        await redis.del(key);
        
        const latencyMs = Date.now() - start;
        return { ok: got === value, latencyMs };
      }
    );
    
    return result.ok ? result.result : { ok: false, error: result.reason };
  } catch (error: any) {
    return { ok: false, error: error.message };
  }
}

async function compute(): Promise<HealthSnapshot> {
  const details: Record<string, unknown> = {};
  
  // فحص Redis
  const redis = await redisHealthProbe().catch((e) => ({ ok: false, error: e.message }));
  details.redis = redis;
  
  // فحص Database (بسيط لـ Render)
  try {
    const { getDatabase } = await import('../db/adapter.js');
    const db = getDatabase();
    const dbHealthy = await db.health();
    details.database = { ok: dbHealthy, connected: true };
  } catch (error: unknown) {
    details.database = { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
  
  // فحص الذاكرة (مهم لـ Render free tier)
  const memUsage = process.memoryUsage();
  const memPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
  details.memory = {
    heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
    usagePercent: Math.round(memPercent),
    ok: memPercent < 90
  };
  
  // تحديد الحالة العامة
  const redisOk = (redis as any).ok === true;
  const dbOk = (details.database as any).ok === true;
  const memOk = (details.memory as any).ok === true;
  
  // Render يتطلب فقط database ليكون ready
  const isRender = process.env.IS_RENDER === 'true' || process.env.RENDER === 'true';
  const ok = isRender ? dbOk : (redisOk && dbOk && memOk);
  
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
    try { snapshot = await compute(); } catch (e: any) {
      snapshot = { ready: false, status: 'degraded', lastUpdated: Date.now(), details: { error: e?.message } };
    }
  };
  void tick();
  timer = setInterval(tick, refreshMs);
  // make interval unref to not block process exit on Render
  (timer as any).unref?.();
}

export function stopHealth() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function getHealthSnapshot(): HealthSnapshot {
  return snapshot;
}