import { describe, test, expect } from 'bun:test';
import RedisConnectionManager from './RedisConnectionManager.js';
import { RedisUsageType, Environment } from '../config/RedisConfigurationFactory.js';
import { RedisRateLimitError } from '../errors/RedisErrors.js';

describe('RedisConnectionManager rate limiting', () => {
  test('blocks connection attempts during rate limit cooldown', async () => {
    const manager = new RedisConnectionManager('redis://localhost:6379', Environment.DEVELOPMENT);
    // simulate rate limit cooldown
    (manager as any).pauseReconnectionsUntil = new Date(Date.now() + 60_000);

    await expect(manager.getConnection(RedisUsageType.HEALTH_CHECK)).rejects.toBeInstanceOf(RedisRateLimitError);
  });
});