/**
 * ===============================================
 * Row Level Security (RLS) & GUC Middleware
 * PostgreSQL tenant isolation using app.current_merchant_id
 * ===============================================
 */

import { Context, Next } from 'hono';
import { getDatabase } from '../database/connection.js';

export interface MerchantIsolationConfig {
  strictMode: boolean; // Fail if no merchant ID found
  allowedPublicPaths: string[]; // Paths that don't require merchant isolation
  headerName: string; // Header to extract merchant ID from
  queryParam?: string; // Optional query parameter for merchant ID
}

const DEFAULT_CONFIG: MerchantIsolationConfig = {
  strictMode: true,
  allowedPublicPaths: ['/health', '/ready', '/webhook', '/auth'],
  headerName: 'x-merchant-id',
  queryParam: 'merchant_id'
};

/**
 * PostgreSQL GUC (Grand Unified Configuration) for merchant isolation
 * Sets app.current_merchant_id which can be used in RLS policies
 */
export function createMerchantIsolationMiddleware(
  config: Partial<MerchantIsolationConfig> = {}
) {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  return async (c: Context, next: Next) => {
    try {
      const path = c.req.path;
      
      // Skip isolation for public paths
      if (finalConfig.allowedPublicPaths.some(publicPath => path.startsWith(publicPath))) {
        await next();
        return;
      }
      
      // Extract merchant ID from header or query parameter
      let merchantId = c.req.header(finalConfig.headerName);
      if (!merchantId && finalConfig.queryParam) {
        merchantId = c.req.query(finalConfig.queryParam);
      }
      
      if (!merchantId) {
        if (finalConfig.strictMode) {
          return c.json({
            error: 'Missing merchant identification',
            code: 'MERCHANT_ID_REQUIRED',
            message: `Merchant ID must be provided via ${finalConfig.headerName} header or ${finalConfig.queryParam} query parameter`
          }, 400);
        } else {
          console.warn(`⚠️ No merchant ID found for path: ${path}`);
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
        
        console.log(`🔒 RLS: Set merchant isolation for ${merchantId} on path ${path}`);
        
        await next();
        
      } catch (dbError) {
        console.error('❌ Failed to set merchant isolation in database:', dbError);
        
        if (finalConfig.strictMode) {
          return c.json({
            error: 'Database isolation setup failed',
            code: 'DB_ISOLATION_ERROR'
          }, 500);
        } else {
          // Continue without DB isolation in non-strict mode
          await next();
        }
      }
      
    } catch (error) {
      console.error('❌ Merchant isolation middleware error:', error);
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