import Bull from 'bull';
import Redis from 'ioredis';
import { RedisHealthChecker, RedisHealthResult } from './RedisHealthChecker';
import { RedisProductionConfig, ProductionRedisConfig } from '../config/RedisProductionConfig';
import { CircuitBreaker } from './CircuitBreaker';

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
  connectionInfo?: RedisHealthResult;
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
  private healthChecker: RedisHealthChecker;
  private circuitBreaker: CircuitBreaker;
  private redisConfig: ProductionRedisConfig;
  private isProcessing = false;
  private lastProcessedAt?: Date;
  private processedJobs = 0;
  private failedJobs = 0;

  constructor(
    private redisUrl: string,
    private logger: any,
    private queueName: string = 'instagram-webhooks'
  ) {
    this.healthChecker = new RedisHealthChecker();
    this.circuitBreaker = new CircuitBreaker(5, 60000); // 5 فشل، استعادة خلال دقيقة
    this.redisConfig = RedisProductionConfig.getProductionConfig(redisUrl);
  }

  async initialize(): Promise<QueueInitResult> {
    try {
      // 1. فحص صحة اتصال ريديس
      this.logger.info('فحص اتصال ريديس...', { url: this.redisUrl });
      
      const healthResult = await this.healthChecker.checkConnection(this.redisUrl);
      
      if (!healthResult.connected) {
        this.logger.error('فشل الاتصال بريديس', { 
          error: healthResult.error,
          url: this.redisUrl
        });
        
        return { 
          success: false, 
          queue: null, 
          error: healthResult.error,
          connectionInfo: healthResult
        };
      }

      this.logger.info('تم الاتصال بريديس بنجاح', {
        responseTime: healthResult.responseTime,
        version: healthResult.version,
        memory: healthResult.memory,
        clients: healthResult.clients
      });

      // 2. تهيئة الطابور مع إعدادات الإنتاج
      this.queue = new Bull(this.queueName, this.redisUrl, {
        redis: this.redisConfig,
        defaultJobOptions: {
          removeOnComplete: 100,     // الاحتفاظ بـ 100 مهمة مكتملة
          removeOnFail: 50,          // الاحتفاظ بـ 50 مهمة فاشلة
          attempts: 3,               // 3 محاولات لكل مهمة
          backoff: {
            type: 'exponential',
            delay: 2000,             // تأخير متزايد
          },
          timeout: 30000,            // مهلة 30 ثانية لكل مهمة
          delay: 100                 // تأخير صغير قبل البدء
        },
        settings: {
          stalledInterval: 30 * 1000,    // فحص المهام المعلقة كل 30 ثانية
          maxStalledCount: 1             // عدد أقصى للمهام المعلقة
        }
      });

      // 3. إعداد معالجات الأحداث
      this.setupEventHandlers();

      // 4. إعداد معالجات المهام
      this.setupJobProcessors();

      // 5. تنظيف المهام القديمة عند البدء
      await this.performInitialCleanup();

      this.logger.info('تم تهيئة مدير الطوابير بنجاح', {
        queueName: this.queueName,
        responseTime: healthResult.responseTime
      });

      return { 
        success: true, 
        queue: this.queue,
        connectionInfo: healthResult
      };

    } catch (error) {
      this.logger.error('فشل في تهيئة مدير الطوابير', { 
        error: error instanceof Error ? error.message : String(error)
      });
      
      return { 
        success: false, 
        queue: null, 
        error: error instanceof Error ? error.message : String(error)
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

    // معالج مهام الويب هوك
    this.queue.process('process-webhook', 5, async (job) => {
      const { eventId, payload, merchantId, platform } = job.data;
      
      return await this.circuitBreaker.execute(async () => {
        try {
          // معالجة المهمة الفعلية
          const result = await this.processWebhookJob(job.data);
          
          return { 
            processed: true, 
            eventId, 
            result,
            processingTime: Date.now() - job.processedOn!
          };
          
        } catch (error) {
          // تسجيل تفصيلي للخطأ
          this.logger.error('فشل في معالجة الويب هوك', { 
            eventId, 
            merchantId, 
            platform,
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
      
      return await this.circuitBreaker.execute(async () => {
        try {
          const result = await this.processAIResponseJob(job.data);
          
          return { 
            processed: true, 
            conversationId, 
            result,
            processingTime: Date.now() - job.processedOn!
          };
          
        } catch (error) {
          this.logger.error('فشل في معالجة استجابة الذكاء الاصطناعي', { 
            conversationId, 
            merchantId,
            error: error instanceof Error ? error.message : String(error)
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

  async close(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
      this.logger.info('تم إغلاق مدير الطوابير');
    }
  }
}

export default ProductionQueueManager;