import Redis from 'ioredis';

const url = process.env.REDIS_URL ?? '';

let servername: string | undefined;
try {
  const parsed = new URL(url);
  servername = parsed.hostname;
} catch {
  servername = undefined;
}

const forceTLS = url.startsWith('rediss://') || process.env.REDIS_FORCE_TLS === 'true';

export const redis = new Redis(url, {
  family: 4,
  keepAlive: 10_000,
  noDelay: true,
  connectTimeout: 5_000,
  maxRetriesPerRequest: null as unknown as number | null, // Required with BullMQ
  enableReadyCheck: false, // Reduce "Connection is closed" races
  retryStrategy: (times) => Math.min(2000, 200 + times * 200),
  ...(forceTLS ? { tls: { rejectUnauthorized: false, ...(servername ? { servername } : {}) } } : {}),
});

export default redis;

