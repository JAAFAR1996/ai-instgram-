/**
 * ===============================================
 * RLS Database Wrapper (2025 Security Standards)
 * ✅ تطبيق تلقائي لـ Row Level Security
 * ===============================================
 */

import crypto from 'crypto';
import { getDatabase } from '../db/adapter.js';
import type { Sql } from '../types/sql.js';
import type { SqlFunction } from '../db/sql-template.js';
import { q } from '../db/safe-query.js';
import { RlsContextRow } from '../types/db-schemas.js';
import { must } from '../utils/safety.js';

export interface RLSContext {
  merchantId?: string;
  isAdmin?: boolean;
  userId?: string;
  sessionId?: string;
}

export class RLSDatabase {
  private db = getDatabase();
  private currentContext: RLSContext = {};

  /**
   * Set merchant context for RLS
   */
  async setMerchantContext(merchantId: string, userId?: string): Promise<void> {
    if (!merchantId) {
      throw new Error('merchantId is required for RLS context');
    }

    const sql: SqlFunction = this.db.getSQL();
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
    } catch (error) {
      throw new Error('Failed to set RLS merchant context');
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
    if (process.env.NODE_ENV === 'production' && !authorized) {
      throw new Error('setAdminContext is restricted in production');
    }

    const sql: SqlFunction = this.db.getSQL();
    try {
      await sql`SET LOCAL app.is_admin = ${isAdmin ? 'true' : 'false'}`;

      this.currentContext = {
        isAdmin,
        ...(userId ? { userId } : {}),
        sessionId: this.generateSessionId()
      };

      await this.logAudit('set_admin_context', userId, { isAdmin, authorized });
    } catch (error) {
      throw new Error('Failed to set RLS admin context');
    }
  }

  /**
   * Clear all RLS context
   */
  async clearContext(): Promise<void> {
    const sql: SqlFunction = this.db.getSQL();
    
    try {
      // Clear all LOCAL settings (automatic at transaction end for pooled connections)
      await sql`SET LOCAL app.tenant_id = DEFAULT`;
      await sql`SET LOCAL app.current_merchant_id = DEFAULT`;
      await sql`SET LOCAL app.is_admin = DEFAULT`;
      this.currentContext = {};
    } catch (error) {
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
      return {
        hasMerchantContext: r.has_merchant_context,
        ...(r.merchant_id ? { merchantId: r.merchant_id } : {}),
        isAdmin: r.is_admin,
        contextAgeSeconds: r.context_age_seconds,
        isValid: r.has_merchant_context || r.is_admin
      };
    } catch (error) {
      console.error('❌ Failed to validate RLS context:', error);
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
      throw new RLSContextError(
        'No valid RLS context set. Call setMerchantContext() or setAdminContext() first.',
        contextValidation
      );
    }

    const sql: SqlFunction = this.db.getSQL();
    return await sql<T>(strings, ...params);
  }

  /**
   * Execute query in transaction with RLS
   */
  async transaction<T>(
    callback: (sql: Sql) => Promise<T>,
    merchantId?: string
  ): Promise<T> {
    const sql: SqlFunction = this.db.getSQL();
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
    const originalContext = { ...this.currentContext };
    
    try {
      await this.setMerchantContext(merchantId);
      return await callback();
    } finally {
      // استرجاع السياق الأصلي
      if (originalContext.merchantId) {
        await this.setMerchantContext(originalContext.merchantId);
      } else if (originalContext.isAdmin) {
        await this.setAdminContext(originalContext.isAdmin);
      } else {
        await this.clearContext();
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
    // هذه معلومات افتراضية - يمكن تحسينها بمراقبة حقيقية
    return {
      activeContexts: 1,
      merchantQueries: 0,
      adminQueries: 0,
      failedContexts: 0
    };
  }

  /**
   * Generate session ID for tracking
   */
  private generateSessionId(): string {
    return `rls_${Date.now()}_${crypto.randomUUID()}`;
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
          performed_by
        ) VALUES (
          ${action},
          'RLS_CONTEXT',
          ${details ? JSON.stringify(details) : null},
          ${userId ?? null}
        )
      `;
    } catch (error) {
      console.error('❌ Failed to log audit event:', error);
    }
  }

  /**
   * Get raw database connection (dangerous - bypasses RLS)
   */
  getRawDatabase() {
    console.warn('⚠️ Getting raw database connection - RLS bypassed!');
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
  const db = getRLSDatabase();
  const originalContext = db.getCurrentContext();
  
  try {
    await db.setMerchantContext(merchantId);
    return await callback(db);
  } finally {
    // استرجاع السياق الأصلي
    if (originalContext.merchantId) {
      await db.setMerchantContext(originalContext.merchantId);
    } else if (originalContext.isAdmin) {
      await db.setAdminContext(originalContext.isAdmin);
    } else {
      await db.clearContext();
    }
  }
}

/**
 * Helper: Execute with admin context
 */
export async function withAdminContext<T>(
  callback: (db: RLSDatabase) => Promise<T>
): Promise<T> {
  const db = getRLSDatabase();
  const originalContext = db.getCurrentContext();
  
  try {
    await db.setAdminContext(true);
    return await callback(db);
  } finally {
    // استرجاع السياق الأصلي
    if (originalContext.merchantId) {
      await db.setMerchantContext(originalContext.merchantId);
    } else {
      await db.clearContext();
    }
  }
}

export default RLSDatabase;
