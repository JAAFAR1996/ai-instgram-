/**
 * ===============================================
 * Enhanced Security Middleware Tests
 * اختبارات شاملة لـ middleware الأمان المحسن
 * ===============================================
 */

import { describe, test, expect, beforeEach, afterEach, jest } from 'bun:test';
import { Hono, Context } from 'hono';
import { testClient } from 'hono/testing';
import crypto from 'crypto';

import {
  strictCorsMiddleware,
  securityHeadersMiddleware,
  requestValidationMiddleware,
  inputSanitizationMiddleware,
  webhookSignatureMiddleware,
  apiRateLimitMiddleware,
  errorHandlingMiddleware,
  traceMiddleware,
  auditLogMiddleware,
  setupSecurityMiddleware,
  setupGlobalErrorHandlers,
  generateCSPNonce
} from './enhanced-security.js';

// Mock dependencies
jest.mock('../config/environment.js', () => ({
  getConfig: jest.fn(() => ({
    environment: 'test',
    security: {
      corsOrigins: ['https://test.example.com', 'https://ai-instgram.onrender.com']
    },
    instagram: {
      metaAppSecret: 'test-secret-key'
    }
  }))
}));

jest.mock('../services/meta-rate-limiter.js', () => ({
  getMetaRateLimiter: jest.fn(() => ({
    shouldBackOff: jest.fn(() => ({ isBackingOff: false }))
  }))
}));

