/**
 * Lightweight Redis startup for Render deployment.
 * Enables idempotency/rate-limit features when REDIS_URL is provided,
 * without queue/worker dependencies.
 */

import type { Pool } from 'pg';
import { getLogger } from '../services/logger.js';
import { getRedisConnectionManager } from '../services/RedisConnectionManager.js';

const log = getLogger({ component: 'redis-startup' });

export interface RedisIntegrationResult {
  success: boolean;
  mode: 'active' | 'fallback' | 'disabled';
  error?: string;
  reason?: string;
}

let state: RedisIntegrationResult | null = null;

export async function initializeRedisIntegration(_pool: Pool): Promise<RedisIntegrationResult> {
  if (state) return state;

  const url = process.env.REDIS_URL ?? '';
  const disabled = process.env.DISABLE_REDIS === 'true';

  if (disabled || !url) {
    state = { success: false, mode: 'disabled', reason: disabled ? 'disabled_by_flag' : 'no_redis_url' };
    log.warn(disabled ? 'Redis disabled by flag' : 'REDIS_URL not set; Redis features disabled');
    return state;
  }

  if (!url.startsWith('redis://') && !url.startsWith('rediss://')) {
    state = { success: false, mode: 'disabled', reason: 'invalid_url', error: `Invalid REDIS_URL: ${url}` };
    log.warn('Invalid REDIS_URL format');
    return state;
  }

  // Consider Redis available for higher-level features; connection is on-demand
  log.info('Redis integration enabled (lightweight)');
  state = { success: true, mode: 'active' };
  return state;
}

export function getRedisIntegrationStatus(): RedisIntegrationResult | null {
  return state;
}

export function isRedisHealthy(): boolean {
  return state?.success === true && state.mode === 'active';
}

export function getRedisManager() {
  return getRedisConnectionManager();
}

export async function closeRedisConnections(): Promise<void> {
  try {
    const mgr = getRedisConnectionManager();
    await mgr.closeAllConnections();
    log.info('Redis connections closed');
  } catch (err) {
    log.error('Error closing Redis connections:', err as Error);
  }
}

