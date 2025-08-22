/**
 * Bull Queue Integration - Production Grade Job Processing
 * Connects custom processors with Bull's job system
 */

import Bull from 'bull';
import { getConfig } from '../config/environment.js';
import { getLogger } from '../services/logger.js';
import { aiProcessor } from './processors/ai-processor.js';
import { webhookProcessor } from './processors/webhook-processor.js';
import { messageDeliveryProcessor } from './processors/message-delivery-processor.js';
import { notificationProcessor } from './processors/notification-processor.js';

const logger = getLogger({ component: 'BullIntegration' });
const config = getConfig();

// Bull queue instances
const queues = new Map<string, Bull.Queue>();

/**
 * Create and configure Bull queue
 */
function createQueue(name: string): Bull.Queue {
  const queue = new Bull(name, config.redis.url || 'redis://localhost:6379', {
    defaultJobOptions: {
      removeOnComplete: 100, // Keep last 100 completed jobs
      removeOnFail: 50,      // Keep last 50 failed jobs
      attempts: 3,           // Retry up to 3 times
      backoff: {
        type: 'exponential',
        delay: 5000,         // Start with 5 second delay
      },
    },
    settings: {
      stalledInterval: 30000,    // Check for stalled jobs every 30s
      maxStalledCount: 1,        // Max 1 stalled job before failing
    }
  });

  // Error handling
  queue.on('error', (error) => {
    logger.error('Bull queue error', { queue: name, error: error.message });
  });

  queue.on('waiting', (jobId) => {
    logger.debug('Job waiting', { queue: name, jobId });
  });

  queue.on('active', (job, jobPromise) => {
    logger.info('Job started', { queue: name, jobId: job.id });
  });

  queue.on('completed', (job, result) => {
    logger.info('Job completed', { 
      queue: name, 
      jobId: job.id, 
      processingTime: Date.now() - job.timestamp 
    });
  });

  queue.on('failed', (job, error) => {
    logger.error('Job failed', { 
      queue: name, 
      jobId: job.id, 
      error: error.message,
      attempt: job.attemptsMade,
      maxAttempts: job.opts.attempts 
    });
  });

  queue.on('stalled', (job) => {
    logger.warn('Job stalled', { queue: name, jobId: job.id });
  });

  return queue;
}

/**
 * Get or create Bull queue instance
 */
export function getBullQueue(name: string): Bull.Queue {
  if (!queues.has(name)) {
    const queue = createQueue(name);
    queues.set(name, queue);
  }
  return queues.get(name)!;
}

/**
 * Initialize Bull processors with correct signatures
 */
export async function initializeBullProcessors() {
  logger.info('Initializing Bull processors...');

  // AI Response Generation Queue
  const aiQueue = getBullQueue('ai-response-generation');
  aiQueue.process('AI_RESPONSE_GENERATION', 5, async (job: Bull.Job) => {
    try {
      const result = await aiProcessor.process(job);
      return result;
    } catch (error) {
      logger.error('AI processor error', { jobId: job.id, error: error.message });
      throw error;
    }
  });

  // Webhook Processing Queue
  const webhookQueue = getBullQueue('webhook-processing');
  webhookQueue.process('WEBHOOK_PROCESSING', 10, async (job: Bull.Job) => {
    try {
      const result = await webhookProcessor.process(job);
      return result;
    } catch (error) {
      logger.error('Webhook processor error', { jobId: job.id, error: error.message });
      throw error;
    }
  });

  // Message Delivery Queue
  const deliveryQueue = getBullQueue('message-delivery');
  deliveryQueue.process('MESSAGE_DELIVERY', 8, async (job: Bull.Job) => {
    try {
      const result = await messageDeliveryProcessor.process(job);
      return result;
    } catch (error) {
      logger.error('Message delivery processor error', { jobId: job.id, error: error.message });
      throw error;
    }
  });

  // Notification Queue
  const notificationQueue = getBullQueue('notifications');
  notificationQueue.process('NOTIFICATION_SEND', 3, async (job: Bull.Job) => {
    try {
      const result = await notificationProcessor.process(job);
      return result;
    } catch (error) {
      logger.error('Notification processor error', { jobId: job.id, error: error.message });
      throw error;
    }
  });

  logger.info('Bull processors initialized successfully');
}

/**
 * Add job to Bull queue with proper options
 */
export async function addBullJob(
  queueName: string,
  jobType: string,
  data: any,
  options: Bull.JobOptions = {}
): Promise<Bull.Job> {
  const queue = getBullQueue(queueName);
  
  const job = await queue.add(jobType, data, {
    priority: options.priority || 0,
    delay: options.delay || 0,
    attempts: options.attempts || 3,
    backoff: typeof options.backoff === 'string' ? { type: options.backoff } : options.backoff || { type: 'exponential' },
    removeOnComplete: options.removeOnComplete !== undefined ? options.removeOnComplete : 100,
    removeOnFail: options.removeOnFail !== undefined ? options.removeOnFail : 50,
    ...options
  });

  logger.info('Job added to Bull queue', {
    queue: queueName,
    jobType,
    jobId: job.id,
    priority: job.opts.priority
  });

  return job;
}

/**
 * Get queue statistics
 */
export async function getBullQueueStats(queueName: string) {
  const queue = getBullQueue(queueName);
  
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaiting(),
    queue.getActive(),
    queue.getCompleted(),
    queue.getFailed(),
    queue.getDelayed()
  ]);

  const isPaused = await queue.isPaused();

  return {
    waiting: waiting.length,
    active: active.length,
    completed: completed.length,
    failed: failed.length,
    delayed: delayed.length,
    paused: isPaused ? 1 : 0,
    total: waiting.length + active.length + completed.length + failed.length + delayed.length
  };
}

/**
 * Graceful shutdown of all queues
 */
export async function shutdownBullQueues() {
  logger.info('Shutting down Bull queues...');
  
  const closePromises = Array.from(queues.values()).map(queue => queue.close());
  await Promise.all(closePromises);
  
  queues.clear();
  logger.info('All Bull queues shut down');
}

/**
 * Health check for Bull queues
 */
export async function checkBullHealth(): Promise<{
  healthy: boolean;
  queues: Record<string, any>;
  errors: string[];
}> {
  const errors: string[] = [];
  const queueHealths: Record<string, any> = {};
  let allHealthy = true;

  for (const [name, queue] of queues) {
    try {
      const stats = await getBullQueueStats(name);
      const isPaused = await queue.isPaused();
      
      queueHealths[name] = {
        ...stats,
        paused: isPaused,
        healthy: !isPaused && stats.active < 100 // Threshold for too many active jobs
      };

      if (isPaused || stats.active >= 100) {
        allHealthy = false;
        errors.push(`Queue ${name} is ${isPaused ? 'paused' : 'overloaded'}`);
      }
    } catch (error) {
      allHealthy = false;
      errors.push(`Queue ${name} health check failed: ${error.message}`);
      queueHealths[name] = { healthy: false, error: error.message };
    }
  }

  return {
    healthy: allHealthy,
    queues: queueHealths,
    errors
  };
}