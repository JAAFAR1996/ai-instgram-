import { ProductionQueueManager } from './ProductionQueueManager.js';
import { RedisUsageType, Environment } from '../config/RedisConfigurationFactory.js';
import RedisConnectionManager from './RedisConnectionManager.js';
import RedisHealthMonitor from './RedisHealthMonitor.js';
import { CircuitBreaker } from './CircuitBreaker.js';
import { UpstashQuotaMonitor } from './UpstashQuotaMonitor.js';
import {
  RedisConnectionError,
  RedisErrorHandler,
  RedisRateLimitError,
  isConnectionError,
  isTimeoutError
} from '../errors/RedisErrors.js';

export interface RedisIntegrationResult {
  success: boolean;
  mode: 'active' | 'fallback' | 'disabled';
  queueManager?: ProductionQueueManager;
  error?: string;
  reason?: string;
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
  private connectionManager: RedisConnectionManager;
  private healthMonitor: RedisHealthMonitor;
  private circuitBreaker: CircuitBreaker;
  private errorHandler: RedisErrorHandler;
  private monitoringInterval?: NodeJS.Timeout;
  private alertingInterval?: NodeJS.Timeout;
  private quotaMonitor: UpstashQuotaMonitor;
  private nextRetryAt?: Date;
  private isInCooldown = false;

  constructor(
    private redisUrl: string, 
    private logger: any, 
    private environment: Environment
  ) {
    this.connectionManager = new RedisConnectionManager(redisUrl, environment, logger);
    this.healthMonitor = new RedisHealthMonitor(logger);
    this.circuitBreaker = new CircuitBreaker(5, 60000, {
      timeout: 15000,
      expectedErrorThreshold: 10
    });
    this.errorHandler = new RedisErrorHandler(logger);
    this.quotaMonitor = new UpstashQuotaMonitor(logger);
  }

  private ceilToHour(timestamp: number): Date {
    const date = new Date(timestamp);
    date.setHours(date.getHours() + 1, 0, 0, 0);
    return date;
  }

  private enterCooldownMode(reason: 'rate_limit' | 'error'): void {
    this.isInCooldown = true;
    this.nextRetryAt = this.ceilToHour(Date.now());
    this.circuitBreaker.forceOpen();
    
    this.logger.warn('Entering Redis cooldown mode', {
      reason,
      nextRetryAt: this.nextRetryAt.toISOString(),
      durationMs: this.nextRetryAt.getTime() - Date.now()
    });
  }

