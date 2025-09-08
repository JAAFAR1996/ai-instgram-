/**
 * ===============================================
 * Cron Entrypoint
 * - Runs periodic maintenance and cleanup tasks once, then exits
 * - Designed to be triggered by Render Cron Job
 * ===============================================
 */

import './boot/error-handlers.js';
import { getLogger } from './services/logger.js';
import { initTelemetry } from './services/telemetry.js';
import { getPool } from './startup/database.js';

const log = getLogger({ component: 'cron' });

async function runCron(): Promise<void> {
  await initTelemetry();
  const pool = getPool();
  try {
    log.info('Cron job started');

    // Cleanup expired message windows
    try {
      const { MessageWindowService } = await import('./services/message-window.js');
      const svc = new MessageWindowService();
      const cleaned = await svc.cleanupExpiredWindows(7);
      log.info('Expired windows cleaned', { cleaned });
    } catch (e) {
      log.warn('cleanupExpiredWindows failed', { error: String(e) });
    }

    // Cleanup expired tokens
    try {
      const { CredentialsRepository } = await import('./repositories/credentials-repository.js');
      const repo = new CredentialsRepository();
      const n = await repo.cleanupExpiredTokens();
      log.info('Expired tokens cleaned', { count: n });
    } catch (e) {
      log.warn('cleanupExpiredTokens failed', { error: String(e) });
    }

    // Cleanup expired cache and old artifacts (DB-side maintenance)
    try {
      await pool.query('SELECT cleanup_expired_cache()');
      log.info('Database cache cleanup executed');
    } catch (e) {
      log.warn('DB cleanup_expired_cache failed', { error: String(e) });
    }

    log.info('Cron job finished');
  } catch (e) {
    log.error('Cron job failed', { error: e instanceof Error ? e.message : String(e) });
    process.exitCode = 1;
  } finally {
    try { await pool.end(); } catch {}
  }
}

runCron().catch((e) => {
  log.error('Cron entry failure', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});

