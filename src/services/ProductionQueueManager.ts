import Bull from 'bull';
import Redis from 'ioredis';
import { RedisUsageType, Environment } from '../config/RedisConfigurationFactory';
import RedisConnectionManager from './RedisConnectionManager';
import RedisHealthMonitor from './RedisHealthMonitor';
import { CircuitBreaker } from './CircuitBreaker';
import {
  RedisQueueError,
  RedisConnectionError,
  RedisErrorHandler,
  isConnectionError
} from '../errors/RedisErrors';

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
  private failedJobs = 0;
  private monitoringInterval?: NodeJS.Timeout;

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
      this.setupEventHandlers();
      this.setupJobProcessors();

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
    if (!this.queue) return;

    this.logger.info('🚀 بدء معالجات الطوابير الإنتاجية...');

    // التحقق من أن Workers تم تشغيلها بنجاح
    const workerInitTimeout = setTimeout(() => {
      this.logger.warn('⚠️ Workers لم تبدأ في المعالجة خلال 10 ثوانٍ');
    }, 10000);

    // معالج شامل لجميع أنواع المهام مع مراقبة محسّنة
    this.queue.process('*', 5, async (job) => {
      // إلغاء تحذير بدء Workers عند أول مهمة
      clearTimeout(workerInitTimeout);
      
      const startTime = Date.now();
      const workerId = `worker-${Math.random().toString(36).substr(2, 9)}`;
      
      this.logger.info(`⚡ Worker ${workerId} - بدء معالجة مهمة`, {
        workerId,
        jobId: job.id,
        name: job.name,
        type: job.data.type || job.name,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts,
        priority: job.opts.priority,
        delay: job.opts.delay,
        queueStatus: {
          waiting: await this.queue!.getWaiting().then(jobs => jobs.length),
          active: await this.queue!.getActive().then(jobs => jobs.length)
        }
      });

      try {
        const result = await this.circuitBreaker.execute(async () => {
          return await this.processWebhookJob(job.data);
        });

        const duration = Date.now() - startTime;
        this.logger.info(`✅ Worker ${workerId} - مهمة مكتملة بنجاح`, {
          workerId,
          jobId: job.id,
          name: job.name,
          duration: `${duration}ms`,
          result: 'success',
          throughput: Math.round(1000 / duration * 100) / 100 // مهام/ثانية
        });

        return {
          success: true,
          workerId,
          jobId: job.id?.toString(),
          processingTime: duration,
          result
        };

      } catch (error) {
        const duration = Date.now() - startTime;
        this.logger.error(`❌ Worker ${workerId} - فشل في معالجة المهمة`, {
          workerId,
          jobId: job.id,
          name: job.name,
          duration: `${duration}ms`,
          error: error instanceof Error ? error.message : String(error),
          attempt: job.attemptsMade + 1,
          maxAttempts: job.opts.attempts,
          willRetry: job.attemptsMade + 1 < (job.opts.attempts || 1),
          errorType: error instanceof Error ? error.constructor.name : 'Unknown'
        });

        throw error;
      }
    });

    // معالج مخصص للويب هوك (للتوافق مع الإصدارات القديمة)
    this.queue.process('process-webhook', 3, async (job) => {
      const { eventId, payload, merchantId, platform } = job.data;
      const webhookWorkerId = `webhook-worker-${Math.random().toString(36).substr(2, 6)}`;
      
      return await this.circuitBreaker.execute(async () => {
        try {
          this.logger.info(`🔄 ${webhookWorkerId} - معالجة ويب هوك`, {
            webhookWorkerId,
            eventId,
            merchantId,
            platform,
            jobId: job.id,
            attempt: job.attemptsMade + 1
          });

          const result = await this.processWebhookJob(job.data);
          
          this.logger.info(`✅ ${webhookWorkerId} - ويب هوك مكتمل`, {
            webhookWorkerId,
            eventId,
            processingTime: Date.now() - job.processedOn!
          });
          
          return { 
            processed: true, 
            webhookWorkerId,
            eventId, 
            result,
            processingTime: Date.now() - job.processedOn!
          };
          
        } catch (error) {
          this.logger.error(`❌ ${webhookWorkerId} - فشل في معالجة الويب هوك`, { 
            webhookWorkerId,
            eventId, 
            merchantId, 
            platform,
            jobId: job.id,
            error: error instanceof Error ? error.message : String(error),
            attempt: job.attemptsMade + 1,
            maxAttempts: job.opts.attempts
          });
          
          throw error;
        }
      });
    });

    // معالج مهام الذكاء الاصطناعي
    this.queue.process('ai-response', 3, async (job) => {
      const { conversationId, merchantId, message } = job.data;
      const aiWorkerId = `ai-worker-${Math.random().toString(36).substr(2, 6)}`;
      
      return await this.circuitBreaker.execute(async () => {
        try {
          this.logger.info(`🤖 ${aiWorkerId} - معالجة استجابة ذكاء اصطناعي`, {
            aiWorkerId,
            conversationId,
            merchantId,
            jobId: job.id,
            messageLength: message?.length || 0
          });

          const result = await this.processAIResponseJob(job.data);
          
          this.logger.info(`✅ ${aiWorkerId} - استجابة ذكاء اصطناعي مكتملة`, {
            aiWorkerId,
            conversationId,
            processingTime: Date.now() - job.processedOn!
          });
          
          return { 
            processed: true, 
            aiWorkerId,
            conversationId, 
            result,
            processingTime: Date.now() - job.processedOn!
          };
          
        } catch (error) {
          this.logger.error(`❌ ${aiWorkerId} - فشل في معالجة استجابة الذكاء الاصطناعي`, { 
            aiWorkerId,
            conversationId, 
            merchantId,
            error: error instanceof Error ? error.message : String(error),
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
      
      const job = await this.queue.add('process-webhook', jobData, {
        priority: priorityValue,
        delay: priority === 'CRITICAL' ? 0 : 100,
        removeOnComplete: priority === 'CRITICAL' ? 200 : 100,
        removeOnFail: priority === 'CRITICAL' ? 100 : 50,
        attempts: priority === 'CRITICAL' ? 5 : 3
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
        delay: 50, // تأخير قصير لمعالجة الذكاء الاصطناعي
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

  private async processWebhookJob(jobData: QueueJob): Promise<any> {
    // تنفيذ معالجة الويب هوك الفعلية
    // هذا مجرد مثال - يجب استبداله بالمعالجة الحقيقية
    await new Promise(resolve => setTimeout(resolve, 100)); // محاكاة معالجة
    return { processed: true, eventId: jobData.eventId };
  }

  private async processAIResponseJob(jobData: any): Promise<any> {
    // تنفيذ معالجة الذكاء الاصطناعي الفعلية
    await new Promise(resolve => setTimeout(resolve, 200)); // محاكاة معالجة
    return { processed: true, conversationId: jobData.conversationId };
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
      this.logger.warn('فشل في التنظيف الأولي', { error });
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
    setInterval(async () => {
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

    if (this.queue) {
      try {
        // انتظار إكمال المهام الجارية مع timeout
        const waitPromise = this.waitForActiveJobs();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Shutdown timeout')), timeoutMs)
        );

        await Promise.race([waitPromise, timeoutPromise]);

        await this.queue!.close();
        this.queue = null;

        this.logger.info('✅ تم إغلاق الطابور بأمان');

      } catch (error) {
        this.logger.warn('فشل في الانتظار لإكمال المهام، إغلاق قسري', { error });
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