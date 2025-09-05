/**
 * ===============================================
 * Database Layer - Production Ready
 * Clean pg.Pool-based data access with transactions
 * ===============================================
 */

import { Pool, PoolClient, PoolConfig } from 'pg';
import type { ConnectionOptions as TLSConnectionOptions } from 'tls';
import { getLogger } from '../services/logger.js';
import { getConfig } from '../config/index.js';
import type { DatabaseError } from '../types/database.js';

const log = getLogger({ component: 'database' });

let pool: Pool | null = null;
let connectionMonitor: NodeJS.Timeout | null = null;
let poolHealthStats = {
  totalConnections: 0,
  successfulConnections: 0,
  failedConnections: 0,
  avgResponseTime: 0,
  maxResponseTime: 0,
  lastHealthCheck: new Date(),
  connectionRetries: 0,
  deadlockCount: 0,
  transactionTimeouts: 0
};

// Removed unused retry configuration for simplified implementation

// Removed unused RetryStrategy interface

// Removed unused calculateAdaptiveTimeout function

/**
 * SIMPLIFIED pool configuration for Render deployment
 * Fixed for Node.js internal assertion errors
 */
function createPoolConfig(): PoolConfig {
  const config = getConfig();
  const isProduction = process.env.NODE_ENV === 'production';
  const isRender = process.env.IS_RENDER === 'true' || process.env.RENDER === 'true';
  
  // TLS configuration - FORCE SSL for Render
  let sslConfig: boolean | TLSConnectionOptions = false;
  const dbUrl = config.database.url;
  const ca = process.env.DB_SSL_CA;
  const sslModeRequire = (() => {
    try { const u = new URL(dbUrl); return (u.searchParams.get('sslmode') ?? '').toLowerCase() === 'require'; } catch { return false; }
  })();
  const overrideRejectUnauth = process.env.DB_SSL_REJECT_UNAUTHORIZED === 'false' || sslModeRequire;
  const strictEnv = process.env.DB_SSL_STRICT;
  const defaultStrict = config.database.ssl === true || isProduction || isRender;
  const strict = typeof strictEnv === 'string' ? (strictEnv === 'true') : defaultStrict;

  // FORCE SSL for production/Render - fix "SSL/TLS required" errors
  if (isProduction || isRender || dbUrl.includes('render.com') || config.database.ssl) {
    sslConfig = ca ? { rejectUnauthorized: false, ca } : { rejectUnauthorized: false };
    log.info('🔐 FORCED SSL for production/Render/config environment', { 
      isProduction, isRender, hasCA: !!ca, configSsl: config.database.ssl 
    });
  } else if (overrideRejectUnauth) {
    sslConfig = ca ? { rejectUnauthorized: false, ca } : { rejectUnauthorized: false };
    log.warn('🔐 Using SSL with rejectUnauthorized=false for PostgreSQL', { reason: sslModeRequire ? 'sslmode=require' : 'env_override', hasCA: !!ca });
  } else if (strict) {
    sslConfig = ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
    log.info('🔐 Using strict SSL for PostgreSQL', { strict: true, hasCA: !!ca });
  }
  
  // SIMPLIFIED pool configuration to avoid Node.js internal assertions
  const maxConnections = Math.min(Number(process.env.DB_MAX_CONNECTIONS || '10'), 20);
  
  return {
    connectionString: config.database.url,
    ssl: sslConfig,
    // Simplified pool sizing
    max: maxConnections,
    min: 1, // Start with minimum connections
    // Conservative timeout settings
    idleTimeoutMillis: 30000, // 30 seconds
    connectionTimeoutMillis: 15000, // 15 seconds - shorter for faster failure
    // Simplified application name
    application_name: `ai-sales-${process.env.NODE_ENV || 'dev'}`,
    // Basic keepalive
    keepAlive: true
  };
}

/**
 * Get database pool instance with comprehensive monitoring
 */
