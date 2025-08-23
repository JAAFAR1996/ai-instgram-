import Redis from 'ioredis';
import crypto from 'node:crypto';
import { getRedis } from './RedisConnectionManager.js';

export async function redisRWProbe() {
  const client: Redis = getRedis();
  const key = `hc:${crypto.randomUUID()}`;
  const value = String(Date.now());
  const start = Date.now();
  try {
    await client.set(key, value, 'EX', 5);
    const got = await client.get(key);
    await client.del(key);
    const latency = Date.now() - start;
    return { ok: got === value, latencyMs: latency };
  } catch (e: any) {
    return { ok: false, error: e?.message };
  }
}