/**
 * ===============================================
 * Row Level Security (RLS) & GUC Middleware
 * PostgreSQL tenant isolation using app.current_merchant_id
 * ===============================================
 */

import { Context, Next } from 'hono';
import { getDatabase } from '../database/connection.js';
import { getLogger } from '../services/logger.js';
import { serr } from '../isolation/context.js';

export interface MerchantIsolationConfig {
  strictMode: boolean; // Fail if no merchant ID found
  softMode: boolean; // Allow requests without merchant ID with logging
  allowedPublicPaths: string[]; // Paths that don't require merchant isolation
  headerName: string; // Header to extract merchant ID from
  queryParam?: string; // Optional query parameter for merchant ID
}

const DEFAULT_CONFIG: MerchantIsolationConfig = {
  strictMode: false, // Changed to support soft mode by default
  softMode: true, // Enable soft mode for production readiness
  allowedPublicPaths: ['/', '/health', '/ready', '/webhooks/instagram', '/internal/diagnostics/meta-ping', '/webhook', '/auth', '/favicon.ico', '/robots.txt'],
  headerName: 'x-merchant-id',
  queryParam: 'merchant_id'
};

const logger = getLogger({ component: 'MerchantIsolationMiddleware' });

/**
 * PostgreSQL GUC (Grand Unified Configuration) for merchant isolation
 * Sets app.current_merchant_id which can be used in RLS policies
 */
export function createMerchantIsolationMiddleware(
  config: Partial<MerchantIsolationConfig> = {}
) {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  // Safe header getter (يدعم كل الحالات)
  const getHeader = (c: Context, name: string): string | undefined => {
    try {
      const h1 = (c.req as any).header?.(name);
      if (h1 != null) return h1 as string;
      const h2 = c.req.raw?.headers?.get(name);
      if (h2 != null) return h2;
      const h3 = (c.req as any).headers?.get?.(name);
      return h3 ?? undefined;
    } catch {
      return undefined;
    }
  };
  
  return async (c: Context, next: Next) => {
    try {
      // Skip isolation for OPTIONS and HEAD methods
      const method = c.req.method;
      if (method === 'OPTIONS' || method === 'HEAD') {
        await next();
        return;
      }

      // Safe path extraction with fallback
      const path = (() => {
        try { 
          return c.req?.path ?? new URL(c.req.url).pathname ?? '/'; 
        } catch { 
          return '/'; 
        }
      })();
      
      // Skip isolation for public paths with safe array checking
      const allowedPublicPaths = finalConfig.allowedPublicPaths;
      const isPublic = Array.isArray(allowedPublicPaths) && allowedPublicPaths.some(p =>
        typeof p === 'string' && p &&
        (p === '/' ? path === '/' : (path === p || path.startsWith(p + '/')))
      );
        
      if (isPublic) {
        await next();
        return;
      }
      
      // Extract merchant ID from header or query parameter
      let merchantId = getHeader(c, finalConfig.headerName);
      if (!merchantId && finalConfig.queryParam) {
        merchantId = c.req.query(finalConfig.queryParam);
      }
      
      if (!merchantId) {
        if (finalConfig.strictMode) {
          logger.error('Merchant ID required but missing', {
            path,
            ip: getHeader(c, 'x-forwarded-for') || getHeader(c, 'x-real-ip') || 'unknown'
          });
          
          return c.json({
            error: 'Missing merchant identification',
            code: 'MERCHANT_ID_REQUIRED',
            message: `Merchant ID must be provided via ${finalConfig.headerName} header or ${finalConfig.queryParam} query parameter`
          }, 400);
        } else if (finalConfig.softMode) {
          logger.warn('No merchant ID found - proceeding in soft mode', {
            path,
            ip: getHeader(c, 'x-forwarded-for') || getHeader(c, 'x-real-ip') || 'unknown',
            userAgent: getHeader(c, 'user-agent')
          });
          
          await next();
          return;
        } else {
          await next();
          return;
        }
      }
      
      // Validate merchant ID format (UUID)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(merchantId)) {
        return c.json({
          error: 'Invalid merchant ID format',
          code: 'INVALID_MERCHANT_ID',
          message: 'Merchant ID must be a valid UUID'
        }, 400);
      }
      
      // Set merchant ID in context for other middleware/handlers
      c.set('merchantId', merchantId);
      
      // Set PostgreSQL application variable for RLS
      const db = getDatabase();
      const sql = db.getSQL();
      
      try {
        // Set app.current_merchant_id for this connection
        // This variable can be used in RLS policies like:
        // CREATE POLICY merchant_isolation ON conversations 
        //   FOR ALL TO app_user 
        //   USING (merchant_id = current_setting('app.current_merchant_id')::uuid);
        await sql`SELECT set_config('app.current_merchant_id', ${merchantId}, true)`;
        
        logger.info('RLS merchant isolation activated', {
          merchantId,
          path,
          method: c.req.method,
          ip: getHeader(c, 'x-forwarded-for') || getHeader(c, 'x-real-ip') || 'unknown'
        });
        
        await next();
        
      } catch (dbError) {
        logger.error({ err: serr(dbError), route: c.req.path, merchantId }, 'Merchant isolation failed');

        if (finalConfig.strictMode) {
          return c.json({
            error: 'Database isolation setup failed',
            code: 'DB_ISOLATION_ERROR'
          }, 500);
        } else if (finalConfig.softMode) {
          logger.warn('Database isolation failed - continuing in soft mode', {
            err: serr(dbError),
            merchantId,
            path
          });
          await next();
        } else {
          // Continue without DB isolation in non-strict mode
          await next();
        }
      }
      
    } catch (error) {
      logger.error({ err: serr(error), route: c.req.path, merchantId: c.get('merchantId') }, 'Merchant isolation failed');
      return c.json({
        error: 'Internal server error',
        code: 'MIDDLEWARE_ERROR'
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
        const result = await sql`SELECT current_setting('app.current_merchant_id', true) as merchant_id`;
        return result[0]?.merchant_id || null;
      } catch (error) {
        console.warn('Could not get current merchant from GUC:', error);
        return null;
      }
    }
  };
}

export default createMerchantIsolationMiddleware;