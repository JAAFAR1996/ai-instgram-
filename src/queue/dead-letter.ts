/**
 * ===============================================
 * Production-Grade Dead Letter Queue (DLQ)
 * طابور الرسائل الميتة - معالجة الأخطاء والفشل المتقدمة
 * ===============================================
 */

import { getLogger } from '../services/logger.js';
import { withTimeout } from '../utils/timeout.js';
import { randomUUID } from 'crypto';

export interface DeadLetterItem {
  id: string;
  ts: number;
  reason: string;
  payload: unknown;
  eventId?: string;
  merchantId?: string;
  platform?: string;
  retryCount: number;
  maxRetries: number;
  nextRetryAt?: number;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  traceId?: string;
  correlationId?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: 'webhook' | 'api' | 'database' | 'redis' | 'queue' | 'other';
}

const dlq: DeadLetterItem[] = [];
const MAX_DLQ_SIZE = parseInt(process.env.DLQ_MAX_SIZE || '10000');
const DLQ_RETRY_DELAY_MS = parseInt(process.env.DLQ_RETRY_DELAY_MS || '300000'); // 5 minutes
const logger = getLogger({ component: 'DLQ' });

const dlqStats = {
  totalProcessed: 0,
  totalRetried: 0,
  totalFailed: 0,
  avgLatency: 0,
  lastCleanup: 0,
  circuitBreakerOpen: false,
  circuitBreakerOpenedAt: 0,
  consecutiveFailures: 0
};

// Circuit breaker configuration
const CIRCUIT_BREAKER_THRESHOLD = parseInt(process.env.DLQ_CIRCUIT_BREAKER_THRESHOLD || '5');
const CIRCUIT_BREAKER_TIMEOUT = parseInt(process.env.DLQ_CIRCUIT_BREAKER_TIMEOUT || '60000'); // 1 minute

/**
 * Enhanced DLQ push with retry logic and categorization
 */
export function pushDLQ(item: Partial<DeadLetterItem> & { reason: string; payload: unknown }): void {
  const dlqItem: DeadLetterItem = {
    id: generateDLQId(),
    ts: Date.now(),
    retryCount: 0,
    maxRetries: 5,
    severity: 'medium',
    category: 'other',
    ...item
  };

  // Calculate next retry time
  if (dlqItem.retryCount < dlqItem.maxRetries) {
    dlqItem.nextRetryAt = Date.now() + (DLQ_RETRY_DELAY_MS * Math.pow(2, dlqItem.retryCount));
  }

  dlq.push(dlqItem);
  dlqStats.totalProcessed++;
  
  // Automatic cleanup to prevent memory overflow
  if (dlq.length > MAX_DLQ_SIZE) {
    const removed = dlq.shift();
    logger.warn('DLQ capacity reached, oldest item removed', { 
      removedId: removed?.id,
      currentSize: dlq.length 
    });
  }
  
  logger.error('DLQ item added', {
    dlqId: dlqItem.id,
    reason: dlqItem.reason,
    severity: dlqItem.severity,
    category: dlqItem.category,
    retryCount: dlqItem.retryCount,
    maxRetries: dlqItem.maxRetries,
    nextRetryAt: dlqItem.nextRetryAt,
    queueSize: dlq.length,
    eventId: dlqItem.eventId,
    merchantId: dlqItem.merchantId,
    platform: dlqItem.platform,
    traceId: dlqItem.traceId
  });

  // Alert on critical items
  if (dlqItem.severity === 'critical') {
    logger.fatal('Critical DLQ item added', {
      dlqId: dlqItem.id,
      reason: dlqItem.reason,
      eventId: dlqItem.eventId
    });
  }
}

/**
 * Get DLQ statistics
 */
export function getDLQStats(): {
  size: number;
  latest: number | null;
  oldestTs: number | null;
  reasons: Record<string, number>;
} {
  const reasons: Record<string, number> = {};
  
  dlq.forEach(item => {
    reasons[item.reason] = (reasons[item.reason] || 0) + 1;
  });
  
  return {
    size: dlq.length,
    latest: dlq.at(-1)?.ts ?? null,
    oldestTs: dlq.at(0)?.ts ?? null,
    reasons
  };
}

/**
 * Drain all items from DLQ (for processing or cleanup)
 */
export function drainDLQ(): DeadLetterItem[] {
  const drained = dlq.splice(0, dlq.length);
  console.log(`🗑️ DLQ: Drained ${drained.length} items`);
  return drained;
}

