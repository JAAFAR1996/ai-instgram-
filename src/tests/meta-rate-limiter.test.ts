import { describe, expect, test } from 'vitest';
import { MetaRateLimiter } from '../services/meta-rate-limiter.ts';

class FakeMulti {
  private store: Map<string, Set<string>>;
  private zcardKey = '';

  constructor(store: Map<string, Set<string>>) {
    this.store = store;
  }

  zremrangebyscore(_key: string, _min: number, _max: number) {
    return this;
  }

  zadd(key: string, _score: number, member: string) {
    if (!this.store.has(key)) {
      this.store.set(key, new Set());
    }
    this.store.get(key)!.add(member);
    return this;
  }

  zcard(key: string) {
    this.zcardKey = key;
    return this;
  }

  expire(_key: string, _seconds: number) {
    return this;
  }

  async exec() {
    const size = this.store.get(this.zcardKey)?.size ?? 0;
    return [[null, 0], [null, 1], [null, size], [null, 1]];
  }
}

class FakeRedis {
  public store = new Map<string, Set<string>>();
  multi() {
    return new FakeMulti(this.store);
  }
}

class FakeRedisManager {
  public connection = new FakeRedis();
  async getConnection() {
    return this.connection;
  }
}

describe('MetaRateLimiter', () => {
  test('generates unique members for successive zadd operations', async () => {
    const limiter = new MetaRateLimiter();
    (limiter as any).redis = new FakeRedisManager();

    const key = 'test';
    const windowMs = 1000;
    const max = 10;

    await limiter.checkRedisRateLimit(key, windowMs, max);
    await limiter.checkRedisRateLimit(key, windowMs, max);

    const store = (limiter as any).redis.connection.store as Map<string, Set<string>>;
    const firstKey = Array.from(store.keys())[0];
    const members = Array.from(store.get(firstKey) ?? []);

    expect(members.length).toBe(2);
    const unique = new Set(members);
    expect(unique.size).toBe(members.length);
  });
});