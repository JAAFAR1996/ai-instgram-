/**
 * ===============================================
 * Global Error Handlers - Production Grade
 * مُعالجات الأخطاء المركزية لمنع انهيار النظام
 * ===============================================
 */

import { setTimeout as delay } from 'node:timers/promises';
import { timerManager } from '../utils/timer-manager.js';

// Global error counters for monitoring
let unhandledRejectionCount = 0;
let uncaughtExceptionCount = 0;

/**
 * Handle unhandled promise rejections
 * معالجة الوعود المرفوضة غير المُعالجة
 */
process.on('unhandledRejection', (reason, promise) => {
  unhandledRejectionCount++;
  
  // Convert reason to proper Error object
  const error = reason instanceof Error 
    ? reason 
    : new Error(`UnhandledRejection: ${String(reason || 'undefined reason')}`);
  
  console.error('[FATAL] unhandledRejection', {
    count: unhandledRejectionCount,
    error: error.message,
    stack: error.stack,
    promise: promise?.constructor?.name || 'unknown',
    timestamp: new Date().toISOString(),
    pid: process.pid
  });
  
  // In development, we might want to crash fast to catch issues
  if (process.env.NODE_ENV === 'development') {
    console.error('💥 Crashing in development mode to catch unhandled rejection');
    process.exit(1);
  }
  
  // In production, log and continue with circuit breaker
  if (unhandledRejectionCount > 50) {
    console.error('🚨 Too many unhandled rejections, shutting down for safety');
    process.exit(1);
  }
});

/**
 * Handle uncaught exceptions
 * معالجة الاستثناءات غير المُلتقطة
 */
process.on('uncaughtException', (err) => {
  uncaughtExceptionCount++;
  
  console.error('[FATAL] uncaughtException', {
    count: uncaughtExceptionCount,
    error: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString(),
    pid: process.pid
  });
  
  // Uncaught exceptions are more serious - always exit
  console.error('💥 Uncaught exception detected, shutting down gracefully...');
  
  // Give time for logs to flush
  void delay(1000).then(() => {
    process.exit(1);
  });
});

/**
 * Handle process warnings
 * معالجة تحذيرات العملية
 */
process.on('warning', (warning) => {
  console.warn('[WARNING]', {
    name: warning.name,
    message: warning.message,
    stack: warning.stack,
    timestamp: new Date().toISOString()
  });
});

/**
 * Handle multiple resolve/reject (debugging)
 */
process.on('multipleResolves', (type, promise, reason) => {
  console.error('[MULTIPLE_RESOLVES]', {
    type,
    reason: reason instanceof Error ? reason.message : String(reason),
    timestamp: new Date().toISOString()
  });
});

/**
 * Graceful shutdown handler
 */
let shuttingDown = false;
const shutdownController = new AbortController();

export async function gracefulShutdown(signal: string, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  
  console.log(`🔄 Graceful shutdown initiated by ${signal}...`);
  
  try {
    // Signal all operations to stop
    shutdownController.abort();
    
    // Signal queue workers to stop processing
    try {
      const { getQueueManager } = await import('../queue/queue-manager.js');
      const qm = getQueueManager();

      // الأفضل أولاً: إيقاف المعالِجات
      if (typeof (qm as any).stopProcessing === 'function') {
        await (qm as any).stopProcessing();
        console.log('✅ Queue processing stopped');
      } else if (typeof (qm as any).pause === 'function') {
        await (qm as any).pause();
        console.log('✅ Queue paused');
      }

      // انتظر هدوء الطابور إن توفّر
      if (typeof (qm as any).waitForIdle === 'function') {
        await (qm as any)
          .waitForIdle(5000)
          .catch((e: unknown) => console.error('Failed to wait for idle queue:', e));
      }

      // اختياري: تفريغ متبقٍ
      if (typeof (qm as any).drain === 'function') {
        await (qm as any)
          .drain()
          .catch((e: unknown) => console.error('Failed to drain queue:', e));
      }

      console.log('✅ Queue manager quiesced');
    } catch (error) {
      console.error('❌ Failed to stop queue manager:', error);
    }
    
    // Close database connections
    try {
      const { closeDatabase } = await import('../database/connection.js');
      await closeDatabase();
      console.log('✅ Database connections closed');
    } catch (error) {
      console.error('❌ Failed to close database:', error);
    }
    
    // Close Redis connections
    try {
      const { getRedisConnectionManager } = await import('../services/RedisConnectionManager.js');
      const redisManager = getRedisConnectionManager();
      await redisManager.closeAllConnections();
      console.log('✅ Redis connections closed');
    } catch (error) {
      console.error('❌ Failed to close Redis connections:', error);
    }

    // Cancel all registered timers
    try {
      timerManager.clearAll();
      console.log('✅ Timers cleared');
    } catch (error) {
      console.error('❌ Failed to clear timers:', error);
    }

    console.log('✅ Graceful shutdown completed');
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
  } finally {
    process.exit(code);
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle PM2 signals
process.on('SIGABRT', () => gracefulShutdown('SIGABRT', 1));

/**
 * Utility function to safely execute async operations
 * دالة مساعدة لتنفيذ العمليات غير المتزامنة بأمان
 */
export async function safeAsync<T>(
  operation: () => Promise<T>,
  context: string,
  fallback?: T
): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`[safeAsync] ${context} failed:`, {
      error: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    });
    return fallback;
  }
}

/**
 * Wrap error with additional context
 */
export function wrapError(error: unknown, context: string): Error {
  if (error instanceof Error) {
    error.message = `${context}: ${error.message}`;
    return error;
  }
  return new Error(`${context}: ${String(error)}`);
}

/**
 * Safe fire-and-forget for async operations
 * تنفيذ آمن للعمليات غير المتزامنة "اطلق وانس"
 */
export function fireAndForget(
  operation: () => Promise<void>,
  context: string
): void {
  void safeAsync(operation, context);
}

// Export shutdown controller for other modules
export { shutdownController };

// Export error stats for monitoring
export function getErrorStats() {
  return {
    unhandledRejectionCount,
    uncaughtExceptionCount,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    timestamp: new Date().toISOString()
  };
}

console.log('🛡️  Global error handlers initialized');