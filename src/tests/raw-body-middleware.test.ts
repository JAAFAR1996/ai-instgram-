import { describe, test, expect } from 'vitest';
import { Hono } from 'hono';

// Minimal reproduction of the webhook raw body middleware
function createApp() {
  const app = new Hono();

  app.use('/webhooks/*', async (c, next) => {
    if (c.req.method === 'POST') {
      const clone = c.req.raw.clone();
      const rawBody = Buffer.from(await clone.arrayBuffer());
      c.set('rawBody', rawBody);
      Object.defineProperty(c, 'req', {
        value: new Request(c.req.raw, { body: rawBody }),
        writable: true,
      });
    }
    await next();
  });

  app.post('/webhooks/test', async (c) => {
    const body = await c.req.text();
    const raw = c.get('rawBody') as Buffer;
    return c.json({ body, raw: raw.toString('utf8') });
  });

  return app;
}

describe('Webhook raw body middleware', () => {
  test('next handler receives the full body', async () => {
    const app = createApp();
    const payload = JSON.stringify({ foo: 'bar' });
    const res = await app.request('http://localhost/webhooks/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.body).toBe(payload);
    expect(data.raw).toBe(payload);
  });
});