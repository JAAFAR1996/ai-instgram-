import { getLogger } from './logger.js';
import { getConfig } from '../config/index.js';

const log = getLogger({ component: 'keep-alive' });

export class KeepAliveService {
  private intervalId: NodeJS.Timeout | null = null;
  private readonly baseUrl: string;

  constructor() {
    const config = getConfig();
    // Our config exposes baseUrl at the top level
    this.baseUrl = (config.baseUrl || process.env.BASE_URL || '').trim();
  }

  start(): void {
    if (this.intervalId) return;
    if (!this.baseUrl) {
      log.warn('Keep-alive disabled: BASE_URL is not set');
      return;
    }
    this.intervalId = setInterval(() => {
      void this.ping();
    }, 10 * 60 * 1000); // every 10 minutes
    log.info('Keep-alive service started');
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      log.info('Keep-alive service stopped');
    }
  }

  private async ping(): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      log.debug('Keep-alive ping successful', { status: res.status });
    } catch (error) {
      log.warn('Keep-alive ping failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }
}

