/**
 * Global Error Handlers - Production Grade (clean)
 * Provides consistent handling for unhandled rejections/exceptions
 * and a graceful shutdown utility used across the app.
 */

import { setTimeout as delay } from 'node:timers/promises';
import { teardownTimerManagement } from '../utils/timer-manager.js';
import { logger } from '../services/logger.js';

// Error counters for simple telemetry
let unhandledRejectionCount = 0;
let uncaughtExceptionCount = 0;

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  unhandledRejectionCount++;

  const error = reason instanceof Error
    ? reason
    : new Error(`UnhandledRejection: ${String(reason ?? 'undefined reason')}`);

  const promiseName = (promise && (promise as object).constructor && (promise as object).constructor.name) ? (promise as object).constructor.name : 'unknown';
  console.error('[FATAL] unhandledRejection', {
    count: unhandledRejectionCount,
    error: error.message,
    stack: error.stack,
    promise: promiseName,
    timestamp: new Date().toISOString(),
    pid: process.pid
  });

  // In development, crash fast to surface issues
  if ((process.env.NODE_ENV || '').toLowerCase() === 'development') {
    console.error('Crashing in development mode to catch unhandled rejection');
    process.exit(1);
  }

  // In production, allow a burst then exit for safety
  if (unhandledRejectionCount > 50) {
    console.error('Too many unhandled rejections, shutting down for safety');
    process.exit(1);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  uncaughtExceptionCount++;

  console.error('[FATAL] uncaughtException', {
    count: uncaughtExceptionCount,
    error: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString(),
    pid: process.pid
  });

  console.error('Uncaught exception detected, shutting down gracefully...');
  void delay(1000).then(() => process.exit(1));
});

// Process warnings
process.on('warning', (warning) => {
  console.warn('[WARNING]', {
    name: warning.name,
    message: warning.message,
    stack: warning.stack,
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown
let shuttingDown = false;
const shutdownController = new AbortController();

export async function gracefulShutdown(signal: string, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`Graceful shutdown initiated by ${signal}...`);

  try {
    // Signal all operations to stop
    shutdownController.abort();

    // Close database connections if available
    try {
      const { getDatabase } = await import('../db/adapter.js');
      const db = getDatabase();
      await db.close();
      logger.info('Database connections closed');
    } catch (error) {
      console.error('Failed to close database:', error);
    }

    // Close Redis connections if available
    try {
      const { getRedisConnectionManager } = await import('../services/RedisConnectionManager.js');
      const redisManager = getRedisConnectionManager();
      await redisManager.closeAllConnections();
      logger.info('Redis connections closed');
    } catch (error) {
      console.error('Failed to close Redis connections:', error);
    }

    // Clear timers and restore globals
    try {
      teardownTimerManagement();
      logger.info('Timers cleared');
    } catch (error) {
      console.error('Failed to clear timers:', error);
    }

    logger.info('Graceful shutdown completed');
  } catch (error) {
    console.error('Error during graceful shutdown:', error);
  } finally {
    process.exit(code);
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
process.on('SIGABRT', () => void gracefulShutdown('SIGABRT', 1));

// Utility wrappers
export async function safeAsync<T>(operation: () => Promise<T>, context: string, fallback?: T): Promise<T | undefined> {
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

export function wrapError(error: unknown, context: string): Error {
  if (error instanceof Error) {
    error.message = `${context}: ${error.message}`;
    return error;
  }
  return new Error(`${context}: ${String(error)}`);
}

export function fireAndForget(operation: () => Promise<void>, context: string): void {
  void safeAsync(operation, context);
}

export { shutdownController };

export function getErrorStats() {
  return {
    unhandledRejectionCount,
    uncaughtExceptionCount,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    timestamp: new Date().toISOString()
  };
}

logger.info('Global error handlers initialized');
