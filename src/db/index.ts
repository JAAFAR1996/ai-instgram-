/**
 * ===============================================
 * Database Layer - Production Ready
 * Clean pg.Pool-based data access with transactions
 * ===============================================
 */

import { Pool, PoolClient, PoolConfig } from 'pg';
import { getLogger } from '../services/logger.js';

const log = getLogger({ component: 'database' });

let pool: Pool | null = null;

/**
 * Production-grade pool configuration
 */
function createPoolConfig(): PoolConfig {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  return {
    connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: parseInt(process.env.PGPOOL_MAX || '40'),
    min: parseInt(process.env.PGPOOL_MIN || '5'),
    idleTimeoutMillis: parseInt(process.env.PGPOOL_IDLE_TIMEOUT || '30000'),
    connectionTimeoutMillis: parseInt(process.env.PGPOOL_CONNECT_TIMEOUT || '5000'),
    acquireTimeoutMillis: parseInt(process.env.PGPOOL_ACQUIRE_TIMEOUT || '10000'),
    allowExitOnIdle: false,
  };
}

/**
 * Get database pool instance
 */
export function getPool(): Pool {
  if (!pool) {
    const config = createPoolConfig();
    pool = new Pool(config);

    // Pool event handlers
    pool.on('connect', (client) => {
      log.debug('New client connected to PostgreSQL');
    });

    pool.on('acquire', (client) => {
      log.debug('Client acquired from pool');
    });

    pool.on('error', (err, client) => {
      log.error('Database pool error:', err);
    });

    pool.on('remove', (client) => {
      log.debug('Client removed from pool');
    });

    log.info('PostgreSQL pool initialized', {
      max: config.max,
      min: config.min,
      idleTimeout: config.idleTimeoutMillis,
      connectionTimeout: config.connectionTimeoutMillis
    });
  }

  return pool;
}

/**
 * Execute function within a transaction
 * Provides rollback on error and proper resource cleanup
 */
export async function withTx<T>(
  poolOrClient: Pool | PoolClient,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  let client: PoolClient;
  let shouldReleaseClient = false;

  // If pool provided, acquire client
  if ('connect' in poolOrClient) {
    client = await poolOrClient.connect();
    shouldReleaseClient = true;
  } else {
    // Client already provided (for nested transactions)
    client = poolOrClient;
  }

  try {
    await client.query('BEGIN');
    log.debug('Transaction started');

    const result = await fn(client);
    
    await client.query('COMMIT');
    log.debug('Transaction committed');
    
    return result;
  } catch (error: any) {
    await client.query('ROLLBACK');
    log.error('Transaction rolled back due to error:', error);
    throw error;
  } finally {
    if (shouldReleaseClient) {
      client.release();
      log.debug('Client released back to pool');
    }
  }
}

/**
 * Get pool statistics for monitoring
 */
export function getPoolStats() {
  if (!pool) return null;

  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    max: pool.options.max,
    min: pool.options.min
  };
}

/**
 * Health check for database connectivity
 */
export async function checkDatabaseHealth(): Promise<{ healthy: boolean; details: any }> {
  try {
    const currentPool = getPool();
    const client = await currentPool.connect();
    
    try {
      const result = await client.query('SELECT NOW() as current_time, version() as db_version');
      const stats = getPoolStats();
      
      return {
        healthy: true,
        details: {
          currentTime: result.rows[0].current_time,
          version: result.rows[0].db_version,
          poolStats: stats
        }
      };
    } finally {
      client.release();
    }
  } catch (error: any) {
    log.error('Database health check failed:', error);
    return {
      healthy: false,
      details: {
        error: error.message,
        poolStats: getPoolStats()
      }
    };
  }
}

/**
 * Graceful shutdown of database pool
 */
export async function closeDatabasePool(): Promise<void> {
  if (pool) {
    try {
      await pool.end();
      log.info('Database pool closed successfully');
    } catch (error: any) {
      log.error('Error closing database pool:', error);
    } finally {
      pool = null;
    }
  }
}

/**
 * Query helper with logging and metrics
 */
export async function query<T = any>(
  poolOrClient: Pool | PoolClient,
  text: string,
  params?: any[]
): Promise<T[]> {
  const startTime = Date.now();
  
  try {
    let client: PoolClient;
    let shouldRelease = false;

    if ('connect' in poolOrClient) {
      client = await poolOrClient.connect();
      shouldRelease = true;
    } else {
      client = poolOrClient;
    }

    try {
      const result = await client.query(text, params);
      const duration = Date.now() - startTime;
      
      log.debug('Query executed', {
        duration,
        rowCount: result.rowCount,
        sql: text.substring(0, 100) + (text.length > 100 ? '...' : '')
      });

      return result.rows as T[];
    } finally {
      if (shouldRelease) {
        client.release();
      }
    }
  } catch (error: any) {
    const duration = Date.now() - startTime;
    log.error('Query failed', {
      duration,
      error: error.message,
      sql: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
      params: params?.length || 0
    });
    throw error;
  }
}