/**
 * Get recent DLQ items (for debugging)
 */
export function getRecentDLQItems(limit: number = 10): DeadLetterItem[] {
  return dlq.slice(-limit);
}

/**
 * Clear DLQ items older than specified time
 */
export function cleanupOldDLQItems(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
  const cutoff = Date.now() - maxAgeMs;
  // const originalLength = dlq.length; // unused
  
  // Remove items older than cutoff
  let removed = 0;
  while (dlq.length > 0) {
    const item = dlq[0]!;
    if (item.ts >= cutoff) break;
    dlq.shift();
    removed++;
  }
  
  if (removed > 0) {
    console.log(`🧹 DLQ: Cleaned up ${removed} old items`);
  }
  
  return removed;
}

/**
 * Get DLQ health status
 */
export function getDLQHealth(): {
  status: 'healthy' | 'warning' | 'critical';
  message: string;
  size: number;
  utilization: number;
} {
  const size = dlq.length;
  const utilization = (size / MAX_DLQ_SIZE) * 100;
  
  let status: 'healthy' | 'warning' | 'critical' = 'healthy';
  let message = 'DLQ operating normally';
  
  if (utilization > 80) {
    status = 'critical';
    message = `DLQ near capacity: ${utilization.toFixed(1)}%`;
  } else if (utilization > 50) {
    status = 'warning';  
    message = `DLQ high utilization: ${utilization.toFixed(1)}%`;
  }
  
  return { status, message, size, utilization };
}

/**
 * Generate unique DLQ item ID
 */
function generateDLQId(): string {
  return `dlq_${Date.now()}_${randomUUID()}`;
}

/**
 * Retry eligible DLQ items
 */
