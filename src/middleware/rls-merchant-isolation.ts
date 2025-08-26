/**
 * ===============================================
 * Row Level Security (RLS) & GUC Middleware
 * PostgreSQL tenant isolation using app.current_merchant_id
 * ===============================================
 */

import { Context, Next } from 'hono';
import { getDatabase } from '../db/adapter.js';
import { getLogger } from '../services/logger.js';
import { serr } from '../isolation/context.js';
import * as jwt from 'jsonwebtoken';

const log = getLogger({ component: 'rls-merchant-isolation' });

/**
 * Validate and extract merchant ID from JWT token
 */
async function validateAndExtractMerchantId(c: Context, config: MerchantIsolationConfig): Promise<string | null> {
  const headerValue = c.req.header(config.headerName);
  if (!headerValue) return null;
  
  // التحقق من JWT token بدلاً من header مباشر
  const authHeader = c.req.header('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing authentication');
  }
  
  const token = authHeader.slice(7);
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error('JWT_SECRET not configured');
  }
  
  try {
    const payload = jwt.verify(token, jwtSecret);
    return (payload as any).merchantId || null;
  } catch (error) {
    throw new Error('Invalid authentication token');
  }
}

export interface MerchantIsolationConfig {
  strictMode: boolean; // Fail if no merchant ID found
  softMode: boolean; // Allow requests without merchant ID with logging
  allowedPublicPaths: string[]; // Paths that don't require merchant isolation
  headerName: string; // Header to extract merchant ID from
  queryParam?: string; // Optional query parameter for merchant ID
  rateLimitConfig?: {
    maxFailedAttempts: number;
    windowMs: number;
    blockDurationMs: number;
  };
  securityConfig?: {
    enableIPBlocking: boolean;
    suspiciousIPs: string[];
    enableAuditLogging: boolean;
    enableCORS: boolean;
  };
}

const DEFAULT_CONFIG: MerchantIsolationConfig = {
  strictMode: false,
  softMode: true,
  allowedPublicPaths: ['/', '/health', '/ready', '/webhooks/instagram', '/internal/diagnostics/meta-ping', '/webhook', '/auth', '/favicon.ico', '/robots.txt'],
  headerName: 'x-merchant-id',
  queryParam: 'merchant_id',
  rateLimitConfig: {
    maxFailedAttempts: 5,
    windowMs: 60000, // 1 minute
    blockDurationMs: 300000 // 5 minutes
  },
  securityConfig: {
    enableIPBlocking: true,
    suspiciousIPs: [],
    enableAuditLogging: true,
    enableCORS: true
  }
};

/**
 * Rate limiting storage for failed attempts
 */
interface RateLimitEntry {
  count: number;
  firstAttempt: Date;
  blockedUntil?: Date;
}

const failedAttempts = new Map<string, RateLimitEntry>();

/**
 * UUID validation regex (RFC 4122 compliant)
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validate UUID format
 */
function isValidUUID(uuid: string): boolean {
  return UUID_REGEX.test(uuid);
}

/**
 * Get client IP address
 */
function getClientIP(c: Context): string {
  const forwardedFor = c.req.header('x-forwarded-for');
  const realIP = c.req.header('x-real-ip');
  const cfConnectingIP = c.req.header('cf-connecting-ip');
  
  if (forwardedFor) {
    // Take the first IP from X-Forwarded-For
    const firstIP = forwardedFor.split(',')[0];
    return firstIP ? firstIP.trim() : (realIP || cfConnectingIP || 'unknown');
  }
  
  return realIP || cfConnectingIP || 'unknown';
}

/**
 * Check if IP is blocked
 */
function isIPBlocked(ip: string, config: MerchantIsolationConfig): boolean {
  if (!config.securityConfig?.enableIPBlocking) {
    return false;
  }

  // Check suspicious IPs list
  if (config.securityConfig.suspiciousIPs.includes(ip)) {
    return true;
  }

  // Check rate limiting
  const entry = failedAttempts.get(ip);
  if (entry?.blockedUntil && new Date() < entry.blockedUntil) {
    return true;
  }

  return false;
}

