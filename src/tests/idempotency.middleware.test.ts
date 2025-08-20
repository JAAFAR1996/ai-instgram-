import { describe, test, expect, mock } from 'bun:test';

// Mock Redis connection manager to avoid actual Redis dependency
mock.module('../services/RedisConnectionManager.js', () => ({
  getRedisConnectionManager: () => ({
    getConnection: async () => ({
      get: async () => null,
      setex: async () => {}
    })
  })
}));

const { Hono } = await import('hono');
const { default: createIdempotencyMiddleware } = await import('../middleware/idempotency.ts');

describe('Idempotency middleware body handling', () => {
  test('preserves body for downstream handlers', async () => {
    const app = new Hono();
    app.use('*', createIdempotencyMiddleware());
    app.post('/echo', async c => {
      const body = await c.req.text();
      return c.json({ body });
    });

    const res = await app.request('/echo', {
      method: 'POST',
      body: 'hello world',
      headers: {
        'Content-Type': 'text/plain',
        'x-merchant-id': 'merchant-1'
      }
    });

    const data = await res.json();
    expect(data.body).toBe('hello world');
  });
});