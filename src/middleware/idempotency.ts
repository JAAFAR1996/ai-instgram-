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
    let rawBody: string | undefined;
    try {
      const clonedRequest = c.req.raw.clone();
      rawBody = await clonedRequest.text();
      if (rawBody) {
        const bodyHash = crypto
          .createHash('sha256')
          .update(rawBody)
          .digest('hex')
          .substring(0, 16);
        keyData += `:${bodyHash}`;
      }
    } catch (error) {
      // If body parsing fails, continue without body hash
    }

    // Restore original request body so downstream handlers can read it
    if (rawBody !== undefined) {
      c.req.raw = new Request(c.req.raw, { body: rawBody });
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
export function hashMerchantAndBody(merchantId: string, body: any): string {
  const content = `${merchantId}:${JSON.stringify(body)}`;
  return crypto.createHash('sha256').update(content).digest('hex');
}

export default createIdempotencyMiddleware;