/**
 * Database Job Processor - Redis Fallback System
 * معالج قاعدة البيانات الفعّال للتعامل مع الوظائف عندما يكون Redis غير متاح
 */

import { getDatabaseJobSpool } from '../queue/db-spool.js';
import { getLogger } from './logger.js';
import { getInstagramWebhookHandler } from './instagram-webhook.js';

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

async function processWebhookFromDatabase(job: any) {
  try {
    logger.info('🔄 Processing webhook job from database', {
      jobId: job.jobId,
      merchantId: job.merchantId,
      priority: job.priority
    });

    // استخدام InstagramWebhookHandler مباشرة
    const webhookHandler = await getInstagramWebhookHandler();
    
    // التحقق من أن job data يحتوي على payload صحيح
    if (!job.jobData) {
      throw new Error('Invalid webhook job data: jobData is null or undefined');
    }
    
    if (!job.jobData.payload) {
      logger.error('Webhook job missing payload - debugging info', {
        jobId: job.jobId,
        jobDataKeys: job.jobData ? Object.keys(job.jobData) : 'null',
        jobDataType: typeof job.jobData,
        merchantId: job.merchantId,
        jobData: job.jobData
      });
      throw new Error('Invalid webhook job data: missing payload');
    }

    // معالجة webhook باستخدام InstagramWebhookHandler
    const result = await webhookHandler.processWebhook(job.jobData.payload, job.merchantId);
    
    logger.info('✅ Webhook job processed successfully', {
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
    logger.error('💥 Error processing webhook job from database', {
      jobId: job.jobId,
      merchantId: job.merchantId,
      error: error instanceof Error ? error.message : String(error)
    });
    
    // إعادة throw للخطأ ليتم التعامل معه
    throw error;
  }
}

// Export للاستخدام في production-index.ts
export { processWebhookFromDatabase };
