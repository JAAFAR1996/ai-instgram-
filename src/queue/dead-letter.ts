/**
 * ===============================================
 * Dead Letter Queue (DLQ) - Simple Implementation
 * طابور الرسائل الميتة - معالجة الأخطاء والفشل
 * ===============================================
 */

export interface DeadLetterItem {
  ts: number;
  reason: string;
  payload: unknown;
  eventId?: string;
  merchantId?: string;
  platform?: string;
  retryCount?: number;
}

const dlq: DeadLetterItem[] = [];
const MAX_DLQ_SIZE = 10000; // Prevent memory overflow

/**
 * Push item to DLQ with automatic cleanup
 */
export function pushDLQ(item: DeadLetterItem): void {
  dlq.push({
    ...item,
    ts: item.ts || Date.now()
  });
  
  // Automatic cleanup to prevent memory overflow
  if (dlq.length > MAX_DLQ_SIZE) {
    dlq.shift(); // Remove oldest item
  }
  
  console.log('📥 DLQ: Item added', {
    reason: item.reason,
    eventId: item.eventId,
    merchantId: item.merchantId,
    platform: item.platform,
    queueSize: dlq.length
  });
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
  const originalLength = dlq.length;
  
  // Remove items older than cutoff
  let removed = 0;
  while (dlq.length > 0 && dlq[0].ts < cutoff) {
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

// Auto-cleanup every hour
setInterval(() => {
  cleanupOldDLQItems();
}, 60 * 60 * 1000).unref();

console.log('💀 Dead Letter Queue initialized');