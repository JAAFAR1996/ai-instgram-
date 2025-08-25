/**
 * ===============================================
 * Redis Startup Module
 * Handles Redis integration and queue initialization
 * ===============================================
 */

import { Pool } from 'pg';
import { getLogger } from '../services/logger.js';
import { getRedisConnectionManager } from '../services/RedisConnectionManager.js';
import { ProductionQueueManager } from '../services/ProductionQueueManager.js';
import { RedisEnvironment } from '../config/RedisConfigurationFactory.js';

const log = getLogger({ component: 'redis-startup' });

// Global instances (simplified)
let queueManager: ProductionQueueManager | null = null;
let initializationResult: RedisIntegrationResult | null = null;

export interface RedisIntegrationResult {
  success: boolean;
  mode: 'active' | 'fallback' | 'disabled';
  queueManager?: ProductionQueueManager;
  error?: string;
  reason?: string;
}

/**
 * Initialize Redis integration (simplified version)
 */
export async function initializeRedisIntegration(_pool: Pool): Promise<RedisIntegrationResult> {
  if (initializationResult) {
    log.info('Redis integration already initialized, returning cached result');
    return initializationResult;
  }

  const redisUrl = process.env.REDIS_URL;
  const disableRedis = process.env.DISABLE_REDIS === 'true';
  
  if (!redisUrl || disableRedis) {
    log.warn(disableRedis ? 'Redis disabled by DISABLE_REDIS flag' : 'REDIS_URL not configured, skipping Redis integration');
    initializationResult = {
      success: false,
      mode: 'disabled',
      reason: disableRedis ? 'disabled_by_flag' : 'no_redis_url',
      error: disableRedis ? 'Redis disabled by DISABLE_REDIS environment variable' : 'REDIS_URL environment variable not set'
    };
    return initializationResult;
  }

  try {
    log.info('🔄 Initializing Redis integration...');
    
    // التحقق من صحة Redis URL
    if (!redisUrl.startsWith('redis://') && !redisUrl.startsWith('rediss://')) {
      throw new Error(`Invalid Redis URL format: ${redisUrl}`);
    }

    // التحقق من الاتصال بـ Redis قبل التهيئة
    const { Redis } = await import('ioredis');
    const testConnection = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: Number(process.env.REDIS_MAX_RETRIES || 3),
      connectTimeout: 5000,
      commandTimeout: 3000,
      enableReadyCheck: true
    });

    // اختبار الاتصال
    await testConnection.ping();
    await testConnection.disconnect();
    
    log.info('✅ Redis connection test successful');
    
    // Try to initialize queue manager
    const { getPool } = await import('../db/index.js');
    const environment = process.env.NODE_ENV === 'production' ? RedisEnvironment.PRODUCTION : RedisEnvironment.DEVELOPMENT;
    const dbPool = getPool();
    
    // Create simple logger adapter for ProductionQueueManager
    const queueLogger = {
      info: (message: string, context?: Record<string, unknown>) => {
        log.info(message, context);
      },
      warn: (message: string, context?: Record<string, unknown>) => {
        log.warn(message, context);
      },
      error: (message: string, error?: Error, context?: Record<string, unknown>) => {
        log.error(message, error, context);
      },
      debug: (message: string, context?: Record<string, unknown>) => {
        log.debug?.(message, context);
      }
    };
    
    queueManager = new ProductionQueueManager(queueLogger, environment, dbPool);
    const queueResult = await queueManager.initialize();
    
    if (queueResult.success) {
      log.info('✅ Redis integration initialized successfully');
      initializationResult = {
        success: true,
        mode: 'active',
        queueManager: queueManager
      };
    } else {
      log.warn('⚠️ Redis queue initialization failed, using fallback mode');
      initializationResult = {
        success: false,
        mode: 'fallback',
        error: queueResult.error || 'Queue initialization failed',
        reason: 'queue_init_failed'
      };
    }

    return initializationResult!;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.warn('⚠️ Redis integration initialization failed, continuing without Redis', { error: errorMessage });
    
    const errorResult: RedisIntegrationResult = {
      success: false,
      mode: 'disabled',
      error: errorMessage,
      reason: 'initialization_error'
    };
    
    initializationResult = errorResult;
    return errorResult;
  }
}

/**
 * Get the Redis connection manager (simplified)
 */
export function getRedisManager() {
  return getRedisConnectionManager();
}

/**
 * Get the current initialization result
 */
export function getRedisIntegrationStatus(): RedisIntegrationResult | null {
  return initializationResult;
}

/**
 * Check if Redis integration is healthy
 */
export function isRedisHealthy(): boolean {
  return initializationResult?.success === true && initializationResult.mode === 'active';
}

/**
 * Get queue manager if available (simplified)
 */
export function getQueueManager() {
  return queueManager;
}

/**
 * Cleanup Redis connections gracefully (simplified)
 */
export async function closeRedisConnections(): Promise<void> {
  try {
    if (queueManager) {
      await queueManager.gracefulShutdown();
    }
    
    const connectionManager = getRedisConnectionManager();
    await connectionManager.closeAllConnections();
    
    log.info('Redis connections closed');
  } catch (error: any) {
    log.error('Error closing Redis connections:', error);
  }
}