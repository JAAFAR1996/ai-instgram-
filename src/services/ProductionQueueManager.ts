import { Queue, Worker, QueueEvents } from 'bullmq';
import type { Job, RedisClient } from 'bullmq';
import { Redis, ReplyError } from 'ioredis';
import { Pool } from 'pg';
import { withWebhookTenantJob, withAITenantJob, withTenantJob } from '../isolation/context.js';
import { telemetry } from './telemetry.js';

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
    p.then(guardResolve(resolve, reject, () => clearTimeout(timer))).catch(guardReject(resolve, reject, () => clearTimeout(timer)));
  });
}
import { RedisUsageType, RedisEnvironment } from '../config/RedisConfigurationFactory.js';
import RedisConnectionManager from './RedisConnectionManager.js';
import * as crypto from 'node:crypto';
import { serr } from '../isolation/context.js';
import { performHealthCheck } from './RedisSimpleHealthCheck.js';
import { CircuitBreaker } from './CircuitBreaker.js';
import { withRetry } from '../utils/retry.js';

import { getInstagramWebhookHandler } from './instagram-webhook.js';
import { getConversationAIOrchestrator } from './conversation-ai-orchestrator.js';
import type { InstagramWebhookEvent, ProcessedWebhookResult, InstagramWebhookHandler } from './instagram-webhook.js';
import { getNotificationService } from './notification-service.js';
import { getRepositories } from '../repositories/index.js';
import { getInstagramClient } from './instagram-api.js';
import { getInstagramMessageSender } from './instagram-message-sender.js';
import { getEnv } from '../config/env.js';
import type { InstagramContext } from './instagram-ai.js';
import { getInstagramAIService } from './instagram-ai.js';

// removed unused type


export interface QueueJob {
  eventId: string;
  payload: unknown;
  merchantId: string;
  platform: 'INSTAGRAM' | 'WHATSAPP' | 'FACEBOOK';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  metadata?: Record<string, unknown>;
}

export interface ManyChatJob {
  eventId: string;
  merchantId: string;
  username: string;
  conversationId: string;
  incomingMessageId: string | null;
  messageText: string;
  imageData?: Array<{ url: string }>;
  sessionData: Record<string, unknown>;
  priority: 'urgent' | 'high' | 'normal';
  metadata: {
    processingStartTime: number;
    source: 'manychat';
    hasImages: boolean;
    originalPayload?: unknown;
  };
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

// Minimal logger signature used internally (varargs to allow flexible calls)
type Logger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
};

// ===== أنواع ومساعدات صغيرة آمنة =====
type U<T> = T | undefined;

// تحسين Type Safety - إضافة interfaces للـ Job
// removed JobWithAttempts (unused)

export class ProductionQueueManager {
  private connectionManager: RedisConnectionManager;
  private circuitBreaker: CircuitBreaker;
  private queue: Queue | null = null;
  private queueConnection: Redis | undefined = undefined;
  private workers: Record<string, Worker> = {};
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

  private webhookHandler: InstagramWebhookHandler | null = null;
  private aiOrchestrator = getConversationAIOrchestrator();
  private repositories = getRepositories();
  private messageSender = getInstagramMessageSender();

  constructor(
    private logger: Logger,
    environment: RedisEnvironment,
    private dbPool: Pool,
    private queueName: string = 'ai-sales-production'
  ) {
    this.connectionManager = new RedisConnectionManager(
      process.env.REDIS_URL ?? '',
      environment,
      logger
    );
    this.circuitBreaker = new CircuitBreaker(5, 60000);
  }

