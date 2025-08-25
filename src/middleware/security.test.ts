/**
 * ===============================================
 * Security Middleware Tests
 * اختبارات شاملة لـ middleware الأمان الأساسي
 * ===============================================
 */

import { describe, test, expect, beforeEach, afterEach, jest } from 'vitest';
import { Hono, Context } from 'hono';
import { testClient } from 'hono/testing';
import crypto from 'crypto';

import {
  rateLimitMiddleware,
  merchantRateLimitMiddleware,
  windowEnforcementMiddleware,
  messagingRateLimitMiddleware,
  securityContextMiddleware,
  auditLogMiddleware,
  webhookSignatureMiddleware,
  corsSecurityMiddleware,
  securityHeadersMiddleware,
  requestValidationMiddleware,
  generateTraceId,
  getClientIP,
  rateLimiters
} from './security.js';

// Mock dependencies
jest.mock('../services/message-window.js', () => ({
  getMessageWindowService: jest.fn(() => ({
    checkCanSendMessage: jest.fn(() => Promise.resolve({
      canSendMessage: true,
      windowExpiresAt: new Date(Date.now() + 86400000) // 24 hours from now
    }))
  }))
}));

jest.mock('../database/connection.js', () => ({
  getDatabase: jest.fn(() => ({
    getSQL: jest.fn(() => jest.fn())
  }))
}));

jest.mock('../services/RedisConnectionManager.js', () => ({
  getRedisConnectionManager: jest.fn(() => ({
    getConnection: jest.fn(() => Promise.resolve({
      // Mock Redis client
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      exists: jest.fn()
    }))
  }))
}));

jest.mock('../config/environment.js', () => ({
  getEnvVar: jest.fn((key) => {
    if (key === 'REDIS_URL') return 'redis://localhost:6379';
    return '';
  }),
  getConfig: jest.fn(() => ({
    baseUrl: 'https://test.example.com',
    instagram: {
      metaAppSecret: 'test-secret-key'
    }
  }))
}));

// Mock rate limiters to avoid Redis dependency in tests
const mockRateLimiter = {
  consume: jest.fn(() => Promise.resolve()),
  points: 100
};

jest.mock('rate-limiter-flexible', () => ({
  RateLimiterRedis: jest.fn(() => mockRateLimiter)
}));

