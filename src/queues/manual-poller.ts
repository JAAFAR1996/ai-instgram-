/**
 * ===============================================
 * Manual Queue Polling - Safe Implementation
 * استطلاع يدوي آمن للطوابير مع معالجة الأخطاء
 * ===============================================
 */

import { setTimeout as delay } from 'node:timers/promises';
import { safeAsync, wrapError, shutdownController } from '../boot/error-handlers';

type Health = 'healthy' | 'degraded' | 'unhealthy';

interface PollStats {
  queueStats: any;
  health: Health;
  processorCount: number;
}

interface PollOptions {
  intervalMs?: number;
  maxRetries?: number;
  backoffMultiplier?: number;
  maxBackoffMs?: number;
}

/**
 * Safe polling loop with comprehensive error handling
 */
export async function pollLoop(options: PollOptions = {}): Promise<void> {
  const {
    intervalMs = 2000,
    maxRetries = 3,
    backoffMultiplier = 2,
    maxBackoffMs = 30000
  } = options;

  let errorCount = 0;
  let currentBackoffMs = 1000;

  console.log('🔄 Starting manual polling loop...', { intervalMs, maxRetries });

  // Continue until shutdown signal
  while (!shutdownController.signal.aborted) {
    try {
      console.log('🔍 [MANUAL-POLLING] دورة فحص جديدة...');
      
      // Get queue stats safely
      const stats = await getQueueStatsSafe();
      if (!stats) {
        console.warn('⚠️  Failed to get queue stats, skipping cycle');
        await safeDelay(intervalMs);
        continue;
      }

      console.log('📊 [MANUAL-POLLING] إحصائيات الطابور:', stats);

      // Check if processing is needed based on health  
      if (stats && stats.health === 'healthy' && stats.processorCount > 0) {
        console.log(`🎯 Queue is healthy with ${stats.processorCount} processors`);
        // In a real scenario, jobs are processed automatically by the queue
        // This polling is just for monitoring
      } else if (stats) {
        console.log(`⚠️  Queue health: ${stats.health}, processors: ${stats.processorCount}`);
      } else {
        console.log('⚠️  Failed to get queue statistics');
      }

      // Reset error count on success
      errorCount = 0;
      currentBackoffMs = 1000;

    } catch (error) {
      errorCount++;
      const wrappedError = wrapError(error, 'pollLoop cycle failed');
      
      console.error('[pollLoop] Error in polling cycle', {
        error: wrappedError.message,
        errorCount,
        currentBackoffMs,
        stack: wrappedError.stack
      });

      // Exponential backoff on repeated failures
      if (errorCount >= maxRetries) {
        currentBackoffMs = Math.min(currentBackoffMs * backoffMultiplier, maxBackoffMs);
        console.warn(`🔄 Backing off for ${currentBackoffMs}ms after ${errorCount} errors`);
      }

      // Circuit breaker: if too many errors, increase interval
      const effectiveInterval = errorCount > maxRetries 
        ? Math.max(intervalMs, currentBackoffMs)
        : intervalMs;

      await safeDelay(effectiveInterval);
      continue;
    }

    // Normal interval delay
    await safeDelay(intervalMs);
  }

  console.log('🛑 Polling loop stopped due to shutdown signal');
}

/**
 * Safely get queue statistics
 */
async function getQueueStatsSafe(): Promise<PollStats | null> {
  const result = await safeAsync<PollStats>(async () => {
    const { getQueueManager } = await import('../queue/queue-manager.js');
    const qm = getQueueManager();
    const raw = await qm.getStats();
    if (!raw) throw new Error('getStats() returned null/undefined');

    const health: Health = raw.health ?? 'unhealthy';
    const processorCount = raw.processors?.registered ?? 0;
    const queueStats = raw.queue ?? {};

    return { queueStats, health, processorCount };
  }, 'getQueueStats');

  return result ?? null;
}

/**
 * Monitor queue health and log status  
 */
async function monitorQueueHealth(): Promise<void> {
  await safeAsync(async () => {
    const { getQueueManager } = await import('../queue/queue-manager.js');
    const queueManager = getQueueManager();

    // Get detailed health info
    const health = await queueManager.healthCheck();
    
    console.log('📊 Queue health monitoring:', {
      status: health.status,
      details: health.details || {}
    });

  }, 'monitorQueueHealth');
}

/**
 * Safe delay with abort signal support
 */
async function safeDelay(ms: number): Promise<void> {
  try {
    await delay(ms, undefined, { signal: shutdownController.signal });
  } catch (error) {
    // AbortError is expected during shutdown
    if ((error as any)?.name === 'AbortError') {
      console.log('🛑 Delay aborted due to shutdown signal');
      return;
    }
    throw error;
  }
}

/**
 * Start polling with error recovery
 */
export async function startPolling(options?: PollOptions): Promise<void> {
  console.log('🚀 Starting queue polling service...');
  
  try {
    await pollLoop(options);
  } catch (error) {
    const wrappedError = wrapError(error, 'startPolling failed');
    console.error('[startPolling] Fatal error:', wrappedError);
    throw wrappedError;
  }
}

/**
 * Health check for polling service
 */
export function getPollHealthCheck() {
  return {
    status: shutdownController.signal.aborted ? 'stopped' : 'running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  };
}