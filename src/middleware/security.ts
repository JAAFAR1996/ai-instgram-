/**
 * ===============================================
 * Security Middleware for API Protection
 * Rate limiting, window enforcement, and audit logging
 * ===============================================
 */

import type { MiddlewareHandler, Context, Next } from 'hono';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import crypto from 'crypto';
import { getMessageWindowService } from '../services/message-window.js';
import { getDatabase } from '../db/adapter.js';
import type { Platform } from '../types/database.js';
import { getRedisConnectionManager } from '../services/RedisConnectionManager.js';
import { RedisUsageType } from '../config/RedisConfigurationFactory.js';
import { getConfig } from '../config/index.js';

const clean = (v?: string | null) =>
  (v ?? '').replace(/[\r\n]/g, '').trim();

const config = getConfig();
let redisClient: any = null;

async function getRedisClient() {
  if (process.env.REDIS_ENABLED === 'false') return null;
  
  if (!redisClient) {
    try {
      redisClient = await getRedisConnectionManager()
        .getConnection(RedisUsageType.CACHING);
    } catch (error) {
      console.warn('Redis not available, using memory fallback');
      return null;
    }
  }
  return redisClient;
}

// Rate limiter configurations
const DEFAULT_RATE_LIMIT = parseInt(process.env.RATE_LIMIT_MAX || '100');
const DEFAULT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000');

const rateLimiters: any = {};

async function getRateLimiter(type: string) {
  if (rateLimiters[type]) return rateLimiters[type];
  
  const redis = await getRedisClient();
  if (redis) {
    rateLimiters[type] = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: `api_${type}`,
      points: DEFAULT_RATE_LIMIT,
      duration: DEFAULT_WINDOW_MS / 1000,
      blockDuration: 60,
    });
  } else {
    // Memory fallback
    const { RateLimiterMemory } = require('rate-limiter-flexible');
    rateLimiters[type] = new RateLimiterMemory({
      points: DEFAULT_RATE_LIMIT,
      duration: DEFAULT_WINDOW_MS / 1000,
    });
  }
  
  return rateLimiters[type];
}

export interface SecurityContext {
  traceId: string;
  sessionId?: string;
  merchantId?: string;
  ipAddress: string;
  userAgent: string;
  startTime: number;
}

/**
 * Generate unique trace ID for request tracking
 */
export function generateTraceId(): string {
  return crypto.randomUUID();
}



export const securityHeaders: MiddlewareHandler = async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Content-Security-Policy', "default-src 'self'");
  if (clean(c.req.header('x-forwarded-proto')) === 'https') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  await next();
};

export function getClientIP(forwarded?: string): string | undefined {
  if (!forwarded) return undefined;
  const first = forwarded.split(',')[0];
  return first ? first.trim().replace(/[\r\n]/g, '') : undefined;
}

/**
 * Basic rate limiting middleware
 */
export function rateLimitMiddleware(limiterType: string = 'general') {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const limiter = await getRateLimiter(limiterType);
    const key = getClientIP(c.req.header('x-forwarded-for')) || 'unknown';
    
    try {
      await limiter.consume(key);
      return await next();
    } catch (rejRes: any) {
      const secs = Math.round(rejRes.msBeforeNext / 1000) || 1;
      
      c.header('Retry-After', String(secs));
      c.header('X-RateLimit-Limit', String(limiter.points));
      c.header('X-RateLimit-Remaining', String(rejRes.remainingPoints || 0));
      c.header('X-RateLimit-Reset', String(new Date(Date.now() + rejRes.msBeforeNext)));
      
      return c.json({
        error: 'Rate limit exceeded',
        message: `Too many requests. Try again in ${secs} seconds.`,
        code: 'RATE_LIMIT_EXCEEDED'
      }, 429);
    }
  };
}

/**
 * Per-merchant rate limiting middleware
 */
export function merchantRateLimitMiddleware() {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const merchantId = c.get('merchantId') || c.req.query('merchantId');
    
    if (!merchantId) {
      return c.json({
        error: 'Merchant ID required',
        code: 'MERCHANT_ID_MISSING'
      }, 400);
    }

    const limiter = await getRateLimiter('merchant');
    const key = `merchant_${merchantId}`;
    
    try {
      await limiter.consume(key);
      return await next();
    } catch (rejRes: any) {
      const secs = Math.round(rejRes.msBeforeNext / 1000) || 1;
      
      return c.json({
        error: 'Merchant rate limit exceeded',
        message: `Too many requests for this merchant. Try again in ${secs} seconds.`,
        code: 'MERCHANT_RATE_LIMIT_EXCEEDED',
        merchantId
      }, 429);
    }
  };
}

/**
 * 24-hour window enforcement middleware for messaging
 */
