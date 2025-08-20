/**
 * Tests for inputSanitizationMiddleware
 */

import { describe, test, expect } from 'bun:test';
import { Hono } from 'hono';
import { inputSanitizationMiddleware } from '../middleware/enhanced-security.js';

describe('inputSanitizationMiddleware', () => {
  test('removes script tag from query parameter', async () => {
    const app = new Hono();
    app.use('*', inputSanitizationMiddleware());
    app.get('/', (c) => {
      return c.json({ q: c.req.query('q') });
    });

    const res = await app.request('/?q=<script>alert(1)</script>');
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.q).toBe('');
  });
});