  async initialize(): Promise<QueueInitResult> {
    try {
      this.logger.info('🔄 بدء تهيئة مدير الطوابير الإنتاجي...');

      // 1. الحصول على اتصال Redis من connectionManager
      const connection = await this.connectionManager.getConnection(RedisUsageType.QUEUE_SYSTEM);
      
      this.logger.info('✅ تم الحصول على اتصال Redis للطوابير');

      // 2. إنشاء BullMQ Queue
      this.queueConnection = connection;
      
      this.queue = new Queue(this.queueName, {
        connection,
        defaultJobOptions: {
          removeOnComplete: { age: 86400, count: 200 },
          removeOnFail:    { age: 259200, count: 100 },
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 }
        }
      });

      // 3. تهيئة webhook handler
      this.webhookHandler = await getInstagramWebhookHandler();
      this.logger.info('✅ تم تهيئة webhook handler');

      // 4. إعداد معالجات الأحداث والمهام
      this.logger.info('🔧 بدء إعداد معالجات الأحداث والمهام...');
      await this.setupEventHandlers();
      this.logger.info('📡 تم إعداد معالجات الأحداث');
      await this.setupJobProcessors(connection);
      this.logger.info('⚙️ تم إعداد معالجات المهام');

      // 4. تنظيف أولي وبدء المراقبة
      await this.performInitialCleanup();
      this.startQueueMonitoring();

      // 5. بدء مراقبة Workers
      this.startWorkerHealthMonitoring();

      this.logger.info('✅ تم تهيئة مدير الطوابير الإنتاجي بنجاح', {
        queueName: this.queueName,
        totalConnections: 1,
        workersReady: true
      });

      return {
        success: true,
        queue: this.queue,
        connectionInfo: {
          connected: true,
          responseTime: 0,
          metrics: {}
        },
        diagnostics: {
          redisConnection: connection,
          queueHealth: {
            connected: true,
            responseTime: 0,
            metrics: {}
          },
          circuitBreaker: this.circuitBreaker.getStats()
        }
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      this.logger.error('💥 فشل في تهيئة مدير الطوابير', {
        error: errorMessage,
        context: { operation: 'QueueManager.initialize', queueName: this.queueName }
      });

      return {
        success: false,
        queue: null,
        error: errorMessage,
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
      
      // 📊 DLQ metrics: Record failed job
      telemetry.counter('queue_dlq_jobs_total', 'Jobs moved to Dead Letter Queue').add(1);
      telemetry.gauge('queue_dlq_current_count', 'Current DLQ job count').record(this.failedJobs);
      
      // 🚨 Error type classification for DLQ
      const errorType = failedReason && typeof failedReason === 'string' 
        ? failedReason.includes('timeout') ? 'timeout'
          : failedReason.includes('network') ? 'network' 
          : failedReason.includes('database') ? 'database'
          : failedReason.includes('AI') || failedReason.includes('OpenAI') ? 'ai_service'
          : 'unknown'
        : 'unknown';
      
      telemetry.counter('queue_dlq_by_error_type_total', 'DLQ jobs by error type').add(1, {
        error_type: errorType,
        queue: this.queueName
      });
      
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
            attempt: 1, // BullMQ handles attempts internally
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
            priority: 'normal',
            metadata: { addedAt: Date.now(), source: 'webhook' }
          });
          
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
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          this.logger.error(`❌ ${webhookWorkerId} - فشل في معالجة الويب هوك`, { 
            webhookWorkerId,
            eventId, 
            merchantId, 
            platform,
            jobId: job.id,
            duration: `${duration}ms`,
            error: errorMessage,
            attempt: 1, // BullMQ handles attempts internally
            maxAttempts: 3
          });
          
          // تحويل الخطأ إلى Error object إذا لم يكن كذلك
          const processedError = error instanceof Error ? error : new Error(errorMessage);
          throw processedError;
        }
      });
    }
    );
    const webhookWorker = new Worker(
      this.queueName,
      async (job: Job) => {
        if (job.name !== 'process-webhook') return;
        const adapted = { id: String(job.id), name: job.name, data: job.data, moveToFailed: async (err: Error, _retry: boolean) => {
          const fn = job.moveToFailed as unknown as (e: Error, token: string) => Promise<void>;
          await fn(err, 'token');
        } };
        return webhookProcessor(adapted);
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
            messageLength: (message as string).length ?? 0,
            attempt: 1 // BullMQ handles attempts internally
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
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          this.logger.error(`❌ ${aiWorkerId} - فشل في معالجة استجابة الذكاء الاصطناعي`, { 
            aiWorkerId,
            conversationId, 
            merchantId,
            duration: `${duration}ms`,
            error: errorMessage,
            attempt: 1, // BullMQ handles attempts internally
            maxAttempts: 3,
            jobId: job.id
          });
          
          // تحويل الخطأ إلى Error object إذا لم يكن كذلك
          const processedError = error instanceof Error ? error : new Error(errorMessage);
          throw processedError;
        }
      });
    }
    );
    const aiWorker = new Worker(
      this.queueName,
      async (job: Job) => {
        if (job.name !== 'ai-response') return;
        const adapted = { id: String(job.id), name: job.name, data: job.data, moveToFailed: async (err: Error, _retry: boolean) => {
          const fn = job.moveToFailed as unknown as (e: Error, token: string) => Promise<void>;
          await fn(err, 'token');
        } };
        return aiProcessor(adapted);
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
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.error('فشل في تنظيف الطابور', { 
            type, 
            error: errorMessage
          });
          const processedError = error instanceof Error ? error : new Error(errorMessage);
          throw processedError;
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

    // 💬 معالج ManyChat المتقدم - العمليات الثقيلة
    this.logger.info('🔧 [DEBUG] تسجيل معالج manychat-processing...');
    
    // Use generic tenant wrapper; ManyChatJob has its own shape
    const manyChatProcessor = withTenantJob(
      this.dbPool,
      this.logger,
      async (job, _data, _client) => {
        this.logger.info('💬 [MANYCHAT-WORKER-START] معالج ManyChat استقبل job!', { 
          jobId: job.id, 
          jobName: job.name,
          merchantId: (typeof ((job.data as Record<string, unknown>)?.merchantId) === "string" ? (job.data as Record<string, unknown>).merchantId as string : undefined),
          username: (typeof ((job.data as Record<string, unknown>)?.username) === "string" ? (job.data as Record<string, unknown>).username as string : undefined) 
        });
        
        clearTimeout(workerInitTimeout);
        
        const manyChatWorkerId = `manychat-worker-${crypto.randomUUID().slice(0, 8)}`;
        const startTime = Date.now();
        const manyChatData = job.data as unknown as ManyChatJob;
      
        return await this.circuitBreaker.execute(async () => {
          try {
            this.logger.info(`💬 ${manyChatWorkerId} - بدء معالجة ManyChat متقدمة`, {
              manyChatWorkerId,
              eventId: manyChatData.eventId,
              merchantId: manyChatData.merchantId,
              username: manyChatData.username,
              conversationId: manyChatData.conversationId,
              hasImages: manyChatData.metadata.hasImages,
              messageLength: manyChatData.messageText.length,
              jobId: job.id,
              processingDelay: startTime - manyChatData.metadata.processingStartTime
            });

            const result = await this.processManyChatJob(manyChatData);
            
            const duration = Date.now() - startTime;
            this.logger.info(`✅ ${manyChatWorkerId} - ManyChat معُولج بنجاح`, {
              manyChatWorkerId,
              eventId: manyChatData.eventId,
              duration: `${duration}ms`,
              totalDuration: `${Date.now() - manyChatData.metadata.processingStartTime}ms`,
              aiResponse: result.aiResponse?.slice(0, 100) + '...',
              stage: result.stage,
              intent: result.intent,
              confidence: result.confidence
            });
            
            return { 
              processed: true, 
              manyChatWorkerId,
              eventId: manyChatData.eventId,
              result,
              processingTime: duration,
              totalTime: Date.now() - manyChatData.metadata.processingStartTime
            };
            
          } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            this.logger.error(`❌ ${manyChatWorkerId} - فشل في معالجة ManyChat`, { 
              manyChatWorkerId,
              eventId: manyChatData.eventId,
              merchantId: manyChatData.merchantId,
              username: manyChatData.username,
              conversationId: manyChatData.conversationId,
              duration: `${duration}ms`,
              error: errorMessage,
              jobId: job.id,
              stack: error instanceof Error ? error.stack?.substring(0, 500) : undefined
            });
            
            const processedError = error instanceof Error ? error : new Error(errorMessage);
            throw processedError;
          }
        });
      }
    );
    
    const manyChatWorker = new Worker(
      this.queueName,
      async (job: Job) => {
        if (job.name !== 'manychat-processing') return;
        const adapted = { id: String(job.id), name: job.name, data: job.data, moveToFailed: async (err: Error, _retry: boolean) => {
          const fn = job.moveToFailed as unknown as (e: Error, token: string) => Promise<void>;
          await fn(err, 'token');
        } };
        return manyChatProcessor(adapted);
      },
      { connection, concurrency: 4 } // 4 concurrent ManyChat jobs
    );
    this.workers['manychat-processing'] = manyChatWorker;

    // تأكيد إنجاز تسجيل جميع المعالجات
    this.logger.info('🎯 [SUCCESS] تم تسجيل جميع معالجات الطوابير بنجاح!', {
      processors: ['process-webhook', 'ai-response', 'cleanup', 'notification', 'message-delivery', 'manychat-processing'],
      concurrency: { webhook: 5, ai: 3, cleanup: 1, notification: 2, messageDelivery: 3, manyChat: 4 },
      total: 18
    });
    
    // 🔍 تحقق فوري من أن القائمة يمكنها إرسال إشعارات عند تفعيل الاختبارات صراحة
    if (
      getEnv('NODE_ENV') !== 'production' &&
      getEnv('ENABLE_QUEUE_TESTS') === 'true'
    ) {
      setTimeout(async () => {
        try {
          this.logger.info('🔍 [BULL-TEST] اختبار إضافة job تجريبي فوري...');
          if (!this.queue) {
            this.logger.warn('Queue not initialized for test job');
            return;
          }
          const testJob = await this.queue.add('test-notification', { test: true }, {
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
              const jobDelay = delayedJob.opts?.delay ?? 0;
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
                jobState: job.opts?.delay ? 'delayed' : 'waiting'
              });
              
              // 🔍 فحص Job data integrity أولاً
              if (!job.data) {
                this.logger.error('❌ [MANUAL-PROCESSING] Job data مفقود!', { jobId: job.id });
                await job.remove();
                this.failedJobs++;
                continue;
              }
              
              // 🔍 فحص إذا كان Job delayed بدلاً من waiting
              if (job.opts?.delay && job.opts.delay > 0) {
                this.logger.warn('⏰ [MANUAL-PROCESSING] Job delayed - تخطي', { 
                  jobId: job.id, 
                  delay: job.opts?.delay 
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
          (error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()).includes('max requests limit exceeded')
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
          this.logger.error('❌ [MANUAL-POLLING] خطأ في التحقق اليدوي', {
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
    priority: 'low' | 'normal' | 'high' | 'urgent' = 'normal'
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

        const qRef = this.queue;
        if (!qRef) { return { success: false, error: 'Ù…Ø¯ÙŠØ± Ø§Ù„Ø·ÙˆØ§Ø¨ÙŠØ± ØºÙŠØ± Ù…Ù‡ÙŠØ£' }; }
        const job = await withRetry(
          () => qRef.add('process-webhook', jobData, {
            priority: priorityValue,
            delay: 0, // إزالة أي تأخير
            removeOnComplete: priority === 'urgent' ? 200 : 100,
            removeOnFail: priority === 'urgent' ? 100 : 50,
            attempts: priority === 'urgent' ? 5 : 3
          }),
          'queue_add_process_webhook',
          { logger: this.logger, payload: { eventId, merchantId, platform } }
        );

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
    priority: 'low' | 'normal' | 'high' | 'urgent' = 'high'
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

        const qRef = this.queue;
        if (!qRef) { return { success: false, error: 'Ù…Ø¯ÙŠØ± Ø§Ù„Ø·ÙˆØ§Ø¨ÙŠØ± ØºÙŠØ± Ù…Ù‡ÙŠØ£' }; }
        const job = await withRetry(
          () => qRef.add('ai-response', jobData, {
            priority: this.getPriorityValue(priority),
            delay: 0,
            attempts: 2
          }),
          'queue_add_ai_response',
          { logger: this.logger, payload: { conversationId, merchantId, platform } }
        );

      return { success: true, jobId: String(job.id ?? '') };

    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async addManyChatJob(
    eventId: string,
    merchantId: string,
    username: string,
    conversationId: string,
    incomingMessageId: string | null,
    messageText: string,
    imageData: Array<{ url: string }> | undefined,
    sessionData: Record<string, unknown>,
    priority: 'urgent' | 'high' | 'normal' = 'high'
  ): Promise<JobResult> {
    if (!this.queue) {
      return { 
        success: false, 
        error: 'مدير الطوابير غير مهيأ' 
      };
    }

    try {
      const jobData: ManyChatJob = {
        eventId,
        merchantId,
        username,
        conversationId,
        incomingMessageId,
        messageText,
        imageData,
        sessionData,
        priority,
        metadata: {
          processingStartTime: Date.now(),
          source: 'manychat',
          hasImages: !!(imageData && imageData.length > 0)
        }
      };

      const priorityValue = this.getPriorityValue(priority);
      
      this.logger.info('📤 [ADD-MANYCHAT-JOB] إضافة ManyChat job إلى الطابور...', {
        jobName: 'manychat-processing',
        eventId,
        merchantId,
        username,
        conversationId,
        priority,
        hasImages: jobData.metadata.hasImages,
        messageLength: messageText.length
      });

      // 📊 Queue Metrics: Record job enqueue
      telemetry.recordQueueOperation(this.queueName, 'add', 1);

      const qRef = this.queue;
      if (!qRef) { return { success: false, error: 'Ù…Ø¯ÙŠØ± Ø§Ù„Ø·ÙˆØ§Ø¨ÙŠØ± ØºÙŠØ± Ù…Ù‡ÙŠØ£' }; }
      const job = await withRetry(
        () => qRef.add('manychat-processing', jobData, {
          priority: priorityValue,
          delay: 0,
          removeOnComplete: priority === 'urgent' ? 200 : 100,
          removeOnFail: priority === 'urgent' ? 100 : 50,
          attempts: priority === 'urgent' ? 3 : 2,
          backoff: { type: 'exponential', delay: 2000 }
        }),
        'queue_add_manychat',
        { logger: this.logger, payload: { eventId, merchantId, username } }
      );

      this.logger.info('✅ [ADD-MANYCHAT-JOB] تم إضافة ManyChat job بنجاح', {
        jobId: job.id,
        jobName: job.name,
        eventId,
        username
      });

      // الحصول على موقع المهمة في الطابور
      const waiting = await this.queue.getWaiting();
      const queuePosition = waiting.findIndex(j => String(j.id ?? '') === String(job.id ?? '')) + 1;

      this.logger.info('تم إضافة مهمة ManyChat للطابور', {
        jobId: job.id,
        eventId,
        merchantId,
        username,
        priority,
        queuePosition
      });

      return { 
        success: true, 
        jobId: String(job.id ?? ''),
        queuePosition
      };

    } catch (error) {
      this.logger.error('فشل في إضافة مهمة ManyChat للطابور', { 
        eventId,
        merchantId,
        username,
        error: error instanceof Error ? error.message : String(error)
      });
      
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
      if (!this.webhookHandler) {
        throw new Error('Webhook handler not initialized');
      }
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
        messageLength: (jobData.message as string)?.length ?? 0,
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
        JSON.parse(JSON.stringify(conversation)) as Record<string, unknown>,
        JSON.parse(JSON.stringify(merchant)) as Record<string, unknown>,
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
        platformMessageId: `${'ai_generated_' + Date.now()}`,
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

      return result as Record<string, unknown>;

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
      case 'urgent': return 1;
      case 'high': return 2;
      case 'normal': return 3;
      case 'low': return 4;
      default: return 3;
    }
  }

  private startQueueMonitoring(): void {
    // مراقبة كل 30 ثانية
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.performQueueHealthCheck();
        
        // 📊 Export queue metrics for monitoring
        const stats = await this.getQueueStats();
        telemetry.gauge('queue_monitoring_total_jobs', 'Total jobs in queue').record(stats.total);
        telemetry.gauge('queue_monitoring_waiting_jobs', 'Jobs waiting in queue').record(stats.waiting);
        telemetry.gauge('queue_monitoring_active_jobs', 'Jobs currently processing').record(stats.active);
        telemetry.gauge('queue_monitoring_failed_jobs', 'Failed jobs count').record(stats.failed);
        telemetry.gauge('queue_monitoring_completed_jobs', 'Completed jobs count').record(stats.completed);
        telemetry.gauge('queue_monitoring_delayed_jobs', 'Delayed jobs count').record(stats.delayed);
        telemetry.gauge('queue_monitoring_error_rate', 'Queue error rate percentage').record(stats.errorRate);
        
      } catch (error) {
        this.logger.error('Queue monitoring error', { error });
        telemetry.counter('queue_monitoring_errors_total', 'Queue monitoring errors').add(1);
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
        // 📊 Record stalled queue metric
        telemetry.counter('queue_stalled_detection_total', 'Queue stalled (jobs waiting but no active processing)').add(1);
        
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
          // 🚨 Critical queue failure metric
          telemetry.counter('queue_critical_failure_total', 'Critical queue failure requiring restart').add(1, {
            waiting_jobs: String(stats.waiting),
            active_jobs: String(stats.active),
            time_since_last_process: String(this.lastProcessedAt ? now - this.lastProcessedAt.getTime() : 'never')
          });
          
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
          // 📊 Record stalled jobs metric
          telemetry.counter('queue_stalled_jobs_total', 'Jobs stalled for too long').add(stalledJobs.length);
          telemetry.gauge('queue_stalled_jobs_current', 'Currently stalled jobs').record(stalledJobs.length);
          
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
    redisHealth: { connected: boolean; responseTime: number; metrics: Record<string, unknown> } | null;
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
          responseTime: healthResult.latency ?? 0,
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

        if (this.queue) {
          await this.queue.close();
          this.queue = null;
        }

        this.logger.info('✅ تم إغلاق الطابور بأمان');

      } catch (error) {
        this.logger.warn({ err: error }, 'فشل في الانتظار لإكمال المهام، إغلاق قسري');
        if (this.queue) {
          await this.queue.close();
          this.queue = null;
        }
      }
    }

    // إغلاق اتصالات Redis
    await this.connectionManager.closeAllConnections();

    this.logger.info('✅ تم إغلاق مدير الطوابير بأمان');
  }

  private async waitForActiveJobs(): Promise<void> {
    if (!this.queue) return;

    const q = this.queue;
    if (!q) return;
    let activeJobs = await q.getActive();
    
    while (activeJobs.length > 0) {
      this.logger.info(`انتظار إكمال ${activeJobs.length} مهام جارية...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      activeJobs = await q.getActive();
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
      cart: Array.isArray((conversation.sessionData as { cart?: unknown[] } | undefined)?.cart)
        ? ((conversation.sessionData as { cart?: unknown[] }).cart as unknown[])
        : [],
      preferences: ((): Record<string, unknown> => {
        const pref = (conversation.sessionData as { preferences?: unknown } | undefined)?.preferences;
        return pref && typeof pref === 'object' ? (pref as Record<string, unknown>) : {};
      })(),
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
        workingHours: ((): Record<string, unknown> => {
          const s = (merchant.settings as { workingHours?: unknown } | undefined)?.workingHours;
          return s && typeof s === 'object' ? (s as Record<string, unknown>) : {};
        })(),
        paymentMethods: Array.isArray((merchant.settings as { paymentMethods?: unknown[] } | undefined)?.paymentMethods)
          ? ((merchant.settings as { paymentMethods?: unknown[] }).paymentMethods as string[])
          : [],
        deliveryFees: ((): Record<string, unknown> => {
          const s = (merchant.settings as { deliveryFees?: unknown } | undefined)?.deliveryFees;
          return s && typeof s === 'object' ? (s as Record<string, unknown>) : {};
        })(),
        autoResponses: ((): Record<string, unknown> => {
          const s = (merchant.settings as { autoResponses?: unknown } | undefined)?.autoResponses;
          return s && typeof s === 'object' ? (s as Record<string, unknown>) : {};
        })()
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
      const instagramClient = await getInstagramClient(jobData.merchantId as string);
      const credentials = await instagramClient.loadMerchantCredentials(jobData.merchantId as string);
      if (!credentials) {
        throw new Error('Instagram credentials not found');
      }
      // DISABLED: Instagram Direct API validation removed - using ManyChat Bridge only
      // await instagramClient.validateCredentials(credentials, String((jobData as { merchantId?: unknown }).merchantId ?? ''));

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
        content: ((
          (jobData as { data?: unknown }).data ?? (jobData as { payload?: unknown }).payload ?? { message: 'Notification' }
        ) as unknown as Record<string, unknown>)
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
   * معالجة مهام ManyChat المتقدمة
   */
  private async processManyChatJob(jobData: ManyChatJob): Promise<{
    success: boolean;
    aiResponse?: string;
    intent?: string;
    confidence?: number;
    stage?: string;
    sessionPatch?: Record<string, unknown>;
    processingTime: number;
    error?: string;
    qualityScore?: number;
    qualityImproved?: boolean;
    usedCache?: boolean;
    decisionPath?: string[];
  }> {
    const startTime = Date.now();
    
    try {
      // 📊 Queue metrics: Record processing start
      telemetry.recordQueueOperation(this.queueName, 'process', 1);
      
      // 📈 Queue depth gauge
      const queueStats = await this.getQueueStats();
      telemetry.gauge('queue_depth', 'Current queue depth').record(queueStats.waiting + queueStats.active);
      telemetry.gauge('queue_active_jobs', 'Active jobs count').record(queueStats.active);
      telemetry.gauge('queue_waiting_jobs', 'Waiting jobs count').record(queueStats.waiting);
      telemetry.gauge('queue_error_rate_percent', 'Queue error rate percentage').record(queueStats.errorRate);
      
      this.logger.info('📬 [MANYCHAT-PROCESS] بدء معالجة ManyChat job متقدمة', {
        eventId: jobData.eventId,
        merchantId: jobData.merchantId,
        username: jobData.username,
        conversationId: jobData.conversationId,
        messageLength: jobData.messageText.length,
        hasImages: jobData.metadata.hasImages,
        sessionKeys: Object.keys(jobData.sessionData || {}),
        queueDelay: startTime - jobData.metadata.processingStartTime
      });

      // 🔍 التحقق من صحة البيانات
      if (!jobData.merchantId || !jobData.username || !jobData.conversationId) {
        throw new Error('Missing required ManyChat job data: merchantId, username, or conversationId');
      }
      
      // 🚀 المعالجة الشاملة للAI + Analytics + Constitutional AI
      const result = await this.executeFullManyChatPipeline(jobData);

      const totalDuration = Date.now() - startTime;
      
      // 📊 Record successful processing metrics
      telemetry.recordQueueOperation(this.queueName, 'completed', 1);
      telemetry.histogram('queue_processing_duration_ms', 'Job processing time in milliseconds', 'ms').record(totalDuration, {
        job_type: 'manychat',
        merchant_id: jobData.merchantId,
        success: 'true',
        has_images: String(jobData.metadata.hasImages),
        cached: String(result.usedCache ?? false)
      });
      
      // 🎯 Business metrics
      if (result.intent) {
        telemetry.counter('manychat_intent_classified_total', 'ManyChat intents classified').add(1, {
          intent: result.intent,
          merchant_id: jobData.merchantId
        });
      }
      
      if (result.confidence && result.confidence >= 0.8) {
        telemetry.counter('manychat_high_confidence_responses_total', 'High confidence AI responses').add(1, {
          merchant_id: jobData.merchantId
        });
      }
      
      this.logger.info('✅ [MANYCHAT-PROCESS] تمت معالجة ManyChat بنجاح شاملة', {
        eventId: jobData.eventId,
        merchantId: jobData.merchantId,
        username: jobData.username,
        conversationId: jobData.conversationId,
        duration: `${totalDuration}ms`,
        totalTime: `${Date.now() - jobData.metadata.processingStartTime}ms`,
        aiResponse: result.aiResponse?.slice(0, 120) + '...',
        intent: result.intent,
        confidence: result.confidence,
        stage: result.stage,
        qualityScore: result.qualityScore,
        qualityImproved: result.qualityImproved,
        usedCache: result.usedCache,
        decisionPathCount: result.decisionPath?.length ?? 0
      });

      return {
        ...result,
        success: true,
        processingTime: totalDuration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // 📊 Record failed processing metrics
      telemetry.recordQueueOperation(this.queueName, 'failed', 1);
      telemetry.histogram('queue_processing_duration_ms', 'Job processing time in milliseconds', 'ms').record(duration, {
        job_type: 'manychat',
        merchant_id: jobData.merchantId,
        success: 'false',
        has_images: String(jobData.metadata.hasImages),
        error_type: error instanceof Error ? error.constructor.name : 'Unknown'
      });
      
      // 🚨 Error classification counter
      telemetry.counter('manychat_processing_errors_total', 'ManyChat processing errors').add(1, {
        error_type: error instanceof Error ? error.constructor.name : 'Unknown',
        merchant_id: jobData.merchantId,
        has_message: String(Boolean(jobData.messageText)),
        has_images: String(jobData.metadata.hasImages)
      });
      
      this.logger.error('💥 [MANYCHAT-ERROR] خطأ في معالجة ManyChat', {
        eventId: jobData.eventId,
        merchantId: jobData.merchantId,
        username: jobData.username,
        conversationId: jobData.conversationId,
        duration: `${duration}ms`,
        error: errorMessage,
        stack: error instanceof Error ? error.stack?.substring(0, 500) : undefined
      });
      
      return {
        success: false,
        processingTime: duration,
        error: errorMessage
      };
    }
  }

  /**
   * تنفيذ pipeline شامل للمعالجة المتقدمة
   */
  private async executeFullManyChatPipeline(jobData: ManyChatJob): Promise<{
    aiResponse?: string;
    intent?: string;
    confidence?: number;
    stage?: string;
    sessionPatch?: Record<string, unknown>;
    qualityScore?: number;
    qualityImproved?: boolean;
    usedCache?: boolean;
    decisionPath?: string[];
  }> {
    let aiResponse: string = '';
    let aiIntent: string | undefined;
    let aiConfidence: number | undefined;
    let decisionPath: string[] = [];
    let stage: 'AWARE' | 'BROWSE' | 'INTENT' | 'OBJECTION' | 'CLOSE' | undefined;
    let sessionPatch: Record<string, unknown> | undefined;
    let qualityScore: number | undefined;
    let qualityImproved: boolean | undefined;
    let usedCache = false;

    // 1. محاولة Cache أولاً للرسائل القصيرة
    try {
      const isShortText = jobData.messageText && jobData.messageText.length <= 64 && !jobData.metadata.hasImages;
      if (isShortText) {
        const { SmartCache } = await import('../services/smart-cache.js');
        const sc = new SmartCache();
        const cached = await sc.getCommonReply(jobData.merchantId, jobData.messageText);
        if (cached?.text && (cached as { intent?: string }).intent && !['OTHER','SMALL_TALK'].includes(String((cached as { intent?: string }).intent).toUpperCase())) {
          aiResponse = cached.text;
          aiIntent = 'CACHED_COMMON';
          aiConfidence = 0.9;
          decisionPath = ['cache=hit'];
          usedCache = true;
          this.logger.info('🎯 [CACHE-HIT] استخدم رد محفوظ', { merchantId: jobData.merchantId, intent: (cached as { intent?: string }).intent });
        }
      }
    } catch (cacheErr) {
      this.logger.debug('Cache lookup failed, proceeding with AI', { error: String(cacheErr) });
    }

    // 2. معالجة AI إذا لم نستخدم Cache
    if (!usedCache) {
      try {
        if (jobData.metadata.hasImages && jobData.imageData?.length) {
          // 🖼️ ENHANCED: Comprehensive image analysis + AI response
          decisionPath.push('image=enhanced_analysis');
          
          try {
            // Import the new Image Analysis Service
            const { default: ImageAnalysisService } = await import('../services/image-analysis.js');
            const imageAnalyzer = new ImageAnalysisService();
            
            // Process each image with comprehensive analysis
            const imageAnalysisResults = [];
            for (const imageInfo of jobData.imageData) {
              try {
                // Download image for analysis
                const imageResponse = await fetch(imageInfo.url);
                if (!imageResponse.ok) continue;
                
                const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
                const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
                
                // Prepare metadata
                const imageMetadata = {
                  messageId: jobData.incomingMessageId || 'temp-' + Date.now(),
                  merchantId: jobData.merchantId,
                  customerId: jobData.username,
                  mimeType: contentType,
                  width: 0, // Will be extracted by the service if needed
                  height: 0,
                  sizeBytes: imageBuffer.length,
                  contentHash: '',
                  url: imageInfo.url
                };
                
                // Perform comprehensive analysis
                const analysisResult = await imageAnalyzer.analyzeImage(imageBuffer, imageMetadata, {
                  enableOCR: true,
                  enableVisualSearch: true,
                  enableProductMatching: true
                });
                
                imageAnalysisResults.push({
                  url: imageInfo.url,
                  analysis: analysisResult
                });
                
                telemetry.counter('manychat_image_analysis_total', 'ManyChat images analyzed').add(1, {
                  merchant_id: jobData.merchantId,
                  content_type: analysisResult.contentType.category,
                  has_ocr: String(Boolean(analysisResult.ocrText)),
                  product_matches: String(analysisResult.productMatches?.length ?? 0)
                });
                
              } catch (imageError) {
                this.logger.warn('Individual image analysis failed', {
                  url: imageInfo.url,
                  error: String(imageError)
                });
              }
            }
            
            // Combine analysis results for AI processing
            const combinedOCRText = imageAnalysisResults
              .map(r => r.analysis.ocrText)
              .filter(Boolean)
              .join(' ');
            
            const combinedLabels = imageAnalysisResults
              .flatMap(r => r.analysis.labels)
              .map(l => l.name)
              .join(', ');
            
            const productMatches = imageAnalysisResults
              .flatMap(r => r.analysis.productMatches || []);
              
            // Enhanced context for AI response
            const enhancedMessage = [
              jobData.messageText,
              combinedOCRText && `OCR النص المستخرج: ${combinedOCRText}`,
              combinedLabels && `وصف الصورة: ${combinedLabels}`,
              productMatches.length > 0 && `منتجات مطابقة: ${productMatches.map(p => p.name).join(', ')}`
            ].filter(Boolean).join('\n\n');
            
            // Use Instagram AI with enhanced context
            const ig = getInstagramAIService();
            const igCtx: import('../services/instagram-ai.js').InstagramContext = {
              merchantId: jobData.merchantId,
              customerId: jobData.username,
              platform: 'instagram',
              stage: 'BROWSING',
              cart: [],
              preferences: {},
              conversationHistory: [],
              interactionType: 'dm',
              imageData: jobData.imageData,
              // Enhanced with analysis results
              imageAnalysis: imageAnalysisResults.map(r => r.analysis)
            };
            
            const igResp = await ig.generateInstagramResponse(enhancedMessage, igCtx);
            aiResponse = igResp.messageAr || igResp.message || 'تم تحليل الصورة بنجاح.';
            aiIntent = igResp.intent || 'IMAGE_INQUIRY';
            aiConfidence = Math.max(igResp.confidence ?? 0.7, 
              imageAnalysisResults.reduce((acc, r) => acc + r.analysis.confidence, 0) / imageAnalysisResults.length);
            decisionPath.push(`image_analysis=${imageAnalysisResults.length}`, 
              `ocr=${Boolean(combinedOCRText)}`, 
              `products=${productMatches.length}`);
            {
              const s = String((igResp as any).stage);
              if (s === 'AWARE' || s === 'BROWSE' || s === 'INTENT' || s === 'OBJECTION' || s === 'CLOSE') {
                stage = s as typeof stage;
              }
            }
            
            // Store enhanced analysis for future reference
            sessionPatch = {
              ...sessionPatch,
              lastImageAnalysis: {
                timestamp: new Date().toISOString(),
                results: imageAnalysisResults.length,
                ocrText: combinedOCRText,
                productMatches: productMatches.length
              }
            };
            
          } catch (analysisError) {
            // Fallback to original Instagram AI processing
            this.logger.warn('Enhanced image analysis failed, falling back to basic processing', {
              error: String(analysisError),
              merchantId: jobData.merchantId
            });
            
            const ig = getInstagramAIService();
            const igCtx: import('../services/instagram-ai.js').InstagramContext = {
              merchantId: jobData.merchantId,
              customerId: jobData.username,
              platform: 'instagram',
              stage: 'BROWSING',
              cart: [],
              preferences: {},
              conversationHistory: [],
              interactionType: 'dm',
              imageData: jobData.imageData
            };
            const igResp = await ig.generateInstagramResponse(jobData.messageText, igCtx);
            aiResponse = igResp.messageAr || igResp.message || 'تم معالجة الصورة.';
            aiIntent = igResp.intent || 'IMAGE_INQUIRY';
            aiConfidence = igResp.confidence ?? 0.7;
            decisionPath.push('vision=fallback');
            {
              const s = String((igResp as any).stage);
              if (s === 'AWARE' || s === 'BROWSE' || s === 'INTENT' || s === 'OBJECTION' || s === 'CLOSE') {
                stage = s as typeof stage;
              }
            }
          }
        } else {
          // معالجة النص بـ Orchestrator
          const { orchestrate } = await import('../services/smart-orchestrator.js');
          const orchResult = await Promise.race([
            orchestrate(jobData.merchantId, jobData.username, jobData.messageText, { 
              askAtMostOneFollowup: true, 
              session: jobData.sessionData, 
              showThinking: true 
            }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('AI orchestration timeout')), 25000))
          ]);
          aiResponse = orchResult.text;
          aiIntent = orchResult.intent;
          aiConfidence = orchResult.confidence;
          decisionPath = orchResult.decision_path || [];
          sessionPatch = orchResult.session_patch ?? undefined;
          stage = orchResult.stage;
        }
      } catch (aiErr) {
        this.logger.error('AI processing failed in ManyChat pipeline', { error: String(aiErr) });
        aiResponse = 'عذراً، حدث خطأ في المعالجة. يرجى المحاولة مرة أخرى.';
        aiIntent = 'ERROR_FALLBACK';
        aiConfidence = 0.1;
        decisionPath = ['ai=error'];
      }
    }

    // 3. تحسين الجودة بـ Constitutional AI
    if (aiResponse && !usedCache) {
      try {
        const ConstitutionalAI = (await import('../services/constitutional-ai.js')).default;
        const consAI = new ConstitutionalAI();
        const ctxObj: import('../types/constitutional-ai.js').ResponseContext = {
          merchantId: jobData.merchantId,
          username: jobData.username,
        };
        if (aiIntent) ctxObj.intent = aiIntent;
        if (stage) ctxObj.stage = stage;
        if (jobData.sessionData) ctxObj.session = jobData.sessionData;
        
        const critique = await consAI.critiqueResponse(aiResponse, ctxObj);
        if (!critique.meetsThreshold) {
          const improveCtx = { ...ctxObj };
          const { improved, record } = await consAI.improveResponse(aiResponse, critique, improveCtx);
          qualityImproved = true;
          qualityScore = record.newScore;
          aiResponse = improved;
          this.logger.info('🔧 [QUALITY] تحسين Constitutional AI', { 
            prevScore: record.prevScore, 
            newScore: record.newScore 
          });
        } else {
          qualityScore = critique.score;
        }
      } catch (qualityErr) {
        this.logger.warn('Constitutional AI improvement failed', { error: String(qualityErr) });
      }
    }

    // 4. تخصيص الاستجابة
    if (aiResponse && !usedCache) {
      try {
        const { CustomerProfiler } = await import('../services/customer-profiler.js');
        const { ResponsePersonalizer } = await import('../services/response-personalizer.js');
        const profiler = new CustomerProfiler();
        const profile = await profiler.personalizeResponses(jobData.merchantId, jobData.username);
        const personalizer = new ResponsePersonalizer();
        const personalized = await personalizer.personalizeResponses(aiResponse, {
          merchantId: jobData.merchantId,
          customerId: jobData.username,
          tier: profile.tier,
          preferences: {
            categories: profile.preferences.categories,
            colors: profile.preferences.colors,
            sizes: profile.preferences.sizes,
            brands: profile.preferences.brands,
            priceSensitivity: profile.preferences.priceSensitivity,
          },
          queryHint: jobData.messageText.slice(0, 80)
        });
        aiResponse = personalized.text;
      } catch (personalizeErr) {
        this.logger.debug('Response personalization skipped', { error: String(personalizeErr) });
      }
    }

    // 5. حفظ الاستجابة كرسالة صادرة
    try {
      const outgoingMessage = await this.repositories.message.create({
        conversationId: jobData.conversationId,
        direction: 'OUTGOING',
        platform: 'instagram',
        messageType: 'TEXT',
        content: aiResponse,
        platformMessageId: `ai_generated_${Date.now()}`,
        aiProcessed: true,
        deliveryStatus: 'PENDING',
        aiConfidence: aiConfidence,
        aiIntent: aiIntent,
        processingTimeMs: Date.now() - jobData.metadata.processingStartTime
      });

      // تحديث stage المحادثة
      if (stage) {
        await this.repositories.conversation.update(jobData.conversationId, {
          conversationStage: stage
        });
      }

      this.logger.info('💾 [MESSAGE-SAVED] تم حفظ رسالة صادرة', { 
        messageId: outgoingMessage.id, 
        conversationId: jobData.conversationId 
      });
    } catch (saveErr) {
      this.logger.warn('Failed to save outgoing message', { error: String(saveErr) });
    }

    // 6. تشغيل Analytics في الخلفية (best-effort)
    try {
      const { PredictiveAnalyticsEngine } = await import('../services/predictive-analytics.js');
      const predictiveEngine = new PredictiveAnalyticsEngine();
      // تشغيل غير متزامن
          predictiveEngine.predictSizeIssues(jobData.merchantId, jobData.username).catch((e) => { console.error('[hardening:no-silent-catch]', e); throw e instanceof Error ? e : new Error(String(e)); });
    } catch {}

    return {
      aiResponse,
      intent: aiIntent,
      confidence: aiConfidence,
      stage,
      sessionPatch,
      qualityScore,
      qualityImproved,
      usedCache,
      decisionPath
    };
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
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        this.logger.warn({ err }, "Failed to mark message as failed in repository");
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