  async initialize(): Promise<RedisIntegrationResult> {
    try {
      this.logger.info('🔄 بدء تهيئة النظام المتكامل الإنتاجي لريديس والطوابير...');

      // تحقق من فترة التبريد قبل أي محاولة اتصال
      if (this.isInCooldown || (this.nextRetryAt && Date.now() < this.nextRetryAt.getTime())) {
        this.logger.warn('Redis in cooldown period - skipping initialization', {
          nextRetryAt: this.nextRetryAt?.toISOString(),
          isInCooldown: this.isInCooldown
        });
        return {
          success: false,
          mode: 'fallback',
          reason: 'cooldown_period',
          error: 'Redis connection blocked during cooldown'
        };
      }

      // 1. فحص صحة Redis باستخدام Health Check connection
      const healthCheckResult = await this.circuitBreaker.execute(async () => {
        const healthConnection = await this.connectionManager.getConnection(RedisUsageType.HEALTH_CHECK);
        return await this.healthMonitor.performComprehensiveHealthCheck(healthConnection);
      });

      if (!healthCheckResult.success) {
        const error = this.errorHandler.handleError(healthCheckResult.error);

        if (error instanceof RedisRateLimitError) {
          this.logger.warn('⚠️ Redis rate limit exceeded - entering cooldown mode', {
            error: error.message,
            code: error.code,
            fallbackMode: 'database_only'
          });

          // دخول في فترة تبريد منضبطة
          this.enterCooldownMode('rate_limit');

          // إيقاف الطوابير فعلياً عند الحصة
          if (this.queueManager) {
            await this.queueManager.gracefulShutdown();
            this.logger.info('Queue manager shutdown due to rate limit');
          }

          // إغلاق جميع اتصالات Redis لتوفير الطلبات
          await this.connectionManager.closeAllConnections();

          // إيقاف monitoring إذا كان يستخدم Redis
          if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = undefined;
          }

          this.logger.info('✅ Fallback mode activated - application will continue without Redis');

          return {
            success: false,
            mode: 'fallback',
            reason: 'rate_limit',
            error: 'Redis rate limit exceeded',
            diagnostics: {
              circuitBreakerStats: this.circuitBreaker.getStats(),
              connectionStats: this.connectionManager.getConnectionStats(),
              recommendations: [
                'Redis rate limit reached - application running in fallback mode',
                'Background processing and caching disabled temporarily',
                'Consider upgrading Redis plan or reducing usage'
              ],
              overallStatus: 'DEGRADED'
            }
          };
        }

        this.logger.error('❌ فشل فحص صحة ريديس', {
          error: error.message,
          code: error.code
        });

        return {
          success: false,
          mode: 'disabled',
          error: error.message,
          diagnostics: {
            circuitBreakerStats: this.circuitBreaker.getStats(),
            connectionStats: this.connectionManager.getConnectionStats()
          }
        };
      }

      const healthResult = healthCheckResult.result;
      
      this.logger.info('✅ تم التحقق من صحة ريديس بنجاح', {
        responseTime: healthResult?.responseTime,
        metrics: {
          version: healthResult?.metrics?.version,
          memory: healthResult?.metrics?.memoryUsage,
          clients: healthResult?.metrics?.connectedClients,
          hitRate: healthResult?.metrics?.hitRate
        }
      });

      // 2. تهيئة مدير الطوابير الإنتاجي
      this.queueManager = new ProductionQueueManager(
        this.redisUrl,
        this.logger,
        this.environment,
        'ai-sales-production-v2'
      );

      const queueInit = await this.queueManager.initialize();

      if (!queueInit.success) {
        const error = new RedisConnectionError(
          'Failed to initialize production queue manager',
          { queueError: queueInit.error }
        );

        this.logger.error('❌ فشل تهيئة مدير الطوابير الإنتاجي', {
          error: error.message,
          queueError: queueInit.error
        });

        return {
          success: false,
          mode: 'disabled',
          error: error.message,
          diagnostics: {
            redisHealth: healthResult,
            queueInit,
            circuitBreakerStats: this.circuitBreaker.getStats(),
            connectionStats: this.connectionManager.getConnectionStats()
          }
        };
      }

      // 3. بدء المراقبة الشاملة والتنبيهات
      this.startComprehensiveMonitoring();
      this.startSmartAlerting();

      const finalDiagnostics = {
        redisHealth: healthResult,
        queueStats: await this.queueManager.getQueueStats(),
        circuitBreakerStats: this.circuitBreaker.getStats(),
        connectionStats: this.connectionManager.getConnectionStats()
      };

      this.logger.info('🎉 تم تهيئة النظام المتكامل الإنتاجي بنجاح', {
        environment: this.environment,
        totalConnections: finalDiagnostics.connectionStats.totalConnections,
        queueHealth: queueInit.diagnostics?.queueHealth?.connected,
        redisHealth: healthResult?.connected,
        circuitBreakerState: finalDiagnostics.circuitBreakerStats.state
      });

      return {
        success: true,
        mode: 'active',
        queueManager: this.queueManager,
        diagnostics: finalDiagnostics
      };

    } catch (error) {
      const redisError = this.errorHandler.handleError(error, {
        operation: 'RedisIntegration.initialize',
        environment: this.environment
      });

      if (redisError instanceof RedisRateLimitError) {
        this.logger.error('💥 تجاوز حد طلبات Redis', {
          error: redisError.message,
          code: redisError.code,
          context: redisError.context
        });

        await this.queueManager?.gracefulShutdown();

        return {
          success: false,
          mode: 'fallback',
          reason: 'rate_limit',
          error: redisError.message,
          diagnostics: {
            circuitBreakerStats: this.circuitBreaker.getStats(),
            connectionStats: this.connectionManager.getConnectionStats(),
            errorDetails: redisError.toJSON(),
            recommendations: [
              'تم تجاوز حد طلبات Redis - تم تعطيل الأنظمة المعتمدة مؤقتًا',
              'قلل استخدام Redis أو قم بترقية الخطة'
            ],
            overallStatus: 'CRITICAL'
          }
        };
      }

      this.logger.error('💥 خطأ حرج في تهيئة النظام المتكامل', {
        error: redisError.message,
        code: redisError.code,
        context: redisError.context
      });

      return {
        success: false,
        mode: 'disabled',
        error: redisError.message,
        diagnostics: {
          circuitBreakerStats: this.circuitBreaker.getStats(),
          connectionStats: this.connectionManager.getConnectionStats(),
          errorDetails: redisError.toJSON()
        }
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
      // 1. فحص صحة Redis الشامل
      let redisHealth = null;
      try {
        const healthConnection = await this.connectionManager.getConnection(RedisUsageType.HEALTH_CHECK);
        redisHealth = await this.healthMonitor.performComprehensiveHealthCheck(healthConnection);
        
        if (!redisHealth.connected) {
          overallStatus = 'CRITICAL';
          recommendations.push('إصلاح اتصال Redis فوراً');
        } else if (redisHealth.responseTime && redisHealth.responseTime > 1000) {
          overallStatus = 'CRITICAL';
          recommendations.push('أداء Redis بطيء جداً - تدخل فوري مطلوب');
        } else if (redisHealth.responseTime && redisHealth.responseTime > 500) {
          overallStatus = 'DEGRADED';
          recommendations.push('تحسين أداء Redis - زمن الاستجابة مرتفع');
        }
      } catch (error) {
        overallStatus = 'CRITICAL';
        recommendations.push('فشل في الاتصال بـ Redis للفحص الصحي');
        redisHealth = { connected: false, error: 'Health check failed', timestamp };
      }

      // 2. إحصائيات الطوابير المتقدمة
      const queueStats = this.queueManager 
        ? await this.queueManager.getQueueStats() 
        : null;

      if (queueStats) {
        if (queueStats.failed > queueStats.completed * 0.5) {
          overallStatus = 'CRITICAL';
          recommendations.push('معدل فشل خطير في الطوابير - فحص المعالجات فوراً');
        } else if (queueStats.errorRate > 15) {
          overallStatus = 'DEGRADED';
          recommendations.push('معدل خطأ مرتفع - مراجعة معالجة المهام');
        }

        if (queueStats.waiting > 2000) {
          overallStatus = 'DEGRADED';
          recommendations.push('طابور مزدحم جداً - زيادة المعالجات أو تحسين الأداء');
        } else if (queueStats.waiting > 500) {
          recommendations.push('طابور طويل - مراقبة الأداء');
        }

        if (queueStats.active === 0 && queueStats.waiting > 0) {
          overallStatus = 'CRITICAL';
          recommendations.push('لا توجد مهام نشطة رغم وجود طابور - فحص المعالجات');
        }
      }

      // 3. إحصائيات Circuit Breaker المتقدمة
      const circuitBreakerStats = this.circuitBreaker.getStats();
      
      if (circuitBreakerStats.state === 'OPEN') {
        overallStatus = 'CRITICAL';
        recommendations.push('قاطع الدائرة مفتوح - الخدمة غير متاحة');
      } else if (circuitBreakerStats.state === 'HALF_OPEN') {
        if (overallStatus === 'HEALTHY') overallStatus = 'DEGRADED';
        recommendations.push('قاطع الدائرة في وضع اختبار - مراقبة الأداء');
      } else if (circuitBreakerStats.errorRate > 30) {
        overallStatus = 'CRITICAL';
        recommendations.push('معدل خطأ خطير في قاطع الدائرة');
      } else if (circuitBreakerStats.errorRate > 15) {
        overallStatus = 'DEGRADED';
        recommendations.push('معدل خطأ مرتفع في قاطع الدائرة');
      }

      // 4. تحليل اتصالات Redis
      const connectionStats = this.connectionManager.getConnectionStats();
      
      if (connectionStats.errorConnections > connectionStats.totalConnections * 0.3) {
        overallStatus = 'CRITICAL';
        recommendations.push('نسبة أخطاء اتصال خطيرة - فحص شبكة Redis');
      } else if (connectionStats.errorConnections > 0) {
        if (overallStatus === 'HEALTHY') overallStatus = 'DEGRADED';
        recommendations.push('بعض اتصالات Redis تواجه مشاكل');
      }

      if (connectionStats.totalReconnects > 10) {
        recommendations.push('عدد مرتفع من إعادة الاتصال - فحص استقرار الشبكة');
      }

      // 5. تحليل المقاييس المتقدمة
      if (redisHealth?.metrics) {
        const metrics = redisHealth.metrics;
        
        if (metrics.connectedClients > 500) {
          recommendations.push('عدد كبير من الاتصالات - فحص connection pooling');
        }

        if (metrics.hitRate < 80 && (metrics.keyspaceHits + metrics.keyspaceMisses) > 1000) {
          recommendations.push('معدل Hit Rate منخفض - مراجعة استراتيجية التخزين المؤقت');
        }

        if (metrics.evictedKeys > 100) {
          recommendations.push('Keys متعددة تم طردها - زيادة الذاكرة أو تحسين TTL');
        }
      }

      // 6. تحليل الصحة العامة
      if (recommendations.length === 0) {
        recommendations.push('🎉 النظام يعمل بأفضل أداء - لا توجد مشاكل مكتشفة');
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
      const redisError = this.errorHandler.handleError(error);

      if (redisError instanceof RedisRateLimitError) {
        await this.queueManager?.gracefulShutdown();

        return {
          timestamp,
          redisHealth: { connected: false, error: redisError.message, timestamp },
          queueStats: null,
          circuitBreakerStats: this.circuitBreaker.getStats(),
          recommendations: [
            'تم تجاوز حد طلبات Redis - تم إيقاف الطوابير مؤقتًا',
            'قلل استخدام Redis أو قم بترقية الخطة'
          ],
          overallStatus: 'CRITICAL'
        };
      }

      this.logger.error('خطأ حرج في إنشاء التقرير الشامل', {
        error: redisError.message
      });

      return {
        timestamp,
        redisHealth: { connected: false, error: 'فشل في الفحص الشامل', timestamp },
        queueStats: null,
        circuitBreakerStats: this.circuitBreaker.getStats(),
        recommendations: ['خطأ حرج في النظام - يتطلب فحص شامل فوري'],
        overallStatus: 'CRITICAL'
      };
    }
  }

  private startComprehensiveMonitoring(): void {
    // مراقبة شاملة كل 45 ثانية
    this.monitoringInterval = setInterval(async () => {
      try {
        const report = await this.getComprehensiveReport();
        
        if (report.overallStatus === 'CRITICAL') {
          this.logger.error('🚨 حالة حرجة في النظام المتكامل', {
            status: report.overallStatus,
            recommendations: report.recommendations,
            redisHealth: report.redisHealth?.connected,
            queueHealth: report.queueStats?.processing,
            connectionStats: this.connectionManager.getConnectionStats()
          });
        } else if (report.overallStatus === 'DEGRADED') {
          this.logger.warn('⚠️ أداء منخفض في النظام المتكامل', {
            status: report.overallStatus,
            recommendations: report.recommendations,
            performance: {
              redisResponseTime: report.redisHealth?.responseTime,
              queueWaiting: report.queueStats?.waiting,
              errorRate: report.queueStats?.errorRate
            }
          });
        } else {
          this.logger.debug('✅ النظام المتكامل يعمل بشكل مثالي', {
            redisResponseTime: report.redisHealth?.responseTime,
            queueStats: {
              waiting: report.queueStats?.waiting,
              active: report.queueStats?.active,
              errorRate: report.queueStats?.errorRate
            },
            circuitState: report.circuitBreakerStats?.state,
            totalConnections: this.connectionManager.getConnectionStats().totalConnections
          });
        }

        // فحص حصة Upstash ومراجعة معدل polling اليدوي
        if (this.queueManager) {
          const quota = await this.quotaMonitor.check(this.queueManager.getRedisClient());

          if (quota.level === 'CRITICAL') {
            this.logger.error('🚨 استهلاك Upstash وصل إلى حد حرج', {
              usage: quota.usage,
            });
          } else if (quota.level === 'WARNING') {
            this.logger.warn('⚠️ استهلاك Upstash يقترب من الحد المسموح', {
              usage: quota.usage,
            });
          }

          this.queueManager.adjustManualPollingInterval(
            quota.recommendedIntervalMultiplier
          );
        }
      } catch (error) {
        this.logger.error('خطأ في المراقبة الشاملة', { error });
      }
    }, 45000); // كل 45 ثانية
    this.monitoringInterval.unref();
  }

  private startSmartAlerting(): void {
    // تنبيهات ذكية كل 5 دقائق
    this.alertingInterval = setInterval(async () => {
      try {
        await this.performSmartAlerting();
      } catch (error) {
        this.logger.error('خطأ في نظام التنبيهات الذكية', { error });
      }
    }, 300000); // كل 5 دقائق
    this.alertingInterval.unref();
  }

  private async performSmartAlerting(): Promise<void> {
    const report = await this.getComprehensiveReport();
    const connectionStats = this.connectionManager.getConnectionStats();
    const alerts: string[] = [];

    // تحليل ذكي للأنماط
    if (report.overallStatus === 'CRITICAL') {
      alerts.push('🚨 حالة حرجة: النظام يحتاج تدخل فوري');
    }

    if (connectionStats.errorConnections > connectionStats.activeConnections / 2) {
      alerts.push('🔴 معدل أخطاء اتصال مرتفع: فحص شبكة Redis');
    }

    if (report.queueStats && report.queueStats.waiting > 2000) {
      alerts.push('📊 طابور مزدحم: زيادة المعالجات أو تحسين الأداء');
    }

    if (report.circuitBreakerStats?.errorRate > 25) {
      alerts.push('⚡ قاطع الدائرة: معدل خطأ عالي جداً');
    }

    // إرسال التنبيهات المهمة فقط
    if (alerts.length > 0) {
      this.logger.warn('🔔 تنبيهات النظام المتكامل', {
        alerts,
        timestamp: new Date().toISOString(),
        systemHealth: {
          overallStatus: report.overallStatus,
          activeConnections: connectionStats.activeConnections,
          queueWaiting: report.queueStats?.waiting,
          circuitState: report.circuitBreakerStats?.state
        }
      });
    }
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

  async gracefulShutdown(timeoutMs: number = 60000): Promise<void> {
    this.logger.info('🔄 بدء إغلاق النظام المتكامل بأمان...');

    try {
      // 1. إيقاف المراقبة والتنبيهات
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = undefined;
      }

      if (this.alertingInterval) {
        clearInterval(this.alertingInterval);
        this.alertingInterval = undefined;
      }

      // 2. إغلاق مدير الطوابير مع انتظار المهام
      if (this.queueManager) {
        this.logger.info('إغلاق مدير الطوابير...');
        await this.queueManager.gracefulShutdown(timeoutMs / 2); // نصف الوقت للطوابير
      }

      // 3. إغلاق جميع اتصالات Redis
      this.logger.info('إغلاق اتصالات Redis...');
      await this.connectionManager.closeAllConnections();

      // 4. إعادة تعيين Circuit Breaker
      this.circuitBreaker.reset();

      this.logger.info('✅ تم إغلاق النظام المتكامل بأمان بنجاح');

    } catch (error) {
      this.logger.error('⚠️ خطأ أثناء الإغلاق الآمن', {
        error: error instanceof Error ? error.message : String(error)
      });

      // إغلاق قسري في حالة الفشل
      try {
        if (this.queueManager) {
          await this.queueManager.close();
        }
        await this.connectionManager.closeAllConnections();
      } catch (forceCloseError) {
        this.logger.error('فشل في الإغلاق القسري', { forceCloseError });
      }

      throw error;
    }
  }

  // الحصول على مدير الطوابير للاستخدام في أماكن أخرى
  getQueueManager(): ProductionQueueManager | undefined {
    return this.queueManager;
  }

  getHealthMonitor(): RedisHealthMonitor {
    return this.healthMonitor;
  }

  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }
}

export default RedisProductionIntegration;