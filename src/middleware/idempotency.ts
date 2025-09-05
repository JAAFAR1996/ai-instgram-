/**
 * ===============================================
 * Idempotency Middleware - Prevent Duplicate Requests
 * Ensures webhook and API requests are processed only once
 * Compatible with Hono framework
 * ===============================================
 */

import * as crypto from 'crypto';
import { Context, Next } from 'hono';
import { getRedisConnectionManager } from '../services/RedisConnectionManager.js';
import { RedisUsageType } from '../config/RedisConfigurationFactory.js';
import { getLogger } from '../services/logger.js';
import { MerchantIdMissingError } from '../utils/merchant.js';
import { createSafeErrorHandler } from '../utils/safe-error-handler.js';

export interface IdempotencyConfig {
  ttlSeconds: number;
  keyPrefix: string;
  hashMerchantAndBody: boolean;
  skipMethods?: string[];
}

export type IdempotencyResponse<T> = {
  status: number;
  body: T;
  headers?: Record<string, string>;
};

// Constants for context keys
const K_IDEMPOTENCY_KEY = 'idempotencyKey';
const K_IDEMPOTENCY_TTL = 'idempotencyTtl';
const K_CACHE_FLAG = 'cacheIdempotency';
const K_RESP = 'idempotencyResponse';
const logger = getLogger({ component: 'IdempotencyMiddleware' });

// Create error handler instance
const errorHandler = createSafeErrorHandler('IdempotencyMiddleware');

const DEFAULT_CONFIG: IdempotencyConfig = {
  ttlSeconds: 3600, // 1 hour
  keyPrefix: 'idempotency',
  hashMerchantAndBody: true,
  skipMethods: ['GET', 'HEAD', 'OPTIONS']
};

/**
 * Generate idempotency key from Hono context
 */
async function generateIdempotencyKey(
  c: Context,
  config: IdempotencyConfig
): Promise<string> {
  const merchantId = c.req.header('x-merchant-id') || 'unknown';
  const method = c.req.method;
  const path = c.req.path;
  
  let keyData = `${method}:${path}:${merchantId}`;
  
  // Hash merchant ID and request body for uniqueness
  if (config.hashMerchantAndBody && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    try {
      const raw = (c.get as unknown as (k: string) => unknown)?.('rawBody') as string | undefined;
      if (raw && raw.length > 0) {
        const head = raw.length > 4096 ? raw.slice(0, 4096) : raw;
        const bodyHash = crypto.createHash('sha256').update(head).digest('hex').substring(0, 16);
        keyData += `:${bodyHash}`;
      } else {
        logger.debug?.('No rawBody available; skipping body hash in idempotency key', {
          requestPath: c.req.path,
          requestMethod: c.req.method,
          merchantId
        });
      }
    } catch (error) {
      // If body handling fails, log and continue without body hash
      logger.warn('Body handling failed while generating idempotency key; continuing without body hash', {
        error: error instanceof Error ? { message: error.message, name: error.name, stack: error.stack } : { message: String(error) },
        requestPath: c.req.path,
        requestMethod: c.req.method,
        merchantId
      });
    }
  }
  
  // Hash webhook signature if present
  const signature = c.req.header('x-hub-signature-256');
  if (signature) {
    const sigHash = crypto
      .createHash('sha256')
      .update(signature)
      .digest('hex')
      .substring(0, 8);
    keyData += `:sig:${sigHash}`;
  }
  
  return `${config.keyPrefix}:${keyData}`;
}

/**
 * Idempotency middleware factory for Hono
 */