describe('🔒 Enhanced Security Middleware Tests', () => {
  let app: Hono;
  let client: any;

  beforeEach(() => {
    app = new Hono();
    jest.clearAllMocks();
  });

  describe('generateCSPNonce', () => {
    test('✅ should generate valid CSP nonce', () => {
      const nonce = generateCSPNonce();
      
      expect(nonce).toBeDefined();
      expect(typeof nonce).toBe('string');
      expect(nonce.length).toBeGreaterThan(0);
      
      // Should be base64 encoded
      expect(Buffer.from(nonce, 'base64').toString('base64')).toBe(nonce);
    });

    test('✅ should generate unique nonces', () => {
      const nonce1 = generateCSPNonce();
      const nonce2 = generateCSPNonce();
      
      expect(nonce1).not.toBe(nonce2);
    });
  });

  describe('strictCorsMiddleware', () => {
    beforeEach(() => {
      app.use(strictCorsMiddleware());
      app.get('/', (c) => c.text('OK'));
      client = testClient(app);
    });

    test('✅ should handle same-origin requests', async () => {
      const res = await client.index.$get();
      expect(res.status).toBe(200);
    });

    test('✅ should allow approved origins', async () => {
      const res = await app.request('/', {
        headers: {
          Origin: 'https://ai-instgram.onrender.com'
        }
      });
      
      expect(res.status).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://ai-instgram.onrender.com');
    });

    test('❌ should reject unauthorized origins', async () => {
      const res = await app.request('/', {
        headers: {
          Origin: 'https://malicious-site.com'
        }
      });
      
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });

    test('✅ should handle OPTIONS requests properly', async () => {
      const res = await app.request('/', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://ai-instgram.onrender.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type'
        }
      });
      
      expect(res.status).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
      expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
    });
  });

  describe('securityHeadersMiddleware', () => {
    beforeEach(() => {
      app.use(securityHeadersMiddleware());
      app.get('/', (c) => c.text('OK'));
      client = testClient(app);
    });

    test('✅ should set all required security headers', async () => {
      const res = await client.index.$get();
      
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
      expect(res.headers.get('Permissions-Policy')).toContain('geolocation=()');
    });

    test('✅ should generate and store CSP nonce', async () => {
      let contextNonce: string | undefined;
      
      app.get('/test', (c) => {
        contextNonce = c.get('cspNonce');
        return c.text('OK');
      });
      
      const res = await app.request('/test');
      
      expect(res.status).toBe(200);
      expect(contextNonce).toBeDefined();
      expect(typeof contextNonce).toBe('string');
    });

    test('✅ should remove server identification headers', async () => {
      const res = await client.index.$get();
      
      expect(res.headers.get('Server')).toBe('');
      expect(res.headers.get('X-Powered-By')).toBe('');
    });
  });

  describe('requestValidationMiddleware', () => {
    beforeEach(() => {
      app.use(requestValidationMiddleware());
      app.post('/', (c) => c.text('OK'));
      app.get('/', (c) => c.text('OK'));
      client = testClient(app);
    });

    test('✅ should allow GET requests without content-type', async () => {
      const res = await client.index.$get();
      expect(res.status).toBe(200);
    });

    test('✅ should allow POST with application/json', async () => {
      const res = await app.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ test: 'data' })
      });
      
      expect(res.status).toBe(200);
    });

    test('❌ should reject POST without content-type', async () => {
      const res = await app.request('/', {
        method: 'POST',
        body: 'test data'
      });
      
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe('INVALID_CONTENT_TYPE');
    });

    test('❌ should reject requests that are too large', async () => {
      const largeData = 'x'.repeat(1024 * 1024 + 1); // 1MB + 1 byte
      
      const res = await app.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': largeData.length.toString()
        },
        body: largeData
      });
      
      expect(res.status).toBe(413);
      const data = await res.json();
      expect(data.code).toBe('REQUEST_TOO_LARGE');
    });
  });

  describe('inputSanitizationMiddleware', () => {
    beforeEach(() => {
      app.use(inputSanitizationMiddleware());
      app.get('/', (c) => {
        const query = c.req.query('search');
        return c.text(`Query: ${query}`);
      });
      client = testClient(app);
    });

    test('✅ should pass through clean input', async () => {
      const res = await app.request('/?search=hello%20world');
      
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe('Query: hello world');
    });

    test('✅ should sanitize XSS attempts', async () => {
      const xssPayload = '<script>alert("xss")</script>';
      const res = await app.request(`/?search=${encodeURIComponent(xssPayload)}`);
      
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain('<script>');
      expect(text).not.toContain('alert');
    });

    test('✅ should sanitize javascript: protocol', async () => {
      const jsPayload = 'javascript:alert("xss")';
      const res = await app.request(`/?search=${encodeURIComponent(jsPayload)}`);
      
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain('javascript:');
    });

    test('✅ should sanitize event handlers', async () => {
      const eventPayload = 'onclick=alert("xss")';
      const res = await app.request(`/?search=${encodeURIComponent(eventPayload)}`);
      
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain('onclick=');
    });
  });

  describe('webhookSignatureMiddleware', () => {
    beforeEach(() => {
      app.use(webhookSignatureMiddleware('instagram'));
      app.post('/', async (c) => {
        const validatedBody = c.get('validatedWebhookBody');
        return c.json({ received: true, bodyLength: validatedBody?.length });
      });
      client = testClient(app);
    });

    test('✅ should validate correct webhook signature', async () => {
      const body = JSON.stringify({ test: 'webhook' });
      const secret = 'test-secret-key';
      
      const signature = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('hex');
      
      const res = await app.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': `sha256=${signature}`
        },
        body
      });
      
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.received).toBe(true);
      expect(data.bodyLength).toBe(body.length);
    });

    test('❌ should reject missing signature', async () => {
      const res = await app.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ test: 'webhook' })
      });
      
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe('WEBHOOK_SIGNATURE_MISSING');
    });

    test('❌ should reject invalid signature', async () => {
      const res = await app.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': 'sha256=invalid-signature'
        },
        body: JSON.stringify({ test: 'webhook' })
      });
      
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    });

    test('❌ should reject signature with wrong length', async () => {
      const res = await app.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': 'sha256=short'
        },
        body: JSON.stringify({ test: 'webhook' })
      });
      
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    });
  });

  describe('apiRateLimitMiddleware', () => {
    beforeEach(() => {
      app.use(apiRateLimitMiddleware());
      app.get('/', (c) => c.text('OK'));
      client = testClient(app);
    });

    test('✅ should allow requests when not backing off', async () => {
      const res = await client.index.$get();
      expect(res.status).toBe(200);
    });

    test('❌ should block requests during backoff', async () => {
      // Mock rate limiter to return backoff state
      const { getMetaRateLimiter } = require('../services/meta-rate-limiter.js');
      const mockRateLimiter = getMetaRateLimiter();
      const backoffUntil = Date.now() + 30000; // 30 seconds from now
      
      mockRateLimiter.shouldBackOff.mockReturnValue({
        isBackingOff: true,
        backoffUntil
      });
      
      const res = await client.index.$get();
      
      expect(res.status).toBe(503);
      expect(res.headers.get('Retry-After')).toBeDefined();
      
      const data = await res.json();
      expect(data.code).toBe('RATE_LIMIT_BACKOFF');
      expect(data.retryAfter).toBeGreaterThan(0);
    });
  });

  describe('traceMiddleware', () => {
    beforeEach(() => {
      app.use(traceMiddleware());
      app.get('/', (c) => {
        const traceId = c.get('traceId');
        return c.json({ traceId });
      });
      client = testClient(app);
    });

    test('✅ should generate trace ID when not provided', async () => {
      const res = await client.index.$get();
      
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Trace-ID')).toBeDefined();
      
      const data = await res.json();
      expect(data.traceId).toBeDefined();
      expect(typeof data.traceId).toBe('string');
    });

    test('✅ should use provided trace ID', async () => {
      const customTraceId = 'custom-trace-123';
      
      const res = await app.request('/', {
        headers: {
          'X-Trace-ID': customTraceId
        }
      });
      
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Trace-ID')).toBe(customTraceId);
      
      const data = await res.json();
      expect(data.traceId).toBe(customTraceId);
    });
  });

  describe('errorHandlingMiddleware', () => {
    beforeEach(() => {
      app.use(errorHandlingMiddleware());
    });

    test('✅ should catch and handle errors gracefully', async () => {
      app.get('/error', () => {
        throw new Error('Test error message');
      });
      
      const res = await app.request('/error');
      
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('Internal server error');
      expect(data.code).toBe('INTERNAL_ERROR');
      expect(data.message).toBe('Test error message'); // In test environment
    });

    test('✅ should hide error details in production', async () => {
      // Mock production environment
      const { getConfig } = require('../config/environment.js');
      getConfig.mockReturnValue({
        environment: 'production',
        security: { corsOrigins: [] },
        instagram: { metaAppSecret: 'test' }
      });
      
      app.get('/error', () => {
        throw new Error('Sensitive error information');
      });
      
      const res = await app.request('/error');
      
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.message).toBe('Something went wrong');
      expect(data.stack).toBeUndefined();
    });
  });

  describe('auditLogMiddleware', () => {
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      app.use(traceMiddleware());
      app.use(auditLogMiddleware());
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    test('✅ should log security events for 4xx/5xx responses', async () => {
      app.get('/not-found', (c) => c.notFound());
      
      const res = await app.request('/not-found', {
        headers: {
          'User-Agent': 'Test Agent',
          'X-Forwarded-For': '192.168.1.1'
        }
      });
      
      expect(res.status).toBe(404);
      expect(consoleSpy).toHaveBeenCalledWith(
        '🔒 Security event:',
        expect.objectContaining({
          method: 'GET',
          url: expect.stringContaining('/not-found'),
          status: 404,
          ip: '192.168.1.1',
          userAgent: 'Test Agent',
          duration: expect.any(Number)
        })
      );
    });

    test('✅ should not log successful requests', async () => {
      app.get('/success', (c) => c.text('OK'));
      
      const res = await app.request('/success');
      
      expect(res.status).toBe(200);
      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });

  describe('setupSecurityMiddleware', () => {
    test('✅ should return array of middleware functions', () => {
      const middlewares = setupSecurityMiddleware();
      
      expect(Array.isArray(middlewares)).toBe(true);
      expect(middlewares.length).toBeGreaterThan(0);
      
      // Each item should be a function (middleware)
      middlewares.forEach(middleware => {
        expect(typeof middleware).toBe('function');
      });
    });

    test('✅ should work when applied to app', async () => {
      const middlewares = setupSecurityMiddleware();
      
      middlewares.forEach(middleware => {
        app.use(middleware);
      });
      
      app.get('/', (c) => c.text('OK'));
      
      const res = await app.request('/', {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Trace-ID')).toBeDefined();
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    });
  });

  describe('setupGlobalErrorHandlers', () => {
    let originalExit: typeof process.exit;
    let originalUncaughtListener: any;
    let originalRejectionListener: any;

    beforeEach(() => {
      originalExit = process.exit;
      originalUncaughtListener = process.listeners('uncaughtException')[0];
      originalRejectionListener = process.listeners('unhandledRejection')[0];
      
      // Mock process.exit to prevent test termination
      process.exit = jest.fn() as any;
    });

    afterEach(() => {
      process.exit = originalExit;
      
      // Remove test listeners
      process.removeAllListeners('uncaughtException');
      process.removeAllListeners('unhandledRejection');
      
      // Restore original listeners if they existed
      if (originalUncaughtListener) {
        process.on('uncaughtException', originalUncaughtListener);
      }
      if (originalRejectionListener) {
        process.on('unhandledRejection', originalRejectionListener);
      }
    });

    test('✅ should setup global error handlers', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      setupGlobalErrorHandlers();
      
      // Check that listeners were added
      expect(process.listenerCount('uncaughtException')).toBeGreaterThan(0);
      expect(process.listenerCount('unhandledRejection')).toBeGreaterThan(0);
      
      consoleSpy.mockRestore();
    });
  });

  describe('Integration Tests', () => {
    test('✅ should handle complex request flow with all middlewares', async () => {
      const middlewares = setupSecurityMiddleware();
      middlewares.forEach(middleware => app.use(middleware));
      
      app.post('/webhook', (c) => {
        return c.json({ 
          success: true,
          traceId: c.get('traceId')
        });
      });
      
      const body = JSON.stringify({ event: 'test' });
      const signature = crypto
        .createHmac('sha256', 'test-secret-key')
        .update(body)
        .digest('hex');
      
      // Remove webhook signature middleware for this test
      app = new Hono();
      app.use(traceMiddleware());
      app.use(strictCorsMiddleware());
      app.use(securityHeadersMiddleware());
      app.use(requestValidationMiddleware());
      app.use(inputSanitizationMiddleware());
      app.use(apiRateLimitMiddleware());
      app.use(auditLogMiddleware());
      app.use(errorHandlingMiddleware());
      
      app.post('/api/test', (c) => c.json({ success: true }));
      
      const res = await app.request('/api/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://ai-instgram.onrender.com'
        },
        body
      });
      
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Trace-ID')).toBeDefined();
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://ai-instgram.onrender.com');
      
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    test('✅ should maintain performance under security middleware load', async () => {
      const middlewares = setupSecurityMiddleware();
      middlewares.forEach(middleware => app.use(middleware));
      
      app.get('/performance', (c) => c.json({ timestamp: Date.now() }));
      
      const startTime = Date.now();
      
      // Make multiple concurrent requests
      const requests = Array.from({ length: 10 }, () =>
        app.request('/performance', {
          headers: {
            'Origin': 'https://ai-instgram.onrender.com'
          }
        })
      );
      
      const responses = await Promise.all(requests);
      const endTime = Date.now();
      
      // All requests should succeed
      responses.forEach(res => {
        expect(res.status).toBe(200);
      });
      
      // Should complete within reasonable time (less than 1 second)
      expect(endTime - startTime).toBeLessThan(1000);
    });
  });

  describe('Edge Cases', () => {
    test('✅ should handle malformed headers gracefully', async () => {
      app.use(setupSecurityMiddleware());
      app.get('/', (c) => c.text('OK'));
      
      const res = await app.request('/', {
        headers: {
          'Content-Length': 'not-a-number',
          'Origin': 'not-a-valid-url'
        }
      });
      
      // Should not crash, should either accept or reject gracefully
      expect([200, 400, 401, 403, 404].includes(res.status)).toBe(true);
    });

    test('✅ should handle empty request body', async () => {
      app.use(webhookSignatureMiddleware('instagram'));
      app.post('/', (c) => c.json({ received: true }));
      
      const signature = crypto
        .createHmac('sha256', 'test-secret-key')
        .update('')
        .digest('hex');
      
      const res = await app.request('/', {
        method: 'POST',
        headers: {
          'X-Hub-Signature-256': `sha256=${signature}`
        },
        body: ''
      });
      
      expect(res.status).toBe(200);
    });

    test('✅ should handle Unicode in query parameters', async () => {
      app.use(inputSanitizationMiddleware());
      app.get('/', (c) => {
        const search = c.req.query('q');
        return c.text(`Search: ${search}`);
      });
      
      const unicodeQuery = 'مرحبا بالعالم';
      const res = await app.request(`/?q=${encodeURIComponent(unicodeQuery)}`);
      
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain(unicodeQuery);
    });
  });
});