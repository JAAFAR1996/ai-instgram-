import Bull from 'bull';
import { Redis } from 'ioredis';
import type { Redis as RedisType } from 'ioredis';

function settleOnce<T>() {
  let settled = false;
  return {
    guardResolve:
      (resolve: (v: T) => void, reject: (e: any) => void, clear?: () => void) =>
      (v: T) => {
        if (settled) return;
        settled = true;
        clear?.();
        resolve(v);
      },
    guardReject:
      (resolve: (v: T) => void, reject: (e: any) => void, clear?: () => void) =>
      (e: any) => {
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
import { RedisUsageType, Environment } from '../config/RedisConfigurationFactory.js';
import RedisConnectionManager from './RedisConnectionManager.js';
import crypto from 'node:crypto';
import RedisHealthMonitor from './RedisHealthMonitor.js';
import { CircuitBreaker } from './CircuitBreaker.js';
import {
  RedisQueueError,
  RedisConnectionError,
  RedisErrorHandler,
  isConnectionError
} from '../errors/RedisErrors.js';
import { getInstagramWebhookHandler } from './instagram-webhook.js';
import { getConversationAIOrchestrator } from './conversation-ai-orchestrator.js';
import type { InstagramWebhookEvent, ProcessedWebhookResult } from './instagram-webhook.js';

export interface QueueJob {
  eventId: string;
  payload: any;
  merchantId: string;
  platform: 'INSTAGRAM' | 'WHATSAPP' | 'FACEBOOK';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  metadata?: Record<string, any>;
}

export interface QueueInitResult {
  success: boolean;
  queue: Bull.Queue | null;
  error?: string;
  connectionInfo?: any;
  diagnostics?: {
    redisConnection?: any;
    queueHealth?: any;
    circuitBreaker?: any;
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

export class ProductionQueueManager {
  private queue: Bull.Queue | null = null;
  private connectionManager: RedisConnectionManager;
  private healthMonitor: RedisHealthMonitor;
  private circuitBreaker: CircuitBreaker;
  private errorHandler: RedisErrorHandler;
  private queueConnection?: Redis;
  private isProcessing = false;
  private lastProcessedAt?: Date;
  private processedJobs = 0;
  private completedJobs = 0;
  private failedJobs = 0;
  private monitoringInterval?: NodeJS.Timeout;
  private manualPollingInterval?: NodeJS.Timeout;
  private workerHealthInterval?: NodeJS.Timeout;
  
  // Real processing services
  private webhookHandler = getInstagramWebhookHandler();
  private aiOrchestrator = getConversationAIOrchestrator();

  constructor(
    private redisUrl: string,
    private logger: any,
    private environment: Environment,
    private queueName: string = 'ai-sales-production'
  ) {
    this.connectionManager = new RedisConnectionManager(
      redisUrl,
      environment,
      logger
    );
    this.healthMonitor = new RedisHealthMonitor(logger);
    this.circuitBreaker = new CircuitBreaker(5, 60000);
    this.errorHandler = new RedisErrorHandler(logger);
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

      this.queueConnection = connectionResult.result;
      
      // 2. التحقق من صحة الاتصال
      if (!this.queueConnection) {
        throw new RedisConnectionError('Queue connection is undefined');
      }
      
      const healthCheck = await this.healthMonitor.performComprehensiveHealthCheck(this.queueConnection);
      
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

      // 3. إنشاء Bull Queue باستخدام خيارات الاتصال المحسنة
      const connectionConfig = this.queueConnection!.options;
      
      this.queue = new Bull(this.queueName, {
        redis: {
          host: connectionConfig.host,
          port: connectionConfig.port,
          password: connectionConfig.password,
          family: connectionConfig.family,
          keyPrefix: connectionConfig.keyPrefix,
          connectTimeout: connectionConfig.connectTimeout,
          lazyConnect: connectionConfig.lazyConnect,
          ...(connectionConfig.tls && { tls: connectionConfig.tls })
        },
        defaultJobOptions: {
          removeOnComplete: 200,     // الاحتفاظ بمزيد من المهام المكتملة
          removeOnFail: 100,         // الاحتفاظ بمزيد من المهام الفاشلة
          attempts: 5,               // محاولات أكثر للمهام المهمة
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          timeout: 45000,            // مهلة أطول للمعالجة المعقدة
          delay: 100
        },
        settings: {
          stalledInterval: 30000,    // فحص المهام المعلقة
          maxStalledCount: 2,        // السماح بمهام معلقة أكثر
          retryProcessDelay: 5000    // تأخير إعادة المحاولة
        }
      });

      // 4. إعداد معالجات الأحداث والمهام
      this.logger.info('🔧 بدء إعداد معالجات الأحداث والمهام...');
      this.setupEventHandlers();
      this.logger.info('📡 تم إعداد معالجات الأحداث');
      this.setupJobProcessors();
      this.logger.info('⚙️ تم إعداد معالجات المهام');

      // 5. تنظيف أولي وبدء المراقبة
      await this.performInitialCleanup();
      this.startQueueMonitoring();

      const diagnostics = {
        redisConnection: this.connectionManager.getConnectionInfo(RedisUsageType.QUEUE_SYSTEM),
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
        error: redisError.message,
        code: redisError.code,
        context: redisError.context
      });

      return {
        success: false,
        queue: null,
        error: redisError.message,
        diagnostics: {
          redisConnection: null,
          queueHealth: null,
          circuitBreaker: this.circuitBreaker.getStats()
        }
      };
    }
  }

  private setupEventHandlers(): void {
    if (!this.queue) return;

    // معالجة أخطاء الطابور
    this.queue.on('error', (error) => {
      this.logger.error('خطأ في الطابور', { 
        error: error.message,
        queueName: this.queueName 
      });
    });

    // مراقبة المهام المعلقة
    this.queue.on('stalled', (job) => {
      this.logger.warn('مهمة معلقة تم اكتشافها', { 
        jobId: job.id,
        jobData: job.data,
        attempts: job.attemptsMade
      });
    });

    // تتبع المهام المكتملة
    this.queue.on('completed', (job, result) => {
      this.processedJobs++;
      this.lastProcessedAt = new Date();
      
      this.logger.info('تم إنجاز مهمة', {
        jobId: job.id,
        processingTime: Date.now() - job.processedOn!,
        totalProcessed: this.processedJobs
      });
    });

    // تتبع المهام الفاشلة
    this.queue.on('failed', (job, error) => {
      this.failedJobs++;
      
      this.logger.error('فشلت مهمة', {
        jobId: job.id,
        error: error.message,
        attempts: job.attemptsMade,
        maxAttempts: job.opts.attempts,
        totalFailed: this.failedJobs
      });
    });

    // حالة المعالجة
    this.queue.on('active', (job) => {
      this.isProcessing = true;
      this.logger.debug('بدء معالجة مهمة', {
        jobId: job.id,
        queuePosition: job.opts.delay
      });
    });

    // انتهاء المعالجة
    this.queue.on('drained', () => {
      this.isProcessing = false;
      this.logger.info('تم إفراغ الطابور - لا توجد مهام في الانتظار');
    });
  }

  private setupJobProcessors(): void {
    this.logger.info('🔍 [DEBUG] setupJobProcessors() - بدء دالة إعداد المعالجات');
    
    if (!this.queue) {
      this.logger.error('💥 [CRITICAL] this.queue is null/undefined في setupJobProcessors!');
      return;
    }

    this.logger.info('🚀 [SUCCESS] بدء معالجات الطوابير الإنتاجية - Queue متوفر');
    this.logger.info('🔧 [DEBUG] Queue status:', this.queue.name, 'clients:', this.queue.client ? 'connected' : 'disconnected');

    // التحقق من أن Workers تم تشغيلها بنجاح
    const workerInitTimeout = setTimeout(() => {
      this.logger.warn('⚠️ [TIMEOUT] Workers لم تبدأ في المعالجة خلال 10 ثوانٍ');
    }, 10000);

    // ⚠️ تم إزالة المعالج العام '*' لأنه يسرق jobs من المعالجات المخصصة
    // المعالجات المخصصة أدناه ستتعامل مع كل نوع job
    
    // تسجيل بدء Workers للمراقبة
    setTimeout(() => {
      this.logger.info('🚀 تم تفعيل جميع معالجات الطوابير المخصصة', {
        processors: ['process-webhook', 'ai-response', 'cleanup'],
        totalConcurrency: 3 + 3 + 1 // مجموع concurrency لكل المعالجات
      });
      clearTimeout(workerInitTimeout);
    }, 100);

    // 🎯 معالج مخصص للويب هوك - الأساسي للمعالجة
    this.logger.info('🔧 [DEBUG] تسجيل معالج process-webhook...');
    
    // إضافة listener لمراقبة أن الـ queue يتلقى jobs
    this.queue.on('waiting', (jobId) => {
      this.logger.info('📥 [JOB-WAITING] Job جديد في الطابور', { jobId });
    });
    
    this.queue.on('stalled', (job) => {
      this.logger.warn('⏸️ [JOB-STALLED] Job متوقف!', { jobId: job.id, jobName: job.name });
    });
    
    this.queue.process('process-webhook', 5, async (job) => { // زيادة concurrency من 3 إلى 5
      this.logger.info('🎯 [WORKER-START] معالج webhook استقبل job!', { jobId: job.id, jobName: job.name });
      // إلغاء تحذير عدم بدء Workers عند أول معالجة
      clearTimeout(workerInitTimeout);
      
      const { eventId, payload, merchantId, platform } = job.data;
      const webhookWorkerId = `webhook-worker-${crypto.randomUUID()}`;
      const startTime = Date.now();
      
      return await this.circuitBreaker.execute(async () => {
        try {
          this.logger.info(`🔄 ${webhookWorkerId} - بدء معالجة ويب هوك`, {
            webhookWorkerId,
            eventId,
            merchantId,
            platform,
            jobId: job.id,
            attempt: job.attemptsMade + 1,
            queueStatus: {
              waiting: await this.queue!.getWaiting().then(jobs => jobs.length),
              active: await this.queue!.getActive().then(jobs => jobs.length)
            }
          });

          const result = await this.processWebhookJob(job.data);
          
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
            error: error instanceof Error ? error.message : String(error),
            attempt: job.attemptsMade + 1,
            maxAttempts: job.opts.attempts,
            errorType: error instanceof Error ? error.constructor.name : 'Unknown'
          });
          
          throw error;
        }
      });
    });

    // 🤖 معالج مهام الذكاء الاصطناعي 
    this.logger.info('🔧 [DEBUG] تسجيل معالج ai-response...');
    
    this.queue.process('ai-response', 3, async (job) => {
      this.logger.info('🤖 [WORKER-START] معالج AI استقبل job!', { jobId: job.id, jobName: job.name });
      const { conversationId, merchantId, message } = job.data;
      const aiWorkerId = `ai-worker-${crypto.randomUUID().replace(/-/g, '').slice(0, 6)}`;
      const startTime = Date.now();
      
      return await this.circuitBreaker.execute(async () => {
        try {
          this.logger.info(`🤖 ${aiWorkerId} - بدء معالجة استجابة ذكاء اصطناعي`, {
            aiWorkerId,
            conversationId,
            merchantId,
            jobId: job.id,
            messageLength: message?.length || 0,
            attempt: job.attemptsMade + 1
          });

          const result = await this.processAIResponseJob(job.data);
          
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
            attempt: job.attemptsMade + 1,
            maxAttempts: job.opts.attempts,
            jobId: job.id
          });
          
          throw error;
        }
      });
    });

    // معالج مهام التنظيف
    this.queue.process('cleanup', 1, async (job) => {
      const { type, olderThanDays } = job.data;
      
      try {
        await this.performCleanup(type, olderThanDays);
        return { cleaned: true, type, olderThanDays };
        
      } catch (error) {
        this.logger.error('فشل في تنظيف الطابور', { 
          type, 
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    });

    // تأكيد إنجاز تسجيل جميع المعالجات
    this.logger.info('🎯 [SUCCESS] تم تسجيل جميع معالجات الطوابير بنجاح!', {
      processors: ['process-webhook', 'ai-response', 'cleanup'],
      concurrency: { webhook: 5, ai: 3, cleanup: 1 },
      total: 9
    });
    
    // 🔍 تحقق فوري من أن القائمة يمكنها إرسال إشعارات عند تفعيل الاختبارات صراحة
    if (
      process.env.NODE_ENV !== 'production' &&
      process.env.ENABLE_QUEUE_TESTS === 'true'
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

  private startManualPolling(): void {
    this.logger.info('🔄 [MANUAL-POLLING] بدء Manual Polling كـ fallback للإشعارات');
    
    // فحص الطابور كل 5 ثوانٍ للبحث عن jobs منتظرة
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
                  delay: job.opts.delay 
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
        this.logger.error('❌ [MANUAL-POLLING] خطأ في Manual Polling', { 
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack?.substring(0, 500) : undefined
        });
      }
    }, 5000); // كل 5 ثوانٍ
  }

  async addWebhookJob(
    eventId: string,
    payload: any,
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
      const queuePosition = waiting.findIndex(j => j.id?.toString() === job.id?.toString()) + 1;

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
        jobId: job.id?.toString(),
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

      return { success: true, jobId: job.id?.toString() };

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

      // Bull Queue لا يحتوي على getPaused() - نستخدم 0 كقيمة افتراضية
      const paused = 0;

      const total = waiting.length + active.length + completed.length + 
                   failed.length + delayed.length + paused;

      const errorRate = this.processedJobs + this.failedJobs > 0 
        ? (this.failedJobs / (this.processedJobs + this.failedJobs)) * 100 
        : 0;

      return {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
        paused: paused,
        total,
        processing: this.isProcessing,
        lastProcessedAt: this.lastProcessedAt,
        errorRate: Math.round(errorRate * 100) / 100
      };

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
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack?.substring(0, 500) : undefined
      });
      
      // إعادة throw للخطأ ليتم التعامل معه بواسطة Bull
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
      const { rawBody, signature, appSecret, headers } = jobData.payload || {};

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

  private async processAIResponseJob(jobData: any): Promise<any> {
    const startTime = Date.now();
    
    try {
      this.logger.info('🤖 [AI-PROCESS] بدء معالجة AI job حقيقي', {
        conversationId: jobData.conversationId,
        merchantId: jobData.merchantId,
        customerId: jobData.customerId,
        messageLength: jobData.message?.length || 0,
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
      const platform = (jobData.platform?.toLowerCase() || 'instagram') as 'instagram' | 'whatsapp';
      
      // إنشاء context حسب platform
      let context: any;
      
      if (platform === 'instagram') {
        context = {
          conversationId: jobData.conversationId,
          merchantId: jobData.merchantId,
          customerId: jobData.customerId,
          messageHistory: jobData.messageHistory || [],
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
          messageHistory: jobData.messageHistory || [],
          customerProfile: jobData.customerProfile || {},
          businessContext: jobData.businessContext || {}
        };
      }

      const aiResponse = await this.aiOrchestrator.generatePlatformResponse(
        jobData.message,
        context,
        platform
      );

      const duration = Date.now() - startTime;
      
      const result = { 
        processed: true, 
        conversationId: jobData.conversationId,
        aiResponse: aiResponse,
        timestamp: new Date().toISOString(),
        duration: `${duration}ms`,
        realProcessing: true // تحديد أن هذا معالجة حقيقية
      };

      this.logger.info('✅ [AI-PROCESS] تمت معالجة AI بنجاح', {
        conversationId: jobData.conversationId,
        merchantId: jobData.merchantId,
        customerId: jobData.customerId,
        platform: platform,
        duration: `${duration}ms`,
        platformOptimized: aiResponse?.platformOptimized || false,
        adaptationsCount: aiResponse?.adaptations?.length || 0,
        responseType: typeof aiResponse?.response
      });

      return result;

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
      await this.queue.clean(24 * 60 * 60 * 1000, 'completed');
      
      // تنظيف المهام الفاشلة القديمة (أكثر من 3 أيام)
      await this.queue.clean(3 * 24 * 60 * 60 * 1000, 'failed');

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
        await this.queue.clean(olderThanMs, 'completed');
        break;
      case 'failed':
        await this.queue.clean(olderThanMs, 'failed');
        break;
      case 'all':
        await this.queue.clean(olderThanMs, 'completed');
        await this.queue.clean(olderThanMs, 'failed');
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
      const isHealthy = await this.healthMonitor.isConnectionHealthy(this.queueConnection, 2000);
      
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
        redisHealth = await this.healthMonitor.performComprehensiveHealthCheck(this.queueConnection);
        
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
}

export default ProductionQueueManager;