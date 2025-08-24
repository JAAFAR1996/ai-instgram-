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
  if (!redisUrl) {
    log.warn('REDIS_URL not configured, skipping Redis integration');
    initializationResult = {
      success: false,
      mode: 'disabled',
      reason: 'no_redis_url',
      error: 'REDIS_URL environment variable not set'
    };
    return initializationResult;
  }

  try {
    log.info('🔄 Initializing Redis integration...');
    
    // Try to initialize queue manager
    const { getPool } = await import('../db/index.js');
    const environment = process.env.NODE_ENV === 'production' ? RedisEnvironment.PRODUCTION : RedisEnvironment.DEVELOPMENT;
    const dbPool = getPool();
    
    // Create logger adapter for ProductionQueueManager
    const queueLogger = {
      info: (...args: unknown[]) => log.info(String(args[0]), args.length > 1 ? { extra: args.slice(1) } : undefined),
      warn: (...args: unknown[]) => log.warn(String(args[0]), args.length > 1 ? { extra: args.slice(1) } : undefined),
      error: (...args: unknown[]) => log.error(String(args[0]), args.length > 1 ? args[1] as Error : undefined, args.length > 2 ? { extra: args.slice(2) } : undefined),
      debug: (...args: unknown[]) => log.debug?.(String(args[0]), args.length > 1 ? { extra: args.slice(1) } : undefined)
    };
    
    queueManager = new ProductionQueueManager(redisUrl, queueLogger, environment, dbPool);
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

    return initializationResult!; // Safe because we always assign before returning
  } catch (error: any) {
    log.error('❌ Redis integration initialization failed', error);
    
    const errorResult: RedisIntegrationResult = {
      success: false,
      mode: 'disabled',
      error: error.message,
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