export function getPool(): Pool {
  if (!pool || pool.ended) {
    try {
      // Reset pool if it was ended
      if (pool && pool.ended) {
        log.warn('🔄 Pool was ended, creating new pool...');
        pool = null;
      }

      const config = createPoolConfig();
      
      // Validate DATABASE_URL before creating pool
      if (!config.connectionString) {
        throw new Error('DATABASE_URL is not configured');
      }

      pool = new Pool(config);

      // SIMPLIFIED pool event handlers with null checks
      pool.on('connect', () => {
        poolHealthStats.totalConnections++;
        poolHealthStats.successfulConnections++;
        log.debug('New client connected to PostgreSQL');
      });

      pool.on('error', (err) => {
        poolHealthStats.failedConnections++;
        const dbError = err as DatabaseError;
        log.error('Database pool error:', {
          error: err.message,
          code: dbError.code,
          poolEnded: pool?.ended ?? false
        });
        
        // FIXED: Do NOT call pool.end() automatically on errors
        // This was causing "Cannot use a pool after calling end" errors
        // Instead, just log the error and let health monitoring handle recovery
        if (err.message.includes('internal assertion') || err.message.includes('Node.js internals')) {
          log.warn('⚠️ Node.js internal error detected - will rely on health monitoring for recovery');
        }
      });

      // Basic health monitoring only
      startPoolHealthMonitoring();

      log.info('PostgreSQL pool initialized successfully', {
        max: config.max,
        min: config.min,
        connectionString: config.connectionString.substring(0, 30) + '...',
        connectionTimeout: config.connectionTimeoutMillis
      });
    } catch (error) {
      log.error('❌ Failed to create database pool', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Ensure pool is null on failure
      pool = null;
      throw error;
    }
  }

  if (!pool) {
    throw new Error('Database pool is null after initialization attempt');
  }

  return pool;
}

/**
 * Reset the global pool (for recovery scenarios)
 */
export function resetPool(): void {
  try {
    if (pool && !pool.ended) {
      pool.end().catch((e) => { console.error('[hardening:no-silent-catch]', e); throw e instanceof Error ? e : new Error(String(e)); });
    }
  } finally {
    pool = null;
  }
}

/**
 * Enhanced transaction execution with timeout, retry, and deadlock detection
 */
export async function withTx<T>(
  poolOrClient: Pool | PoolClient,
  fn: (client: PoolClient) => Promise<T>,
  options?: {
    timeout?: number;
    retries?: number;
    isolationLevel?: 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
  }
): Promise<T> {
  const {
    timeout = 30000, // 30 seconds default
    retries = 5,
    isolationLevel = 'READ COMMITTED'
  } = options || {};

  let client: PoolClient;
  let shouldReleaseClient = false;
  let attempt = 0;
  const startTime = Date.now();

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

  while (attempt <= retries) {
    const transactionId = `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      // Start transaction with isolation level
      await client.query('BEGIN');
      if (isolationLevel !== 'READ COMMITTED') {
        await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolationLevel}`);
      }
      
      log.debug('Transaction started', {
        transactionId,
        isolationLevel,
        attempt: attempt + 1,
        timeout
      });

      // SIMPLIFIED transaction timeout
      let timeoutId: NodeJS.Timeout | null = null;
      const adaptiveTimeout = timeout + (attempt * 5000); // Simple increasing timeout
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          poolHealthStats.transactionTimeouts++;
          log.warn('⚡ Transaction timeout occurred', {
            transactionId,
            timeout: adaptiveTimeout,
            attempt: attempt + 1,
            avgResponseTime: poolHealthStats.avgResponseTime
          });
          reject(new Error(`Transaction timeout after ${adaptiveTimeout}ms (attempt ${attempt + 1})`));
        }, adaptiveTimeout);
      });

      // Execute transaction function with adaptive timeout
      const result = await Promise.race([
        fn(client),
        timeoutPromise
      ]);
      
      // Clear timeout if successful
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      
      await client.query('COMMIT');
      const duration = Date.now() - startTime;
      
      log.debug('Transaction committed successfully', {
        transactionId,
        duration,
        attempt: attempt + 1
      });
      
      // Update performance stats
      updatePerformanceStats(duration);
      
      return result;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      const duration = Date.now() - startTime;
      
      // ⚡ STAGE 3: Enhanced deadlock and serialization handling
      const isDeadlock = isDeadlockError(error);
      const isSerializationFailure = isSerializationError(error);
      
      if (isDeadlock) {
        await handleDeadlockRecovery(error as Error, attempt, transactionId);
      }
      
      // SIMPLIFIED retry conditions
      const shouldRetry = attempt < retries && (isDeadlock || isSerializationFailure);
      
      if (shouldRetry) {
        attempt++;
        // Simple exponential backoff
        const backoffDelay = Math.min(1000 * Math.pow(1.5, attempt - 1), 10000);
        
        log.info('Retrying transaction after backoff', {
          transactionId,
          attempt,
          backoffDelay,
          reason: isDeadlock ? 'deadlock' : 'serialization_failure'
        });
        
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
        continue;
      }
      
      log.error('Transaction failed and will not retry', {
        transactionId,
        attempt: attempt + 1,
        duration,
        error: error instanceof Error ? error.message : String(error),
        isDeadlock,
        isSerializationFailure
      });
      
      throw error;
    } finally {
      if (shouldReleaseClient && attempt === retries) {
        client.release();
        log.debug('Client released back to pool');
      }
    }
  }

  // This should never be reached, but TypeScript requires it
  throw new Error('Transaction retry loop ended unexpectedly');
}

/**
 * Setup connection retry mechanism
 */
