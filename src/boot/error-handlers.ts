/**
 * Global Error Handlers - Production Grade (clean)
 * Provides consistent handling for unhandled rejections/exceptions
 * and a graceful shutdown utility used across the app.
 */

import { setTimeout as delay } from 'node:timers/promises';
import { teardownTimerManagement } from '../utils/timer-manager.js';
import { logger } from '../services/logger.js';

// =============== Advanced Recovery Manager ===============
type RecoveryEvent = 'unhandledRejection' | 'uncaughtException' | 'manual' | 'warning';

let lastRecoveryAt = 0;
let recoveryAttempts = 0;
let degradedMode = false;
const RECOVERY_COOLDOWN_MS = 30_000; // 30s between recovery attempts
const RECOVERY_MAX_ATTEMPTS_WINDOW = 10 * 60_000; // 10 minutes window
const RECOVERY_MAX_ATTEMPTS = 3; // after this, exit gracefully
const recentRecoveries: number[] = [];

async function attemptSystemRecovery(event: RecoveryEvent, reason?: string): Promise<void> {
  const now = Date.now();
  if (now - lastRecoveryAt < RECOVERY_COOLDOWN_MS) {
    logger.warn('Recovery suppressed due to cooldown', { event, sinceMs: now - lastRecoveryAt });
    return;
  }
  lastRecoveryAt = now;

  // Track windowed attempts
  recentRecoveries.push(now);
  while (recentRecoveries.length && now - (recentRecoveries[0] || 0) > RECOVERY_MAX_ATTEMPTS_WINDOW) recentRecoveries.shift();
  recoveryAttempts = recentRecoveries.length;

  logger.warn('Attempting system recovery...', { event, reason, attemptsInWindow: recoveryAttempts });

  try {
    // 1) Database recovery
    try {
      const { getDatabase } = await import('../db/adapter.js');
      const db = getDatabase();
      const healthy = await db.health().catch(() => false);
      if (!healthy) {
        logger.warn('DB unhealthy, attempting recovery');
        await db.recoverConnection();
        logger.info('DB recovery successful');
      }
    } catch (e) {
      logger.error('DB recovery failed', { err: e instanceof Error ? e : new Error(String(e)) });
    }

    // 2) Redis recovery
    try {
      const { getRedisConnectionManager } = await import('../services/RedisConnectionManager.js');
      const rm = getRedisConnectionManager();
      await rm.performHealthCheckOnAllConnections().catch((e) => { console.error('[hardening:no-silent-catch]', e); throw e instanceof Error ? e : new Error(String(e)); });
      // If rate limited or disabled, try to re-enable after cooldown
      rm.enableRedis();
      logger.info('Redis recovery attempted');
    } catch (e) {
      logger.warn('Redis recovery skipped/failed', { error: String(e) });
    }

    // 3) Predictive scheduler sanity (best-effort)
    try {
      const { getSchedulerService } = await import('../startup/predictive-services.js');
      const svc = getSchedulerService();
      if (svc && !svc.getStatus().isRunning) {
        // Do not autostart here; just log to avoid noisy restarts
        logger.warn('Predictive scheduler not running (observed during recovery)');
      }
    } catch {}

    // 4) Switch to degraded mode if we keep failing
    if (recoveryAttempts >= RECOVERY_MAX_ATTEMPTS) {
      degradedMode = true;
      logger.error('Too many recovery attempts, entering degraded mode');
      // Graceful shutdown to allow process manager to restart
      await delay(1000);
      await gracefulShutdown('RECOVERY_LIMIT', 1);
      return;
    }

    logger.info('System recovery pass completed', { degradedMode });
  } catch (err) {
    logger.error('System recovery pass failed', { err: err instanceof Error ? err : new Error(String(err)) });
  }
}

// Export a manual trigger for recovery (for admin/ops usage)
export async function triggerRecovery(reason?: string): Promise<void> {
  await attemptSystemRecovery('manual', reason);
}

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

  // In production, try recovery; allow a burst then exit for safety
  attemptSystemRecovery('unhandledRejection', error.message).catch((e) => {
    logger.error('attemptSystemRecovery failed (unhandledRejection)', { err: e instanceof Error ? e : new Error(String(e)) });
  });
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

  // Attempt recovery first; if fatal class, proceed to exit
  attemptSystemRecovery('uncaughtException', err.message).catch((e) => {
    logger.error('attemptSystemRecovery failed (uncaughtException)', { err: e instanceof Error ? e : new Error(String(e)) });
  });
  console.error('Uncaught exception detected, scheduling graceful shutdown...');
  delay(1500).then(() => process.exit(1)).catch((e) => {
    logger.error('delay before exit failed', { err: e instanceof Error ? e : new Error(String(e)) });
    process.exit(1);
  });
});

// Process warnings
process.on('warning', (warning) => {
  console.warn('[WARNING]', {
    name: warning.name,
    message: warning.message,
    stack: warning.stack,
    timestamp: new Date().toISOString()
  });
  // Opportunistic recovery on critical warnings
  const msg = (warning?.message || '').toLowerCase();
  if (/fswatch|memory leak|eventemitter leak/.test(msg)) {
    attemptSystemRecovery('warning', warning.message).catch((e) => {
      logger.error('attemptSystemRecovery failed (warning)', { err: e instanceof Error ? e : new Error(String(e)) });
    });
  }
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
process.on('SIGTERM', () => { gracefulShutdown('SIGTERM').catch((e) => logger.error('gracefulShutdown error SIGTERM', { err: e as Error })); });
process.on('SIGINT', () => { gracefulShutdown('SIGINT').catch((e) => logger.error('gracefulShutdown error SIGINT', { err: e as Error })); });
process.on('SIGABRT', () => { gracefulShutdown('SIGABRT', 1).catch((e) => logger.error('gracefulShutdown error SIGABRT', { err: e as Error })); });

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
  operation().catch((error) => {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error(`[fireAndForget] ${context} failed`, { err });
  });
}

export { shutdownController };

export function getErrorStats() {
  return {
    unhandledRejectionCount,
    uncaughtExceptionCount,
    recoveryAttempts,
    degradedMode,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    timestamp: new Date().toISOString()
  };
}

logger.info('Global error handlers initialized');
