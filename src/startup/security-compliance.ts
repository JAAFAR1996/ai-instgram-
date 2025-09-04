import { getLogger } from '../services/logger.js';
import { getComplianceService } from '../services/compliance.js';
import { runStartupValidation } from './validation.js';

const log = getLogger({ component: 'security-compliance-startup' });

let started = false;
let timers: NodeJS.Timeout[] = [];

export function initializeSecurityCompliance(): void {
  if (started) return;
  started = true;

  const svc = getComplianceService();

  // 1) Hourly runtime security validation (env/secrets/config sanity)
  const hourly = setInterval(async () => {
    try {
      const report = await runStartupValidation();
      const overall = report.overallSuccess ? 'SUCCESS' as 'SUCCESS' | 'FAILURE' : 'FAILURE' as 'SUCCESS' | 'FAILURE';
      await svc.logEvent(null, 'RUNTIME_SECURITY_VALIDATION', overall, {
        overallSuccess: report.overallSuccess,
        criticalErrors: report.criticalErrors,
        totalDurationMs: report.totalDuration
      });
    } catch (e) {
      log.warn('Runtime security validation failed', { error: String(e) });
      await svc.logSecurity(null, 'RUNTIME_VALIDATION', 'FAILURE', { error: String(e) });
    }
  }, 60 * 60 * 1000); // 1h
  if (hourly.unref) hourly.unref();
  timers.push(hourly);

  // 2) Daily OAuth session cleanup
  const daily = setInterval(async () => {
    try {
      const deleted = await svc.cleanupExpiredOAuthSessions();
      await svc.logEvent(null, 'OAUTH_CLEANUP', 'SUCCESS', { deleted });
    } catch (e) {
      await svc.logEvent(null, 'OAUTH_CLEANUP', 'FAILURE', { error: String(e) });
    }
  }, 24 * 60 * 60 * 1000);
  if (daily.unref) daily.unref();
  timers.push(daily);

  log.info('Security + Compliance monitors initialized');
}

export function stopSecurityCompliance(): void {
  for (const t of timers) try { clearInterval(t); } catch { /* noop */ }
  timers = [];
  started = false;
}