export async function processRetryableItems(
  retryHandler: (item: DeadLetterItem) => Promise<boolean>
): Promise<{ retried: number; succeeded: number; failed: number }> {
  const now = Date.now();
  
  // Check circuit breaker
  if (dlqStats.circuitBreakerOpen) {
    if (now - dlqStats.circuitBreakerOpenedAt > CIRCUIT_BREAKER_TIMEOUT) {
      // Reset circuit breaker after timeout
      dlqStats.circuitBreakerOpen = false;
      dlqStats.consecutiveFailures = 0;
      logger.info('DLQ circuit breaker reset after timeout', {
        timeoutMs: CIRCUIT_BREAKER_TIMEOUT,
        previousFailures: dlqStats.consecutiveFailures
      });
    } else {
      logger.warn('DLQ circuit breaker is open, skipping retry processing', {
        openedAt: new Date(dlqStats.circuitBreakerOpenedAt).toISOString(),
        timeRemainingMs: CIRCUIT_BREAKER_TIMEOUT - (now - dlqStats.circuitBreakerOpenedAt)
      });
      return { retried: 0, succeeded: 0, failed: 0 };
    }
  }
  
  const retryableItems = dlq.filter(item => 
    item.nextRetryAt && 
    item.nextRetryAt <= now && 
    item.retryCount < item.maxRetries
  );

  let retried = 0;
  let succeeded = 0;
  let failed = 0;

  // Process items in batches to avoid overwhelming the system
  const BATCH_SIZE = parseInt(process.env.DLQ_BATCH_SIZE || '5');
  
  for (let i = 0; i < retryableItems.length; i += BATCH_SIZE) {
    const batch = retryableItems.slice(i, i + BATCH_SIZE);
    
    await Promise.allSettled(batch.map(async (item) => {
      const startTime = Date.now();
      
      try {
        logger.info('Retrying DLQ item', { 
          dlqId: item.id, 
          attempt: item.retryCount + 1,
          maxRetries: item.maxRetries,
          category: item.category,
          severity: item.severity
        });

        const success = await withTimeout(
          retryHandler(item), 
          30000, 
          `DLQ retry ${item.id}`
        );

        const processingTime = Date.now() - startTime;

        if (success) {
          // Remove from DLQ atomically
          const index = dlq.findIndex(i => i.id === item.id);
          if (index >= 0) {
            dlq.splice(index, 1);
            succeeded++;
            dlqStats.totalRetried++;
            dlqStats.avgLatency = (dlqStats.avgLatency + processingTime) / 2;
            
            logger.info('DLQ item retry succeeded', { 
              dlqId: item.id,
              processingTime,
              category: item.category,
              severity: item.severity
            });
          } else {
            logger.warn('DLQ item not found during success removal', { dlqId: item.id });
          }
        } else {
          // Update retry count with exponential backoff
          item.retryCount++;
          const backoffMultiplier = Math.pow(2, item.retryCount);
          const jitter = Math.random() * 1000; // Add jitter to prevent thundering herd
          
          if (item.retryCount < item.maxRetries) {
            item.nextRetryAt = Date.now() + (DLQ_RETRY_DELAY_MS * backoffMultiplier) + jitter;
          } else {
            delete item.nextRetryAt; // Max retries reached
            dlqStats.totalFailed++;
            
            // Log permanent failure for monitoring
            logger.error('DLQ item permanently failed', { 
              dlqId: item.id,
              reason: item.reason,
              category: item.category,
              severity: item.severity,
              totalAttempts: item.retryCount,
              originalError: item.error,
              traceId: item.traceId
            });
            
            // Mark as critical if originally high/critical severity
            if (item.severity === 'high' || item.severity === 'critical') {
              item.severity = 'critical';
              logger.fatal('Critical DLQ item permanently failed', {
                dlqId: item.id,
                reason: item.reason,
                merchantId: item.merchantId,
                eventId: item.eventId
              });
            }
          }
          failed++;
          
          logger.warn('DLQ item retry failed', { 
            dlqId: item.id,
            retryCount: item.retryCount,
            maxRetries: item.maxRetries,
            nextRetryAt: item.nextRetryAt,
            processingTime,
            category: item.category,
            severity: item.severity
          });
        }
        retried++;
      } catch (error: any) {
        const processingTime = Date.now() - startTime;
        
        // Enhanced error logging with context
        const errorDetails = {
          dlqId: item.id,
          retryAttempt: item.retryCount + 1,
          maxRetries: item.maxRetries,
          category: item.category,
          severity: item.severity,
          processingTime,
          errorName: error?.name || 'UnknownError',
          errorMessage: error?.message || 'Unknown error occurred',
          errorStack: error?.stack,
          merchantId: item.merchantId,
          traceId: item.traceId,
          correlationId: item.correlationId
        };
        
        logger.error('DLQ retry handler error', errorDetails);
        
        // Update item with error information
        item.error = {
          name: error?.name || 'RetryHandlerError',
          message: error?.message || 'Retry handler failed',
          stack: error?.stack
        };
        
        // Increment retry count even on handler error
        item.retryCount++;
        if (item.retryCount < item.maxRetries) {
          const backoffMultiplier = Math.pow(2, item.retryCount);
          const jitter = Math.random() * 1000;
          item.nextRetryAt = Date.now() + (DLQ_RETRY_DELAY_MS * backoffMultiplier) + jitter;
        } else {
          delete item.nextRetryAt;
          dlqStats.totalFailed++;
          
          logger.error('DLQ item failed permanently due to handler errors', errorDetails);
        }
        
        failed++;
        retried++;
      }
    }));
    
    // Small delay between batches to prevent overwhelming
    if (i + BATCH_SIZE < retryableItems.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // Update circuit breaker state
  if (succeeded > 0) {
    // Reset consecutive failures on any success
    dlqStats.consecutiveFailures = 0;
  } else if (failed > 0) {
    dlqStats.consecutiveFailures += failed;
    
    // Open circuit breaker if threshold exceeded
    if (dlqStats.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD && !dlqStats.circuitBreakerOpen) {
      dlqStats.circuitBreakerOpen = true;
      dlqStats.circuitBreakerOpenedAt = Date.now();
      
      logger.error('DLQ circuit breaker opened due to consecutive failures', {
        consecutiveFailures: dlqStats.consecutiveFailures,
        threshold: CIRCUIT_BREAKER_THRESHOLD,
        timeoutMs: CIRCUIT_BREAKER_TIMEOUT
      });
    }
  }

  if (retried > 0) {
    logger.info('DLQ retry batch completed', { 
      retried, 
      succeeded, 
      failed,
      successRate: succeeded > 0 ? ((succeeded / retried) * 100).toFixed(1) + '%' : '0%',
      totalQueueSize: dlq.length,
      avgLatency: dlqStats.avgLatency.toFixed(2) + 'ms',
      consecutiveFailures: dlqStats.consecutiveFailures,
      circuitBreakerOpen: dlqStats.circuitBreakerOpen
    });
  }

  return { retried, succeeded, failed };
}

/**
 * Get comprehensive DLQ monitoring data
 */
export function getDLQMonitoring(): {
  queue: {
    size: number;
    capacity: number;
    utilization: number;
  };
  stats: typeof dlqStats & {
    successRate: number;
    criticalItems: number;
    retryableItems: number;
  };
  categories: Record<string, number>;
  severities: Record<string, number>;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
} {
  const now = Date.now();
  const retryableItems = dlq.filter(item => 
    item.nextRetryAt && item.nextRetryAt <= now && item.retryCount < item.maxRetries
  ).length;

  const criticalItems = dlq.filter(item => item.severity === 'critical').length;
  
  const categories: Record<string, number> = {};
  const severities: Record<string, number> = {};
  const latencies: number[] = [];

  dlq.forEach(item => {
    categories[item.category] = (categories[item.category] || 0) + 1;
    severities[item.severity] = (severities[item.severity] || 0) + 1;
    latencies.push(now - item.ts);
  });

  latencies.sort((a, b) => a - b);

  return {
    queue: {
      size: dlq.length,
      capacity: MAX_DLQ_SIZE,
      utilization: (dlq.length / MAX_DLQ_SIZE) * 100
    },
    stats: {
      ...dlqStats,
      successRate: dlqStats.totalRetried > 0 ? 
        ((dlqStats.totalRetried - dlqStats.totalFailed) / dlqStats.totalRetried) * 100 : 0,
      criticalItems,
      retryableItems
    },
    categories,
    severities,
    latencyP50: percentile(latencies, 0.5),
    latencyP95: percentile(latencies, 0.95),
    latencyP99: percentile(latencies, 0.99)
  };
}

/**
 * Calculate percentile
 */
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const index = Math.ceil(arr.length * p) - 1;
  return arr[index] || 0;
}

/**
 * Enhanced cleanup with monitoring
 */
export function enhancedCleanup(): {
  removed: number;
  oldItems: number;
  failedItems: number;
} {
  const now = Date.now();
  const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours
  const cutoff = now - maxAgeMs;
  
  // const initialLength = dlq.length; // unused
  let oldItemsRemoved = 0;
  let failedItemsRemoved = 0;

  // Remove old items and items that exceeded max retries
  for (let i = dlq.length - 1; i >= 0; i--) {
    const item = dlq[i];
    
    if (!item) break;
    if (item.ts < cutoff) {
      dlq.splice(i, 1);
      oldItemsRemoved++;
    } else if (item.retryCount >= item.maxRetries && !item.nextRetryAt) {
      dlq.splice(i, 1);
      failedItemsRemoved++;
    }
  }

  const totalRemoved = oldItemsRemoved + failedItemsRemoved;
  dlqStats.lastCleanup = now;

  if (totalRemoved > 0) {
    logger.info('DLQ enhanced cleanup completed', {
      totalRemoved,
      oldItemsRemoved,
      failedItemsRemoved,
      remainingSize: dlq.length
    });
  }

  return {
    removed: totalRemoved,
    oldItems: oldItemsRemoved,
    failedItems: failedItemsRemoved
  };
}

// Auto-cleanup every hour with enhanced logic
setInterval(() => {
  enhancedCleanup();
}, 60 * 60 * 1000).unref();

// Auto-retry every 5 minutes (basic handler - override with custom logic)
setInterval(async () => {
  try {
    const retryResult = await processRetryableItems(async (item) => {
      // Default retry logic - can be overridden
      logger.info('Default DLQ retry - placeholder handler', { 
        dlqId: item.id,
        category: item.category,
        severity: item.severity,
        retryCount: item.retryCount
      });
      return false; // Return false to keep in queue for custom retry handlers
    });
    
    if (retryResult.retried > 0) {
      logger.info('DLQ auto-retry cycle completed', retryResult);
    }
  } catch (error: any) {
    logger.error('DLQ auto-retry interval failed', {
      error: {
        name: error?.name || 'UnknownError',
        message: error?.message || 'Auto-retry interval error',
        stack: error?.stack
      },
      timestamp: new Date().toISOString(),
      queueSize: dlq.length
    });
    
    // Log critical error if this becomes frequent
    dlqStats.totalFailed++;
    if (dlqStats.totalFailed > 10) {
      logger.fatal('DLQ auto-retry system experiencing frequent failures', {
        totalFailed: dlqStats.totalFailed,
        queueSize: dlq.length,
        lastError: error?.message
      });
    }
  }
}, 5 * 60 * 1000).unref();

logger.info('Production-grade Dead Letter Queue initialized', {
  maxSize: MAX_DLQ_SIZE,
  retryDelayMs: DLQ_RETRY_DELAY_MS
});