export function windowEnforcementMiddleware() {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const merchantId = c.get('merchantId') || c.req.query('merchantId');
    const platform = (c.req.query('platform') || 'instagram') as Platform;
    
    const body = await c.req.json().catch(() => ({}));
    const customerPhone = body.customer_phone || c.req.query('customer_phone');
    const customerInstagram = body.customer_instagram || c.req.query('customer_instagram');
    
    if (!merchantId) {
      return c.json({
        error: 'Merchant ID required',
        code: 'MERCHANT_ID_MISSING'
      }, 400);
    }

    if (!customerPhone && !customerInstagram) {
      return c.json({
        error: 'Customer identifier required',
        code: 'CUSTOMER_ID_MISSING'
      }, 400);
    }

    try {
      const windowService = getMessageWindowService();
      const windowStatus = await windowService.checkCanSendMessage(merchantId, {
        phone: customerPhone,
        instagram: customerInstagram,
        platform
      });

      if (!windowStatus.canSendMessage) {
        return c.json({
          error: 'Message window expired',
          message: 'Cannot send message outside 24-hour customer service window',
          code: 'WINDOW_EXPIRED',
          details: {
            windowExpiredAt: windowStatus.windowExpiresAt,
            platform,
            customer: customerPhone || customerInstagram
          }
        }, 403);
      }

      // Store window info in context for logging
      c.set('windowStatus', windowStatus);
      
      return await next();
    } catch (error) {
      console.error('❌ Window enforcement error:', error);
      return c.json({
        error: 'Window check failed',
        code: 'WINDOW_CHECK_ERROR'
      }, 500);
    }
  };
}

/**
 * Messaging rate limiting with customer-specific limits
 */
export function messagingRateLimitMiddleware() {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const merchantId = c.get('merchantId') || c.req.query('merchantId');
    
    const body = await c.req.json().catch(() => ({}));
    const customerPhone = body.customer_phone || c.req.query('customer_phone');
    const customerInstagram = body.customer_instagram || c.req.query('customer_instagram');
    
    const customerId = customerPhone || customerInstagram;
    
    if (!customerId) {
      return c.json({
        error: 'Customer identifier required',
        code: 'CUSTOMER_ID_MISSING'
      }, 400);
    }

    const limiter = rateLimiters.messaging;
    const key = `messaging_${merchantId}_${customerId}`;
    
    try {
      await limiter.consume(key);
      return await next();
    } catch (rejRes: any) {
      const secs = Math.round(rejRes.msBeforeNext / 1000) || 1;
      
      return c.json({
        error: 'Messaging rate limit exceeded',
        message: `Too many messages to this customer. Try again in ${secs} seconds.`,
        code: 'MESSAGING_RATE_LIMIT_EXCEEDED',
        customerId
      }, 429);
    }
  };
}

/**
 * Security context middleware - adds tracing and security info
 */
export function securityContextMiddleware() {
  return async (c: Context, next: Next) => {
    const traceId = generateTraceId();
    const ipAddress = getClientIP(c.req.header('x-forwarded-for')) || 'unknown';
    const userAgent = c.req.header('user-agent') || 'unknown';
    const startTime = Date.now();
    
    const securityContext: SecurityContext = {
      traceId,
      ipAddress,
      userAgent,
      startTime
    };
    
    // Store in context
    c.set('securityContext', securityContext);
    c.set('traceId', traceId);
    
    // Add trace header to response
    c.header('X-Trace-ID', traceId);
    
    return await next();
  };
}

/**
 * Audit logging middleware
 */
export function auditLogMiddleware() {
  return async (c: Context, next: Next) => {
    const securityContext: SecurityContext = c.get('securityContext');
    const merchantId = c.get('merchantId');
    
    // Execute the request
    await next();
    
    // Log after execution
    try {
      const executionTime = Date.now() - securityContext.startTime;
      const memoryUsage = process.memoryUsage();
      const memoryUsageMB = memoryUsage.heapUsed / 1024 / 1024;
      
      const db = getDatabase();
      const sql = db.getSQL();
      
      await sql`
        INSERT INTO audit_logs (
          merchant_id,
          action,
          entity_type,
          details,
          trace_id,
          ip_address,
          user_agent,
          request_path,
          request_method,
          execution_time_ms,
          memory_usage_mb,
          success
        ) VALUES (
          ${merchantId || null}::uuid,
          ${`${c.req.method}_${c.req.path}`},
          'API_REQUEST',
          ${JSON.stringify({
            query: c.req.query(),
            headers: Object.fromEntries(
              Object.entries(c.req.header()).filter(([key]) => 
                !key.toLowerCase().includes('authorization') &&
                !key.toLowerCase().includes('token')
              )
            ),
            status: c.res.status,
            windowStatus: c.get('windowStatus')
          })},
          ${securityContext.traceId}::uuid,
          ${securityContext.ipAddress}::inet,
          ${securityContext.userAgent},
          ${c.req.path},
          ${c.req.method},
          ${executionTime},
          ${memoryUsageMB},
          ${c.res.status < 400}
        )
      `;
    } catch (error) {
      console.error('❌ Audit logging failed:', error);
      // Don't fail the request if audit logging fails
    }
  };
}

