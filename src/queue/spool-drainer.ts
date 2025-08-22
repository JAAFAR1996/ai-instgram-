/**
 * Spool Drainer - Redis Fallback Recovery Worker
 * Drains jobs from database spool back to Redis when available
 */

import { getDatabaseJobSpool } from './db-spool.js';
import { addBullJob } from './bull-integration.js';
import { getLogger } from '../services/logger.js';
import { getRedisConnectionManager } from '../services/RedisConnectionManager.js';
import { RedisUsageType } from '../config/RedisConfigurationFactory.js';

const logger = getLogger({ component: 'SpoolDrainer' });

export interface SpoolDrainerConfig {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
}

const DEFAULT_CONFIG: SpoolDrainerConfig = {
  enabled: true,
  intervalMs: 10000,        // Check every 10 seconds
  batchSize: 10,            // Process up to 10 jobs at a time
  backoffMultiplier: 1.5,   // Increase delay by 50% on each failure
  maxBackoffMs: 300000,     // Max 5 minutes backoff
};

export class SpoolDrainer {
  private config: SpoolDrainerConfig;
  private spool = getDatabaseJobSpool();
  private isRunning = false;
  private intervalId?: NodeJS.Timeout;
  private currentBackoffMs = 0;
  private redisHealthy = true;
  private totalProcessed = 0;
  private totalErrors = 0;

  constructor(config: Partial<SpoolDrainerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the spool drainer
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Spool drainer is already running');
      return;
    }

    if (!this.config.enabled) {
      logger.info('Spool drainer is disabled');
      return;
    }

    this.isRunning = true;
    logger.info('Starting spool drainer', {
      intervalMs: this.config.intervalMs,
      batchSize: this.config.batchSize
    });

    this.intervalId = setInterval(() => {
      this.drainSpoolBatch().catch(error => {
        logger.error('Spool drainer error', { error: error.message });
      });
    }, this.config.intervalMs);
  }

  /**
   * Stop the spool drainer
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    logger.info('Spool drainer stopped');
  }

  /**
   * Drain a batch of jobs from spool
   */
  private async drainSpoolBatch(): Promise<void> {
    try {
      // Check Redis health
      const redisManager = getRedisConnectionManager();
      const redisClient = await redisManager.getConnection(RedisUsageType.CACHING);
      await redisClient.ping();
      this.redisHealthy = true;
      
    } catch (error) {
      this.redisHealthy = false;
      logger.debug('Redis not available, skipping drain');
      return;
    }

    // Apply backoff if needed
    if (this.currentBackoffMs > 0) {
      await this.sleep(this.currentBackoffMs);
    }

    try {
      const spooledJobs = await this.spool.getNextJobs(this.config.batchSize);
      
      if (spooledJobs.length === 0) {
        return;
      }

      logger.info('Draining spooled jobs', { count: spooledJobs.length });

      for (const job of spooledJobs) {
        try {
          const queueName = this.mapJobTypeToQueue(job.jobType);
          
          await addBullJob(queueName, job.jobType, job.jobData, {
            priority: this.mapPriorityToBull(job.priority)
          });

          await this.spool.removeJob(job.jobId, job.merchantId);
          this.totalProcessed++;
          
        } catch (error) {
          logger.error('Failed to drain job', {
            jobId: job.jobId,
            error: error.message
          });
          this.totalErrors++;
        }
      }

      this.resetBackoff();

    } catch (error) {
      logger.error('Spool drain failed', { error: error.message });
      this.applyBackoff();
    }
  }

  private mapJobTypeToQueue(jobType: string): string {
    const queueMap: Record<string, string> = {
      'WEBHOOK_PROCESSING': 'webhook-processing',
      'AI_RESPONSE_GENERATION': 'ai-response-generation',
      'MESSAGE_DELIVERY': 'message-delivery',
      'NOTIFICATION_SEND': 'notifications'
    };
    return queueMap[jobType] || 'default';
  }

  private mapPriorityToBull(priority: string): number {
    const priorityMap: Record<string, number> = {
      'CRITICAL': 10,
      'HIGH': 5,
      'NORMAL': 0,
      'LOW': -5
    };
    return priorityMap[priority] || 0;
  }

  private applyBackoff(): void {
    this.currentBackoffMs = Math.min(
      this.currentBackoffMs === 0 ? this.config.intervalMs : this.currentBackoffMs * this.config.backoffMultiplier,
      this.config.maxBackoffMs
    );
  }

  private resetBackoff(): void {
    this.currentBackoffMs = 0;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public getStats() {
    return {
      running: this.isRunning,
      redisHealthy: this.redisHealthy,
      totalProcessed: this.totalProcessed,
      totalErrors: this.totalErrors,
      currentBackoffMs: this.currentBackoffMs
    };
  }

  /**
   * Test complete cycle: spool -> drain -> remove
   */
  public async testCycle(testJobData: any): Promise<{ success: boolean; error?: string }> {
    try {
      const testJobId = `test_${Date.now()}`;
      
      // Step 1: Spool job
      await this.spool.spoolJob({
        jobId: testJobId,
        jobType: 'AI_RESPONSE_GENERATION',
        jobData: testJobData,
        priority: 'NORMAL',
        merchantId: testJobData.merchantId || 'test-merchant-id'
      });

      // Step 2: Drain
      await this.drainSpoolBatch();

      // Step 3: Verify removal
      const remaining = await this.spool.getNextJobs(1);
      const testJobExists = remaining.some(job => job.jobId === testJobId);

      return { success: !testJobExists };
      
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
}

let spoolDrainerInstance: SpoolDrainer | null = null;

export function getSpoolDrainer(config?: Partial<SpoolDrainerConfig>): SpoolDrainer {
  if (!spoolDrainerInstance) {
    spoolDrainerInstance = new SpoolDrainer(config);
  }
  return spoolDrainerInstance;
}