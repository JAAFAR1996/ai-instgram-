/**
 * ===============================================
 * Database Layer - Production Ready
 * Clean pg.Pool-based data access with transactions
 * ===============================================
 */

import { Pool, PoolClient, PoolConfig } from 'pg';
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

/**
 * Connection retry configuration
 */
interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

// ⚡ STAGE 3: Enhanced retry configuration for production resilience
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: process.env.NODE_ENV === 'production' ? 8 : 5,
  baseDelay: 1500, // 1.5 seconds initial delay
  maxDelay: 30000, // 30 seconds max delay for production
  backoffMultiplier: 1.8 // More gradual backoff
};

// ⚡ Connection retry strategies
interface RetryStrategy {
  name: string;
  shouldRetry: (error: Error, attempt: number) => boolean;
  getDelay: (attempt: number, config: RetryConfig) => number;
}

// ⚡ STAGE 3: Adaptive timeout calculation
function calculateAdaptiveTimeout(baseTimeout: number, attempt: number): number {
  // زيادة التايم أوت مع المحاولات لتحسين فرص النجاح
  const multiplier = 1 + (attempt * 0.3); // 30% زيادة لكل محاولة
  const adaptiveTimeout = Math.min(baseTimeout * multiplier, baseTimeout * 2.5); // حد أقصى 2.5x
  
  // إضافة buffer إضافي للعمليات المعقدة في المحاولات المتأخرة
  const complexityBuffer = attempt > 2 ? 5000 : 0;
  
  return Math.floor(adaptiveTimeout + complexityBuffer);
}

/**
 * Production-grade pool configuration using centralized config
 * محسّن لـ Render deployment
 */
function createPoolConfig(): PoolConfig {
  const config = getConfig();
  const isProduction = process.env.NODE_ENV === 'production';
  const isRender = process.env.IS_RENDER === 'true' || process.env.RENDER === 'true';
  
  // Enhanced SSL configuration for production
  let sslConfig: any = false;
  
  if (config.database.ssl || isProduction || isRender) {
    sslConfig = {
      // Require SSL in production unless explicitly disabled
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
      // Enable SSL verification in production
      checkServerIdentity: isProduction ? undefined : () => undefined,
      // Minimum TLS version
      minVersion: 'TLSv1.2',
      // Secure cipher suites
      ciphers: [
        'ECDHE-RSA-AES128-GCM-SHA256',
        'ECDHE-RSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES128-SHA256',
        'ECDHE-RSA-AES256-SHA384'
      ].join(':'),
      // Honor server cipher order
      honorCipherOrder: true
    };
    
    // Additional production SSL settings
    if (isProduction) {
      log.info('🔐 Using production SSL configuration for database', {
        rejectUnauthorized: sslConfig.rejectUnauthorized,
        minVersion: sslConfig.minVersion
      });
    }
  }
  
  // ⚡ STAGE 3: Enhanced pool configuration for optimal performance
  const maxConnections = Number(process.env.DB_MAX_CONNECTIONS || process.env.DATABASE_POOL_MAX || (isProduction ? 20 : 10));
  const minConnections = Number(process.env.DATABASE_POOL_MIN || Math.max(2, Math.floor(maxConnections / 4)));
  
  return {
    connectionString: config.database.url,
    ssl: sslConfig,
    // ⚡ Optimized connection pool sizing
    max: maxConnections,
    min: minConnections,
    // ⚡ Improved timeout settings
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT || (isProduction ? 30000 : 15000)),
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT || 10000),
    // ⚡ Enhanced query timeouts
    statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT || (isProduction ? 45000 : 30000)),
    query_timeout: Number(process.env.DB_QUERY_TIMEOUT || (isProduction ? 40000 : 25000)),
    // ⚡ Connection lifecycle management
    allowExitOnIdle: !isProduction, // Keep connections alive in production
    // ⚡ Monitoring and identification
    application_name: `ai-sales-${process.env.NODE_ENV || 'dev'}-${process.pid}`,
    // ⚡ Enhanced keepalive settings
    keepAlive: true,
    keepAliveInitialDelayMillis: isProduction ? 30000 : 10000,
  };
}

/**
 * Get database pool instance with comprehensive monitoring
 */
