/**
 * Worker entrypoint: starts BullMQ workers only (no HTTP server)
 */
import './boot/error-handlers.js';
import { getLogger } from './services/logger.js';
import { initTelemetry } from './services/telemetry.js';
import { getPool } from './startup/database.js';
import { initializeRedisIntegration } from './startup/redis.js';
import { ProductionQueueManager } from './services/ProductionQueueManager.js';
import { RedisEnvironment } from './config/RedisConfigurationFactory.js';

const log = getLogger({ component: 'worker' });

async function startWorker() {
  try {
    await initTelemetry();
    const pool = getPool();
    const redisStatus = await initializeRedisIntegration(pool);

    if (!(redisStatus.success && redisStatus.mode === 'active')) {
      throw new Error('Redis not active; cannot start workers');
    }

    const baseLogger = getLogger({ component: 'queue-worker' });
    const qLogger = {
      info: (...args: unknown[]) => baseLogger.info(String(args[0] ?? ''), typeof args[1] === 'object' ? (args[1] as Record<string, unknown>) : undefined),
      warn: (...args: unknown[]) => baseLogger.warn(String(args[0] ?? ''), typeof args[1] === 'object' ? (args[1] as Record<string, unknown>) : undefined),
      error: (...args: unknown[]) => baseLogger.error(String(args[0] ?? ''), typeof args[1] === 'object' ? (args[1] as Record<string, unknown>) : undefined),
      debug: (...args: unknown[]) => baseLogger.debug(String(args[0] ?? ''), typeof args[1] === 'object' ? (args[1] as Record<string, unknown>) : undefined),
    };

    const qm = new ProductionQueueManager(qLogger, RedisEnvironment.PRODUCTION, pool, 'ai-sales-production');
    const result = await qm.initialize();
    if (!result.success) {
      throw new Error(result.error ?? 'Unknown queue init failure');
    }

    log.info('Workers started and ready');

    // Keep process alive
    setInterval(() => void 0, 60_000).unref();
  } catch (err) {
    log.error('Worker bootstrap failed', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
}

startWorker();

