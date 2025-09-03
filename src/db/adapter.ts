/**
 * ===============================================
 * Database Adapter - Unified Interface
 * محول موحد لقاعدة البيانات مع تعامل متقدم للأخطاء
 * ===============================================
 */

import { getPool } from './index.js';
import { type Sql, type SqlFunction } from './sql-template.js';
export type { DBRow } from '../types/instagram.js';
import { buildSqlCompat, toQuery, buildSqlCompatFromClient } from '../infrastructure/db/sql-compat.js';
import { DatabaseError } from '../types/database.js';
import { getLogger } from '../services/logger.js';
import type { Pool, PoolClient } from 'pg';

const log = getLogger({ component: 'database-adapter' });

/**
 * Extended PoolClient interface with processID
 */
interface ExtendedPoolClient extends PoolClient {
  processID?: number;
}

/**
 * Database error interface
 */
interface DatabaseErrorType extends Error {
  code?: string;
  message: string;
}

/**
 * Query Performance Metrics
 */
interface QueryMetrics {
  sql: string;
  params?: unknown[];
  duration: number;
  rowCount: number;
  timestamp: Date;
}

/**
 * Connection Pool Statistics
 */
interface PoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  activeCount: number;
}

/**
 * Transaction Options
 */
interface TransactionOptions {
  timeout?: number;
  isolationLevel?: 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
  readOnly?: boolean;
}

/**
 * Unified Database Interface
 */
export interface IDatabase {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  transaction<T>(fn: (sql: Sql) => Promise<T>, options?: TransactionOptions): Promise<T>;
  begin<T>(fn: (sql: Sql) => Promise<T>, options?: TransactionOptions): Promise<T>;
  health(): Promise<boolean>;
  close(): Promise<void>;
  getPoolStats(): PoolStats;
  getQueryMetrics(): QueryMetrics[];
}

/**
 * Database Adapter Implementation
 */
export class DatabaseAdapter implements IDatabase {
  private pool: Pool;
  private sql: SqlFunction;
  private queryMetrics: QueryMetrics[] = [];
  private readonly MAX_METRICS_HISTORY = 1000;
  private readonly DEFAULT_TRANSACTION_TIMEOUT = 60000; // 60 seconds

