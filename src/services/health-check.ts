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

import { redisRWProbe } from './RedisHealthChecker.js';
// add db probe here if needed

async function compute(): Promise<HealthSnapshot> {
  const details: Record<string, unknown> = {};
  const redis = await redisRWProbe().catch((e) => ({ ok: false, error: e.message }));
  details.redis = redis;
  const ok = (redis as any).ok === true;
  return {
    ready: ok,
    status: ok ? 'ok' : 'degraded',
    lastUpdated: Date.now(),
    details,
  };
}

export function startHealth(refreshMs = 2000) {
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