// Removed unused RETRY_STRATEGIES for simplified implementation

// Removed unused setupConnectionRetry function for simplified implementation

// Removed unused executeRetryStrategy function for simplified implementation

/**
 * Start SIMPLIFIED pool health monitoring for Render
 */
function startPoolHealthMonitoring(): void {
  // Clear existing monitor if any
  if (connectionMonitor) {
    clearInterval(connectionMonitor);
  }
  
  // SIMPLIFIED monitoring with pool recovery
  connectionMonitor = setInterval(async () => {
    try {
      const stats = getPoolStats();
      if (stats) {
        poolHealthStats.lastHealthCheck = new Date();
        
        // Check for critical pool state
        if (stats.totalCount === 0 && stats.idleCount === 0) {
          log.warn('🚨 Pool shows 0 connections, marking for recreation...');
          
          // FIXED: Do NOT call pool.end() in health monitoring
          // Just mark pool as null to force recreation on next getPool() call
          pool = null;
          
          log.info('⚡ Pool marked for recreation - will be recreated on next database operation');
        } else {
          log.debug('Pool health check', {
            total: stats.totalCount,
            idle: stats.idleCount,
            waiting: stats.waitingCount
          });
        }
      }
    } catch (error) {
      log.warn('Pool health monitoring error', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      // On monitoring error, mark pool for recreation
      if (error instanceof Error && error.message.includes('internal assertion')) {
        log.warn('⚠️ Internal assertion in monitoring, marking pool for recreation');
        pool = null;
      }
    }
  }, 60000); // Check every minute for more responsive recovery
}

// Removed unused monitorPoolHealth function for simplified implementation

// Removed unused handleConnectionFailure function for simplified implementation

/**
 * Optimize pool configuration based on usage patterns
 */
export function optimizePoolConfiguration(): {
  recommendations: string[];
  currentStats: ReturnType<typeof getPoolStats>;
  healthStats: typeof poolHealthStats;
} {
  const stats = getPoolStats();
  const recommendations = [];
  
  if (!stats) {
    return {
      recommendations: ['Pool not initialized'],
      currentStats: {
        totalCount: 0,
        idleCount: 0,
        waitingCount: 0,
        max: 0,
        min: 0,
        utilization: 0,
        healthStats: poolHealthStats,
        uptime: 0,
        poolEnded: true
      },
      healthStats: poolHealthStats
    };
  }
  
  // Analyze connection patterns
  const utilizationPercent = ((stats.totalCount - stats.idleCount) / (stats.max || 1)) * 100;
  const failureRate = poolHealthStats.totalConnections > 0 
    ? (poolHealthStats.failedConnections / poolHealthStats.totalConnections) * 100 
    : 0;
  
  // Pool size recommendations
  if (utilizationPercent > 90) {
    recommendations.push('Consider increasing pool size - utilization is very high');
  } else if (utilizationPercent < 20) {
    recommendations.push('Consider reducing pool size - low utilization detected');
  }
  
  // Connection quality recommendations
  if (failureRate > 5) {
    recommendations.push('High connection failure rate detected - check database stability');
  }
  
  // Performance recommendations
  if (poolHealthStats.avgResponseTime > 1000) {
    recommendations.push('High average response time - optimize queries or database performance');
  }
  
  // Deadlock recommendations
  if (poolHealthStats.deadlockCount > 0) {
    recommendations.push('Deadlocks detected - review transaction isolation levels and query order');
  }
  
  // Timeout recommendations
  if (poolHealthStats.transactionTimeouts > 0) {
    recommendations.push('Transaction timeouts detected - consider optimizing long-running transactions');
  }
  
  if (recommendations.length === 0) {
    recommendations.push('Pool configuration appears optimal');
  }
  
  return {
    recommendations,
    currentStats: stats,
    healthStats: poolHealthStats
  };
}

/**
 * Update performance statistics
 */
function updatePerformanceStats(duration: number): void {
  // Update average response time using exponential moving average
  if (poolHealthStats.avgResponseTime === 0) {
    poolHealthStats.avgResponseTime = duration;
  } else {
    poolHealthStats.avgResponseTime = (poolHealthStats.avgResponseTime * 0.8) + (duration * 0.2);
  }
  
  // Update max response time
  if (duration > poolHealthStats.maxResponseTime) {
    poolHealthStats.maxResponseTime = duration;
  }
}

/**
 * ⚡ STAGE 3: Enhanced deadlock detection and classification
 */
function isDeadlockError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  
  const pgError = error as DatabaseError;
  const deadlockCodes = [
    '40P01', // deadlock_detected
    '40001', // serialization_failure
    '25P02', // in_failed_sql_transaction (can be related to deadlocks)
    '57014'  // query_canceled (sometimes due to deadlock timeout)
  ];
  
  const deadlockMessages = [
    'deadlock detected',
    'deadlock', 
    'could not serialize access',
    'concurrent update',
    'tuple concurrently updated'
  ];
  
  const hasDeadlockCode = deadlockCodes.includes(pgError.code ?? '');
  const hasDeadlockMessage = pgError.message && 
    deadlockMessages.some(msg => pgError.message.toLowerCase().includes(msg));
  
  return hasDeadlockCode || Boolean(hasDeadlockMessage);
}

