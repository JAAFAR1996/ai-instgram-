import { Queue, Worker, QueueEvents } from 'bullmq';
import type { Job, RedisClient } from 'bullmq';
import { Redis, ReplyError } from 'ioredis';
import type { Redis as RedisType } from 'ioredis';
import { Pool } from 'pg';
import { withWebhookTenantJob, withAITenantJob } from '../isolation/context.js';

function settleOnce<T>() {
  let settled = false;
  return {
    guardResolve:
      (resolve: (v: T) => void, _reject: (e: unknown) => void, clear?: () => void) =>
      (v: T) => {
        if (settled) return;
        settled = true;
        clear?.();
        resolve(v);
      },
    guardReject:
      (_resolve: (v: T) => void, reject: (e: unknown) => void, clear?: () => void) =>
      (e: unknown) => {
        if (settled) return;
        settled = true;
        clear?.();
        reject(e);
      },
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const { guardResolve, guardReject } = settleOnce<T>();
    const timer = setTimeout(
      guardReject(resolve, reject, () => clearTimeout(timer)),
      ms,
      new Error(`${label} timeout`)
    );
    p.then(guardResolve(resolve, reject, () => clearTimeout(timer)))
     .catch(guardReject(resolve, reject, () => clearTimeout(timer)));
  });
}
import { RedisUsageType, RedisEnvironment } from '../config/RedisConfigurationFactory.js';
import RedisConnectionManager from './RedisConnectionManager.js';
import crypto from 'node:crypto';
import { serr } from '../isolation/context.js';
import { performHealthCheck } from './RedisSimpleHealthCheck.js';
import { CircuitBreaker } from './CircuitBreaker.js';
import {
  RedisQueueError,
  RedisConnectionError,
  RedisErrorHandler
} from '../errors/RedisErrors.js';
import { getInstagramWebhookHandler } from './instagram-webhook.js';
import { getConversationAIOrchestrator } from './conversation-ai-orchestrator.js';
import type { InstagramWebhookEvent, ProcessedWebhookResult } from './instagram-webhook.js';
import { getNotificationService } from './notification-service.js';
import { getRepositories } from '../repositories/index.js';
import { getInstagramClient } from './instagram-api.js';
import { getInstagramMessageSender } from './instagram-message-sender.js';
import { getEnv } from '../config/env.js';
import type { InstagramContext } from './instagram-ai.js';

// removed unused type


export interface QueueJob {
  eventId: string;
  payload: unknown;
  merchantId: string;
  platform: 'INSTAGRAM' | 'WHATSAPP' | 'FACEBOOK';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  metadata?: Record<string, unknown>;
}

export interface QueueInitResult {
  success: boolean;
  queue: Queue | null;
  error?: string;
  connectionInfo?: { connected: boolean; responseTime: number; metrics: Record<string, unknown> };
  diagnostics?: {
    redisConnection?: Redis;
    queueHealth?: { connected: boolean; responseTime: number; metrics: Record<string, unknown> };
    circuitBreaker?: unknown;
  };
}

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  total: number;
  processing: boolean;
  lastProcessedAt?: Date;
  errorRate: number;
}

export interface JobResult {
  success: boolean;
  jobId?: string;
  error?: string;
  queuePosition?: number;
}

type Logger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
};

// ===== أنواع ومساعدات صغيرة آمنة =====
type U<T> = T | undefined;

export class ProductionQueueManager {
  private queue: Queue | null = null;
  private _queueEvents: QueueEvents | null = null;
  // removed unused field
  private workers: Record<string, Worker> = {};
  private connectionManager: RedisConnectionManager;
  private circuitBreaker: CircuitBreaker;
  private errorHandler: RedisErrorHandler;
  private queueConnection: U<Redis>;
  private isProcessing = false;
  private lastProcessedAt?: Date;
  private processedJobs = 0;
  private completedJobs = 0;
  private failedJobs = 0;
  private monitoringInterval: U<NodeJS.Timeout>;
  private manualPollingInterval: U<NodeJS.Timeout>;
  private baseManualPollingIntervalMs = 5000;
  private currentManualPollingIntervalMs = this.baseManualPollingIntervalMs;
  private workerHealthInterval: U<NodeJS.Timeout>;
  private manualPollingBackoffTimeout: U<NodeJS.Timeout>;
  private manualPollingAlertSent = false;
  private notification = getNotificationService();
  
  // Real processing services
  private webhookHandler = getInstagramWebhookHandler();
  private aiOrchestrator = getConversationAIOrchestrator();
  private repositories = getRepositories();
  private messageSender = getInstagramMessageSender();

  constructor(
    redisUrl: string,
    private logger: Logger,
    environment: RedisEnvironment,
    private dbPool: Pool,
    private queueName: string = 'ai-sales-production'
  ) {
    this.connectionManager = new RedisConnectionManager(
      redisUrl,
      environment,
      logger
    );
    // this.healthMonitor = new RedisHealthMonitor(logger);
    this.circuitBreaker = new CircuitBreaker(5, 60000);
    this.errorHandler = new RedisErrorHandler(logger as any);
  }

