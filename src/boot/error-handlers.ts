/**
 * ===============================================
 * Global Error Handlers - Production Grade
 * مُعالجات الأخطاء المركزية لمنع انهيار النظام
 * ===============================================
 */

import { setTimeout as delay } from 'node:timers/promises';
import { teardownTimerManagement } from '../utils/timer-manager.js';
import { logger } from '../services/logger.js';

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
 * REMOVED: multipleResolves event is deprecated in Node 18+ and unreliable
 * Use single promise guards or AbortController patterns instead
 */

/**
 * Graceful shutdown handler
 */
let shuttingDown = false;
const shutdownController = new AbortController();

export async function gracefulShutdown(signal: string, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  
  logger.info(`🔄 Graceful shutdown initiated by ${signal}...`);
  
  try {
    // Signal all operations to stop
    shutdownController.abort();
    
    // Signal queue workers to stop processing
    try {
      logger.info('⚠️ Queue manager shutdown temporarily disabled');
    } catch (error) {
      console.error('❌ Failed to stop queue processing:', error);
    }
    
    // Close database connections
    try {
      const { getDatabase } = await import('../db/adapter.js');
      const db = getDatabase();
      await db.close();
      logger.info('✅ Database connections closed');
    } catch (error) {
      console.error('❌ Failed to close database:', error);
    }
    
    // Close Redis connections
    try {
      const { getRedisConnectionManager } = await import('../services/RedisConnectionManager.js');
      const redisManager = getRedisConnectionManager();
      await redisManager.closeAllConnections();
      logger.info('✅ Redis connections closed');
    } catch (error) {
      console.error('❌ Failed to close Redis connections:', error);
    }

      // Cancel all registered timers and restore globals
      try {
        teardownTimerManagement();
        logger.info('✅ Timers cleared');
      } catch (error) {
        console.error('❌ Failed to clear timers:', error);
      }

    logger.info('✅ Graceful shutdown completed');
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

logger.info('🛡️  Global error handlers initialized');