  constructor() {
    try {
      this.pool = getPool();
      this.sql = this.createSQLFunction();
      this.setupPoolEventHandlers();
      log.info('✅ Database adapter initialized successfully');
    } catch (error) {
      log.error('❌ Failed to initialize database adapter', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw new DatabaseError(
        `Database initialization failed: ${error instanceof Error ? error.message : String(error)}`,
        'INIT_FAILED'
      );
    }
  }

  /**
   * Create enhanced SQL function with performance monitoring
   */
  private createSQLFunction(): SqlFunction {
    const baseSql = buildSqlCompat(this.pool);
    
      // Enhanced SQL function with performance monitoring
  const enhancedSql = async <T extends Record<string, unknown> = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...params: unknown[]
  ): Promise<T[]> => {
      const startTime = Date.now();
      const compiled = toQuery(strings, params);
      const sql = compiled.text;
      
      try {
        const result = await baseSql<T>(strings, ...params);
        const duration = Date.now() - startTime;
        
              // Log performance metrics
      this.logQueryMetrics(sql, (compiled.values as unknown[]) || [], duration, result.length);
        
        // Log slow queries
        if (duration > 1000) {
          log.warn('🐌 Slow query detected', {
            duration,
            sql: sql.substring(0, 200) + (sql.length > 200 ? '...' : ''),
            rowCount: result.length
          });
        }
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        log.error('❌ SQL execution failed', {
          duration,
          sql: sql.substring(0, 200) + (sql.length > 200 ? '...' : ''),
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    };

    // Proxy composition helpers for compatibility
    (enhancedSql as any).unsafe = (baseSql as any).unsafe;
    (enhancedSql as any).join = (baseSql as any).join;
    (enhancedSql as any).commit = (baseSql as any).commit;
    (enhancedSql as any).rollback = (baseSql as any).rollback;

    // Add transaction support to SQL function
    enhancedSql.transaction = async <T>(
      callback: (sql: Sql) => Promise<T>,
      options: TransactionOptions = {}
    ): Promise<T> => {
      return await this.transaction(callback, options);
    };

    // Add begin method for compatibility
    enhancedSql.begin = async <T>(
      callback: (sql: Sql) => Promise<T>,
      options: TransactionOptions = {}
    ): Promise<T> => {
      return await this.transaction(callback, options);
    };

    return enhancedSql as SqlFunction;
  }

  /**
   * Setup pool event handlers for monitoring
   */
  private setupPoolEventHandlers(): void {
    this.pool.on('connect', (client: PoolClient) => {
      const extendedClient = client as ExtendedPoolClient;
      log.debug('🔌 New database connection established', {
        clientId: extendedClient.processID || 'unknown'
      });
    });

    this.pool.on('acquire', (client: PoolClient) => {
      const extendedClient = client as ExtendedPoolClient;
      log.debug('📥 Database connection acquired', {
        clientId: extendedClient.processID || 'unknown',
        poolStats: this.getPoolStats()
      });
    });

    this.pool.on('release', (error: Error | null, client: PoolClient) => {
      const extendedClient = client as ExtendedPoolClient;
      log.debug('📤 Database connection released', {
        clientId: extendedClient.processID || 'unknown',
        poolStats: this.getPoolStats(),
        ...(error && { error: error.message })
      });
    });

    this.pool.on('error', (error: Error, client: PoolClient) => {
      const extendedClient = client as ExtendedPoolClient;
      log.error('❌ Database pool error', {
        error: error.message,
        clientId: extendedClient.processID || 'unknown',
        poolStats: this.getPoolStats()
      });
    });

    this.pool.on('remove', (client: PoolClient) => {
      const extendedClient = client as ExtendedPoolClient;
      log.debug('🗑️ Database connection removed', {
        clientId: extendedClient.processID || 'unknown',
        poolStats: this.getPoolStats()
      });
    });
  }

  /**
   * Log query performance metrics
   */
  private logQueryMetrics(sql: string, params: unknown[], duration: number, rowCount: number): void {
    const metric: QueryMetrics = {
      sql,
      params,
      duration,
      rowCount,
      timestamp: new Date()
    };

    this.queryMetrics.push(metric);
    
    // Keep only recent metrics
    if (this.queryMetrics.length > this.MAX_METRICS_HISTORY) {
      this.queryMetrics = this.queryMetrics.slice(-this.MAX_METRICS_HISTORY);
    }

    // Log performance for slow queries
    if (duration > 500) {
      log.debug('🐌 Query performance', {
        duration,
        rowCount,
        sql: sql.substring(0, 100) + (sql.length > 100 ? '...' : '')
      });
    }
  }

  /**
   * Execute query and return all rows
   */
  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const startTime = Date.now();
    
    try {
      const result = await this.pool.query(sql, params);
      const duration = Date.now() - startTime;
      
      this.logQueryMetrics(sql, params || [], duration, result.rows.length);
      
      log.debug('✅ Query executed successfully', {
        duration,
        rowCount: result.rows.length,
        sql: sql.substring(0, 100) + (sql.length > 100 ? '...' : '')
      });
      
      return result.rows as T[];
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const dbError = error as DatabaseErrorType;
      log.error('❌ Query execution failed', {
        sql: sql.substring(0, 200) + (sql.length > 200 ? '...' : ''),
        duration,
        error: dbError.message,
        code: dbError.code
      });
      
      throw new DatabaseError(
        dbError.message,
        dbError.code,
        sql,
        params
      );
    }
  }

  /**
   * Execute query and return first row
   */
  async queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] || null;
  }

  /**
   * Execute function within a transaction with enhanced error handling
   */
  async transaction<T>(
    fn: (sql: Sql) => Promise<T>,
    options: TransactionOptions = {}
  ): Promise<T> {
    const {
      timeout = this.DEFAULT_TRANSACTION_TIMEOUT,
      isolationLevel = 'READ COMMITTED',
      readOnly = false
    } = options;

    const startTime = Date.now();
    let client: PoolClient | null = null;
    
    try {
      // Acquire connection with timeout
      client = await Promise.race([
        this.pool.connect(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 5000)
        )
      ]);

      log.debug('🔄 Transaction started', {
        isolationLevel,
        readOnly,
        clientId: (client as ExtendedPoolClient).processID || 'unknown'
      });

      // Explicitly begin transaction and set options
      await client.query('BEGIN');
      await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
      if (readOnly) {
        await client.query('SET TRANSACTION READ ONLY');
      }

      // Create SQL function bound to this client
      const clientSql = buildSqlCompatFromClient(client);
      
      // Execute transaction with timeout
      const transactionPromise = fn(clientSql);
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Transaction timeout')), timeout)
      );

      const result = await Promise.race([transactionPromise, timeoutPromise]);
      
      await client.query('COMMIT');
      
      const duration = Date.now() - startTime;
      log.debug('✅ Transaction committed successfully', {
        duration,
        clientId: (client as ExtendedPoolClient).processID || 'unknown'
      });
      
