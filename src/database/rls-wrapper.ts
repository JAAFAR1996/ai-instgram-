/**
 * ===============================================
 * RLS Database Wrapper (2025 Security Standards)
 * ✅ تطبيق تلقائي لـ Row Level Security
 * ===============================================
 */

import { getDatabase } from './connection';
import type postgres from 'postgres';
import crypto from 'crypto';

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

    const sql = this.db.getSQL();
    
    try {
      // Use SET LOCAL for transaction-scoped context (critical for pooled connections)
      await sql`SET LOCAL app.tenant_id = ${merchantId}`;
      await sql`SET LOCAL app.current_merchant_id = ${merchantId}`;
      
      this.currentContext = {
        merchantId,
        userId,
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

    const sql = this.db.getSQL();

    try {
      // Use SET LOCAL for transaction-scoped context
      await sql`SET LOCAL app.is_admin = ${isAdmin ? 'true' : 'false'}`;

      this.currentContext = {
        isAdmin,
        userId,
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
    const sql = this.db.getSQL();
    
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
    const sql = this.db.getSQL();
    
    try {
      const [result] = await sql`SELECT * FROM validate_rls_context()`;
      
      return {
        hasMerchantContext: result.has_merchant_context,
        merchantId: result.merchant_id,
        isAdmin: result.is_admin,
        contextAgeSeconds: result.context_age_seconds,
        isValid: result.has_merchant_context || result.is_admin
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
  async query<T>(strings: TemplateStringsArray, ...params: any[]): Promise<T[]> {
    // التحقق من السياق قبل التنفيذ
    const contextValidation = await this.validateContext();

    if (!contextValidation.isValid) {
      throw new RLSContextError(
        'No valid RLS context set. Call setMerchantContext() or setAdminContext() first.',
        contextValidation
      );
    }

    return await this.db.query(strings, ...params) as T[];
  }

  /**
   * Execute query in transaction with RLS
   */
  async transaction<T>(
    callback: (sql: postgres.Sql) => Promise<T>,
    merchantId?: string
  ): Promise<T> {
    const sql = this.db.getSQL();
    
    return await sql.begin(async (transaction) => {
      // إعداد السياق داخل التراكنشن
      if (merchantId) {
        await transaction`SELECT set_merchant_context(${merchantId}::uuid)`;
      } else if (this.currentContext.merchantId) {
        await transaction`SELECT set_merchant_context(${this.currentContext.merchantId}::uuid)`;
      } else if (this.currentContext.isAdmin) {
        await transaction`SELECT set_admin_context(${this.currentContext.isAdmin})`;
      }

      // تنفيذ الكود
      return await callback(transaction);
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
    public readonly contextInfo: any
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