/**
 * Record failed attempt
 */
function recordFailedAttempt(ip: string, config: MerchantIsolationConfig): void {
  const now = new Date();
  const entry = failedAttempts.get(ip) || {
    count: 0,
    firstAttempt: now
  };

  entry.count++;
  
  // Block IP if too many failed attempts
  if (entry.count >= (config.rateLimitConfig?.maxFailedAttempts || 5)) {
    entry.blockedUntil = new Date(now.getTime() + (config.rateLimitConfig?.blockDurationMs || 300000));
  }

  failedAttempts.set(ip, entry);
}

/**
 * Log security event
 */
function logSecurityEvent(
  event: string,
  details: Record<string, unknown>,
  config: MerchantIsolationConfig
): void {
  if (!config.securityConfig?.enableAuditLogging) {
    return;
  }

  log.warn('🔒 Security event detected', {
    event,
    timestamp: new Date().toISOString(),
    ...details
  });
}

/**
 * PostgreSQL GUC (Grand Unified Configuration) for merchant isolation
 * Sets app.current_merchant_id which can be used in RLS policies
 */
export function createMerchantIsolationMiddleware(
  config: Partial<MerchantIsolationConfig> = {}
) {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  // Simplified query getter
  const getQuery = (c: Context, name: string): string | undefined => {
    try {
      const url = new URL(c.req.url);
      return url.searchParams.get(name) || undefined;
    } catch {
      return undefined;
    }
  };
  
  return async (c: Context, next: Next): Promise<Response | void> => {
    const startTime = Date.now();
    const clientIP = getClientIP(c);
    
    try {
      // Handle CORS preflight requests
      if (finalConfig.securityConfig?.enableCORS && c.req.method === 'OPTIONS') {
        return new Response(null, {
          status: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-merchant-id',
            'Access-Control-Max-Age': '86400'
          }
        });
      }

      // Skip isolation for HEAD method
      if (c.req.method === 'HEAD') {
        return await next();
      }

      // Simplified path extraction
      const path = c.req.path || '/';
      
      // Skip webhooks immediately (before any checks)
      if (path === '/webhooks/instagram' || path.startsWith('/webhooks/instagram/')) {
        await next();
        return;
      }
      
      // Check if IP is blocked
      if (isIPBlocked(clientIP, finalConfig)) {
        logSecurityEvent('IP_BLOCKED', {
          ip: clientIP,
          path,
          userAgent: c.req.header('user-agent')
        }, finalConfig);
        
        return c.json({
          error: 'Access denied',
          code: 'ACCESS_DENIED'
        }, 403);
      }
      
      // Skip isolation for public paths
      const isPublic = finalConfig.allowedPublicPaths.some(p =>
        p === '/' ? path === '/' : (path === p || path.startsWith(p + '/'))
      );
        
      if (isPublic) {
        await next();
        return;
      }
      
      // Extract merchant ID with JWT validation
      let merchantId: string | null = null;
      try {
        merchantId = await validateAndExtractMerchantId(c, finalConfig);
      } catch (error) {
        // Fallback to query parameter if JWT validation fails
        if (finalConfig.queryParam) {
          const queryValue = getQuery(c, finalConfig.queryParam);
          merchantId = queryValue || null;
        }
      }
      
      if (!merchantId) {
        if (finalConfig.strictMode) {
          recordFailedAttempt(clientIP, finalConfig);
          
          logSecurityEvent('MISSING_MERCHANT_ID', {
            ip: clientIP,
            path,
            userAgent: c.req.header('user-agent')
          }, finalConfig);
          
          return c.json({
            error: 'Authentication required',
            code: 'AUTH_REQUIRED'
          }, 401);
        } else if (finalConfig.softMode) {
          log.info('No merchant ID found - proceeding in soft mode', {
            path,
            ip: clientIP
          });
          
          await next();
          return;
        } else {
          await next();
          return;
        }
      }
      
      // Validate merchant ID format (UUID)
      if (!isValidUUID(merchantId)) {
        recordFailedAttempt(clientIP, finalConfig);
        
        logSecurityEvent('INVALID_MERCHANT_ID', {
          ip: clientIP,
          path,
          userAgent: c.req.header('user-agent')
        }, finalConfig);
        
        return c.json({
          error: 'Invalid authentication',
          code: 'INVALID_AUTH'
        }, 401);
      }
      
      // Set merchant ID in context for other middleware/handlers
      c.set('merchantId', merchantId);
      
      // Set PostgreSQL application variable for RLS
      const db = getDatabase();
      const sql = db.getSQL();
      
      try {
        // Use unified context function from migration 037
        await sql`SELECT set_merchant_context(${merchantId}::uuid)`;
        
        log.info('RLS merchant isolation activated', {
          merchantId: merchantId.substring(0, 8) + '...', // Mask sensitive data
          path,
          method: c.req.method,
          ip: clientIP,
          duration: Date.now() - startTime
        });
        
        await next();
        
      } catch (dbError) {
        log.error('Merchant isolation failed', {
          error: serr(dbError),
          path,
          merchantId: merchantId.substring(0, 8) + '...' // Mask sensitive data
        });

        if (finalConfig.strictMode) {
          return c.json({
            error: 'Service temporarily unavailable',
            code: 'SERVICE_UNAVAILABLE'
          }, 503);
        } else if (finalConfig.softMode) {
          log.warn('Database isolation failed - continuing in soft mode', {
            error: serr(dbError),
            path
          });
          await next();
        } else {
          await next();
        }
      }
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      log.error('Merchant isolation middleware error', {
        error: serr(error),
        path: c.req.path,
        ip: clientIP,
        duration
      });
      
      return c.json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      }, 500);
    }
  };
}

