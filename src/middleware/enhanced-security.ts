/**
 * ===============================================
 * Enhanced Security Middleware (2025 Standards)
 * ✅ CORS Strict + CSP + Security Headers + Rate Limiting
 * ===============================================
 */

import { Context, Next } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import crypto from 'crypto';
import { getConfig } from '../config/environment.js';
import { getMetaRateLimiter } from '../services/meta-rate-limiter.js';

export interface SecurityConfig {
  corsOrigins: string[];
  environment: 'development' | 'production' | 'test';
  trustProxy: boolean;
}

/**
 * Generate nonce for CSP
 */
export function generateCSPNonce(): string {
  return crypto.randomBytes(16).toString('base64');
}

/**
 * CORS middleware with strict production settings
 */
export function strictCorsMiddleware() {
  const config = getConfig();
  
  // Production: strict allowlist
  const allowedOrigins = config.environment === 'production' 
    ? config.security.corsOrigins.filter(origin => origin !== '*')
    : ['https://ai-instgram.onrender.com'];

  return cors({
    origin: (origin, c) => {
      // Allow same-origin requests (no origin header)
      if (!origin) return '*';
      
      // Check against allowlist
      const isAllowed = allowedOrigins.some(allowed => {
        if (allowed === '*') return config.environment !== 'production';
        return origin === allowed || origin.endsWith('.' + allowed.replace(/^https?:\/\//, ''));
      });
      
      return isAllowed ? origin : null;
    },
    allowHeaders: [
      'Content-Type',
      'Authorization', 
      'X-Requested-With',
      'X-Merchant-ID',
      'X-Trace-ID',
      'Accept',
      'Origin'
    ],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: false, // Never allow credentials with CORS
    maxAge: 86400 // 24 hours
  });
}

/**
 * Security headers middleware
 */
export function securityHeadersMiddleware() {
  return async (c: Context, next: Next) => {
    const config = getConfig();
    const nonce = generateCSPNonce();
    
    // Store nonce for later use in templates
    c.set('cspNonce', nonce);

    // Content Security Policy (2025 standards - API-only)
    const csp = [
      "default-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "connect-src 'self' https://graph.facebook.com https://graph.instagram.com https://api.openai.com"
    ].join('; ');

    // Security headers
    c.header('Content-Security-Policy', csp);
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    
    // HSTS for production
    if (config.environment === 'production') {
      c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }

    // Remove server information
    c.header('Server', ''); 
    c.header('X-Powered-By', '');

    await next();
  };
}

/**
 * Request validation middleware
 */
export function requestValidationMiddleware() {
  return async (c: Context, next: Next) => {
    const contentType = c.req.header('Content-Type');
    const method = c.req.method;
    
    // Validate content type for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      if (!contentType || !contentType.includes('application/json')) {
        return c.json({
          error: 'Invalid content type',
          message: 'Content-Type must be application/json',
          code: 'INVALID_CONTENT_TYPE'
        }, 400);
      }
    }

    // Body size validation
    const contentLength = c.req.header('Content-Length');
    if (contentLength && parseInt(contentLength) > 1024 * 1024) { // 1MB limit
      return c.json({
        error: 'Request too large',
        message: 'Request body cannot exceed 1MB',
        code: 'REQUEST_TOO_LARGE'
      }, 413);
    }

    await next();
  };
}

/**
 * Input sanitization middleware
 */
export function inputSanitizationMiddleware() {
  return async (c: Context, next: Next) => {
    // Sanitize query parameters
    const url = new URL(c.req.url);
    let modified = false;

    for (const [key, value] of url.searchParams.entries()) {
      // Remove potential XSS vectors
      const sanitized = value
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '');

      if (sanitized !== value) {
        console.warn(`⚠️ Potentially malicious input sanitized: ${key}=${value}`);
        url.searchParams.set(key, sanitized);
        modified = true;
      }
    }

    if (modified) {
      // Rebuild the request with sanitized query parameters
      const sanitizedRequest = new Request(url.toString(), c.req.raw);
      c.req.raw = sanitizedRequest;
    }

    await next();
  };
}

/**
 * Webhook signature validation
 */
