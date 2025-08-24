/**
 * ===============================================
 * Database Layer - Production Ready
 * Clean pg.Pool-based data access with transactions
 * ===============================================
 */

import { Pool, PoolClient, PoolConfig } from 'pg';
import { getLogger } from '../services/logger.js';
import { getConfig } from '../config/index.js';

const log = getLogger({ component: 'database' });

let pool: Pool | null = null;

/**
 * Production-grade pool configuration using centralized config
 * محسّن لـ Render deployment
 */
function createPoolConfig(): PoolConfig {
  const config = getConfig();
  const isRender = process.env.IS_RENDER === 'true' || process.env.RENDER === 'true';
  
  return {
    connectionString: config.database.url,
    ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
    max: isRender ? 10 : config.database.maxConnections, // Render free tier limit
    min: isRender ? 2 : Math.min(5, Math.floor(config.database.maxConnections / 4)),
    idleTimeoutMillis: isRender ? 20000 : 30000, // أقل لـ Render
    connectionTimeoutMillis: isRender ? 10000 : 5000, // أكثر تسامحاً لـ Render
    allowExitOnIdle: false,
    statement_timeout: isRender ? 25000 : 30000,
    query_timeout: isRender ? 25000 : 30000,
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
    pool.on('connect', () => {
      log.debug('New client connected to PostgreSQL');
    });

    pool.on('acquire', () => {
      log.debug('Client acquired from pool');
    });

    pool.on('error', (err) => {
      log.error('Database pool error:', err);
    });

    pool.on('remove', () => {
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
    const connectedClient = await poolOrClient.connect();
    if (!connectedClient) {
      throw new Error('Failed to acquire database client');
    }
    client = connectedClient;
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
  } catch (error: unknown) {
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
export interface DatabaseHealthDetails {
  currentTime?: string;
  version?: string;
  poolStats: ReturnType<typeof getPoolStats>;
  error?: string;
}

export async function checkDatabaseHealth(): Promise<{ healthy: boolean; details: DatabaseHealthDetails }> {
  try {
    const currentPool = getPool();
    const client = await currentPool.connect();
    
    try {
      const result = await client.query('SELECT NOW() as current_time, version() as db_version');
      const stats = getPoolStats();
      
      return {
        healthy: true,
        details: {
          currentTime: String(result.rows[0].current_time),
          version: String(result.rows[0].db_version),
          poolStats: stats
        }
      };
    } finally {
      client.release();
    }
  } catch (error: unknown) {
    log.error('Database health check failed:', error);
    return {
      healthy: false,
      details: {
        error: error instanceof Error ? error.message : String(error),
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
    } catch (error: unknown) {
      log.error('Error closing database pool:', error);
    } finally {
      pool = null;
    }
  }
}

/**
 * Query helper with logging and metrics
 */
export async function query<T = Record<string, unknown>>(
  poolOrClient: Pool | PoolClient,
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const startTime = Date.now();
  
  try {
    let client: PoolClient;
    let shouldRelease = false;

    if ('connect' in poolOrClient) {
      const connectedClient = await poolOrClient.connect();
      if (!connectedClient) {
        throw new Error('Failed to acquire database client');
      }
      client = connectedClient;
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
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    log.error('Query failed', {
      duration,
      error: error instanceof Error ? error.message : String(error),
      sql: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
      params: params?.length || 0
    });
    throw error;
  }
}