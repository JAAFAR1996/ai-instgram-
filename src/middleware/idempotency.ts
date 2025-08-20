/**
 * ===============================================
 * Idempotency Middleware - Prevent Duplicate Requests
 * Ensures webhook and API requests are processed only once
 * Compatible with Hono framework
 * ===============================================
 */

import crypto from 'crypto';
import { Context, Next } from 'hono';
import { getRedisConnectionManager } from '../services/RedisConnectionManager.js';
import { RedisUsageType } from '../config/RedisConfigurationFactory.js';

export interface IdempotencyConfig {
  ttlSeconds: number;
  keyPrefix: string;
  hashMerchantAndBody: boolean;
  skipMethods?: string[];
}

type IdempotencyResponse = { status: number; body: any; headers?: Record<string, string> };

// Constants for context keys
const K_IDEMPOTENCY_KEY = 'idempotencyKey';
const K_IDEMPOTENCY_TTL = 'idempotencyTtl';
const K_CACHE_FLAG = 'cacheIdempotency';
const K_RESP = 'idempotencyResponse';

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
      const body = await c.req.text();
      if (body) {
        const bodyHash = crypto
          .createHash('sha256')
          .update(body)
          .digest('hex')
          .substring(0, 16);
        keyData += `:${bodyHash}`;
      }
    } catch (error) {
      // If body parsing fails, continue without body hash
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
  
  return async (c: Context, next: Next) => {
    try {
      // Skip idempotency check for certain methods
      if (finalConfig.skipMethods?.includes(c.req.method)) {
        await next();
        return;
      }
      
      const idempotencyKey = await generateIdempotencyKey(c, finalConfig);
      const redis = await getRedisConnectionManager().getConnection(RedisUsageType.IDEMPOTENCY);
      
      // Check if request was already processed
      const existingResult = await redis.get(idempotencyKey);
      
      if (existingResult) {
        const parsed = JSON.parse(existingResult);
        console.log(`🔒 Idempotency hit: ${idempotencyKey}`);
        
        // Return cached response
        return c.json(parsed.body, parsed.status, parsed.headers || {});
      }
      
      // Create a flag to track if we should cache response
      c.set(K_IDEMPOTENCY_KEY, idempotencyKey);
      c.set(K_IDEMPOTENCY_TTL, finalConfig.ttlSeconds);
      
      await next();
      
      // Check if response should be cached (handled in individual endpoints)
      const shouldCache = Boolean(c.get(K_CACHE_FLAG));
      const responseData = c.get(K_RESP) as IdempotencyResponse;
      
      if (shouldCache && responseData) {
        await redis.setex(
          idempotencyKey,
          finalConfig.ttlSeconds,
          JSON.stringify(responseData)
        );
        console.log(`💾 Cached idempotency result: ${idempotencyKey}`);
      }
      
    } catch (error) {
      console.error('❌ Idempotency middleware error:', error);
      // Continue with normal processing on idempotency errors
      await next();
    }
  };
}

/**
 * Helper function to mark response as idempotent (called from handlers)
 */
export function markIdempotent(c: Context, status: number, body: any, headers?: Record<string, string>) {
  c.set(K_CACHE_FLAG, true);
  c.set(K_RESP, { status, body, headers });
}

/**
 * Hash merchant and body pattern for audit compliance
 */
export function hashMerchantAndBody(merchantId: string, body: any): string {
  const content = `${merchantId}:${JSON.stringify(body)}`;
  return crypto.createHash('sha256').update(content).digest('hex');
}

export default createIdempotencyMiddleware;