export function getPool(): Pool {
  if (!pool) {
    const config = createPoolConfig();
    pool = new Pool(config);

    // Enhanced pool event handlers
    pool.on('connect', () => {
      poolHealthStats.totalConnections++;
      poolHealthStats.successfulConnections++;
      log.debug('New client connected to PostgreSQL', {
        totalConnections: poolHealthStats.totalConnections,
        poolStats: getPoolStats()
      });
    });

    pool.on('acquire', () => {
      log.debug('Client acquired from pool', {
        idleCount: pool?.idleCount,
        totalCount: pool?.totalCount
      });
    });

    pool.on('error', (err) => {
      poolHealthStats.failedConnections++;
      const dbError = err as DatabaseError;
      log.error('Database pool error:', {
        error: err.message,
        code: dbError.code,
        totalConnections: poolHealthStats.totalConnections,
        failedConnections: poolHealthStats.failedConnections
      });
      
      // Handle connection failure
      handleConnectionFailure(err);
    });

    pool.on('remove', () => {
      log.debug('Client removed from pool', {
        reason: 'idle_timeout_or_error',
        remainingConnections: pool?.totalCount
      });
    });

    // Setup connection monitoring
    setupConnectionRetry();
    startPoolHealthMonitoring();

    log.info('PostgreSQL pool initialized with monitoring', {
      max: config.max,
      min: config.min,
      idleTimeout: config.idleTimeoutMillis,
      connectionTimeout: config.connectionTimeoutMillis,
      monitoringEnabled: true
    });
  }

  return pool;
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

      // ⚡ STAGE 3: Enhanced transaction timeout with proper cleanup
      let timeoutId: NodeJS.Timeout | null = null;
      const adaptiveTimeout = calculateAdaptiveTimeout(timeout, attempt);
      
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
      
      // Retry conditions with enhanced logic
      const shouldRetry = attempt < retries && (isDeadlock || isSerializationFailure);
      
      if (shouldRetry) {
        attempt++;
        // Exponential backoff for retries
        const backoffDelay = Math.min(
          DEFAULT_RETRY_CONFIG.baseDelay * Math.pow(DEFAULT_RETRY_CONFIG.backoffMultiplier, attempt - 1),
          DEFAULT_RETRY_CONFIG.maxDelay
        );
        
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
// ⚡ STAGE 3: Advanced connection retry strategies
const RETRY_STRATEGIES: Record<string, RetryStrategy> = {
  exponentialBackoff: {
    name: 'exponential-backoff',
    shouldRetry: (error: Error, attempt: number) => {
      const dbError = error as DatabaseError;
      const retryableErrors = ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'];
      return attempt < DEFAULT_RETRY_CONFIG.maxRetries && 
             retryableErrors.includes(dbError.code || '');
    },
    getDelay: (attempt: number, config: RetryConfig) => {
      const delay = Math.min(
        config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1),
        config.maxDelay
      );
      // Add jitter to prevent thundering herd
      return delay + Math.random() * 1000;
    }
  },
  linearBackoff: {
    name: 'linear-backoff',
    shouldRetry: (error: Error, attempt: number) => {
      log.debug('Linear backoff retry check', { error: error.message, attempt });
      return attempt < DEFAULT_RETRY_CONFIG.maxRetries;
    },
    getDelay: (attempt: number, config: RetryConfig) => {
      return Math.min(config.baseDelay * attempt, config.maxDelay);
    }
  }
};

function setupConnectionRetry(): void {
  if (!pool) return;

  // ⚡ Enhanced connection error handling with smart retry strategies
  pool.on('error', async (err) => {
    if (isConnectionError(err)) {
      poolHealthStats.connectionRetries++;
      const strategy = RETRY_STRATEGIES.exponentialBackoff as RetryStrategy;
      
      log.warn('Connection error detected, initiating enhanced retry sequence', {
        error: err.message,
        code: (err as DatabaseError).code,
        retryCount: poolHealthStats.connectionRetries,
        strategy: strategy.name
      });
      
      // Execute retry strategy
      await executeRetryStrategy(err, strategy);
    }
  });
}

// ⚡ Execute sophisticated retry strategy
async function executeRetryStrategy(error: Error, strategy: RetryStrategy): Promise<void> {
  let attempt = 1;
  
  while (strategy.shouldRetry(error, attempt)) {
    const delay = strategy.getDelay(attempt, DEFAULT_RETRY_CONFIG);
    
    log.info(`⚡ Attempting database recovery (${attempt}/${DEFAULT_RETRY_CONFIG.maxRetries})`, {
      strategy: strategy.name,
      delay,
      attempt
    });
    
    await new Promise(resolve => setTimeout(resolve, delay));
    
    try {
      // Test connection recovery with timeout
      await Promise.race([
        checkDatabaseHealth(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), 5000)
        )
      ]);
      
      log.info('✅ Database connection recovery successful', {
        attempt,
        totalRetries: poolHealthStats.connectionRetries
      });
      return;
      
    } catch (recoveryError) {
      log.warn(`❌ Database recovery attempt ${attempt} failed`, { 
        recoveryError: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
        nextAttemptIn: attempt < DEFAULT_RETRY_CONFIG.maxRetries ? strategy.getDelay(attempt + 1, DEFAULT_RETRY_CONFIG) : 'none'
      });
      attempt++;
    }
  }
  
  log.error('🚨 Database connection recovery exhausted all retry attempts', {
    totalAttempts: attempt - 1,
    maxRetries: DEFAULT_RETRY_CONFIG.maxRetries
  });
}

