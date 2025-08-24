/**
 * ===============================================
 * RLS Database Wrapper (2025 Security Standards)
 * ✅ تطبيق تلقائي لـ Row Level Security
 * ===============================================
 */

import { randomUUID } from 'crypto';
import { getDatabase } from '../db/adapter.js';
import { getLogger } from '../services/logger.js';
import { withTx } from '../db/index.js';
import type { Sql } from '../types/sql.js';
import type { SqlFunction } from '../db/sql-template.js';
import { q } from '../db/safe-query.js';
import { RlsContextRow } from '../types/db-schemas.js';
import { must } from '../utils/safety.js';

const log = getLogger({ component: 'rls-wrapper' });

export interface RLSContext {
  merchantId?: string;
  isAdmin?: boolean;
  userId?: string;
  sessionId?: string;
}

export class RLSDatabase {
  private db = getDatabase();
  private currentContext: RLSContext = {};
  private readonly TRANSACTION_TIMEOUT = 30000; // 30 seconds

  /**
   * Validate UUID format
   */
  private validateUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  /**
   * Set merchant context for RLS
   */
  async setMerchantContext(merchantId: string, userId?: string): Promise<void> {
    // Input validation
    if (!merchantId) {
      throw new Error('merchantId is required for RLS context');
    }

    if (!this.validateUUID(merchantId)) {
      throw new Error(`Invalid merchantId format: ${merchantId}. Expected UUID format.`);
    }

    const sql: SqlFunction = this.db.getSQL();
    const originalContext = { ...this.currentContext };
    
    try {
      // سياق محلي داخل التراكنشن
      await sql`SET LOCAL app.tenant_id = ${merchantId}`;
      await sql`SET LOCAL app.current_merchant_id = ${merchantId}`;
      
      this.currentContext = {
        merchantId,
        ...(userId ? { userId } : {}),
        isAdmin: false,
        sessionId: this.generateSessionId()
      };

      log.info('✅ RLS merchant context set successfully', { 
        merchantId, 
        ...(userId && { userId }), 
        ...(this.currentContext.sessionId && { sessionId: this.currentContext.sessionId })
      });
    } catch (error) {
      // Restore original context on failure
      this.currentContext = originalContext;
      log.error('❌ Failed to set RLS merchant context:', error);
      throw new Error(`Failed to set RLS merchant context: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Set admin context (bypass RLS)
   */
  async setAdminContext(
    isAdmin: boolean = true,
    userId?: string,
    authorized = false
  ): Promise<void> {
    // Security check for production
    if (process.env.NODE_ENV === 'production' && !authorized) {
      log.error('🚨 Unauthorized admin context access attempt in production', { userId });
      throw new Error('setAdminContext is restricted in production');
    }

    const sql: SqlFunction = this.db.getSQL();
    const originalContext = { ...this.currentContext };
    
    try {
      await sql`SET LOCAL app.is_admin = ${isAdmin ? 'true' : 'false'}`;

      this.currentContext = {
        isAdmin,
        ...(userId ? { userId } : {}),
        sessionId: this.generateSessionId()
      };

      await this.logAudit('set_admin_context', userId, { isAdmin, authorized });
      
      log.info('✅ RLS admin context set successfully', { 
        isAdmin, 
        ...(userId && { userId }), 
        authorized,
        ...(this.currentContext.sessionId && { sessionId: this.currentContext.sessionId })
      });
    } catch (error) {
      // Restore original context on failure
      this.currentContext = originalContext;
      log.error('❌ Failed to set RLS admin context:', error);
      throw new Error(`Failed to set RLS admin context: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Clear all RLS context
   */
  async clearContext(): Promise<void> {
    const sql: SqlFunction = this.db.getSQL();
    const originalContext = { ...this.currentContext };
    
    try {
      // Clear all LOCAL settings (automatic at transaction end for pooled connections)
      await sql`SET LOCAL app.tenant_id = DEFAULT`;
      await sql`SET LOCAL app.current_merchant_id = DEFAULT`;
      await sql`SET LOCAL app.is_admin = DEFAULT`;
      this.currentContext = {};
      
      log.info('✅ RLS context cleared successfully');
    } catch (error) {
      // Restore original context on failure
      this.currentContext = originalContext;
      log.warn('⚠️ Failed to clear RLS context, context will be cleared at transaction end', { error: error instanceof Error ? error.message : String(error) });
      // Silently fail - context will be cleared at transaction end anyway
    }
  }

  /**
   * Validate current RLS context
   */
  async validateContext(): Promise<{
    hasMerchantContext: boolean;
    merchantId?: string;
    isAdmin: boolean;
    contextAgeSeconds: number;
    isValid: boolean;
  }> {
    try {
      const userId = this.currentContext.userId ?? 'system';
      const rows = await q(RlsContextRow, 'select * from get_rls_context($1)', [userId]);
      const r = must(rows[0], 'RLS: empty');
      
      const result = {
        hasMerchantContext: r.has_merchant_context,
        ...(r.merchant_id ? { merchantId: r.merchant_id } : {}),
        isAdmin: r.is_admin,
        contextAgeSeconds: r.context_age_seconds,
        isValid: r.has_merchant_context || r.is_admin
      };

      if (!result.isValid) {
        log.warn('⚠️ Invalid RLS context detected', result);
      }

      return result;
    } catch (error) {
      log.error('❌ Failed to validate RLS context:', error);
      return {
        hasMerchantContext: false,
        isAdmin: false,
        contextAgeSeconds: 0,
        isValid: false
      };
    }
  }

  /**
   * Execute query with automatic context validation
   */
  async query<T extends { [key: string]: unknown } = { [key: string]: unknown }>(strings: TemplateStringsArray, ...params: unknown[]): Promise<T[]> {
    // التحقق من السياق قبل التنفيذ
    const contextValidation = await this.validateContext();

    if (!contextValidation.isValid) {
      log.error('❌ Invalid RLS context for query execution', contextValidation);
      throw new RLSContextError(
        'No valid RLS context set. Call setMerchantContext() or setAdminContext() first.',
        contextValidation
      );
    }

    const sql: SqlFunction = this.db.getSQL();
    try {
      const result = await sql<T>(strings, ...params);
      log.debug('✅ Query executed successfully with RLS context', { 
        contextValidation,
        resultCount: result.length 
      });
      return result;
    } catch (error) {
      log.error('❌ Query execution failed with RLS context:', error);
      throw error;
    }
  }

  /**
   * Execute query in transaction with RLS
   */
  async transaction<T>(
    callback: (sql: Sql) => Promise<T>,
    merchantId?: string
  ): Promise<T> {
    // Input validation for merchantId
    if (merchantId && !this.validateUUID(merchantId)) {
      throw new Error(`Invalid merchantId format: ${merchantId}. Expected UUID format.`);
    }

    const sql: SqlFunction = this.db.getSQL();
    const originalContext = { ...this.currentContext };
    
    try {
      return await sql.transaction(async (trx: SqlFunction) => {
        // إعداد السياق داخل التراكنشن
        if (merchantId) {
          await trx`SELECT set_merchant_context(${merchantId}::uuid)`;
        } else if (this.currentContext.merchantId) {
          await trx`SELECT set_merchant_context(${this.currentContext.merchantId}::uuid)`;
        } else if (this.currentContext.isAdmin) {
          await trx`SELECT set_admin_context(${this.currentContext.isAdmin})`;
        }

        return await callback(trx as unknown as Sql);
      }) as T;
    } catch (error) {
      // Restore original context on failure
      this.currentContext = originalContext;
      log.error('❌ Transaction failed with RLS context:', error);
      throw error;
    }
  }

  /**
   * Get current context
   */
  getCurrentContext(): RLSContext {
    return { ...this.currentContext };
  }

  /**
   * Execute query as specific merchant (temporary context)
   */
  async queryAsMerchant<T>(
    merchantId: string,
    callback: () => Promise<T>
  ): Promise<T> {
    // Input validation
    if (!this.validateUUID(merchantId)) {
      throw new Error(`Invalid merchantId format: ${merchantId}. Expected UUID format.`);
    }

    const originalContext = { ...this.currentContext };
    
    try {
      await this.setMerchantContext(merchantId);
      const result = await callback();
      log.info('✅ Query executed successfully as merchant', { merchantId });
      return result;
    } catch (error) {
      log.error('❌ Query execution failed as merchant:', error);
      throw error;
    } finally {
      // استرجاع السياق الأصلي
      try {
        if (originalContext.merchantId) {
          await this.setMerchantContext(originalContext.merchantId);
        } else if (originalContext.isAdmin) {
          await this.setAdminContext(originalContext.isAdmin);
        } else {
          await this.clearContext();
        }
        log.debug('✅ Original RLS context restored');
      } catch (restoreError) {
        log.error('❌ Failed to restore original RLS context:', restoreError);
        // Don't throw here as it would mask the original error
      }
    }
  }

  /**
   * Get stats about RLS usage
   */
  async getRLSStats(): Promise<{
    activeContexts: number;
    merchantQueries: number;
    adminQueries: number;
    failedContexts: number;
  }> {
    try {
      const sql = this.db.getSQL();
      const stats = await sql`
        SELECT 
          COUNT(*) FILTER (WHERE app.current_merchant_id IS NOT NULL) as merchant_contexts,
          COUNT(*) FILTER (WHERE app.is_admin = true) as admin_contexts,
          COUNT(*) FILTER (WHERE app.current_merchant_id IS NULL AND app.is_admin = false) as failed_contexts
        FROM pg_stat_activity 
        WHERE state = 'active'
      `;
      
      return {
        activeContexts: Number(stats[0]?.merchant_contexts || 0) + Number(stats[0]?.admin_contexts || 0),
        merchantQueries: Number(stats[0]?.merchant_contexts || 0),
        adminQueries: Number(stats[0]?.admin_contexts || 0),
        failedContexts: Number(stats[0]?.failed_contexts || 0)
      };
    } catch (error) {
      log.error('❌ Failed to get RLS stats:', error);
      return {
        activeContexts: 0,
        merchantQueries: 0,
        adminQueries: 0,
        failedContexts: 0
      };
    }
  }

  /**
   * Generate session ID for tracking
   */
  private generateSessionId(): string {
    return `rls_${Date.now()}_${randomUUID()}`;
  }

  /**
   * Internal helper to log security-related actions
   */
  private async logAudit(action: string, userId?: string, details?: Record<string, unknown>): Promise<void> {
    try {
      const sql = this.db.getSQL();
      await sql`
        INSERT INTO audit_logs (
          action,
          entity_type,
          details,
          performed_by,
          created_at
        ) VALUES (
          ${action},
          'RLS_CONTEXT',
          ${details ? JSON.stringify(details) : null},
          ${userId ?? null},
          NOW()
        )
      `;
      log.debug('✅ Audit log entry created', { action, ...(userId && { userId }) });
    } catch (error) {
      log.error('❌ Failed to log audit event:', error);
      // Don't throw as audit logging should not break main functionality
    }
  }

  /**
   * Get raw database connection (SECURED - requires admin context)
   */
  getRawDatabase() {
    // Security check - only allow in admin context
    if (!this.currentContext.isAdmin) {
      log.error('🚨 Unauthorized attempt to access raw database without admin context');
      throw new Error('Raw database access requires admin context');
    }

    // Additional security check for production
    if (process.env.NODE_ENV === 'production') {
      log.warn('⚠️ Raw database access in production environment', {
        ...(this.currentContext.userId && { userId: this.currentContext.userId }),
        ...(this.currentContext.sessionId && { sessionId: this.currentContext.sessionId })
      });
    }

    log.warn('⚠️ Getting raw database connection - RLS bypassed!', {
      ...(this.currentContext.userId && { userId: this.currentContext.userId }),
      ...(this.currentContext.sessionId && { sessionId: this.currentContext.sessionId })
    });
    
    return this.db;
  }
}

/**
 * RLS Context Error
 */
export class RLSContextError extends Error {
  constructor(
    message: string,
    public readonly contextInfo: {
      hasMerchantContext: boolean;
      merchantId?: string;
      isAdmin: boolean;
      contextAgeSeconds: number;
      isValid: boolean;
    }
  ) {
    super(message);
    this.name = 'RLSContextError';
  }
}

// Singleton instance
let rlsDatabaseInstance: RLSDatabase | null = null;

/**
 * Get RLS database instance
 */
export function getRLSDatabase(): RLSDatabase {
  if (!rlsDatabaseInstance) {
    rlsDatabaseInstance = new RLSDatabase();
    log.info('✅ RLS Database instance created');
  }
  return rlsDatabaseInstance;
}

/**
 * Helper: Execute with merchant context
 */
export async function withMerchantContext<T>(
  merchantId: string,
  callback: (db: RLSDatabase) => Promise<T>
): Promise<T> {
  // Input validation
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(merchantId)) {
    throw new Error(`Invalid merchantId format: ${merchantId}. Expected UUID format.`);
  }

  const db = getRLSDatabase();
  const originalContext = db.getCurrentContext();
  
  try {
    await db.setMerchantContext(merchantId);
    const result = await callback(db);
    log.info('✅ withMerchantContext executed successfully', { merchantId });
    return result;
  } catch (error) {
    log.error('❌ withMerchantContext execution failed:', error);
    throw error;
  } finally {
    // استرجاع السياق الأصلي
    try {
      if (originalContext.merchantId) {
        await db.setMerchantContext(originalContext.merchantId);
      } else if (originalContext.isAdmin) {
        await db.setAdminContext(originalContext.isAdmin);
      } else {
        await db.clearContext();
      }
      log.debug('✅ Original RLS context restored in withMerchantContext');
    } catch (restoreError) {
      log.error('❌ Failed to restore original RLS context in withMerchantContext:', restoreError);
    }
  }
}

/**
 * Helper: Execute with admin context
 */
export async function withAdminContext<T>(
  callback: (db: RLSDatabase) => Promise<T>,
  authorized = false
): Promise<T> {
  const db = getRLSDatabase();
  const originalContext = db.getCurrentContext();
  
  try {
    await db.setAdminContext(true, undefined, authorized);
    const result = await callback(db);
    log.info('✅ withAdminContext executed successfully', { authorized });
    return result;
  } catch (error) {
    log.error('❌ withAdminContext execution failed:', error);
    throw error;
  } finally {
    // استرجاع السياق الأصلي
    try {
      if (originalContext.merchantId) {
        await db.setMerchantContext(originalContext.merchantId);
      } else {
        await db.clearContext();
      }
      log.debug('✅ Original RLS context restored in withAdminContext');
    } catch (restoreError) {
      log.error('❌ Failed to restore original RLS context in withAdminContext:', restoreError);
    }
  }
}

export default RLSDatabase;