/**
 * Helper function to get current merchant ID from context
 */
export function getCurrentMerchantId(c: Context): string | undefined {
  return c.get('merchantId');
}

/**
 * Helper function to ensure merchant ID exists in context
 */
export function requireMerchantId(c: Context): string {
  const merchantId = getCurrentMerchantId(c);
  if (!merchantId) {
    throw new Error('Merchant ID required but not found in context');
  }
  return merchantId;
}

/**
 * Create SQL template with automatic merchant isolation
 * This ensures all queries automatically filter by current merchant
 */
export function createMerchantSQL(sql: any) {
  return {
    /**
     * Execute query with automatic merchant verification
     */
    async withMerchantCheck<T>(query: Promise<T>, merchantId?: string): Promise<T> {
      if (merchantId) {
        // Verify the merchant matches the one set in GUC
        const currentMerchant = await sql`SELECT current_setting('app.current_merchant_id', true) as merchant_id`;
        if (currentMerchant[0]?.merchant_id !== merchantId) {
          throw new Error('Merchant ID mismatch - possible security violation');
        }
      }
      
      return query;
    },
    
    /**
     * Get current merchant ID from PostgreSQL GUC
     */
    async getCurrentMerchant(): Promise<string | null> {
      try {
        const result = await sql`SELECT current_merchant_id() as merchant_id`;
        return result[0]?.merchant_id || null;
      } catch (error) {
        log.warn('Could not get current merchant from unified function', { error: serr(error) });
        return null;
      }
    }
  };
}

/**
 * Clear rate limiting data (for testing/admin purposes)
 */
export function clearRateLimitData(): void {
  failedAttempts.clear();
}

/**
 * Get rate limiting statistics
 */
export function getRateLimitStats(): {
  totalBlockedIPs: number;
  blockedIPs: string[];
  totalFailedAttempts: number;
} {
  const blockedIPs = Array.from(failedAttempts.entries())
    .filter(([_, entry]) => entry.blockedUntil && new Date() < entry.blockedUntil)
    .map(([ip, _]) => ip);

  const totalFailedAttempts = Array.from(failedAttempts.values())
    .reduce((sum, entry) => sum + entry.count, 0);

  return {
    totalBlockedIPs: blockedIPs.length,
    blockedIPs,
    totalFailedAttempts
  };
}

export default createMerchantIsolationMiddleware;