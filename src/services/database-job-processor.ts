/**
 * Database Job Processor - Redis Fallback System
 * معالج قاعدة البيانات الفعّال للتعامل مع الوظائف عندما يكون Redis غير متاح
 */

import { getDatabaseJobSpool } from '../queue/db-spool.js';
import type { SpooledJob } from '../queue/db-spool.js';
import { getLogger } from './logger.js';
import { getInstagramWebhookHandler } from './instagram-webhook.js';
import type { InstagramWebhookHandler, ProcessedWebhookResult, InstagramWebhookEvent } from './instagram-webhook.js';

const logger = getLogger({ component: 'DatabaseJobProcessor' });
let processingInterval: NodeJS.Timeout | null = null;
let isRunning = false;

export function startDatabaseJobProcessor() {
  if (processingInterval || isRunning) {
    logger.info('Database Job Processor is already running');
    return;
  }
  
  logger.info('🚀 Starting Database Job Processor...');
  isRunning = true;
  
  const spool = getDatabaseJobSpool();
  
  processingInterval = setInterval(async () => {
    try {
      const jobs = await spool.getNextJobs(5); // معالجة 5 jobs في المرة
      
      if (jobs.length === 0) return;
      
      logger.info(`📦 Processing ${jobs.length} database jobs`);
      
      for (const job of jobs) {
        try {
          if (job.jobType === 'WEBHOOK_PROCESSING') {
            await processWebhookFromDatabase(job);
          } else {
            logger.warn('Unknown job type', { jobType: job.jobType, jobId: job.jobId });
          }
        } catch (error) {
          logger.error('Error processing individual job', {
            jobId: job.jobId,
            jobType: job.jobType,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    } catch (error) {
      logger.error('Database job processing error', error);
    }
  }, 5000); // كل 5 ثواني
  
  processingInterval.unref();
  
  logger.info('✅ Database Job Processor started successfully');
}

export function stopDatabaseJobProcessor() {
  if (processingInterval) {
    clearInterval(processingInterval);
    processingInterval = null;
    isRunning = false;
    logger.info('🛑 Database Job Processor stopped');
  }
}

export function isDatabaseJobProcessorRunning(): boolean {
  return isRunning && processingInterval !== null;
}

async function processWebhookFromDatabase(job: SpooledJob) {
  try {
    logger.info('🔄 Processing webhook job from database', {
      jobId: job.jobId,
      merchantId: job.merchantId,
      priority: job.priority
    });

    // إضافة فحص قاعدة البيانات قبل الاستخدام
    let webhookHandler: InstagramWebhookHandler;
    try {
      webhookHandler = await getInstagramWebhookHandler();
    } catch (error) {
      logger.error('❌ Failed to get Instagram webhook handler:', error);
      throw new Error('Webhook handler initialization failed');
    }
    
    // التحقق من صحة job data
    if (!job.jobData) {
      throw new Error('Invalid webhook job data: jobData is null or undefined');
    }
    const jobData = (job.jobData as unknown) as Record<string, unknown>;
    if (!(jobData as Record<string, unknown>).payload) {
      logger.error('Webhook job missing payload', {
        jobId: job.jobId,
        jobDataKeys: Object.keys(jobData || {})
      });
      throw new Error('Webhook job missing payload');
    }

    // معالجة الويبهوك بشكل آمن
    const result: ProcessedWebhookResult = await webhookHandler.processWebhook(
      ((jobData as { payload: unknown }).payload as unknown as InstagramWebhookEvent),
      job.merchantId
    );

    logger.info('✅ Webhook processed successfully', {
      jobId: job.jobId,
      merchantId: job.merchantId,
      success: result.success,
      eventsProcessed: result.eventsProcessed,
      messagesProcessed: result.messagesProcessed
    });

    // إزالة job من spool بعد المعالجة الناجحة
    const spool = getDatabaseJobSpool();
    await spool.removeJob(job.jobId, job.merchantId);
    
  } catch (error) {
    logger.error('❌ Webhook processing failed:', {
      jobId: job.jobId,
      merchantId: job.merchantId,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

// Export للاستخدام في production-index.ts
export { processWebhookFromDatabase };