export function createIdempotencyMiddleware(
  config: Partial<IdempotencyConfig> = {}
) {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  return async (c: Context, next: Next): Promise<Response | void> => {
    try {
      // Pre-read request body once (for text/json types) and store in context
      const contentType = c.req.header('content-type') ?? '';
      const isTextual = contentType.startsWith('application/json') || contentType.startsWith('text/');
      let rawBody = '';
      if (isTextual && (c.req.method === 'POST' || c.req.method === 'PUT' || c.req.method === 'PATCH')) {
        try {
          rawBody = await c.req.text();
        } catch {}
        if (rawBody) {
          (c as unknown as { set: (k: string, v: unknown) => void }).set('rawBody', rawBody);
          if (contentType.startsWith('application/json')) {
            try {
              (c as unknown as { set: (k: string, v: unknown) => void }).set('jsonBody', JSON.parse(rawBody));
            } catch {}
          }
        }
      }

      // Skip idempotency check for certain methods
      if (finalConfig.skipMethods?.includes(c.req.method)) {
        return await next();
      }
      
      const idempotencyKey = await generateIdempotencyKey(c, finalConfig);
      
      // Safe Redis operation with fallback
      const redisResult = await getRedisConnectionManager().safeRedisOperation(
        RedisUsageType.IDEMPOTENCY,
        async (redis) => await redis.get(idempotencyKey)
      );
      
      const existingResult = redisResult.ok ? redisResult.result : null;
      
      // إذا كان Redis غير متاح، نستمر بدون idempotency
      if (redisResult.skipped) {
        logger.info('Redis not available, continuing without idempotency check');
        await next();
        return;
      }
      
      if (existingResult) {
        let parsed;
        try {
          parsed = JSON.parse(existingResult);
        } catch (err) {
          const safeError = errorHandler.handleError(err, {
            operation: 'parse_cache_entry',
            requestPath: c.req.path,
            requestMethod: c.req.method,
            merchantId: c.req.header('x-merchant-id')
          });
          logger.error('Invalid cache entry', safeError);
          return c.text('Invalid cache entry', 500);
        }
        logger.info(`🔒 Idempotency hit: ${idempotencyKey}`);

        // Return cached response - with safety checks
        if (!parsed || typeof parsed !== 'object' || !('body' in parsed) || !('status' in parsed)) {
          logger.error('Corrupted cache entry - missing required fields', { parsed });
          // Remove corrupted cache entry safely
          await getRedisConnectionManager().safeRedisOperation(
            RedisUsageType.IDEMPOTENCY,
            async (redis) => await redis.del(idempotencyKey)
          );
          // Continue processing instead of returning corrupted data
        } else {
          return c.json(parsed.body, parsed.status, parsed.headers || {});
        }
      }
      
      // Create a flag to track if we should cache response
      c.set(K_IDEMPOTENCY_KEY, idempotencyKey);
      c.set(K_IDEMPOTENCY_TTL, finalConfig.ttlSeconds);
      
      await next();
      
      // Check if response should be cached (handled in individual endpoints)
      const shouldCache = Boolean(c.get(K_CACHE_FLAG));
      const responseData = c.get(K_RESP) as IdempotencyResponse<unknown>;
      
      if (shouldCache && responseData) {
        await getRedisConnectionManager().safeRedisOperation(
          RedisUsageType.IDEMPOTENCY,
          async (redis) => await redis.setex(
            idempotencyKey,
            finalConfig.ttlSeconds,
            JSON.stringify(responseData)
          )
        );
        logger.info(`💾 Cached idempotency result: ${idempotencyKey}`);
      }
      
    } catch (error) {
      if (error instanceof MerchantIdMissingError) {
        return c.json({
          error: 'Merchant ID required',
          code: 'MERCHANT_ID_MISSING'
        }, 400);
      }
      
      const safeError = errorHandler.handleError(error, {
        requestPath: c.req.path,
        requestMethod: c.req.method,
        merchantId: c.req.header('x-merchant-id')
      });
      
      logger.error('❌ Idempotency middleware error', safeError);
      // Continue with normal processing on idempotency errors
      await next();
    }
  };
}

/**
 * Helper function to mark response as idempotent (called from handlers)
 */
export function markIdempotent<T>(
  c: Context,
  status: number,
  body: T,
  headers?: Record<string, string>
): void {
  c.set(K_CACHE_FLAG, true);
  const response: IdempotencyResponse<T> = headers 
    ? { status, body, headers }
    : { status, body };
  c.set(K_RESP, response);
}

/**
 * Hash merchant and body pattern for audit compliance
 */
export function hashMerchantAndBody(merchantId: string, body: unknown): string {
  const content = `${merchantId}:${JSON.stringify(body)}`;
  return crypto.createHash('sha256').update(content).digest('hex');
}

export default createIdempotencyMiddleware;
