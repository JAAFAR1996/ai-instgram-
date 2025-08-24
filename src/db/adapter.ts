/**
 * ===============================================
 * Database Adapter - Unified Interface
 * محول موحد لقاعدة البيانات مع تعامل متقدم للأخطاء
 * ===============================================
 */

import { getPool } from './index.js';
import { type Sql, type SqlFunction } from './sql-template.js';
export type { DBRow } from '../types/instagram.js';
import { buildSqlCompat } from '../infrastructure/db/sql-compat.js';
import { DatabaseError } from '../types/database.js';
import type { Pool } from 'pg';

/**
 * Unified Database Interface
 */
export interface IDatabase {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T>(sql: string, params?: unknown[]): Promise<T | null>;
  transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  health(): Promise<boolean>;
  close(): Promise<void>;
}

/**
 * Database Adapter Implementation
 */
export class DatabaseAdapter implements IDatabase {
  private pool: Pool;
  private sql: SqlFunction;

  constructor() {
    this.pool = getPool();
    this.sql = buildSqlCompat(this.pool);
  }

  /**
   * Execute query and return all rows
   */
  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    try {
      const startTime = Date.now();
      const result = await this.pool.query(sql, params);
      const duration = Date.now() - startTime;
      
      console.debug(`Query executed in ${duration}ms, ${result.rows.length} rows returned`);
      
      return result.rows as T[];
    } catch (error: any) {
      throw new DatabaseError(
        error.message,
        error.code,
        sql,
        params
      );
    }
  }

  /**
   * Execute query and return first row
   */
  async queryOne<T>(sql: string, params?: unknown[]): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] || null;
  }

  /**
   * Execute function within a transaction
   */
  async transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      console.debug('Transaction started');
      
      // Create SQL function bound to this client
      const clientSql = this.sql.bind(client);
      const result = await fn(clientSql);
      
      await client.query('COMMIT');
      console.debug('Transaction committed');
      
      return result;
    } catch (error: any) {
      await client.query('ROLLBACK');
      console.debug('Transaction rolled back');
      
      throw new DatabaseError(
        `Transaction failed: ${error.message}`,
        error.code,
        undefined,
        undefined
      );
    } finally {
      client.release();
    }
  }

  /**
   * Health check - simple SELECT 1
   */
  async health(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch (error) {
      console.warn('Database health check failed:', error);
      return false;
    }
  }

  /**
   * Close database connections
   */
  async close(): Promise<void> {
    try {
      await this.pool.end();
    } catch (error: any) {
      throw new DatabaseError(
        `Failed to close database: ${error.message}`,
        error.code
      );
    }
  }

  /**
   * Get SQL template function (safe and compatible)
   * يُرجع SqlFunction متوافق مع الاستخدامات القديمة مع حماية من SQL injection
   */
  getSQL(): SqlFunction {
    return this.sql;
  }

  /**
   * Get raw pool (for advanced operations)
   */
  getPool(): Pool {
    return this.pool;
  }

  // Legacy compatibility properties
  get totalCount() { return this.pool.totalCount; }
  get idleCount() { return this.pool.idleCount; }
  get waitingCount() { return this.pool.waitingCount; }
  get poolInstance() { return this.pool; }
  
  // Legacy compatibility methods
  connect() { return this.pool.connect(); }
  end() { return this.pool.end(); }
  
  /**
   * Check if database is ready
   */
  isReady(): boolean {
    return !!this.pool && !this.pool.ended;
  }

  /**
   * Check if database is connected
   */
  async isConnected(): Promise<boolean> {
    return await this.health();
  }
}

/**
 * Singleton instance
 */
let dbAdapter: DatabaseAdapter | null = null;

/**
 * Get database adapter instance
 */
export function getDatabase(): DatabaseAdapter {
  if (!dbAdapter) {
    dbAdapter = new DatabaseAdapter();
  }
  return dbAdapter;
}

/**
 * Export for direct SQL usage
 */
export { getSql } from './sql-template.js';
export type { Sql, SqlFunction } from './sql-template.js';

/**
 * Legacy compatibility
 */
export { getDatabase as default };