describe('🔒 Security Middleware Tests', () => {
  let app: Hono;
  let client: any;

  beforeEach(() => {
    app = new Hono();
    jest.clearAllMocks();
  });

  describe('generateTraceId', () => {
    test('✅ should generate valid UUID trace ID', () => {
      const traceId = generateTraceId();
      
      expect(traceId).toBeDefined();
      expect(typeof traceId).toBe('string');
      expect(traceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    test('✅ should generate unique trace IDs', () => {
      const traceId1 = generateTraceId();
      const traceId2 = generateTraceId();
      
      expect(traceId1).not.toBe(traceId2);
    });
  });

  describe('getClientIP', () => {
    test('✅ should extract IP from X-Forwarded-For header', () => {
      const mockContext = {
        req: {
          header: jest.fn((name) => {
            if (name === 'x-forwarded-for') return '192.168.1.1, 10.0.0.1';
            return undefined;
          })
        }
      } as any as Context;

      const ip = getClientIP(mockContext);
      expect(ip).toBe('192.168.1.1');
    });

    test('✅ should extract IP from X-Real-IP header', () => {
      const mockContext = {
        req: {
          header: jest.fn((name) => {
            if (name === 'x-real-ip') return '192.168.1.1';
            return undefined;
          })
        }
      } as any as Context;

      const ip = getClientIP(mockContext);
      expect(ip).toBe('192.168.1.1');
    });

    test('✅ should return unknown when no IP headers present', () => {
      const mockContext = {
        req: {
          header: jest.fn(() => undefined)
        }
      } as any as Context;

      const ip = getClientIP(mockContext);
      expect(ip).toBe('unknown');
    });

    test('✅ should sanitize IP addresses', () => {
      const mockContext = {
        req: {
          header: jest.fn((name) => {
            if (name === 'x-forwarded-for') return '192.168.1.1\r\n';
            return undefined;
          })
        }
      } as any as Context;

      const ip = getClientIP(mockContext);
      expect(ip).toBe('192.168.1.1');
    });
  });

  describe('rateLimitMiddleware', () => {
    beforeEach(() => {
      app.use(rateLimitMiddleware());
      app.get('/', (c) => c.text('OK'));
      client = testClient(app);
    });

    test('✅ should allow requests under limit', async () => {
      mockRateLimiter.consume.mockResolvedValueOnce(undefined);
      
      const res = await client.index.$get();
      expect(res.status).toBe(200);
    });

    test('❌ should block requests over limit', async () => {
      const rejectionRes = {
        msBeforeNext: 60000,
        remainingPoints: 0
      };
      mockRateLimiter.consume.mockRejectedValueOnce(rejectionRes);
      
      const res = await client.index.$get();
      
      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).toBe('60');
      expect(res.headers.get('X-RateLimit-Limit')).toBe('100');
      
      const data = await res.json();
      expect(data.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    test('✅ should use different limiter types', async () => {
      const webhookApp = new Hono();
      webhookApp.use(rateLimitMiddleware('webhook'));
      webhookApp.post('/', (c) => c.text('OK'));
      
      const res = await webhookApp.request('/', { method: 'POST' });
      expect(res.status).toBe(200);
    });
  });

  describe('merchantRateLimitMiddleware', () => {
    beforeEach(() => {
      app.use(merchantRateLimitMiddleware());
      app.get('/', (c) => c.text('OK'));
      client = testClient(app);
    });

    test('❌ should require merchant ID', async () => {
      const res = await client.index.$get();
      
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe('MERCHANT_ID_MISSING');
    });

    test('✅ should allow requests with merchant ID', async () => {
      mockRateLimiter.consume.mockResolvedValueOnce(undefined);
      
      app.get('/merchant', (c) => {
        c.set('merchantId', 'test-merchant-123');
        return c.text('OK');
      });
      
      const res = await app.request('/merchant');
      expect(res.status).toBe(200);
    });

    test('❌ should block merchant over limit', async () => {
      const rejectionRes = {
        msBeforeNext: 120000,
        remainingPoints: 0
      };
      mockRateLimiter.consume.mockRejectedValueOnce(rejectionRes);
      
      const res = await app.request('/?merchantId=test-merchant');
      
      expect(res.status).toBe(429);
      const data = await res.json();
      expect(data.code).toBe('MERCHANT_RATE_LIMIT_EXCEEDED');
      expect(data.merchantId).toBe('test-merchant');
    });
  });

  describe('windowEnforcementMiddleware', () => {
    beforeEach(() => {
      app.use(windowEnforcementMiddleware());
      app.post('/', (c) => c.json({ success: true }));
      client = testClient(app);
    });

    test('❌ should require merchant ID', async () => {
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_phone: '+1234567890' })
      });
      
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe('MERCHANT_ID_MISSING');
    });

    test('❌ should require customer identifier', async () => {
      const res = await app.request('/?merchantId=test-merchant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe('CUSTOMER_ID_MISSING');
    });

    test('✅ should allow messages within window', async () => {
      const res = await app.request('/?merchantId=test-merchant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_phone: '+1234567890' })
      });
      
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    test('❌ should block messages outside window', async () => {
      const { getMessageWindowService } = require('../services/message-window.js');
      const mockWindowService = getMessageWindowService();
      mockWindowService.checkCanSendMessage.mockResolvedValueOnce({
        canSendMessage: false,
        windowExpiresAt: new Date('2024-01-01T00:00:00Z')
      });
      
      const res = await app.request('/?merchantId=test-merchant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_instagram: 'test_user' })
      });
      
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.code).toBe('WINDOW_EXPIRED');
      expect(data.details.customer).toBe('test_user');
    });

    test('❌ should handle window check errors', async () => {
      const { getMessageWindowService } = require('../services/message-window.js');
      const mockWindowService = getMessageWindowService();
      mockWindowService.checkCanSendMessage.mockRejectedValueOnce(new Error('DB error'));
      
      const res = await app.request('/?merchantId=test-merchant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_phone: '+1234567890' })
      });
      
      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.code).toBe('WINDOW_CHECK_ERROR');
    });
  });

  describe('messagingRateLimitMiddleware', () => {
    beforeEach(() => {
      app.use(messagingRateLimitMiddleware());
      app.post('/', (c) => c.json({ sent: true }));
      client = testClient(app);
    });

    test('❌ should require customer identifier', async () => {
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchantId: 'test-merchant' })
      });
      
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe('CUSTOMER_ID_MISSING');
    });

    test('✅ should allow messages under limit', async () => {
      mockRateLimiter.consume.mockResolvedValueOnce(undefined);
      
      const res = await app.request('/?merchantId=test-merchant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_phone: '+1234567890' })
      });
      
      expect(res.status).toBe(200);
    });

    test('❌ should block excessive messaging to same customer', async () => {
      const rejectionRes = {
        msBeforeNext: 300000,
        remainingPoints: 0
      };
      mockRateLimiter.consume.mockRejectedValueOnce(rejectionRes);
      
      const res = await app.request('/?merchantId=test-merchant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_instagram: 'test_user' })
      });
      
      expect(res.status).toBe(429);
      const data = await res.json();
      expect(data.code).toBe('MESSAGING_RATE_LIMIT_EXCEEDED');
      expect(data.customerId).toBe('test_user');
    });
  });

  describe('securityContextMiddleware', () => {
    beforeEach(() => {
      app.use(securityContextMiddleware());
      app.get('/', (c) => {
        const context = c.get('securityContext');
        return c.json({ 
          traceId: context.traceId,
          ipAddress: context.ipAddress,
          hasUserAgent: !!context.userAgent,
          hasStartTime: !!context.startTime
        });
      });
      client = testClient(app);
    });

    test('✅ should create security context', async () => {
      const res = await app.request('/', {
        headers: {
          'User-Agent': 'Test Browser',
          'X-Forwarded-For': '192.168.1.1'
        }
      });
      
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Trace-ID')).toBeDefined();
      
      const data = await res.json();
      expect(data.traceId).toBeDefined();
      expect(data.ipAddress).toBe('192.168.1.1');
      expect(data.hasUserAgent).toBe(true);
      expect(data.hasStartTime).toBe(true);
    });

    test('✅ should handle missing headers gracefully', async () => {
      const res = await client.index.$get();
      
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.traceId).toBeDefined();
      expect(data.ipAddress).toBe('unknown');
      expect(data.hasUserAgent).toBe(false);
    });
  });

  describe('auditLogMiddleware', () => {
    let mockSQL: jest.Mock;

    beforeEach(() => {
      mockSQL = jest.fn(() => Promise.resolve());
      const { getDatabase } = require('../database/connection.js');
      getDatabase.mockReturnValue({
        getSQL: () => mockSQL
      });

      app.use(securityContextMiddleware());
      app.use(auditLogMiddleware());
      app.get('/', (c) => c.text('OK'));
      app.get('/error', (c) => c.text('Error', 500));
      client = testClient(app);
    });

    test('✅ should log successful requests', async () => {
      const res = await client.index.$get();
      
      expect(res.status).toBe(200);
      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([
          null, // merchant_id
          'GET_/',
          'API_REQUEST',
          expect.any(String), // JSON details
          expect.any(String), // trace_id
          'unknown', // ip_address
          'unknown', // user_agent
          '/',
          'GET',
          expect.any(Number), // execution_time
          expect.any(Number), // memory_usage
          true // success
        ])
      );
    });

    test('✅ should log failed requests', async () => {
      const res = await app.request('/error');
      
      expect(res.status).toBe(500);
      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([
          false // success = false for 5xx status
        ])
      );
    });

    test('✅ should handle audit logging errors gracefully', async () => {
      mockSQL.mockRejectedValueOnce(new Error('DB error'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const res = await client.index.$get();
      
      expect(res.status).toBe(200); // Request should still succeed
      expect(consoleSpy).toHaveBeenCalledWith('❌ Audit logging failed:', expect.any(Error));
      
      consoleSpy.mockRestore();
    });

    test('✅ should filter sensitive headers', async () => {
      const res = await app.request('/', {
        headers: {
          'Authorization': 'Bearer secret-token',
          'X-API-Token': 'secret',
          'Content-Type': 'application/json'
        }
      });
      
      expect(res.status).toBe(200);
      
      const logCall = mockSQL.mock.calls[0][0];
      const details = JSON.parse(logCall[3]);
      expect(details.headers).not.toHaveProperty('authorization');
      expect(details.headers).not.toHaveProperty('x-api-token');
      expect(details.headers).toHaveProperty('content-type');
    });
  });

  describe('webhookSignatureMiddleware', () => {
    const secretKey = process.env.TEST_WEBHOOK_SECRET || 'test-webhook-secret-for-testing-only';

    beforeEach(() => {
      app.use(webhookSignatureMiddleware(secretKey));
      app.post('/', (c) => c.json({ verified: true }));
      client = testClient(app);
    });

    test('❌ should require signature header', async () => {
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: 'data' })
      });
      
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.code).toBe('SIGNATURE_MISSING');
    });

    test('✅ should verify valid signature', async () => {
      const body = JSON.stringify({ webhook: 'data' });
      const signature = crypto
        .createHmac('sha256', secretKey)
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
      expect(data.verified).toBe(true);
    });

    test('❌ should reject invalid signature format', async () => {
      const res = await app.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': 'sha256=invalid-hex'
        },
        body: JSON.stringify({ test: 'data' })
      });
      
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.code).toBe('INVALID_SIGNATURE_FORMAT');
    });

    test('❌ should reject wrong signature', async () => {
      const body = JSON.stringify({ test: 'data' });
      const wrongSignature = crypto
        .createHmac('sha256', 'wrong-secret')
        .update(body)
        .digest('hex');
      
      const res = await app.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature-256': `sha256=${wrongSignature}`
        },
        body
      });
      
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.code).toBe('INVALID_SIGNATURE');
    });

    test('✅ should handle X-Signature header', async () => {
      const body = JSON.stringify({ test: 'data' });
      const signature = crypto
        .createHmac('sha256', secretKey)
        .update(body)
        .digest('hex');
      
      const res = await app.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': `sha256=${signature}`
        },
        body
      });
      
      expect(res.status).toBe(200);
    });
  });

  describe('corsSecurityMiddleware', () => {
    beforeEach(() => {
      app.use(corsSecurityMiddleware());
      app.get('/', (c) => c.text('OK'));
      app.options('/', (c) => c.text('OK'));
      client = testClient(app);
    });

    test('✅ should handle OPTIONS preflight', async () => {
      const res = await app.request('/', { method: 'OPTIONS' });
      
      expect(res.status).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
      expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
      expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
    });

    test('✅ should allow approved origins', async () => {
      process.env.ALLOWED_ORIGINS = 'https://app.example.com,https://admin.example.com';
      
      const res = await app.request('/', {
        headers: {
          'Origin': 'https://app.example.com'
        }
      });
      
      expect(res.status).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
      
      delete process.env.ALLOWED_ORIGINS;
    });

    test('✅ should not set CORS origin for unapproved origins', async () => {
      const res = await app.request('/', {
        headers: {
          'Origin': 'https://malicious-site.com'
        }
      });
      
      expect(res.status).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });
  });

  describe('securityHeadersMiddleware', () => {
    beforeEach(() => {
      app.use(securityHeadersMiddleware());
      app.get('/', (c) => c.text('OK'));
      client = testClient(app);
    });

    test('✅ should set all security headers', async () => {
      const res = await client.index.$get();
      
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
      expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
      expect(res.headers.get('Permissions-Policy')).toContain('geolocation=()');
    });

    test('✅ should set HSTS in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      
      const prodApp = new Hono();
      prodApp.use(securityHeadersMiddleware());
      prodApp.get('/', (c) => c.text('OK'));
      
      const res = await prodApp.request('/');
      
      expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
      
      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('requestValidationMiddleware', () => {
    beforeEach(() => {
      app.use(requestValidationMiddleware());
      app.post('/', (c) => c.text('OK'));
      app.get('/', (c) => c.text('OK'));
      client = testClient(app);
    });

    test('✅ should allow GET requests', async () => {
      const res = await client.index.$get();
      expect(res.status).toBe(200);
    });

    test('✅ should allow POST with JSON content type', async () => {
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: 'data' })
      });
      
      expect(res.status).toBe(200);
    });

    test('❌ should reject POST without content type', async () => {
      const res = await app.request('/', {
        method: 'POST',
        body: 'test data'
      });
      
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.code).toBe('INVALID_CONTENT_TYPE');
    });

    test('❌ should reject requests over size limit', async () => {
      const largeBody = 'x'.repeat(11 * 1024 * 1024); // 11MB
      
      const res = await app.request('/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': largeBody.length.toString()
        },
        body: largeBody
      });
      
      expect(res.status).toBe(413);
      const data = await res.json();
      expect(data.code).toBe('REQUEST_TOO_LARGE');
    });
  });

  describe('Integration Tests', () => {
    test('✅ should handle complete security middleware stack', async () => {
      const secureApp = new Hono();
      
      // Apply all security middleware
      secureApp.use(securityContextMiddleware());
      secureApp.use(corsSecurityMiddleware());
      secureApp.use(securityHeadersMiddleware());
      secureApp.use(requestValidationMiddleware());
      secureApp.use(rateLimitMiddleware());
      secureApp.use(auditLogMiddleware());
      
      secureApp.post('/secure', (c) => {
        const context = c.get('securityContext');
        return c.json({ 
          secure: true,
          traceId: context.traceId
        });
      });
      
      const res = await secureApp.request('/secure', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://test.example.com'
        },
        body: JSON.stringify({ message: 'secure test' })
      });
      
      expect(res.status).toBe(200);
      expect(res.headers.get('X-Trace-ID')).toBeDefined();
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      
      const data = await res.json();
      expect(data.secure).toBe(true);
      expect(data.traceId).toBeDefined();
    });

    test('✅ should maintain performance under security load', async () => {
      const perfApp = new Hono();
      
      perfApp.use(securityContextMiddleware());
      perfApp.use(rateLimitMiddleware());
      perfApp.use(securityHeadersMiddleware());
      
      perfApp.get('/perf', (c) => c.json({ timestamp: Date.now() }));
      
      const startTime = Date.now();
      
      // Concurrent requests
      const requests = Array.from({ length: 20 }, () =>
        perfApp.request('/perf')
      );
      
      const responses = await Promise.all(requests);
      const endTime = Date.now();
      
      // All should succeed
      responses.forEach(res => {
        expect(res.status).toBe(200);
      });
      
      // Should complete quickly
      expect(endTime - startTime).toBeLessThan(2000);
    });
  });

  describe('Rate Limiting Tests', () => {
    test('✅ should enforce rate limits correctly', async () => {
      const app = new Hono();
      app.use(rateLimitMiddleware('general'));
      app.get('/', (c) => c.text('OK'));
      
      // Mock rate limiter to reject after first request
      mockRateLimiter.consume
        .mockResolvedValueOnce(undefined) // First request succeeds
        .mockRejectedValueOnce({ msBeforeNext: 60000, remainingPoints: 0 }); // Second request fails
      
      const res1 = await app.request('/');
      expect(res1.status).toBe(200);
      
      const res2 = await app.request('/');
      expect(res2.status).toBe(429);
      expect(res2.headers.get('Retry-After')).toBe('60');
    });
    
    test('✅ should handle concurrent requests', async () => {
      const app = new Hono();
      app.use(rateLimitMiddleware('webhook'));
      app.post('/', (c) => c.json({ success: true }));
      
      // Mock rate limiter to handle concurrent requests
      mockRateLimiter.consume.mockResolvedValue(undefined);
      
      // Send multiple concurrent requests
      const requests = Array.from({ length: 10 }, () =>
        app.request('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ test: 'data' })
        })
      );
      
      const responses = await Promise.all(requests);
      
      // All should succeed
      responses.forEach(res => {
        expect(res.status).toBe(200);
      });
      
      // Rate limiter should be called for each request
      expect(mockRateLimiter.consume).toHaveBeenCalledTimes(10);
    });

    test('✅ should handle different rate limiter types', async () => {
      const app = new Hono();
      app.use(rateLimitMiddleware('messaging'));
      app.post('/', (c) => c.json({ sent: true }));
      
      mockRateLimiter.consume.mockResolvedValue(undefined);
      
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_phone: '+1234567890' })
      });
      
      expect(res.status).toBe(200);
    });

    test('✅ should handle rate limiter errors gracefully', async () => {
      const app = new Hono();
      app.use(rateLimitMiddleware());
      app.get('/', (c) => c.text('OK'));
      
      // Mock rate limiter to throw error
      mockRateLimiter.consume.mockRejectedValue(new Error('Redis connection failed'));
      
      const res = await app.request('/');
      
      // Should still allow request when rate limiter fails
      expect(res.status).toBe(200);
    });
  });

  describe('IP Validation Tests', () => {
    test('✅ should validate trusted proxy IPs', async () => {
      const app = new Hono();
      app.use(rateLimitMiddleware());
      app.get('/', (c) => c.text('OK'));
      
      // Test with trusted proxy IP
      const res = await app.request('/', {
        headers: {
          'X-Forwarded-For': '192.168.1.100',
          'X-Real-IP': '127.0.0.1' // Trusted proxy
        }
      });
      
      expect(res.status).toBe(200);
    });

    test('✅ should handle multiple IP addresses in X-Forwarded-For', async () => {
      const app = new Hono();
      app.use(rateLimitMiddleware());
      app.get('/', (c) => c.text('OK'));
      
      const res = await app.request('/', {
        headers: {
          'X-Forwarded-For': '203.0.113.1, 198.51.100.1, 192.168.1.1'
        }
      });
      
      expect(res.status).toBe(200);
    });

    test('✅ should handle Cloudflare IP headers', async () => {
      const app = new Hono();
      app.use(rateLimitMiddleware());
      app.get('/', (c) => c.text('OK'));
      
      const res = await app.request('/', {
        headers: {
          'CF-Connecting-IP': '203.0.113.1'
        }
      });
      
      expect(res.status).toBe(200);
    });

    test('✅ should sanitize IP addresses', async () => {
      const app = new Hono();
      app.use(rateLimitMiddleware());
      app.get('/', (c) => c.text('OK'));
      
      const res = await app.request('/', {
        headers: {
          'X-Forwarded-For': '192.168.1.1\r\n<script>alert("xss")</script>'
        }
      });
      
      expect(res.status).toBe(200);
    });

    test('✅ should handle missing IP headers', async () => {
      const app = new Hono();
      app.use(rateLimitMiddleware());
      app.get('/', (c) => c.text('OK'));
      
      const res = await app.request('/');
      
      expect(res.status).toBe(200);
    });
  });

  describe('Edge Cases', () => {
    test('✅ should handle malformed request bodies', async () => {
      const app = new Hono();
      app.use(windowEnforcementMiddleware());
      app.post('/', (c) => c.json({ ok: true }));
      
      // Send malformed JSON
      const res = await app.request('/?merchantId=test&customer_phone=123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"invalid": json}'
      });
      
      // Should still work as it falls back to empty object
      expect(res.status).toBe(200);
    });

    test('✅ should handle concurrent rate limit checks', async () => {
      const app = new Hono();
      app.use(rateLimitMiddleware());
      app.get('/', (c) => c.text('OK'));
      
      // Multiple concurrent requests
      const requests = Array.from({ length: 5 }, () =>
        app.request('/')
      );
      
      const responses = await Promise.all(requests);
      
      // All should succeed (mocked rate limiter allows all)
      responses.forEach(res => {
        expect(res.status).toBe(200);
      });
    });

    test('✅ should handle missing security context gracefully', async () => {
      const app = new Hono();
      app.use(auditLogMiddleware()); // Without securityContextMiddleware
      app.get('/', (c) => c.text('OK'));
      
      const res = await app.request('/');
      
      // Should not crash even without security context
      expect(res.status).toBe(200);
    });
  });
});