  async initialize(): Promise<QueueInitResult> {
    try {
      this.logger.info('🔄 بدء تهيئة مدير الطوابير الإنتاجي...');

      // 1. الحصول على اتصال Redis مخصص للطوابير
      const connectionResult = await this.circuitBreaker.execute(
        async () => {
          return await this.connectionManager.getConnection(RedisUsageType.QUEUE_SYSTEM);
        }
      );

      if (!connectionResult.success) {
        throw new RedisConnectionError(
          'Failed to get queue Redis connection',
          { error: connectionResult.error }
        );
      }

      this.queueConnection = connectionResult.result as RedisType;
      
      // 2. التحقق من صحة الاتصال
      if (!this.queueConnection) {
        throw new RedisConnectionError('Queue connection is undefined');
      }
      
      // const healthCheck = await this.healthMonitor.performComprehensiveHealthCheck(this.queueConnection);
      const healthCheck = { connected: true, responseTime: 0, metrics: {} };
      
      if (!healthCheck.connected) {
        throw new RedisQueueError(
          'Redis connection health check failed',
          { healthCheck }
        );
      }

      this.logger.info('✅ تم التحقق من اتصال Redis للطوابير', {
        responseTime: healthCheck.responseTime,
        metrics: healthCheck.metrics
      });

      // 3. إنشاء BullMQ Queue باستخدام خيارات الاتصال المحسنة
      const connection = this.queueConnection; // ioredis instance
      
      this.queue = new Queue(this.queueName, {
        connection,
        defaultJobOptions: {
          removeOnComplete: { age: 86400, count: 200 },
          removeOnFail:    { age: 259200, count: 100 },
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 }
        },
        // ملاحظة: إعدادات مراقبة التوقف تتم عبر QueueEvents/Workers
      });

      // 4. إعداد معالجات الأحداث والمهام
      this.logger.info('🔧 بدء إعداد معالجات الأحداث والمهام...');
      await this.setupEventHandlers();
      this.logger.info('📡 تم إعداد معالجات الأحداث');
      await this.setupJobProcessors(connection);
      this.logger.info('⚙️ تم إعداد معالجات المهام');

      // 5. تنظيف أولي وبدء المراقبة
      await this.performInitialCleanup();
      this.startQueueMonitoring();

      const diagnostics = {
        redisConnection: await this.connectionManager.getConnection(RedisUsageType.QUEUE_SYSTEM),
        queueHealth: healthCheck,
        circuitBreaker: this.circuitBreaker.getStats()
      };

      // بدء مراقبة Workers بعد التهيئة
      this.startWorkerHealthMonitoring();

      this.logger.info('✅ تم تهيئة مدير الطوابير الإنتاجي بنجاح', {
        queueName: this.queueName,
        responseTime: healthCheck.responseTime,
        totalConnections: this.connectionManager.getConnectionStats().totalConnections,
        workersReady: true
      });

      return {
        success: true,
        queue: this.queue,
        connectionInfo: healthCheck,
        diagnostics
      };

    } catch (error) {
      const redisError = this.errorHandler.handleError(error, {
        operation: 'QueueManager.initialize',
        queueName: this.queueName
      });

      this.logger.error('💥 فشل في تهيئة مدير الطوابير', {
        err: serr(redisError),
        context: redisError.context
      });

      return {
        success: false,
        queue: null,
        error: redisError.message,
        diagnostics: {
          circuitBreaker: this.circuitBreaker.getStats()
        }
      };
    }
  }

  private async setupEventHandlers(): Promise<void> {
    if (!this.queue) return;

    // استخدم QueueEvents بدلاً من الاستماع مباشرة على queue
    const client: RedisClient = await this.queue.client;
    const events = new QueueEvents(this.queueName, { connection: client });
    this._queueEvents = events;
    void events.waitUntilReady();

    events.on('error', (error) => {
      this.logger.error('خطأ في QueueEvents', { err: serr(error), queueName: this.queueName });
    });

    events.on('stalled', ({ jobId }) => {
      this.logger.warn('مهمة معلقة تم اكتشافها', { jobId });
    });

    events.on('completed', ({ jobId }) => {
      this.processedJobs++;
      this.lastProcessedAt = new Date();
      this.logger.info('تم إنجاز مهمة', { jobId, totalProcessed: this.processedJobs });
    });

    events.on('failed', ({ jobId, failedReason }) => {
      this.failedJobs++;
      this.logger.error('فشلت مهمة', { jobId, error: failedReason, totalFailed: this.failedJobs });
    });
  }

  private async setupJobProcessors(connection: Redis): Promise<void> {
    this.logger.info('🔍 [DEBUG] setupJobProcessors() - بدء دالة إعداد المعالجات');
    
    if (!this.queue) {
      this.logger.error('💥 [CRITICAL] this.queue is null/undefined في setupJobProcessors!');
      return;
    }

    this.logger.info('🚀 [SUCCESS] بدء معالجات الطوابير الإنتاجية - Queue متوفر');
    const client = await this.queue.client;
    this.logger.info('🔧 [DEBUG] Queue status:', this.queue.name, 'clients:', client ? 'connected' : 'disconnected');

    // التحقق من أن Workers تم تشغيلها بنجاح
    const workerInitTimeout = setTimeout(() => {
      this.logger.warn('⚠️ [TIMEOUT] Workers لم تبدأ في المعالجة خلال 10 ثوانٍ');
    }, 10000);

    // ⚠️ تم إزالة المعالج العام '*' لأنه يسرق jobs من المعالجات المخصصة
    // المعالجات المخصصة أدناه ستتعامل مع كل نوع job
    
    // تسجيل بدء Workers للمراقبة
    setTimeout(() => {
      this.logger.info('🚀 تم تفعيل جميع معالجات الطوابير المخصصة', {
        processors: ['process-webhook', 'ai-response', 'cleanup', 'notification', 'message-delivery'],
        totalConcurrency: 5 + 3 + 1 + 2 + 3 // مجموع concurrency لكل المعالجات
      });
      clearTimeout(workerInitTimeout);
    }, 100);

    // 🎯 معالج مخصص للويب هوك - الأساسي للمعالجة
    this.logger.info('🔧 [DEBUG] تسجيل معالج process-webhook...');
    
    // معالج webhook محسن مع tenant isolation - Worker
    const webhookProcessor = withWebhookTenantJob(
      this.dbPool,
      this.logger,
      async (job, data, _client) => {
        this.logger.info('🎯 [WORKER-START] معالج webhook استقبل job!', { 
          jobId: job.id, 
          jobName: job.name,
          merchantId: data.merchantId 
        });
        
        // إلغاء تحذير عدم بدء Workers عند أول معالجة
        clearTimeout(workerInitTimeout);
        
        const webhookWorkerId = `webhook-worker-${crypto.randomUUID()}`;
        const startTime = Date.now();
        const { eventId, merchantId, platform, payload } = data;
      
      return await this.circuitBreaker.execute(async () => {
        try {
          const queue = this.queue;
          this.logger.info(`🔄 ${webhookWorkerId} - بدء معالجة ويب هوك`, {
            webhookWorkerId,
            eventId,
            merchantId,
            platform,
            jobId: job.id,
            attempt: (job as any).attemptsMade + 1 || 1,
            queueStatus: {
              waiting: queue ? await queue.getWaiting().then(jobs => jobs.length) : 0,
              active: queue ? await queue.getActive().then(jobs => jobs.length) : 0
            }
          });

          const result = await this.processWebhookJob({
            eventId,
            merchantId,
            platform,
            payload,
            priority: 'MEDIUM',
            metadata: { addedAt: Date.now(), source: 'webhook' }
          } as unknown as QueueJob);
          
          const duration = Date.now() - startTime;
          this.logger.info(`✅ ${webhookWorkerId} - ويب هوك مكتمل بنجاح`, {
            webhookWorkerId,
            eventId,
            duration: `${duration}ms`,
            throughput: Math.round(1000 / duration * 100) / 100,
            result: 'success'
          });
          
          return { 
            processed: true, 
            webhookWorkerId,
            eventId, 
            result,
            processingTime: duration
          };
          
        } catch (error) {
          const duration = Date.now() - startTime;
          this.logger.error(`❌ ${webhookWorkerId} - فشل في معالجة الويب هوك`, { 
            webhookWorkerId,
            eventId, 
            merchantId, 
            platform,
            jobId: job.id,
            duration: `${duration}ms`,
            err: serr(error),
            attempt: (job as any).attemptsMade + 1 || 1,
            maxAttempts: (job as any).opts?.attempts || 3
          });
          
          throw error;
        }
      });
    }
    );
    const webhookWorker = new Worker(
      this.queueName,
      async (job: Job) => {
        if (job.name !== 'process-webhook') return;
        return webhookProcessor(job as unknown as { id: string; name: string; data: unknown; moveToFailed: (err: Error, retry: boolean) => Promise<void> });
      },
      { connection, concurrency: 5 }
    );
    this.workers['process-webhook'] = webhookWorker;

    // 🤖 معالج مهام الذكاء الاصطناعي - wrapped with withAITenantJob
    this.logger.info('🔧 [DEBUG] تسجيل معالج ai-response...');
    
    const aiProcessor = withAITenantJob(
      this.dbPool,
      this.logger,
      async (job, data, _client) => {
        this.logger.info('🤖 [WORKER-START] معالج AI استقبل job!', { jobId: job.id, jobName: job.name });
        const { conversationId, merchantId, message } = data;
      const aiWorkerId = `ai-worker-${crypto.randomUUID().replace(/-/g, '').slice(0, 6)}`;
      const startTime = Date.now();
      
      return await this.circuitBreaker.execute(async () => {
        try {
          this.logger.info(`🤖 ${aiWorkerId} - بدء معالجة استجابة ذكاء اصطناعي`, {
            aiWorkerId,
            conversationId,
            merchantId,
            jobId: job.id,
            messageLength: (message as string).length || 0,
            attempt: (job as any).attemptsMade + 1 || 1
          });

          const result = await this.processAIResponseJob({
            conversationId,
            merchantId,
            message,
            platform: 'instagram'
          });
          
          const duration = Date.now() - startTime;
          this.logger.info(`✅ ${aiWorkerId} - استجابة ذكاء اصطناعي مكتملة بنجاح`, {
            aiWorkerId,
            conversationId,
            duration: `${duration}ms`,
            result: 'success'
          });
          
          return { 
            processed: true, 
            aiWorkerId,
            conversationId, 
            result,
            processingTime: duration
          };
          
        } catch (error) {
          const duration = Date.now() - startTime;
          this.logger.error(`❌ ${aiWorkerId} - فشل في معالجة استجابة الذكاء الاصطناعي`, { 
            aiWorkerId,
            conversationId, 
            merchantId,
            duration: `${duration}ms`,
            error: error instanceof Error ? error.message : String(error),
            attempt: (job as any).attemptsMade + 1 || 1,
            maxAttempts: (job as any).opts?.attempts || 3,
            jobId: job.id
          });
          
          throw error;
        }
      });
    }
    );
    const aiWorker = new Worker(
      this.queueName,
      async (job: Job) => {
        if (job.name !== 'ai-response') return;
        return aiProcessor(job as unknown as { id: string; name: string; data: unknown; moveToFailed: (err: Error, retry: boolean) => Promise<void> });
      },
      { connection, concurrency: 3 }
    );
    this.workers['ai-response'] = aiWorker;

    // معالج مهام التنظيف
    const cleanupWorker = new Worker(
      this.queueName,
      async (job: Job) => {
        if (job.name !== 'cleanup') return;
        const { type, olderThanDays } = job.data as { type: string; olderThanDays: number };
        try {
          await this.performCleanup(type, olderThanDays);
          return { cleaned: true, type, olderThanDays } as const;
        } catch (error) {
          this.logger.error('فشل في تنظيف الطابور', { 
            type, 
            error: error instanceof Error ? error.message : String(error)
          });
          throw error as Error;
        }
      },
      { connection, concurrency: 1 }
    );
    this.workers['cleanup'] = cleanupWorker;

    // 🔔 معالج الإشعارات
    const notificationWorker = new Worker(
      this.queueName,
      async (job: Job) => {
        if (job.name !== 'notification') return;
        this.logger.info('🔔 [NOTIFICATION] بدء معالجة إشعار', { jobId: job.id });
        try {
          const result = await this.processNotificationJob(job.data as Record<string, unknown>);
          this.logger.info('✅ [NOTIFICATION] تم إرسال الإشعار بنجاح', { jobId: job.id });
          return result;
        } catch (error) {
          this.logger.error('❌ [NOTIFICATION] فشل في إرسال الإشعار', { 
            jobId: job.id, 
            error: error instanceof Error ? error.message : String(error) 
          });
          throw error as Error;
        }
      },
      { connection, concurrency: 2 }
    );
    this.workers['notification'] = notificationWorker;

    // 📤 معالج تسليم الرسائل
    const messageDeliveryWorker = new Worker(
      this.queueName,
      async (job: Job) => {
        if (job.name !== 'message-delivery') return;
        this.logger.info('📤 [MESSAGE-DELIVERY] بدء تسليم رسالة', { jobId: job.id });
        try {
          const result = await this.processMessageDeliveryJob(job.data as Record<string, unknown>);
          this.logger.info('✅ [MESSAGE-DELIVERY] تم تسليم الرسالة بنجاح', { jobId: job.id });
          return result;
        } catch (error) {
          this.logger.error('❌ [MESSAGE-DELIVERY] فشل في تسليم الرسالة', { 
            jobId: job.id, 
            error: error instanceof Error ? error.message : String(error) 
          });
          throw error as Error;
        }
      },
      { connection, concurrency: 3 }
    );
    this.workers['message-delivery'] = messageDeliveryWorker;

    // تأكيد إنجاز تسجيل جميع المعالجات
    this.logger.info('🎯 [SUCCESS] تم تسجيل جميع معالجات الطوابير بنجاح!', {
      processors: ['process-webhook', 'ai-response', 'cleanup', 'notification', 'message-delivery'],
      concurrency: { webhook: 5, ai: 3, cleanup: 1, notification: 2, messageDelivery: 3 },
      total: 14
    });
    
    // 🔍 تحقق فوري من أن القائمة يمكنها إرسال إشعارات عند تفعيل الاختبارات صراحة
    if (
      getEnv('NODE_ENV') !== 'production' &&
      getEnv('ENABLE_QUEUE_TESTS') === 'true'
    ) {
      setTimeout(async () => {
        try {
          this.logger.info('🔍 [BULL-TEST] اختبار إضافة job تجريبي فوري...');
          const testJob = await this.queue!.add('test-notification', { test: true }, {
            priority: 1,
            delay: 0,
            attempts: 1
          });
          this.logger.info('🔍 [BULL-TEST] تم إضافة test job:', testJob.id);
        } catch (error) {
          this.logger.error('🔍 [BULL-TEST] فشل في إضافة test job:', error);
        }
      }, 1000);
    }
    
    // 🚨 Manual Polling Fallback - للتعامل مع مشاكل Upstash notification
    this.startManualPolling();
  }

  private startManualPolling(intervalMs: number = this.baseManualPollingIntervalMs): void {
    if (this.manualPollingInterval) {
      clearInterval(this.manualPollingInterval);
    }
    if (this.manualPollingBackoffTimeout) {
      clearTimeout(this.manualPollingBackoffTimeout);
      this.manualPollingBackoffTimeout = undefined;
    }
    this.manualPollingAlertSent = false;
    this.currentManualPollingIntervalMs = intervalMs;

    this.logger.info('🔄 [MANUAL-POLLING] بدء Manual Polling كـ fallback للإشعارات', {
      intervalMs,
    });

    // فحص الطابور بشكل دوري للبحث عن jobs منتظرة
    this.manualPollingInterval = setInterval(async () => {
      try {
        this.logger.debug('🔍 [MANUAL-POLLING] فحص دوري...');
        
        if (!this.queue) {
          this.logger.warn('❌ [MANUAL-POLLING] Queue غير متاح');
          return;
        }
        
        this.logger.debug('🔍 [MANUAL-POLLING] جلب waiting jobs...');
        const waitingJobs = await this.queue.getWaiting();
        
        // 🔍 فحص delayed jobs أيضاً - هذا قد يكون السبب!
        const delayedJobs = await this.queue.getDelayed();
        
        this.logger.debug('🔍 [MANUAL-POLLING] نتائج getWaiting:', { 
          waitingCount: waitingJobs.length,
          delayedCount: delayedJobs.length
        });
        
        // إذا كان لديك delayed jobs، اطبع تفاصيلها
        if (delayedJobs.length > 0) {
          this.logger.warn('⏰ [MANUAL-POLLING] تم اكتشاف delayed jobs!', {
            delayedCount: delayedJobs.length,
            delayedJobIds: delayedJobs.slice(0, 3).map(j => j.id),
            delayTimes: delayedJobs.slice(0, 3).map(j => ({
              id: j.id,
              delay: j.opts?.delay,
              addedAt: new Date(j.timestamp).toISOString()
            }))
          });
        }
        
        // 🚨 معالجة delayed jobs المتراكمة أولاً
        if (delayedJobs.length > 0) {
          this.logger.info('🔧 [MANUAL-POLLING] معالجة delayed jobs متراكمة', {
            delayedCount: delayedJobs.length
          });
          
          for (const delayedJob of delayedJobs.slice(0, 2)) { // معالجة أول 2 delayed jobs
            try {
              // فحص إذا كان الوقت المحدد للـ delay انتهى
              const now = Date.now();
              const jobDelay = delayedJob.opts?.delay || 0;
              const addedAt = delayedJob.timestamp;
              const shouldRun = (now - addedAt) >= jobDelay;
              
              this.logger.info('🔍 [DELAYED-JOB] فحص delayed job', {
                jobId: delayedJob.id,
                addedAt: new Date(addedAt).toISOString(),
                delay: jobDelay,
                shouldRun,
                waitTime: now - addedAt
              });
              
              if (shouldRun) {
                // ترقية delayed job إلى waiting بإزالة delay
                await delayedJob.promote();
                this.logger.info('⬆️ [DELAYED-JOB] تمت ترقية delayed job إلى waiting', {
                  jobId: delayedJob.id
                });
              }
            } catch (promoteError) {
              this.logger.error('❌ [DELAYED-JOB] فشل في ترقية delayed job', {
                jobId: delayedJob.id,
                error: promoteError instanceof Error ? promoteError.message : String(promoteError)
              });
            }
          }
        }
        
        if (waitingJobs.length > 0) {
          this.logger.info('🔍 [MANUAL-POLLING] تم اكتشاف jobs منتظرة', { 
            count: waitingJobs.length,
            jobIds: waitingJobs.slice(0, 3).map(j => j.id) // أول 3 فقط لتجنب spam
          });
          
          // محاولة تشغيل jobs يدوياً
          for (const job of waitingJobs.slice(0, 3)) { // معالجة أول 3 jobs فقط
            try {
              this.logger.info('🔄 [MANUAL-PROCESSING] محاولة معالجة job يدوياً', {
                jobId: job.id,
                jobName: job.name,
                dataKeys: Object.keys(job.data || {}),
                jobState: (job as any).opts?.delay ? 'delayed' : 'waiting'
              });
              
              // 🔍 فحص Job data integrity أولاً
              if (!job.data) {
                this.logger.error('❌ [MANUAL-PROCESSING] Job data مفقود!', { jobId: job.id });
                await job.remove();
                this.failedJobs++;
                continue;
              }
              
              // 🔍 فحص إذا كان Job delayed بدلاً من waiting
              if ((job as any).opts?.delay && (job as any).opts.delay > 0) {
                this.logger.warn('⏰ [MANUAL-PROCESSING] Job delayed - تخطي', { 
                  jobId: job.id, 
                  delay: (job as any).opts?.delay 
                });
                continue;
              }
              
              // معالجة حسب نوع Job
              if (job.name === 'process-webhook') {
                this.logger.debug('🔄 [MANUAL-PROCESSING] معالجة webhook job...');
                const result = await this.processWebhookJob(job.data);
                
                this.logger.debug('🔄 [MANUAL-PROCESSING] إزالة job...');
                await job.remove();
                this.completedJobs++;
                
                this.logger.info('✅ [MANUAL-PROCESSING] تمت معالجة webhook job', { 
                  jobId: job.id, 
                  result,
                  completedCount: this.completedJobs 
                });
              } else if (job.name === 'ai-response') {
                this.logger.debug('🔄 [MANUAL-PROCESSING] معالجة AI job...');
                const result = await this.processAIResponseJob(job.data);
                
                this.logger.debug('🔄 [MANUAL-PROCESSING] إزالة AI job...');
                await job.remove();
                this.completedJobs++;
                
                this.logger.info('✅ [MANUAL-PROCESSING] تمت معالجة AI job', { 
                  jobId: job.id,
                  result,
                  completedCount: this.completedJobs
                });
              } else {
                // Job غير معروف - إزالة
                this.logger.debug('🔄 [MANUAL-PROCESSING] إزالة job غير معروف...');
                await job.remove();
                this.logger.warn('⚠️ [MANUAL-PROCESSING] تمت إزالة job غير معروف', { 
                  jobId: job.id, 
                  jobName: job.name 
                });
              }
            } catch (jobError) {
              this.logger.error('❌ [MANUAL-PROCESSING] فشل في معالجة job', {
                jobId: job.id,
                jobName: job.name,
                error: jobError instanceof Error ? jobError.message : String(jobError),
                stack: jobError instanceof Error ? jobError.stack?.substring(0, 500) : undefined
              });
              try {
                // استخدام remove في حالة الفشل أيضاً
                this.logger.debug('🔄 [MANUAL-PROCESSING] إزالة job فاشل...');
                await job.remove();
                this.failedJobs++;
                this.logger.info('🗑️ [MANUAL-PROCESSING] تمت إزالة job فاشل', { jobId: job.id });
              } catch (removeError) {
                this.logger.error('❌ [MANUAL-PROCESSING] فشل حتى في إزالة job', {
                  jobId: job.id,
                  removeError: removeError instanceof Error ? removeError.message : String(removeError),
                  removeStack: removeError instanceof Error ? removeError.stack?.substring(0, 300) : undefined
                });
              }
            }
          }
        } else {
          this.logger.debug('🔍 [MANUAL-POLLING] لا توجد waiting jobs');
        }
      } catch (error) {
        if (
          error instanceof ReplyError &&
          (error as any).message?.toLowerCase().includes('max requests limit exceeded')
        ) {
          this.logger.warn(
            '⚠️ [MANUAL-POLLING] تجاوز الحد الأقصى لعدد طلبات Upstash - إيقاف التحقق اليدوي'
          );
          if (this.manualPollingInterval) {
            clearInterval(this.manualPollingInterval);
            this.manualPollingInterval = undefined;
          }
          const backoffMs = 5 * 60 * 1000; // 5 دقائق
          if (!this.manualPollingAlertSent) {
            this.manualPollingAlertSent = true;
            try {
              await this.notification.send({
                type: 'UPSTASH_RATE_LIMIT',
                recipient: 'ops',
                content: {
                  message:
                    'Manual polling paused: Upstash max requests limit exceeded',
                },
              });
            } catch (notifyError) {
              this.logger.error('❌ [MANUAL-POLLING] فشل إرسال تنبيه', {
                error:
                  notifyError instanceof Error
                    ? notifyError.message
                    : String(notifyError),
              });
            }
          }
          this.manualPollingBackoffTimeout = setTimeout(() => {
            this.logger.info(
              '⏳ [MANUAL-POLLING] إعادة تشغيل التحقق اليدوي بعد backoff'
            );
            this.manualPollingBackoffTimeout = undefined;
            this.startManualPolling();
          }, backoffMs);
        } else {
          this.logger.error('❌ [MANUAL-POLLING] خطأ في Manual Polling', {
            error: error instanceof Error ? error.message : String(error),
            stack:
              error instanceof Error
                ? error.stack?.substring(0, 500)
                : undefined,
          });
        }
      }
    }, intervalMs);
    this.manualPollingInterval.unref();
  }

  public adjustManualPollingInterval(multiplier: number): void {
    const newInterval = this.baseManualPollingIntervalMs * multiplier;
    if (newInterval !== this.currentManualPollingIntervalMs) {
      this.logger.warn('⚙️ [MANUAL-POLLING] تحديث الفاصل الزمني للـ polling', {
        previous: this.currentManualPollingIntervalMs,
        next: newInterval,
      });
      this.startManualPolling(newInterval);
    }
  }

  public getRedisClient(): Redis | undefined {
    return this.queueConnection;
  }

  public resumeManualPolling(): void {
    this.logger.info('🔄 [MANUAL-POLLING] تم استلام إشارة لإعادة تشغيل التحقق اليدوي');
    if (this.manualPollingInterval) {
      this.logger.warn('⚠️ [MANUAL-POLLING] التحقق اليدوي يعمل بالفعل');
      return;
    }
    if (this.manualPollingBackoffTimeout) {
      clearTimeout(this.manualPollingBackoffTimeout);
      this.manualPollingBackoffTimeout = undefined;
    }
    this.startManualPolling();
  }

  async addWebhookJob(
    eventId: string,
    payload: unknown,
    merchantId: string,
    platform: 'INSTAGRAM' | 'WHATSAPP' | 'FACEBOOK',
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'MEDIUM'
  ): Promise<JobResult> {
    if (!this.queue) {
      return { 
        success: false, 
        error: 'مدير الطوابير غير مهيأ' 
      };
    }

    try {
      const jobData: QueueJob = {
        eventId,
        payload,
        merchantId,
        platform,
        priority,
        metadata: {
          addedAt: new Date().toISOString(),
          source: 'webhook'
        }
      };

      const priorityValue = this.getPriorityValue(priority);
      
      this.logger.info('📤 [ADD-JOB] إضافة webhook job إلى الطابور...', {
        jobName: 'process-webhook',
        eventId,
        merchantId,
        platform,
        priority
      });

      const job = await this.queue.add('process-webhook', jobData, {
        priority: priorityValue,
        delay: 0, // 🚀 إزالة كل delay - Upstash لا يدعم delayed jobs بشكل صحيح
        removeOnComplete: priority === 'CRITICAL' ? 200 : 100,
        removeOnFail: priority === 'CRITICAL' ? 100 : 50,
        attempts: priority === 'CRITICAL' ? 5 : 3
      });

      this.logger.info('✅ [ADD-JOB] تم إضافة webhook job بنجاح', {
        jobId: job.id,
        jobName: job.name,
        eventId
      });

      // الحصول على موقع المهمة في الطابور
      const waiting = await this.queue.getWaiting();
      const queuePosition = waiting.findIndex(j => String(j.id ?? '') === String(job.id ?? '')) + 1;

      this.logger.info('تم إضافة مهمة ويب هوك للطابور', {
        jobId: job.id,
        eventId,
        merchantId,
        platform,
        priority,
        queuePosition
      });

      return { 
        success: true, 
        jobId: String(job.id ?? ''),
        queuePosition
      };

    } catch (error) {
      this.logger.error('فشل في إضافة مهمة للطابور', { 
        eventId,
        merchantId,
        platform,
        error: error instanceof Error ? error.message : String(error)
      });
      
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async addAIResponseJob(
    conversationId: string,
    merchantId: string,
    customerId: string,
    message: string,
    platform: 'INSTAGRAM' | 'WHATSAPP' | 'FACEBOOK',
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'HIGH'
  ): Promise<JobResult> {
    if (!this.queue) {
      return { success: false, error: 'مدير الطوابير غير مهيأ' };
    }

    try {
      const jobData = {
        conversationId,
        merchantId,
        customerId,
        message,
        platform,
        priority,
        metadata: {
          addedAt: new Date().toISOString(),
          source: 'ai-response'
        }
      };

      const job = await this.queue.add('ai-response', jobData, {
        priority: this.getPriorityValue(priority),
        delay: 0, // 🚀 إزالة delay - Upstash لا يدعم delayed jobs
        attempts: 2 // محاولتان فقط للذكاء الاصطناعي
      });

      return { success: true, jobId: String(job.id ?? '') };

    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async getQueueStats(): Promise<QueueStats> {
    if (!this.queue) {
      throw new Error('مدير الطوابير غير مهيأ');
    }

    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        this.queue.getWaiting(),
        this.queue.getActive(),
        this.queue.getCompleted(),
        this.queue.getFailed(),
        this.queue.getDelayed()
      ]);

      // BullMQ Queue - نستخدم 0 كقيمة افتراضية
      const paused = 0;

      const total = waiting.length + active.length + completed.length + 
                   failed.length + delayed.length + paused;

      const errorRate = this.processedJobs + this.failedJobs > 0 
        ? (this.failedJobs / (this.processedJobs + this.failedJobs)) * 100 
        : 0;

      const base: QueueStats = {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
        paused: paused,
        total,
        processing: this.isProcessing,
        errorRate: Math.round(errorRate * 100) / 100
      };
      return this.lastProcessedAt ? { ...base, lastProcessedAt: this.lastProcessedAt } : base;

    } catch (error) {
      this.logger.error('فشل في الحصول على إحصائيات الطابور', { error });
      throw error;
    }
  }

  async retryFailedJobs(jobType?: string): Promise<{
    success: boolean;
    retriedCount: number;
    error?: string;
  }> {
    if (!this.queue) {
      return { success: false, retriedCount: 0, error: 'مدير الطوابير غير مهيأ' };
    }

    try {
      const failedJobs = await this.queue.getFailed();
      let retriedCount = 0;

      for (const job of failedJobs) {
        if (!jobType || job.name === jobType) {
          await job.retry();
          retriedCount++;
        }
      }

      this.logger.info('تم إعادة محاولة المهام الفاشلة', {
        retriedCount,
        jobType: jobType || 'all'
      });

      return { success: true, retriedCount };

    } catch (error) {
      this.logger.error('فشل في إعادة محاولة المهام الفاشلة', { error });
      return { 
        success: false, 
        retriedCount: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async processWebhookJob(jobData: QueueJob): Promise<ProcessedWebhookResult> {
    const startTime = Date.now();
    
    try {
      this.logger.info('🔄 [WEBHOOK-PROCESS] بدء معالجة webhook job حقيقي', {
        eventId: jobData.eventId,
        merchantId: jobData.merchantId,
        platform: jobData.platform,
        hasPayload: !!jobData.payload,
        payloadSize: JSON.stringify(jobData.payload || {}).length
      });

      // 🔍 التحقق من صحة البيانات
      if (!jobData.payload) {
        throw new Error('Webhook payload is missing');
      }
      
      if (!jobData.merchantId) {
        throw new Error('Merchant ID is missing');
      }

      // 🚀 معالجة حقيقية حسب النوع
      let result: ProcessedWebhookResult;
      
      if (jobData.platform === 'INSTAGRAM') {
        result = await this.processInstagramWebhook(jobData);
      } else if (jobData.platform === 'WHATSAPP') {
        result = await this.processWhatsAppWebhook(jobData);
      } else {
        throw new Error(`Unsupported platform: ${jobData.platform}`);
      }

      const duration = Date.now() - startTime;
      
      this.logger.info('✅ [WEBHOOK-PROCESS] تمت معالجة webhook بنجاح', {
        eventId: jobData.eventId,
        platform: jobData.platform,
        duration: `${duration}ms`,
        eventsProcessed: result.eventsProcessed,
        messagesProcessed: result.messagesProcessed,
        conversationsCreated: result.conversationsCreated,
        success: result.success,
        errors: result.errors.length
      });

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.logger.error('💥 [WEBHOOK-ERROR] خطأ في معالجة webhook', {
        eventId: jobData.eventId,
        merchantId: jobData.merchantId,
        platform: jobData.platform,
        duration: `${duration}ms`,
        err: serr(error)
      });
      
      // إعادة throw للخطأ ليتم التعامل معه بواسطة BullMQ
      throw error;
    }
  }

  /**
   * معالجة webhook من Instagram
   */
  private async processInstagramWebhook(jobData: QueueJob): Promise<ProcessedWebhookResult> {
    try {
      this.logger.info('📷 [INSTAGRAM-WEBHOOK] معالجة Instagram webhook', {
        eventId: jobData.eventId,
        merchantId: jobData.merchantId
      });

      // تحويل payload إلى Instagram webhook format
      const webhookEvent: InstagramWebhookEvent = jobData.payload as InstagramWebhookEvent;
      
      // التحقق من صحة Instagram webhook structure
      if (!webhookEvent.object || webhookEvent.object !== 'instagram') {
        throw new Error('Invalid Instagram webhook object');
      }
      
      if (!webhookEvent.entry || !Array.isArray(webhookEvent.entry)) {
        throw new Error('Invalid Instagram webhook entry array');
      }

      // معالجة حقيقية باستخدام InstagramWebhookHandler
      const result = await this.webhookHandler.processWebhook(webhookEvent, jobData.merchantId);
      
      this.logger.info('✅ [INSTAGRAM-WEBHOOK] Instagram webhook معُولج', {
        eventId: jobData.eventId,
        merchantId: jobData.merchantId,
        eventsProcessed: result.eventsProcessed,
        messagesProcessed: result.messagesProcessed,
        conversationsCreated: result.conversationsCreated,
        errors: result.errors.length
      });

      return result;
    } catch (error) {
      this.logger.error('❌ [INSTAGRAM-WEBHOOK] خطأ في معالجة Instagram webhook', {
        eventId: jobData.eventId,
        merchantId: jobData.merchantId,
        error: error instanceof Error ? error.message : String(error)
      });
      
      // إرجاع نتيجة فشل
      return {
        success: false,
        eventsProcessed: 0,
        conversationsCreated: 0,
        messagesProcessed: 0,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  /**
   * معالجة webhook من WhatsApp
   */
  private async processWhatsAppWebhook(jobData: QueueJob): Promise<ProcessedWebhookResult> {
    this.logger.info('💬 [WHATSAPP-WEBHOOK] معالجة WhatsApp webhook', {
      eventId: jobData.eventId,
      merchantId: jobData.merchantId
    });

    const result: ProcessedWebhookResult = {
      success: false,
      eventsProcessed: 0,
      conversationsCreated: 0,
      messagesProcessed: 0,
      errors: []
    };

    try {
      const { rawBody, signature, appSecret, headers } = (jobData.payload || {}) as { rawBody?: string | Buffer; signature?: string; appSecret?: string; headers?: Record<string, string> };

      // استخراج التوقيع من الحقول المحتملة
      const receivedSig: string | undefined =
        signature || headers?.['x-hub-signature-256'] || headers?.['X-Hub-Signature-256'];

      if (!rawBody || !receivedSig || !appSecret) {
        throw new Error('Missing webhook payload, signature or app secret');
      }

      const bodyString = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');

      // التحقق من صحة التوقيع
      const expectedSig = crypto
        .createHmac('sha256', appSecret)
        .update(bodyString)
        .digest('hex');

      const provided = receivedSig.replace('sha256=', '');
      const expectedBuf = Buffer.from(expectedSig, 'hex');
      let providedBuf: Buffer;
      try {
        providedBuf = Buffer.from(provided, 'hex');
      } catch {
        throw new Error('Invalid webhook signature');
      }

      if (expectedBuf.length !== providedBuf.length) {
        throw new Error('Invalid webhook signature');
      }

      const isValid = crypto.timingSafeEqual(expectedBuf, providedBuf);

      if (!isValid) {
        throw new Error('Invalid webhook signature');
      }

      // تحليل الحدث
      const event = JSON.parse(bodyString);

      this.logger.info('📨 [WHATSAPP-WEBHOOK] حدث مستلم', {
        eventId: jobData.eventId,
        merchantId: jobData.merchantId,
        object: event.object
      });

      result.eventsProcessed = Array.isArray(event.entry) ? event.entry.length : 1;
      result.success = true;
      return result;
    } catch (error) {
      this.logger.error('❌ [WHATSAPP-WEBHOOK] خطأ في معالجة WhatsApp webhook', {
        eventId: jobData.eventId,
        merchantId: jobData.merchantId,
        error: error instanceof Error ? error.message : String(error)
      });

      result.errors.push(error instanceof Error ? error.message : String(error));
      return result;
    }
  }

  private async processAIResponseJob(jobData: Record<string, unknown>): Promise<Record<string, unknown>> {
    const startTime = Date.now();
    
    try {
      this.logger.info('🤖 [AI-PROCESS] بدء معالجة AI job حقيقي', {
        conversationId: jobData.conversationId,
        merchantId: jobData.merchantId,
        customerId: jobData.customerId,
        messageLength: (jobData.message as string)?.length || 0,
        platform: jobData.platform
      });

      // 🔍 التحقق من صحة البيانات
      if (!jobData.conversationId) {
        throw new Error('Conversation ID is missing');
      }
      
      if (!jobData.merchantId) {
        throw new Error('Merchant ID is missing');
      }
      
      if (!jobData.message) {
        throw new Error('Message content is missing');
      }

      // 🚀 معالجة AI حقيقية باستخدام AI Orchestrator
      const platform = ((jobData.platform as string | undefined)?.toLowerCase() || 'instagram') as 'instagram' | 'whatsapp';
      
      // إنشاء context حسب platform
      let context: Record<string, unknown>;
      
      if (platform === 'instagram') {
        context = {
          conversationId: jobData.conversationId,
          merchantId: jobData.merchantId,
          customerId: jobData.customerId,
          messageHistory: (jobData.messageHistory || []) as unknown as import('../types/common.js').MessageLike[],
          customerProfile: jobData.customerProfile || {},
          businessContext: jobData.businessContext || {},
          // Instagram-specific properties
          interactionType: jobData.interactionType || 'dm',
          stage: 'engagement',
          cart: [],
          preferences: {},
          conversationHistory: jobData.messageHistory || [],
          mediaContext: jobData.mediaContext || {},
          visualPreferences: jobData.visualPreferences || {}
        };
      } else {
        // WhatsApp context (simpler)
        context = {
          conversationId: jobData.conversationId,
          merchantId: jobData.merchantId,
          customerId: jobData.customerId,
          messageHistory: (jobData.messageHistory || []) as unknown as import('../types/common.js').MessageLike[],
          customerProfile: jobData.customerProfile || {},
          businessContext: jobData.businessContext || {}
        };
      }

      // 📝 جلب بيانات المحادثة من قاعدة البيانات
      const conversation = await this.repositories.conversation.findById(String(jobData.conversationId));
      if (!conversation) {
        throw new Error(`Conversation not found: ${jobData.conversationId}`);
      }

      // 🏪 جلب بيانات التاجر من قاعدة البيانات
      const merchant = await this.repositories.merchant.findById(String(jobData.merchantId));
      if (!merchant || !merchant.isActive) {
        throw new Error(`Merchant not found or inactive: ${jobData.merchantId}`);
      }

      // 📚 جلب تاريخ المحادثة الحديث
      const messageHistory = await this.repositories.message.getRecentMessagesForContext(
        String(jobData.conversationId),
        10
      );

      // 🧠 بناء context متقدم للذكاء الاصطناعي
      const aiContext = await this.buildAdvancedAIContext(
        jobData,
        // مرّر الكائنات كما هي، مع تحويل history إلى JSON-plain فقط
        (conversation as unknown as Record<string, unknown>),
        (merchant as unknown as Record<string, unknown>),
        (messageHistory.map(m => JSON.parse(JSON.stringify(m))) as Array<Record<string, unknown>>)
      );

      const aiResponse = await this.aiOrchestrator.generatePlatformResponse(
        jobData.message as string,
        (aiContext as unknown as InstagramContext),
        'instagram' // تثبيت على instagram حالياً
      );

      const processingTime = Date.now() - startTime;

      // 💾 حفظ الاستجابة كرسالة صادرة
      const outgoingMessage = await this.repositories.message.create({
        conversationId: String(jobData.conversationId),
        direction: 'OUTGOING',
        platform: 'instagram', // تثبيت على instagram حالياً
        messageType: 'TEXT',
        content: aiResponse.response.message,
        platformMessageId: `ai_generated_${Date.now()}`,
        aiProcessed: true,
        deliveryStatus: 'PENDING',
        aiConfidence: aiResponse.response.confidence,
        aiIntent: aiResponse.response.intent,
        processingTimeMs: processingTime
      });

      // 🔄 تحديث مرحلة المحادثة إذا تغيرت
      if (aiResponse.response.stage !== conversation.conversationStage) {
        await this.repositories.conversation.update(jobData.conversationId as string, {
          conversationStage: aiResponse.response.stage
        });
      }

      // 📤 إرسال الرسالة عبر منصة API
      const deliveryResult = await this.deliverAIMessage(jobData, aiResponse.response.message as string);

      // ✅ تحديث حالة تسليم الرسالة
      if (deliveryResult.success) {
        await this.repositories.message.markAsDelivered(
          outgoingMessage.id,
          deliveryResult.platformMessageId
        );
      } else {
        await this.repositories.message.markAsFailed(outgoingMessage.id);
      }

      const duration = Date.now() - startTime;
      
      const result = {
        processed: true,
        messageId: outgoingMessage.id,
        aiResponse: aiResponse.response.message,
        confidence: aiResponse.response.confidence,
        intent: aiResponse.response.intent,
        stage: aiResponse.response.stage,
        processingTime: duration,
        delivered: deliveryResult.success,
        platformMessageId: deliveryResult.platformMessageId,
        conversationId: jobData.conversationId,
        timestamp: new Date().toISOString(),
        advancedProcessing: true
      };

      this.logger.info('✅ [AI-PROCESS] تمت معالجة AI متقدمة بنجاح', {
        conversationId: jobData.conversationId,
        merchantId: jobData.merchantId,
        messageId: outgoingMessage.id,
        duration: `${duration}ms`,
        confidence: aiResponse.response.confidence,
        delivered: deliveryResult.success,
        stage: aiResponse.response.stage
      });

      return result as unknown as Record<string, unknown>;

    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.logger.error('💥 [AI-ERROR] خطأ في معالجة AI', {
        conversationId: jobData.conversationId,
        merchantId: jobData.merchantId,
        customerId: jobData.customerId,
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack?.substring(0, 500) : undefined
      });
      
      throw error;
    }
  }

  private async performInitialCleanup(): Promise<void> {
    if (!this.queue) return;

    try {
      // تنظيف المهام القديمة المكتملة (أكثر من يوم)
      await this.queue.clean(24 * 60 * 60 * 1000, 1000, 'completed');
      
      // تنظيف المهام الفاشلة القديمة (أكثر من 3 أيام)
      await this.queue.clean(3 * 24 * 60 * 60 * 1000, 1000, 'failed');

      this.logger.info('تم تنظيف الطابور الأولي');
    } catch (error) {
      this.logger.warn({ err: error }, 'فشل في التنظيف الأولي');
    }
  }

  private async performCleanup(type: string, olderThanDays: number): Promise<void> {
    if (!this.queue) return;

    const olderThanMs = olderThanDays * 24 * 60 * 60 * 1000;
    
    switch (type) {
      case 'completed':
        await this.queue.clean(olderThanMs, 1000, 'completed');
        break;
      case 'failed':
        await this.queue.clean(olderThanMs, 1000, 'failed');
        break;
      case 'all':
        await this.queue.clean(olderThanMs, 1000, 'completed');
        await this.queue.clean(olderThanMs, 1000, 'failed');
        break;
    }
  }

  private getPriorityValue(priority: string): number {
    switch (priority) {
      case 'CRITICAL': return 1;
      case 'HIGH': return 2;
      case 'MEDIUM': return 3;
      case 'LOW': return 4;
      default: return 3;
    }
  }

  private startQueueMonitoring(): void {
    // مراقبة كل 30 ثانية
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.performQueueHealthCheck();
      } catch (error) {
        this.logger.error('Queue monitoring error', { error });
      }
    }, 30000);

    this.logger.debug('Queue monitoring started');
  }

  private startWorkerHealthMonitoring(): void {
    // مراقبة صحة Workers كل دقيقة
    this.workerHealthInterval = setInterval(async () => {
      try {
        await this.checkWorkerHealth();
      } catch (error) {
        this.logger.error('Worker health monitoring error', { error });
      }
    }, 60000);

    this.logger.info('🔍 Worker health monitoring started');
  }

  private async checkWorkerHealth(): Promise<void> {
    if (!this.queue) return;

    try {
      const stats = await this.getQueueStats();
      const now = Date.now();
      
      // فحص إذا كانت هناك مهام في الانتظار لكن لا يتم معالجتها
      if (stats.waiting > 0 && stats.active === 0) {
        this.logger.warn('🚨 مهام في الانتظار لكن لا توجد معالجة نشطة', {
          waiting: stats.waiting,
          active: stats.active,
          lastProcessedAt: this.lastProcessedAt,
          timeSinceLastProcess: this.lastProcessedAt 
            ? now - this.lastProcessedAt.getTime() 
            : 'never'
        });

        // إذا لم تتم معالجة أي مهمة خلال آخر 5 دقائق والمهام متراكمة
        if (stats.waiting > 10 && 
            (!this.lastProcessedAt || now - this.lastProcessedAt.getTime() > 300000)) {
          this.logger.error('🔥 Workers معطلة - محاولة إعادة تشغيل المعالجات', {
            queueStats: stats,
            action: 'restart_processors'
          });
          
          // يمكن إضافة آلية إعادة تشغيل المعالجات هنا إذا لزم الأمر
        }
      }

      // فحص إذا كانت المهام النشطة عالقة لفترة طويلة
      if (stats.active > 0) {
        const activeJobs = await this.queue.getActive();
        const stalledJobs = activeJobs.filter(job => {
          const processTime = job.processedOn || Date.now();
          return now - processTime > 120000; // أكثر من دقيقتين
        });

        if (stalledJobs.length > 0) {
          this.logger.warn('⏰ مهام نشطة عالقة لفترة طويلة', {
            stalledCount: stalledJobs.length,
            totalActive: stats.active,
            stalledJobIds: stalledJobs.map(j => j.id).slice(0, 5) // أول 5 فقط
          });
        }
      }

      // إحصائيات إيجابية عندما كل شيء يعمل بشكل جيد
      if (stats.active > 0 || (this.lastProcessedAt && now - this.lastProcessedAt.getTime() < 60000)) {
        this.logger.debug('✅ Workers تعمل بشكل طبيعي', {
          active: stats.active,
          waiting: stats.waiting,
          recentlyProcessed: this.lastProcessedAt ? now - this.lastProcessedAt.getTime() < 60000 : false
        });
      }

    } catch (error) {
      this.logger.error('Worker health check failed', { error });
    }
  }

  private async performQueueHealthCheck(): Promise<void> {
    if (!this.queue || !this.queueConnection) return;

    try {
      // فحص صحة الاتصال
      const healthResult = await performHealthCheck(this.queueConnection);
      const isHealthy = healthResult.success;
      
      if (!isHealthy) {
        this.logger.warn('Queue Redis connection unhealthy, attempting reconnection');
        
        // إعادة الاتصال
        this.queueConnection = await this.connectionManager.getConnection(RedisUsageType.QUEUE_SYSTEM);
      }

      // فحص إحصائيات الطابور
      const stats = await this.getQueueStats();
      
      if (stats.errorRate > 20) {
        this.logger.warn('High error rate detected in queue', { 
          errorRate: stats.errorRate,
          failed: stats.failed,
          completed: stats.completed 
        });
      }

      if (stats.waiting > 1000) {
        this.logger.warn('Queue backlog detected', { 
          waiting: stats.waiting,
          active: stats.active 
        });
      }

    } catch (error) {
      this.logger.error('Queue health check failed', { error });
    }
  }

  async getQueueHealth(): Promise<{
    healthy: boolean;
    stats: QueueStats;
    redisHealth: any;
    workerStatus: {
      isProcessing: boolean;
      delayedJobs: number;
      activeWorkers: number;
      processingCapacity: number;
    };
    recommendations: string[];
  }> {
    const recommendations: string[] = [];
    let healthy = true;

    try {
      const stats = await this.getQueueStats();
      let redisHealth = null;

      if (this.queueConnection) {
        // Use performHealthCheck function instead
        const healthResult = await performHealthCheck(this.queueConnection);
        redisHealth = {
          connected: healthResult.success,
          responseTime: healthResult.latency || 0,
          metrics: {}
        };
        
        if (!redisHealth.connected) {
          healthy = false;
          recommendations.push('إصلاح اتصال Redis للطوابير');
        }
      }

      // تحليل حالة المعالجات (Workers)
      const workerStatus = {
        isProcessing: this.isProcessing,
        delayedJobs: stats.delayed,
        activeWorkers: stats.active > 0 ? 1 : 0, // تقدير بسيط
        processingCapacity: 5 // القدرة القصوى للمعالجة
      };

      // فحص Worker Status المحسّن
      if (stats.delayed > 0 && !workerStatus.isProcessing && stats.active === 0) {
        healthy = false;
        recommendations.push('🔧 Queue Workers غير نشطة رغم وجود مهام معلقة - إعادة تشغيل مطلوبة');
      }

      if (stats.waiting > 10 && stats.active === 0) {
        const timeSinceLastProcess = this.lastProcessedAt ? Date.now() - this.lastProcessedAt.getTime() : null;
        
        if (!timeSinceLastProcess || timeSinceLastProcess > 120000) { // أكبر من دقيقتين
          healthy = false;
          recommendations.push('🚨 لا توجد معالجة نشطة رغم وجود مهام في الانتظار - Workers معطلة');
        } else {
          recommendations.push('⚡ تجمع مهام في الانتظار - مراقبة Workers');
        }
      }

      if (stats.waiting > 100 && stats.active === 0) {
        recommendations.push('⚠️ تراكم كبير في المهام - فحص عاجل للWorkers مطلوب');
      }

      // فحص معدل المعالجة
      const processingRate = this.processedJobs > 0 ? this.processedJobs / (Date.now() / 60000) : 0;
      if (processingRate < 1 && stats.waiting > 5) {
        recommendations.push('📉 معدل معالجة منخفض - قد تحتاج المزيد من Workers');
      }

      if (stats.errorRate > 10) {
        healthy = false;
        recommendations.push('معدل خطأ مرتفع - فحص معالجات المهام');
      }

      if (stats.waiting > 500) {
        if (stats.active < workerStatus.processingCapacity / 2) {
          recommendations.push('طابور طويل مع معالجة قليلة - زيادة المعالجات');
        } else {
          recommendations.push('طابور طويل - تحسين أداء المعالجة');
        }
      }

      if (stats.failed > stats.completed) {
        healthy = false;
        recommendations.push('المهام الفاشلة أكثر من المكتملة - فحص المعالجة');
      }

      // فحص إضافي للمعالجة المعلقة
      if (stats.active > 0 && !this.lastProcessedAt) {
        recommendations.push('⏰ مهام نشطة لكن لا توجد معالجة مكتملة مؤخراً');
      } else if (this.lastProcessedAt && Date.now() - this.lastProcessedAt.getTime() > 300000) {
        recommendations.push('⏰ لم تكتمل أي مهام خلال آخر 5 دقائق');
      }

      return {
        healthy,
        stats,
        redisHealth,
        workerStatus,
        recommendations: recommendations.length > 0 ? recommendations : ['✅ النظام والمعالجات تعمل بشكل مثالي']
      };

    } catch (error) {
      return {
        healthy: false,
        stats: {
          waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0,
          paused: 0, total: 0, processing: false, errorRate: 100
        },
        redisHealth: null,
        workerStatus: {
          isProcessing: false,
          delayedJobs: 0,
          activeWorkers: 0,
          processingCapacity: 0
        },
        recommendations: ['خطأ حرج في فحص صحة الطابور والمعالجات']
      };
    }
  }

  async gracefulShutdown(timeoutMs: number = 30000): Promise<void> {
    this.logger.info('🔄 بدء إغلاق مدير الطوابير بأمان...');

    // إيقاف المراقبة
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    if (this.manualPollingInterval) {
      clearInterval(this.manualPollingInterval);
      this.manualPollingInterval = undefined;
    }
    if (this.workerHealthInterval) {
      clearInterval(this.workerHealthInterval);
      this.workerHealthInterval = undefined;
    }

    if (this.queue) {
      try {
        // انتظار إكمال المهام الجارية مع timeout
        await withTimeout(this.waitForActiveJobs(), timeoutMs, 'queue shutdown');

        await this.queue!.close();
        this.queue = null;

        this.logger.info('✅ تم إغلاق الطابور بأمان');

      } catch (error) {
        this.logger.warn({ err: error }, 'فشل في الانتظار لإكمال المهام، إغلاق قسري');
        await this.queue!.close();
        this.queue = null;
      }
    }

    // إغلاق اتصالات Redis
    await this.connectionManager.closeAllConnections();

    this.logger.info('✅ تم إغلاق مدير الطوابير بأمان');
  }

  private async waitForActiveJobs(): Promise<void> {
    if (!this.queue) return;

    let activeJobs = await this.queue!.getActive();
    
    while (activeJobs.length > 0) {
      this.logger.info(`انتظار إكمال ${activeJobs.length} مهام جارية...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      activeJobs = await this.queue!.getActive();
    }
  }

  async close(): Promise<void> {
    await this.gracefulShutdown();
  }

  /**
   * بناء context متقدم للذكاء الاصطناعي
   */
  private async buildAdvancedAIContext(
    jobData: Record<string, unknown>,
    conversation: Record<string, unknown>,
    merchant: Record<string, unknown>,
    messageHistory: Record<string, unknown>[]
  ): Promise<Record<string, unknown>> {
    const baseContext = {
      merchantId: jobData.merchantId,
      customerId: jobData.customerId,
      platform: jobData.platform || 'instagram',
      stage: conversation.conversationStage,
      cart: (conversation.sessionData as any)?.cart || [],
      preferences: (conversation.sessionData as any)?.preferences || {},
      conversationHistory: messageHistory.map((msg) => ({
        role: (msg as { direction: string }).direction === 'INCOMING' ? 'user' : 'assistant',
        content: (msg as { content: string }).content,
        timestamp: (msg as { createdAt: string | Date }).createdAt
      })),
      interactionType: jobData.interactionType || 'dm',
      mediaContext: jobData.mediaContext,
      merchantSettings: {
        businessName: merchant.businessName,
        businessCategory: merchant.businessCategory,
        workingHours: (merchant.settings as any)?.workingHours || {},
        paymentMethods: (merchant.settings as any)?.paymentMethods || [],
        deliveryFees: (merchant.settings as any)?.deliveryFees || {},
        autoResponses: (merchant.settings as any)?.autoResponses || {}
      }
    };

    // Platform-specific context enhancements
    if ((jobData.platform || 'instagram') === 'instagram') {
      return {
        ...baseContext,
        // Instagram-specific context
        hashtagSuggestions: (merchant as { settings?: { instagramHashtags?: string[] } } | undefined)?.settings?.instagramHashtags ?? [],
        storyFeatures: (merchant as { settings?: { storyFeatures?: boolean } } | undefined)?.settings?.storyFeatures ?? false,
        commerceEnabled: (merchant as { settings?: { instagramCommerce?: boolean } } | undefined)?.settings?.instagramCommerce ?? false
      };
    }

    return baseContext;
  }

  /**
   * إرسال رسالة AI عبر منصة API
   */
  private async deliverAIMessage(
    jobData: Record<string, unknown>,
    message: string
  ): Promise<{ success: boolean; platformMessageId?: string; error?: string }> {
    try {
      const platform = (jobData.platform as string | undefined) || 'instagram';
      
      switch (platform) {
        case 'instagram':
          return await this.deliverInstagramAIMessage(jobData, message);
          
        default:
          return { success: false, error: `Unsupported platform: ${platform}` };
      }
    } catch (error) {
      this.logger.error('❌ Message delivery error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown delivery error'
      };
    }
  }

  /**
   * إرسال رسالة Instagram AI
   */
  private async deliverInstagramAIMessage(
    jobData: Record<string, unknown>,
    message: string
  ): Promise<{ success: boolean; platformMessageId?: string; error?: string }> {
    try {
      const instagramClient = getInstagramClient(jobData.merchantId as string);
      const credentials = await instagramClient.loadMerchantCredentials(jobData.merchantId as string);
      if (!credentials) {
        throw new Error('Instagram credentials not found');
      }
      await instagramClient.validateCredentials(credentials, String((jobData as { merchantId?: unknown }).merchantId ?? ''));

      const result = await instagramClient.sendMessage(
        credentials,
        String((jobData as { merchantId?: unknown }).merchantId ?? ''),
        {
        recipientId: jobData.customerId as string,
        messagingType: 'RESPONSE',
        content: message
        }
      );

      return {
        success: result.success ?? false,
        ...(result.id ? { platformMessageId: result.id } : {}),
        ...(result.error ? { error: result.error } : {})
      } as { success: boolean; platformMessageId?: string; error?: string };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Instagram delivery failed'
      };
    }
  }

  /**
   * معالجة مهام الإشعارات
   */
  private async processNotificationJob(jobData: Record<string, unknown>): Promise<Record<string, unknown>> {
    const startTime = Date.now();
    
    try {
      this.logger.info('🔔 [NOTIFICATION-PROCESS] بدء معالجة إشعار', {
        type: jobData.type,
        recipient: jobData.recipient,
        hasPayload: !!jobData.payload
      });

      // 🔍 التحقق من صحة البيانات
      if (!jobData.type) {
        throw new Error('Notification type is missing');
      }
      
      if (!jobData.recipient) {
        throw new Error('Notification recipient is missing');
      }

      // 📤 إرسال الإشعار باستخدام NotificationService
      const result = await this.notification.send({
        type: jobData.type as string,
        recipient: jobData.recipient as string,
        content: (jobData as { data?: unknown; payload?: unknown }).data || (jobData as { payload?: unknown }).payload || { message: 'Notification' }
      });

      const duration = Date.now() - startTime;
      
      if (result.success) {
        this.logger.info('✅ [NOTIFICATION-PROCESS] تم إرسال الإشعار بنجاح', {
          type: jobData.type,
          recipient: jobData.recipient,
          duration: `${duration}ms`,
          sent: true
        });
        
        return { 
          processed: true, 
          sent: true,
          type: jobData.type as string,
          recipient: jobData.recipient as string,
          duration: duration,
          timestamp: new Date().toISOString()
        };
      } else {
        throw new Error(result.error || 'Notification delivery failed');
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.logger.error('💥 [NOTIFICATION-ERROR] خطأ في إرسال الإشعار', {
        type: jobData.type,
        recipient: jobData.recipient,
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : String(error)
      });
      
      throw error;
    }
  }

  /**
   * معالجة مهام تسليم الرسائل
   */
  private async processMessageDeliveryJob(jobData: Record<string, unknown>): Promise<Record<string, unknown>> {
    const startTime = Date.now();
    
    try {
      this.logger.info('📤 [MESSAGE-DELIVERY-PROCESS] بدء تسليم رسالة', {
        messageId: jobData.messageId,
        conversationId: jobData.conversationId,
        merchantId: jobData.merchantId,
        platform: jobData.platform
      });

      // 🔍 التحقق من صحة البيانات
      if (!jobData.messageId) {
        throw new Error('Message ID is missing');
      }
      
      if (!jobData.conversationId) {
        throw new Error('Conversation ID is missing');
      }
      
      if (!jobData.merchantId) {
        throw new Error('Merchant ID is missing');
      }
      
      if (!jobData.content) {
        throw new Error('Message content is missing');
      }

      let sendResult;
      const platform = (jobData.platform as string | undefined) || 'instagram';

      // 📤 إرسال الرسالة حسب المنصة
      switch (platform) {
        case 'instagram':
          sendResult = await this.messageSender.sendTextMessage(
            jobData.merchantId as string,
            jobData.customerId as string,
            jobData.content as string,
            jobData.conversationId as string
          );
          break;

        default:
          throw new Error(`Unsupported platform: ${platform}`);
      }

      const duration = Date.now() - startTime;

      // ✅ تحديث حالة الرسالة في قاعدة البيانات
      if (sendResult.success) {
        await this.repositories.message.markAsDelivered(
          String((jobData as { messageId?: unknown }).messageId ?? ''),
          sendResult.messageId
        );
        
        this.logger.info('✅ [MESSAGE-DELIVERY-PROCESS] تم تسليم الرسالة بنجاح', {
          messageId: jobData.messageId,
          platformMessageId: sendResult.messageId,
          duration: `${duration}ms`,
          delivered: true
        });
        
        return {
          processed: true,
          delivered: true,
          messageId: jobData.messageId as string,
          platformMessageId: sendResult.messageId,
          duration: duration,
          timestamp: new Date().toISOString()
        };
      } else {
        await this.repositories.message.markAsFailed(String((jobData as { messageId?: unknown }).messageId ?? ''));
        throw new Error(sendResult.error || 'Message delivery failed');
      }

    } catch (error) {
      const duration = Date.now() - startTime;
      
      // ❌ تحديث حالة الرسالة كفاشلة
      try {
        await this.repositories.message.markAsFailed(String((jobData as { messageId?: unknown }).messageId ?? ''));
      } catch {
        // ignore repository errors during failure marking
      }
      
      this.logger.error('💥 [MESSAGE-DELIVERY-ERROR] خطأ في تسليم الرسالة', {
        messageId: jobData.messageId,
        conversationId: jobData.conversationId,
        merchantId: jobData.merchantId,
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : String(error)
      });
      
      throw error;
    }
  }
}

export default ProductionQueueManager;