export function webhookSignatureMiddleware(platform: 'instagram') {
  return async (c: Context, next: Next) => {
    const config = getConfig();
    const signature = c.req.header('X-Hub-Signature-256');
    
    if (!signature) {
      return c.json({
        error: 'Missing signature',
        code: 'WEBHOOK_SIGNATURE_MISSING'
      }, 400);
    }

    // Get raw body for signature verification without consuming original
    const clonedRequest = c.req.raw.clone();
    const rawBody = await clonedRequest.text();

    // Reattach body so downstream handlers can access it
    c.req.raw = new Request(c.req.raw, { body: rawBody });

    const secret = config.instagram.metaAppSecret;

    // Verify HMAC-SHA256 signature
    const crypto = await import('crypto');
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const providedSignature = signature.replace('sha256=', '');

    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const providedBuffer = Buffer.from(providedSignature, 'hex');

    // Compare lengths before timingSafeEqual
    if (expectedBuffer.length !== providedBuffer.length) {
      return c.json({
        error: 'Invalid signature',
        code: 'WEBHOOK_SIGNATURE_INVALID'
      }, 401);
    }

    if (!crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
      console.error('❌ Webhook signature verification failed', {
        provided: providedSignature.substring(0, 8) + '...',
        expected: expectedSignature.substring(0, 8) + '...'
      });

      return c.json({
        error: 'Invalid signature',
        code: 'WEBHOOK_SIGNATURE_INVALID'
      }, 401);
    }

    // Store validated body for processing
    c.set('validatedWebhookBody', rawBody);
    
    await next();
  };
}

/**
 * API rate limiting with Meta integration
 */
export function apiRateLimitMiddleware() {
  return async (c: Context, next: Next) => {
    const rateLimiter = getMetaRateLimiter();
    
    // Check if we should back off
    const backoffState = rateLimiter.shouldBackOff();
    if (backoffState.isBackingOff) {
      const waitSeconds = Math.ceil((backoffState.backoffUntil - Date.now()) / 1000);
      
      c.header('Retry-After', waitSeconds.toString());
      
      return c.json({
        error: 'Service temporarily unavailable',
        message: `Rate limit backoff active. Retry in ${waitSeconds} seconds.`,
        code: 'RATE_LIMIT_BACKOFF',
        retryAfter: waitSeconds
      }, 503);
    }

    await next();
  };
}

/**
 * Error handling middleware
 */
export function errorHandlingMiddleware() {
  return async (c: Context, next: Next) => {
    try {
      await next();
    } catch (error) {
      console.error('❌ Unhandled error:', error);
      
      const config = getConfig();
      const isDev = config.environment === 'development';
      
      return c.json({
        error: 'Internal server error',
        message: isDev ? (error as Error).message : 'Something went wrong',
        code: 'INTERNAL_ERROR',
        ...(isDev && { stack: error.stack })
      }, 500);
    }
  };
}

/**
 * Trace ID middleware for request tracking
 */
export function traceMiddleware() {
  return async (c: Context, next: Next) => {
    const traceId = c.req.header('X-Trace-ID') || crypto.randomUUID();
    
    c.set('traceId', traceId);
    c.header('X-Trace-ID', traceId);
    
    await next();
  };
}

/**
 * Security audit logging
 */
export function auditLogMiddleware() {
  return async (c: Context, next: Next) => {
    const startTime = Date.now();
    const traceId = c.get('traceId');
    const ip = c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP') || 'unknown';
    
    await next();
    
    const duration = Date.now() - startTime;
    const status = c.res.status;
    
    // Log security events
    if (status >= 400) {
      console.warn('🔒 Security event:', {
        traceId,
        method: c.req.method,
        url: c.req.url,
        status,
        ip,
        userAgent: c.req.header('User-Agent'),
        duration
      });
    }
  };
}

/**
 * Combined security middleware setup
 */
export function setupSecurityMiddleware() {
  return [
    traceMiddleware(),
    strictCorsMiddleware(),
    securityHeadersMiddleware(),
    requestValidationMiddleware(),
    inputSanitizationMiddleware(),
    apiRateLimitMiddleware(),
    auditLogMiddleware(),
    errorHandlingMiddleware()
  ];
}

// Global error handler for uncaught errors
export function setupGlobalErrorHandlers() {
  process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });
}

export default {
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
  setupGlobalErrorHandlers
};