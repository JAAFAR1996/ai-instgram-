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

// Fallback processing interval when Redis is down (faster)
const FALLBACK_PROCESSING_INTERVAL = 5000; // 5 seconds

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

    this.scheduleNextRun();
  }

  /**
   * Schedule next run with adaptive interval based on Redis health
   */
  private scheduleNextRun(): void {
    if (!this.isRunning) return;

    // Use faster interval when Redis is down and we're processing inline
    const interval = this.redisHealthy ? this.config.intervalMs : FALLBACK_PROCESSING_INTERVAL;
    
    this.intervalId = setTimeout(() => {
      this.drainSpoolBatch()
        .then(() => this.scheduleNextRun())
        .catch(error => {
          logger.error('Spool drainer error', { error: error.message });
          this.scheduleNextRun(); // Schedule next run even on error
        });
    }, interval);
  }

  /**
   * Stop the spool drainer
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.intervalId) {
      clearTimeout(this.intervalId);
    }
    logger.info('Spool drainer stopped');
  }

  /**
   * Drain a batch of jobs from spool or process them inline if Redis is down
   */
  private async drainSpoolBatch(): Promise<void> {
    try {
      // Check Redis health using safe wrapper
      const redisManager = getRedisConnectionManager();
      const ping = await redisManager.safeRedisOperation('ping', RedisUsageType.CACHING, (c: any) => c.ping());
      
      this.redisHealthy = !!ping.ok;
      
      if (!this.redisHealthy) {
        // Process jobs inline when Redis is unavailable
        await this.processJobsInline();
        return;
      }
      
    } catch (error) {
      this.redisHealthy = false;
      logger.debug('Redis not available, processing jobs inline');
      await this.processJobsInline();
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
          
          // Use safe Redis operation for enqueuing
          const redisManager = getRedisConnectionManager();
          const enqueueResult = await redisManager.safeRedisOperation(
            `enqueue-${job.jobType}`,
            RedisUsageType.CACHING,
            async () => {
              return await addBullJob(queueName, job.jobType, job.jobData, {
                priority: this.mapPriorityToBull(job.priority)
              });
            }
          );

          if (enqueueResult.ok) {
            await this.spool.removeJob(job.jobId, job.merchantId);
            this.totalProcessed++;
          } else {
            logger.warn('Failed to enqueue job - Redis operation failed', {
              jobId: job.jobId,
              reason: enqueueResult.reason
            });
            this.totalErrors++;
          }
          
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

  /**
   * Process jobs inline when Redis is unavailable
   */
  private async processJobsInline(): Promise<void> {
    try {
      const spooledJobs = await this.spool.getNextJobs(this.config.batchSize);
      
      if (spooledJobs.length === 0) {
        return;
      }

      logger.info('Processing spooled jobs inline (Redis unavailable)', { count: spooledJobs.length });

      for (const job of spooledJobs) {
        try {
          await this.processJobInline(job);
          await this.spool.removeJob(job.jobId, job.merchantId);
          this.totalProcessed++;
          
        } catch (error) {
          logger.error('Failed to process inline job', {
            jobId: job.jobId,
            jobType: job.jobType,
            error: error instanceof Error ? error.message : String(error)
          });
          this.totalErrors++;
        }
      }

      this.resetBackoff();

    } catch (error) {
      this.totalErrors++;
      this.applyBackoff();
      logger.error('Inline job processing batch failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Process a single job inline without Redis queue
   */
  private async processJobInline(job: any): Promise<void> {
    const { aiProcessor } = await import('./processors/ai-processor.js');
    const { webhookProcessor } = await import('./processors/webhook-processor.js');
    const { messageDeliveryProcessor } = await import('./processors/message-delivery-processor.js');
    const { notificationProcessor } = await import('./processors/notification-processor.js');

    // Create a minimal job object compatible with processors
    const processorJob = {
      id: job.jobId,
      data: job.jobData,
      opts: { priority: job.priority },
      timestamp: Date.now(),
      attemptsMade: 1,
      queue: null as any,
      name: job.jobType,
      stacktrace: [],
      returnvalue: null,
      finishedOn: null,
      processedOn: null,
      failedReason: null,
      delay: 0,
      progress: 0
    } as any;

    switch (job.jobType) {
      case 'AI_RESPONSE_GENERATION':
        await aiProcessor.process(processorJob);
        break;
      
      case 'WEBHOOK_PROCESSING':
        await webhookProcessor.process(processorJob);
        break;
      
      case 'MESSAGE_DELIVERY':
        await messageDeliveryProcessor.process(processorJob);
        break;
      
      case 'NOTIFICATION_SEND':
        await notificationProcessor.process(processorJob);
        break;
      
      default:
        logger.warn('Unknown job type for inline processing', { jobType: job.jobType });
        throw new Error(`Unknown job type: ${job.jobType}`);
    }
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