import { getLogger } from '../services/logger.js';
import { getInstagramHashtagMonitor } from '../services/instagram-hashtag-monitor.js';

const log = getLogger({ component: 'hashtag-services-startup' });

let started = false;

export async function initializeHashtagServices(): Promise<void> {
  try {
    const enabled = process.env.ENABLE_HASHTAG_MONITORING !== 'false';
    if (!enabled) {
      log.info('Hashtag monitoring services disabled by configuration');
      return;
    }

    if (started) {
      log.info('Hashtag monitoring services already started');
      return;
    }

    const monitor = getInstagramHashtagMonitor();
    // Run aggregation every 15 minutes (configurable by env)
    const intervalMs = Number(process.env.HASHTAG_AGGREGATION_INTERVAL_MS || '900000');
    monitor.startScheduler({ aggregationIntervalMs: intervalMs });

    started = true;
    log.info('Hashtag monitoring services initialized', { intervalMs });
  } catch (e) {
    log.error('Failed to initialize hashtag services', { error: String(e) });
    throw e;
  }
}

export function getHashtagServicesStatus(): { running: boolean } {
  return { running: started };
}