/**
 * Webhook signature verification middleware
 */
export function webhookSignatureMiddleware(secretKey: string) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const signature = c.req.header('X-Hub-Signature-256') || c.req.header('X-Signature');
    
    if (!signature) {
      return c.json({
        error: 'Webhook signature missing',
        code: 'SIGNATURE_MISSING'
      }, 401);
    }

    try {
      const originalRequest = c.req.raw;
      let bodyBuffer: ArrayBuffer;
      try {
        bodyBuffer = await originalRequest.arrayBuffer();
      } catch (bodyError) {
        console.warn('⚠️ Failed to retrieve webhook body for signature verification:', bodyError);
        return c.json({
          error: 'Unable to read request body',
          code: 'BODY_RETRIEVAL_FAILED'
        }, 400);
      }

      const bodyText = Buffer.from(bodyBuffer).toString();
      const expectedSignature = crypto
        .createHmac('sha256', secretKey)
        .update(bodyText)
        .digest('hex');

      const providedSignature = signature.replace('sha256=', '');

      if (!/^[0-9a-f]{64}$/i.test(providedSignature)) {
        return c.json({
          error: 'Invalid webhook signature',
          code: 'INVALID_SIGNATURE_FORMAT'
        }, 401);
      }

      const expectedBuffer = Buffer.from(expectedSignature, 'hex');
      const providedBuffer = Buffer.from(providedSignature, 'hex');

      if (expectedBuffer.length !== providedBuffer.length) {
        return c.json({
          error: 'Invalid webhook signature',
          code: 'INVALID_SIGNATURE_LENGTH'
        }, 401);
      }

      if (!crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
        return c.json({
          error: 'Invalid webhook signature',
          code: 'INVALID_SIGNATURE'
        }, 401);
      }

      // Rebuild request with consumed body for downstream middleware
      const newRequest = new Request(originalRequest.url, {
        method: originalRequest.method,
        headers: new Headers(originalRequest.headers),
        body: bodyBuffer
      });
      c.req.raw = newRequest;

      return await next();
    } catch (error) {
      console.error('❌ Webhook signature verification failed:', error);
      return c.json({
        error: 'Signature verification failed',
        code: 'SIGNATURE_VERIFICATION_ERROR'
      }, 500);
    }
  };
}

/**
 * CORS security middleware
 */
export function corsSecurityMiddleware() {
  const config = getConfig();
  return async (c: Context, next: Next): Promise<Response | void> => {
    const origin = c.req.header('origin');
    const allowedOrigins = config.security.corsOrigins;
    
    if (origin && allowedOrigins.includes(origin)) {
      c.header('Access-Control-Allow-Origin', origin);
    }
    
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    c.header('Access-Control-Max-Age', '86400'); // 24 hours
    
    if (c.req.method === 'OPTIONS') {
      return c.text('');
    }
    
    return await next();
  };
}

/**
 * Helper function to clean header values
 */
// removed unused _clean



/**
 * Legacy function for backward compatibility
 */
export function securityHeadersMiddleware() {
  return async (c: Context, next: Next) => {
    // Modern security headers
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
    
    // Content Security Policy (2025 standards - API-only)
    const csp = [
      "default-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "connect-src 'self' https://graph.facebook.com https://graph.instagram.com https://api.openai.com"
    ].join('; ');
    
    c.header('Content-Security-Policy', csp);
    
    // HSTS for all environments (development uses HTTP, production HTTPS)
    if (config.environment === 'production') {
      c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    
    return await next();
  };
}

/**
 * Request validation middleware
 */
export function requestValidationMiddleware() {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const contentType = c.req.header('content-type');
    const method = c.req.method;
    
    // Validate content type for POST/PUT requests
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      if (!contentType || !contentType.includes('application/json')) {
        return c.json({
          error: 'Invalid content type',
          message: 'Content-Type must be application/json',
          code: 'INVALID_CONTENT_TYPE'
        }, 400);
      }
    }
    
    // Validate request size (10MB limit)
    const contentLength = parseInt(c.req.header('content-length') || '0');
    if (contentLength > 10 * 1024 * 1024) {
      return c.json({
        error: 'Request too large',
        message: 'Request body must be less than 10MB',
        code: 'REQUEST_TOO_LARGE'
      }, 413);
    }
    
    return await next();
  };
}

// Create shorthand exports for common usage
export const rateLimiter = rateLimitMiddleware();

// Export all middleware functions
export {
  rateLimiters
};