/**
 * ⚡ STAGE 3: Advanced deadlock handling with exponential backoff
 */
function calculateDeadlockDelay(attempt: number): number {
  // تأخير متزايد مع jitter لتجنب thundering herd
  const baseDelay = 100; // 100ms base
  const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt - 1), 5000); // max 5s
  const jitter = Math.random() * 0.3 * exponentialDelay; // 30% jitter
  
  return Math.floor(exponentialDelay + jitter);
}

/**
 * ⚡ Enhanced deadlock recovery strategy
 */
async function handleDeadlockRecovery(
  error: Error, 
  attempt: number, 
  transactionId: string
): Promise<void> {
  const delay = calculateDeadlockDelay(attempt);
  
  log.warn('🔄 Deadlock detected, initiating recovery', {
    transactionId,
    attempt,
    delay,
    errorCode: (error as DatabaseError).code,
    deadlockCount: poolHealthStats.deadlockCount
  });
  
  // تسجيل إحصائيات Deadlock للمراقبة
  poolHealthStats.deadlockCount++;
  
  // تأخير متزايد قبل إعادة المحاولة
  await new Promise(resolve => setTimeout(resolve, delay));
  
  // تسجيل معلومات إضافية للتشخيص
  if (attempt === 1) {
    log.info('📊 Deadlock analysis', {
      currentConnections: pool?.totalCount ?? 0,
      idleConnections: pool?.idleCount ?? 0,
      avgResponseTime: poolHealthStats.avgResponseTime,
      recentDeadlocks: poolHealthStats.deadlockCount
    });
  }
}

/**
 * Check if error is a serialization failure
 */
function isSerializationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  
  const pgError = error as DatabaseError;
  return pgError.code === '40001' || // serialization_failure
         pgError.code === '25P02';   // transaction_integrity_constraint_violation
}

// Removed unused isConnectionError function for simplified implementation

/**
 * Enhanced pool statistics for comprehensive monitoring
 */
export function getPoolStats() {
  if (!pool || pool.ended) {
    return {
      totalCount: 0,
      idleCount: 0,
      waitingCount: 0,
      max: 0,
      min: 0,
      utilization: 0,
      healthStats: poolHealthStats,
      uptime: 0,
      poolEnded: true
    };
  }

  try {
    return {
      totalCount: pool.totalCount ?? 0,
      idleCount: pool.idleCount ?? 0,
      waitingCount: pool.waitingCount ?? 0,
      max: pool.options?.max ?? 0,
      min: pool.options?.min ?? 0,
      // Extended statistics
      utilization: ((pool.totalCount - pool.idleCount) / (pool.options?.max || 1)) * 100,
      healthStats: poolHealthStats,
      uptime: Date.now() - poolHealthStats.lastHealthCheck.getTime(),
      poolEnded: false
    };
  } catch (error) {
    log.error('❌ Error reading pool stats, returning fallback', {
      error: error instanceof Error ? error.message : String(error)
    });
    
    return {
      totalCount: 0,
      idleCount: 0,
      waitingCount: 0,
      max: 0,
      min: 0,
      utilization: 0,
      healthStats: poolHealthStats,
      uptime: 0,
      poolEnded: true,
      error: true
    };
  }
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
 * Graceful shutdown of database pool with cleanup
 */
export async function closeDatabasePool(): Promise<void> {
  if (pool) {
    try {
      // Stop health monitoring
      if (connectionMonitor) {
        clearInterval(connectionMonitor);
        connectionMonitor = null;
      }
      
      // Close the pool
      await pool.end();
      log.info('Database pool closed successfully', {
        totalConnectionsCreated: poolHealthStats.totalConnections,
        successfulConnections: poolHealthStats.successfulConnections,
        failedConnections: poolHealthStats.failedConnections
      });
    } catch (error: unknown) {
      log.error('Error closing database pool:', error);
    } finally {
      pool = null;
      // Reset health stats
      poolHealthStats = {
        totalConnections: 0,
        successfulConnections: 0,
        failedConnections: 0,
        avgResponseTime: 0,
        maxResponseTime: 0,
        lastHealthCheck: new Date(),
        connectionRetries: 0,
        deadlockCount: 0,
        transactionTimeouts: 0
      };
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
      params: params?.length ?? 0
    });
    throw error;
  }
}