/**
 * Start pool health monitoring
 */
function startPoolHealthMonitoring(): void {
  // Clear existing monitor if any
  if (connectionMonitor) {
    clearInterval(connectionMonitor);
  }
  
  connectionMonitor = setInterval(async () => {
    await monitorPoolHealth();
  }, 60000); // Check every minute
}

/**
 * Monitor pool health and log metrics
 */
async function monitorPoolHealth(): Promise<void> {
  try {
    const stats = getPoolStats();
    
    if (!stats || !pool) return;
    
    // Calculate pool utilization
    const utilization = ((stats.totalCount - stats.idleCount) / (stats.max || 1)) * 100;
    
    // Update health stats
    poolHealthStats.lastHealthCheck = new Date();
    
    // Log health metrics
    log.debug('Pool health check', {
      utilization: Math.round(utilization),
      totalConnections: stats.totalCount,
      idleConnections: stats.idleCount,
      waitingConnections: stats.waitingCount,
      maxConnections: stats.max,
      successfulConnections: poolHealthStats.successfulConnections,
      failedConnections: poolHealthStats.failedConnections,
      avgResponseTime: poolHealthStats.avgResponseTime,
      transactionTimeouts: poolHealthStats.transactionTimeouts,
      deadlockCount: poolHealthStats.deadlockCount
    });
    
    // Warning thresholds
    if (utilization > 80) {
      log.warn('High database pool utilization', {
        utilization: Math.round(utilization),
        recommendation: 'Consider optimizing connection usage or increasing pool size'
      });
    }
    
    if (stats.waitingCount > 0) {
      log.warn('Clients waiting for database connections', {
        waitingCount: stats.waitingCount,
        recommendation: 'Consider increasing pool size or optimizing query performance'
      });
    }
    
    // Memory leak detection
    if (poolHealthStats.totalConnections > (stats.max || 10) * 10) {
      log.error('Potential connection leak detected', {
        totalConnectionsCreated: poolHealthStats.totalConnections,
        currentConnections: stats.totalCount,
        maxAllowed: stats.max,
        recommendation: 'Investigate for connection leaks'
      });
    }
    
  } catch (error) {
    log.error('Pool health monitoring failed', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Handle connection failures with automatic recovery
 */
function handleConnectionFailure(error: Error): void {
  const dbError = error as DatabaseError;
  log.error('Connection failure detected', {
    error: error.message,
    code: dbError.code,
    connectionRetries: poolHealthStats.connectionRetries
  });
  
  // Implement connection failure recovery strategies
  const errorCode = dbError.code;
  
  switch (errorCode) {
    case 'ECONNREFUSED':
    case 'ENOTFOUND':
      log.warn('Database server unreachable, will attempt reconnection');
      break;
      
    case 'ECONNRESET':
      log.warn('Connection reset by database server');
      break;
      
    case 'ETIMEDOUT':
      log.warn('Connection timeout, check network and database performance');
      break;
      
    default:
      log.warn('Unknown connection error', { errorCode });
  }
}

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
      currentStats: null,
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
  
  const hasDeadlockCode = deadlockCodes.includes(pgError.code || '');
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
      currentConnections: pool?.totalCount || 0,
      idleConnections: pool?.idleCount || 0,
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

/**
 * Check if error is a connection-related error
 */
function isConnectionError(error: Error): boolean {
  const connectionCodes = [
    'ECONNREFUSED',
    'ECONNRESET', 
    'ENOTFOUND',
    'ETIMEDOUT',
    'EPIPE',
    'ENETUNREACH'
  ];
  
  const pgError = error as DatabaseError;
  return connectionCodes.includes(pgError.code || '') ||
         connectionCodes.includes((pgError as any).errno || '') ||
         (typeof error === 'object' && error !== null && 'message' in error && 
          typeof error.message === 'string' && 
          error.message.includes('connect'));
}

/**
 * Enhanced pool statistics for comprehensive monitoring
 */
export function getPoolStats() {
  if (!pool) return null;

  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    max: pool.options.max,
    min: pool.options.min,
    // Extended statistics
    utilization: ((pool.totalCount - pool.idleCount) / (pool.options.max || 1)) * 100,
    healthStats: poolHealthStats,
    uptime: Date.now() - poolHealthStats.lastHealthCheck.getTime()
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
      params: params?.length || 0
    });
    throw error;
  }
}