      return result;
    } catch (error: unknown) {
      if (client) {
        try {
          await client.query('ROLLBACK');
          log.debug('🔄 Transaction rolled back', {
            clientId: (client as ExtendedPoolClient).processID || 'unknown',
            error: error instanceof Error ? error.message : String(error)
          });
        } catch (rollbackError) {
          log.error('❌ Failed to rollback transaction', {
            clientId: (client as ExtendedPoolClient).processID || 'unknown',
            rollbackError: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
          });
        }
      }
      
      const duration = Date.now() - startTime;
      const dbError = error as DatabaseErrorType;
      log.error('❌ Transaction failed', {
        duration,
        error: dbError.message,
        isolationLevel,
        readOnly
      });
      
      throw new DatabaseError(
        `Transaction failed: ${dbError.message}`,
        dbError.code,
        undefined,
        undefined
      );
    } finally {
      if (client) {
        client.release();
        log.debug('📤 Transaction connection released', {
          clientId: (client as ExtendedPoolClient).processID || 'unknown'
        });
      }
    }
  }

  /**
   * Alias for transaction method (for compatibility)
   */
  async begin<T>(
    fn: (sql: Sql) => Promise<T>,
    options: TransactionOptions = {}
  ): Promise<T> {
    return await this.transaction(fn, options);
  }

  /**
   * Enhanced health check with recovery mechanism
   */
  async health(): Promise<boolean> {
    try {
      const startTime = Date.now();
      
      // Validate pool first
      if (!this.pool || this.pool.ended) {
        log.warn('⚠️ Database pool is ended, attempting recovery...');
        await this.recoverConnection();
      }
      
      // Test with timeout
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Health check timeout')), 10000)
      );
      
      const queryPromise = this.pool.query('SELECT 1 as test');
      await Promise.race([queryPromise, timeoutPromise]);
      
      const duration = Date.now() - startTime;
      const poolStats = this.getPoolStats();
      
      log.debug('✅ Database health check passed', {
        duration,
        totalConnections: poolStats.totalCount,
        idleConnections: poolStats.idleCount
      });
      
      return true;
    } catch (error: unknown) {
      const poolStats = this.getPoolStats();
      const dbError = error as DatabaseErrorType;
      
      log.error('❌ Database health check failed', {
        error: dbError.message,
        poolStats,
        recovery: 'attempting_connection_recovery'
      });
      
      // Attempt recovery on health check failure
      try {
        await this.recoverConnection();
        log.info('🔄 Connection recovery completed after health check failure');
      } catch (recoveryError) {
        log.error('❌ Connection recovery failed', {
          recoveryError: recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
        });
      }
      
      return false;
    }
  }

  /**
   * Close database connections gracefully
   */
  async close(): Promise<void> {
    try {
      log.info('🔄 Closing database connections...');
      
      // Wait for active connections to finish
      await this.pool.end();
      
      log.info('✅ Database connections closed successfully');
    } catch (error: unknown) {
      const dbError = error as DatabaseErrorType;
      log.error('❌ Failed to close database connections', {
        error: dbError.message
      });
      
      throw new DatabaseError(
        `Failed to close database: ${dbError.message}`,
        dbError.code
      );
    }
  }

  /**
   * Get connection pool statistics
   */
  getPoolStats(): PoolStats {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
      activeCount: this.pool.totalCount - this.pool.idleCount
    };
  }

  /**
   * Get query performance metrics
   */
  getQueryMetrics(): QueryMetrics[] {
    return [...this.queryMetrics];
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

  /**
   * Recover database connection after failure
   */
  async recoverConnection(): Promise<void> {
    try {
      log.info('🔄 Starting database connection recovery...');
      
      // Close existing pool if it exists
      if (this.pool && !this.pool.ended) {
        try {
          await this.pool.end();
        } catch (endError) {
          log.warn('⚠️ Error ending existing pool during recovery', {
            error: endError instanceof Error ? endError.message : String(endError)
          });
        }
      }
      
      // Force pool recreation using exported reset API
      const dbModule = await import('./index.js');
      if (typeof (dbModule as any).resetPool === 'function') {
        (dbModule as any).resetPool();
      }
      // Create new pool
      this.pool = dbModule.getPool();
      
      // Recreate SQL function with new pool
      this.sql = this.createSQLFunction();
      
      // Test the new connection
      await this.pool.query('SELECT 1');
      
      log.info('✅ Database connection recovery successful');
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error('❌ Database connection recovery failed', {
        error: errorMessage
      });
      
      throw new DatabaseError(
        `Connection recovery failed: ${errorMessage}`,
        'RECOVERY_FAILED'
      );
    }
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
    try {
      dbAdapter = new DatabaseAdapter();
      log.info('✅ Database adapter singleton created');
    } catch (error) {
      log.error('❌ Failed to create database adapter singleton', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
  return dbAdapter;
}

/**
 * Reset database adapter (for recovery scenarios)
 */
export function resetDatabase(): void {
  log.info('🔄 Resetting database adapter singleton...');
  dbAdapter = null;
}

/**
 * Get database with automatic recovery attempt
 */
export async function getDatabaseWithRecovery(): Promise<DatabaseAdapter> {
  try {
    const db = getDatabase();
    
    // Test if connection is working
    const isHealthy = await db.health();
    if (!isHealthy) {
      log.warn('⚠️ Database not healthy, attempting recovery...');
      await db.recoverConnection();
    }
    
    return db;
  } catch (error) {
    log.error('❌ Database recovery failed, resetting adapter', {
      error: error instanceof Error ? error.message : String(error)
    });
    
    // Reset and try once more
    resetDatabase();
    return getDatabase();
  }
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
