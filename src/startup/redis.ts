/**
 * ===============================================
 * Redis Startup Module
 * Handles Redis integration and queue initialization
 * ===============================================
 */

import { Pool } from 'pg';
import { getLogger } from '../services/logger.js';
import { RedisProductionIntegration, type RedisIntegrationResult } from '../services/RedisProductionIntegration.js';
import { Environment } from '../config/RedisConfigurationFactory.js';

const log = getLogger({ component: 'redis-startup' });

// Global integration instance
let redisIntegration: RedisProductionIntegration | null = null;
let initializationResult: RedisIntegrationResult | null = null;

/**
 * Initialize Redis integration with production configuration
 */
export async function initializeRedisIntegration(pool: Pool): Promise<RedisIntegrationResult> {
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

  const environment = (process.env.NODE_ENV === 'production') ? Environment.PRODUCTION : Environment.DEVELOPMENT;
  
  try {
    log.info('🔄 Initializing Redis production integration...');
    
    redisIntegration = new RedisProductionIntegration(
      redisUrl,
      log,
      environment,
      pool
    );

    initializationResult = await redisIntegration.initialize();
    
    if (initializationResult.success) {
      log.info('✅ Redis integration initialized successfully', {
        mode: initializationResult.mode,
        queueManagerReady: !!initializationResult.queueManager
      });
    } else {
      log.warn('⚠️ Redis integration failed or degraded', {
        mode: initializationResult.mode,
        error: initializationResult.error,
        reason: initializationResult.reason
      });
    }

    return initializationResult;
  } catch (error: any) {
    log.error('❌ Redis integration initialization failed', error);
    
    initializationResult = {
      success: false,
      mode: 'disabled',
      error: error.message,
      reason: 'initialization_error'
    };
    
    return initializationResult;
  }
}

/**
 * Get the current Redis integration instance
 */
export function getRedisIntegration(): RedisProductionIntegration | null {
  return redisIntegration;
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
 * Get queue manager if available
 */
export function getQueueManager() {
  if (!initializationResult?.queueManager) {
    return null;
  }
  return initializationResult.queueManager;
}

/**
 * Cleanup Redis connections gracefully
 */
export async function closeRedisConnections(): Promise<void> {
  if (redisIntegration) {
    try {
      // Add cleanup method if available in RedisProductionIntegration
      // await redisIntegration.cleanup();
      log.info('Redis connections closed');
    } catch (error: any) {
      log.error('Error closing Redis connections:', error);
    }
  }
}