import { ProductionQueueManager } from './ProductionQueueManager';
import { RedisHealthChecker } from './RedisHealthChecker';
import { RedisProductionConfig } from '../config/RedisProductionConfig';
import { CircuitBreaker } from './CircuitBreaker';

export interface RedisIntegrationResult {
  success: boolean;
  queueManager?: ProductionQueueManager;
  healthChecker?: RedisHealthChecker;
  error?: string;
  diagnostics?: any;
}

export interface RedisMonitoringReport {
  timestamp: Date;
  redisHealth: any;
  queueStats: any;
  circuitBreakerStats: any;
  recommendations: string[];
  overallStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
}

export class RedisProductionIntegration {
  private queueManager?: ProductionQueueManager;
  private healthChecker: RedisHealthChecker;
  private circuitBreaker: CircuitBreaker;
  private logger: any;
  private redisUrl: string;
  private monitoringInterval?: NodeJS.Timeout;

  constructor(redisUrl: string, logger: any) {
    this.redisUrl = redisUrl;
    this.logger = logger;
    this.healthChecker = new RedisHealthChecker();
    this.circuitBreaker = new CircuitBreaker(5, 60000, {
      timeout: 10000,
      expectedErrorThreshold: 10
    });
  }

  async initialize(): Promise<RedisIntegrationResult> {
    try {
      this.logger.info('🔄 بدء تهيئة النظام المتكامل لريديس والطوابير...');

      // 1. فحص صحة ريديس أولاً
      const healthCheck = await this.circuitBreaker.execute(
        () => this.healthChecker.checkConnection(this.redisUrl)
      );

      if (!healthCheck.success) {
        this.logger.error('❌ فشل الاتصال بريديس', { 
          error: healthCheck.error 
        });
        return { 
          success: false, 
          error: healthCheck.error,
          diagnostics: { circuitBreakerStats: this.circuitBreaker.getStats() }
        };
      }

      this.logger.info('✅ تم التحقق من صحة ريديس', {
        responseTime: healthCheck.result?.responseTime,
        version: healthCheck.result?.version
      });

      // 2. تهيئة مدير الطوابير
      this.queueManager = new ProductionQueueManager(
        this.redisUrl,
        this.logger,
        'ai-sales-production'
      );

      const queueInit = await this.queueManager.initialize();
      
      if (!queueInit.success) {
        this.logger.error('❌ فشل تهيئة مدير الطوابير', { 
          error: queueInit.error 
        });
        return { 
          success: false, 
          error: queueInit.error,
          diagnostics: { 
            redisHealth: healthCheck.result,
            circuitBreakerStats: this.circuitBreaker.getStats()
          }
        };
      }

      this.logger.info('✅ تم تهيئة النظام المتكامل بنجاح');

      // 3. بدء مراقبة مستمرة
      this.startMonitoring();

      return {
        success: true,
        queueManager: this.queueManager,
        healthChecker: this.healthChecker,
        diagnostics: {
          redisHealth: healthCheck.result,
          queueStats: await this.queueManager.getQueueStats(),
          circuitBreakerStats: this.circuitBreaker.getStats()
        }
      };

    } catch (error) {
      this.logger.error('💥 خطأ في تهيئة النظام المتكامل', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async processWebhookWithFallback(
    eventId: string,
    payload: any,
    merchantId: string,
    platform: 'INSTAGRAM' | 'WHATSAPP' | 'FACEBOOK',
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'MEDIUM'
  ): Promise<{
    success: boolean;
    processedBy: 'QUEUE' | 'FALLBACK';
    jobId?: string;
    error?: string;
  }> {
    if (!this.queueManager) {
      return { success: false, processedBy: 'FALLBACK', error: 'النظام غير مهيأ' };
    }

    // محاولة المعالجة عبر الطابور مع Circuit Breaker
    const queueResult = await this.circuitBreaker.execute(
      () => this.queueManager!.addWebhookJob(eventId, payload, merchantId, platform, priority),
      // البديل: معالجة فورية مبسطة
      () => this.fallbackWebhookProcessing(eventId, payload, merchantId, platform)
    );

    if (queueResult.success && queueResult.result?.success) {
      this.logger.info('✅ تمت معالجة الويب هوك عبر الطابور', {
        eventId,
        merchantId,
        platform,
        jobId: queueResult.result.jobId,
        fallbackUsed: queueResult.fallbackUsed
      });

      return {
        success: true,
        processedBy: queueResult.fallbackUsed ? 'FALLBACK' : 'QUEUE',
        jobId: queueResult.result.jobId
      };
    } else {
      this.logger.error('❌ فشل في معالجة الويب هوك', {
        eventId,
        error: queueResult.error,
        fallbackUsed: queueResult.fallbackUsed
      });

      return {
        success: false,
        processedBy: queueResult.fallbackUsed ? 'FALLBACK' : 'QUEUE',
        error: queueResult.error
      };
    }
  }

  private async fallbackWebhookProcessing(
    eventId: string,
    payload: any,
    merchantId: string,
    platform: string
  ): Promise<{ success: boolean; jobId: string }> {
    // معالجة مبسطة فورية كبديل عند فشل الطابور
    this.logger.warn('🔄 استخدام المعالجة البديلة للويب هوك', {
      eventId,
      merchantId,
      platform
    });

    // هنا يمكن إضافة معالجة مبسطة فورية
    // مثل: حفظ في قاعدة البيانات مباشرة أو إرسال إشعار أساسي
    
    await new Promise(resolve => setTimeout(resolve, 100)); // محاكاة معالجة
    
    return { 
      success: true, 
      jobId: `fallback-${eventId}-${Date.now()}` 
    };
  }

  async getComprehensiveReport(): Promise<RedisMonitoringReport> {
    const timestamp = new Date();
    const recommendations: string[] = [];
    let overallStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL' = 'HEALTHY';

    try {
      // 1. فحص صحة ريديس
      const redisHealth = await this.healthChecker.checkConnection(this.redisUrl);
      
      if (!redisHealth.connected) {
        overallStatus = 'CRITICAL';
        recommendations.push('إصلاح اتصال ريديس فوراً');
      } else if (redisHealth.responseTime && redisHealth.responseTime > 500) {
        overallStatus = 'DEGRADED';
        recommendations.push('تحسين أداء ريديس - زمن الاستجابة مرتفع');
      }

      // 2. إحصائيات الطوابير
      const queueStats = this.queueManager 
        ? await this.queueManager.getQueueStats() 
        : null;

      if (queueStats) {
        if (queueStats.failed > queueStats.completed) {
          overallStatus = 'CRITICAL';
          recommendations.push('معدل فشل مرتفع في الطوابير - فحص المعالجات');
        } else if (queueStats.errorRate > 10) {
          overallStatus = 'DEGRADED';
          recommendations.push('معدل خطأ مرتفع - مراجعة المعالجة');
        }

        if (queueStats.waiting > 1000) {
          recommendations.push('طابور طويل - فحص أداء المعالجة');
        }
      }

      // 3. إحصائيات Circuit Breaker
      const circuitBreakerStats = this.circuitBreaker.getStats();
      
      if (circuitBreakerStats.state === 'OPEN') {
        overallStatus = 'CRITICAL';
        recommendations.push('قاطع الدائرة مفتوح - الخدمة غير متاحة');
      } else if (circuitBreakerStats.errorRate > 20) {
        overallStatus = 'DEGRADED';
        recommendations.push('معدل خطأ عالي في قاطع الدائرة');
      }

      // 4. تشخيص إضافي
      if (redisHealth.connected && redisHealth.clients && redisHealth.clients > 100) {
        recommendations.push('عدد كبير من اتصالات ريديس - فحص تجميع الاتصالات');
      }

      return {
        timestamp,
        redisHealth,
        queueStats,
        circuitBreakerStats,
        recommendations,
        overallStatus
      };

    } catch (error) {
      this.logger.error('خطأ في إنشاء التقرير الشامل', { error });
      
      return {
        timestamp,
        redisHealth: { connected: false, error: 'فشل في الفحص' },
        queueStats: null,
        circuitBreakerStats: this.circuitBreaker.getStats(),
        recommendations: ['خطأ في النظام - فحص شامل مطلوب'],
        overallStatus: 'CRITICAL'
      };
    }
  }

  private startMonitoring(): void {
    // مراقبة كل دقيقة
    this.monitoringInterval = setInterval(async () => {
      try {
        const report = await this.getComprehensiveReport();
        
        if (report.overallStatus === 'CRITICAL') {
          this.logger.error('🚨 حالة حرجة في النظام', {
            status: report.overallStatus,
            recommendations: report.recommendations
          });
        } else if (report.overallStatus === 'DEGRADED') {
          this.logger.warn('⚠️ أداء منخفض في النظام', {
            status: report.overallStatus,
            recommendations: report.recommendations
          });
        } else {
          this.logger.debug('✅ النظام يعمل بشكل صحي', {
            redisResponseTime: report.redisHealth?.responseTime,
            queueWaiting: report.queueStats?.waiting,
            circuitState: report.circuitBreakerStats?.state
          });
        }
      } catch (error) {
        this.logger.error('خطأ في المراقبة الدورية', { error });
      }
    }, 60000); // كل دقيقة
  }

  async performHealthCheck(): Promise<{
    healthy: boolean;
    details: any;
    recommendations: string[];
  }> {
    const report = await this.getComprehensiveReport();
    
    return {
      healthy: report.overallStatus === 'HEALTHY',
      details: {
        redis: report.redisHealth,
        queue: report.queueStats,
        circuitBreaker: report.circuitBreakerStats,
        overallStatus: report.overallStatus
      },
      recommendations: report.recommendations
    };
  }

  async gracefulShutdown(): Promise<void> {
    this.logger.info('🔄 بدء إغلاق النظام بأمان...');

    // إيقاف المراقبة
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    // إغلاق مدير الطوابير
    if (this.queueManager) {
      await this.queueManager.close();
    }

    // إعادة تعيين Circuit Breaker
    this.circuitBreaker.reset();

    this.logger.info('✅ تم إغلاق النظام بأمان');
  }

  // الحصول على مدير الطوابير للاستخدام في أماكن أخرى
  getQueueManager(): ProductionQueueManager | undefined {
    return this.queueManager;
  }

  getHealthChecker(): RedisHealthChecker {
    return this.healthChecker;
  }

  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }
}

export default RedisProductionIntegration;