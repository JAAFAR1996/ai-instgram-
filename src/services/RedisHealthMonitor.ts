import { Redis } from 'ioredis';
import type { Redis as RedisType } from 'ioredis';
import {
  RedisHealthCheckError,
  RedisValidationError,
  RedisMetricsError,
  RedisErrorFactory,
  RedisErrorHandler,
  isTimeoutError
} from '../errors/RedisErrors.js';

export interface RedisMetrics {
  version: string;
  memoryUsage: string;
  memoryPeak: string;
  memoryRss: string;
  connectedClients: number;
  blockedClients: number;
  uptime: number;
  totalCommandsProcessed: number;
  instantaneousOpsPerSec: number;
  keyspaceHits: number;
  keyspaceMisses: number;
  expiredKeys: number;
  evictedKeys: number;
  hitRate: number;
}

export interface RedisHealthResult {
  connected: boolean;
  responseTime?: number;
  error?: string;
  metrics?: RedisMetrics;
  timestamp: Date;
  checks: {
    ping: boolean;
    read: boolean;
    write: boolean;
    delete: boolean;
  };
}

export interface RedisLoadTestResult {
  success: boolean;
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  averageResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  throughputPerSecond: number;
  errors: string[];
  percentiles: {
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  };
}

export interface RedisConnectionDiagnosis {
  url: string;
  diagnosis: string;
  recommendations: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
  metrics?: RedisMetrics;
  healthScore: number; // 0-100
}

export class RedisHealthMonitor {
  private errorHandler: RedisErrorHandler;

  constructor(private logger?: any) {
    this.errorHandler = new RedisErrorHandler(logger);
  }

  async isConnectionHealthy(connection: RedisType, timeout: number = 3000): Promise<boolean> {
    try {
      const start = Date.now();
      
      // استخدام Promise.race للتحكم في المهلة الزمنية
      const result = await Promise.race([
        connection.ping(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), timeout)
        )
      ]);
      
      const responseTime = Date.now() - start;
      
      // اعتبار الاتصال صحي إذا كان زمن الاستجابة أقل من ثانية واحدة
      return responseTime < 1000 && result === 'PONG';
      
    } catch (error) {
      this.logger?.debug('Redis health check failed', { 
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  async validateConnection(connection: RedisType): Promise<void> {
    try {
      // اختبار مباشر بدون انتظار ready state
      // إذا كان الاتصال يعمل، العمليات ستنجح حتى لو status !== 'ready'
      
      const testKey = `health:check:${Date.now()}`;
      const testValue = `test-${Math.random()}`;
      
      this.logger?.debug('Starting Redis validation', {
        connectionStatus: connection.status,
        host: connection.options.host,
        port: connection.options.port
      });

      // Ping test - أهم اختبار
      const pingResult = await connection.ping();
      if (pingResult !== 'PONG') {
        throw new RedisValidationError('Ping test failed', { pingResult });
      }

      // Write test
      await connection.set(testKey, testValue, 'EX', 30);
      
      // Read test
      const retrieved = await connection.get(testKey);
      if (retrieved !== testValue) {
        throw new RedisValidationError(
          'Data integrity check failed',
          { expected: testValue, received: retrieved }
        );
      }

      // Delete test (optional warning only)
      try {
        const deleteResult = await connection.del(testKey);
        if (deleteResult !== 1) {
          this.logger?.warn('Delete test warning', { deleteResult });
        }
      } catch (delError) {
        this.logger?.warn('Delete operation failed', { 
          error: delError instanceof Error ? delError.message : String(delError)
        });
      }
      
      this.logger?.info('✅ Redis connection validation successful', {
        connectionStatus: connection.status,
        testKey: testKey.substring(0, 20) + '...',
        operations: ['ping', 'set', 'get', 'del']
      });
      
    } catch (error) {
      this.logger?.error('❌ Redis validation failed', {
        connectionStatus: connection.status,
        host: connection.options.host,
        port: connection.options.port,
        error: error instanceof Error ? error.message : String(error)
      });

      const redisError = this.errorHandler.handleError(error, {
        operation: 'validateConnection',
        connectionStatus: connection.status
      });
      
      throw new RedisValidationError(
        'Redis connection validation failed',
        { 
          originalError: redisError.message,
          connectionStatus: connection.status,
          connectionState: this.getConnectionState(connection)
        },
        redisError
      );
    }
  }

  private async waitForConnectionReady(connection: RedisType, timeoutMs: number = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new RedisValidationError(
          'Connection ready timeout',
          { 
            status: connection.status,
            timeout: timeoutMs 
          }
        ));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        connection.removeListener('ready', onReady);
        connection.removeListener('error', onError);
        connection.removeListener('close', onClose);
      };

      const onReady = () => {
        cleanup();
        resolve();
      };

      const onError = (error: Error) => {
        cleanup();
        reject(new RedisValidationError(
          'Connection error during ready wait',
          { error: error.message }
        ));
      };

      const onClose = () => {
        cleanup();
        reject(new RedisValidationError('Connection closed during ready wait'));
      };

      // التحقق من الحالة الحالية
      if (connection.status === 'ready') {
        cleanup();
        resolve();
        return;
      }

      // انتظار ready state
      connection.once('ready', onReady);
      connection.once('error', onError);
      connection.once('close', onClose);
    });
  }

  private getConnectionState(connection: RedisType): any {
    return {
      status: connection.status,
      options: {
        host: connection.options.host,
        port: connection.options.port,
        connectTimeout: connection.options.connectTimeout,
        lazyConnect: connection.options.lazyConnect
      }
    };
  }

  async performComprehensiveHealthCheck(connection: RedisType): Promise<RedisHealthResult> {
    const timestamp = new Date();
    const checks = {
      ping: false,
      read: false,
      write: false,
      delete: false
    };

    try {
      const startTime = Date.now();
      
      // 1. فحص Ping
      try {
        await connection.ping();
        checks.ping = true;
      } catch (error) {
        this.logger?.warn('Redis ping failed', { error });
      }

      // 2. فحص الكتابة
      const testKey = `health:comprehensive:${Date.now()}`;
      const testValue = JSON.stringify({
        timestamp: timestamp.toISOString(),
        test: 'comprehensive_health_check'
      });

      try {
        await connection.set(testKey, testValue, 'EX', 30);
        checks.write = true;
      } catch (error) {
        this.logger?.warn('Redis write failed', { error });
      }

      // 3. فحص القراءة
      try {
        const retrieved = await connection.get(testKey);
        checks.read = retrieved === testValue;
      } catch (error) {
        this.logger?.warn('Redis read failed', { error });
      }

      // 4. فحص الحذف
      try {
        const deleted = await connection.del(testKey);
        checks.delete = deleted === 1;
      } catch (error) {
        this.logger?.warn('Redis delete failed', { error });
      }

      const responseTime = Date.now() - startTime;
      const connected = Object.values(checks).every(check => check === true);

      let metrics: RedisMetrics | undefined;
      try {
        metrics = await this.getConnectionMetrics(connection);
      } catch (error) {
        this.logger?.warn('Failed to get Redis metrics', { error });
      }

      return {
        connected,
        responseTime,
        timestamp,
        checks,
        metrics
      };

    } catch (error) {
      const redisError = this.errorHandler.handleError(error, {
        operation: 'comprehensiveHealthCheck'
      });

      return {
        connected: false,
        error: redisError.message,
        timestamp,
        checks
      };
    }
  }

  async getConnectionMetrics(connection: RedisType): Promise<RedisMetrics> {
    try {
      const [info, memory, stats, keyspace] = await Promise.all([
        connection.info(),
        connection.info('memory'),
        connection.info('stats'),
        connection.info('keyspace')
      ]);

      const metrics: RedisMetrics = {
        version: this.extractVersion(info),
        memoryUsage: this.extractMemoryUsage(memory),
        memoryPeak: this.extractMemoryPeak(memory),
        memoryRss: this.extractMemoryRss(memory),
        connectedClients: this.extractConnectedClients(info),
        blockedClients: this.extractBlockedClients(info),
        uptime: this.extractUptime(info),
        totalCommandsProcessed: this.extractTotalCommands(stats),
        instantaneousOpsPerSec: this.extractOpsPerSec(stats),
        keyspaceHits: this.extractKeyspaceHits(stats),
        keyspaceMisses: this.extractKeyspaceMisses(stats),
        expiredKeys: this.extractExpiredKeys(stats),
        evictedKeys: this.extractEvictedKeys(stats),
        hitRate: 0 // سيتم حسابه
      };

      // حساب Hit Rate
      const totalRequests = metrics.keyspaceHits + metrics.keyspaceMisses;
      metrics.hitRate = totalRequests > 0 
        ? Math.round((metrics.keyspaceHits / totalRequests) * 100 * 100) / 100
        : 0;

      return metrics;

    } catch (error) {
      throw new RedisMetricsError(
        'Failed to get Redis connection metrics',
        { operation: 'getConnectionMetrics' },
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  async performLoadTest(
    connection: RedisType, 
    operations: number = 1000,
    concurrency: number = 10
  ): Promise<RedisLoadTestResult> {
    const responseTimes: number[] = [];
    const errors: string[] = [];
    let successfulOps = 0;
    let failedOps = 0;
    const startTime = Date.now();

    try {
      // تقسيم العمليات على batches متزامنة
      const batchSize = Math.ceil(operations / concurrency);
      const batches: Promise<void>[] = [];

      for (let batch = 0; batch < concurrency; batch++) {
        const batchPromise = this.runLoadTestBatch(
          connection,
          batch,
          batchSize,
          responseTimes,
          errors
        ).then(result => {
          successfulOps += result.successful;
          failedOps += result.failed;
        });
        
        batches.push(batchPromise);
      }

      await Promise.all(batches);
      
      const totalTime = Date.now() - startTime;
      const throughputPerSecond = Math.round((operations / totalTime) * 1000);

      // حساب الإحصائيات
      const sortedTimes = responseTimes.sort((a, b) => a - b);
      const percentiles = this.calculatePercentiles(sortedTimes);

      return {
        success: failedOps === 0,
        totalOperations: operations,
        successfulOperations: successfulOps,
        failedOperations: failedOps,
        averageResponseTime: responseTimes.length > 0 
          ? Math.round(responseTimes.reduce((a, b) => a + b) / responseTimes.length)
          : 0,
        minResponseTime: sortedTimes.length > 0 ? sortedTimes[0] : 0,
        maxResponseTime: sortedTimes.length > 0 ? sortedTimes[sortedTimes.length - 1] : 0,
        throughputPerSecond,
        errors: [...new Set(errors)],
        percentiles
      };

    } catch (error) {
      return {
        success: false,
        totalOperations: operations,
        successfulOperations: successfulOps,
        failedOperations: operations,
        averageResponseTime: 0,
        minResponseTime: 0,
        maxResponseTime: 0,
        throughputPerSecond: 0,
        errors: [error instanceof Error ? error.message : String(error)],
        percentiles: { p50: 0, p90: 0, p95: 0, p99: 0 }
      };
    }
  }

  private async runLoadTestBatch(
    connection: RedisType,
    batchId: number,
    batchSize: number,
    responseTimes: number[],
    errors: string[]
  ): Promise<{ successful: number; failed: number }> {
    let successful = 0;
    let failed = 0;

    for (let i = 0; i < batchSize; i++) {
      try {
        const start = Date.now();
        
        // عملية اختبار: كتابة، قراءة، حذف
        const key = `load_test_${batchId}_${i}_${Date.now()}`;
        const value = `value_${batchId}_${i}`;
        
        await connection.set(key, value, 'EX', 30);
        await connection.get(key);
        await connection.del(key);
        
        const responseTime = Date.now() - start;
        responseTimes.push(responseTime);
        successful++;

      } catch (error) {
        failed++;
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    return { successful, failed };
  }

  private calculatePercentiles(sortedTimes: number[]) {
    if (sortedTimes.length === 0) {
      return { p50: 0, p90: 0, p95: 0, p99: 0 };
    }

    const getPercentile = (p: number) => {
      const index = Math.ceil((p / 100) * sortedTimes.length) - 1;
      return sortedTimes[Math.max(0, index)];
    };

    return {
      p50: getPercentile(50),
      p90: getPercentile(90),
      p95: getPercentile(95),
      p99: getPercentile(99)
    };
  }

  async diagnoseConnection(redisUrl: string): Promise<RedisConnectionDiagnosis> {
    let connection: RedisType | null = null;
    
    try {
      connection = new Redis(redisUrl, {
        connectTimeout: 5000,
        lazyConnect: true,
        maxRetriesPerRequest: 1
      });

      const healthResult = await this.performComprehensiveHealthCheck(connection);
      const recommendations: string[] = [];
      let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';
      let healthScore = 100;

      if (!healthResult.connected) {
        severity = 'critical';
        healthScore = 0;
        recommendations.push('إصلاح اتصال Redis فوراً');
        
        if (healthResult.error?.includes('ENOTFOUND')) {
          recommendations.push('فحص DNS والشبكة');
        } else if (healthResult.error?.includes('ECONNREFUSED')) {
          recommendations.push('التأكد من تشغيل خادم Redis');
          recommendations.push('فحص البورت والFirewall');
        } else if (healthResult.error?.includes('timeout')) {
          recommendations.push('زيادة مهلة الاتصال');
        }

        return {
          url: redisUrl,
          diagnosis: `فشل الاتصال: ${healthResult.error}`,
          recommendations,
          severity,
          healthScore
        };
      }

      // تحليل الأداء
      if (healthResult.responseTime && healthResult.responseTime > 100) {
        const timeScore = Math.max(0, 100 - (healthResult.responseTime / 10));
        healthScore = Math.min(healthScore, timeScore);
        
        if (healthResult.responseTime > 1000) {
          severity = 'high';
          recommendations.push('أداء بطيء جداً - فحص خادم Redis');
        } else if (healthResult.responseTime > 500) {
          severity = 'medium';
          recommendations.push('أداء بطيء - تحسين شبكة الاتصال');
        } else {
          recommendations.push('أداء مقبول لكن يمكن تحسينه');
        }
      }

      // تحليل المقاييس
      if (healthResult.metrics) {
        const metrics = healthResult.metrics;
        
        if (metrics.connectedClients > 1000) {
          healthScore = Math.min(healthScore, 70);
          recommendations.push('عدد كبير من الاتصالات - فحص connection pooling');
        }

        if (metrics.hitRate < 90 && metrics.keyspaceHits + metrics.keyspaceMisses > 1000) {
          healthScore = Math.min(healthScore, 80);
          recommendations.push('معدل Hit Rate منخفض - مراجعة استراتيجية التخزين المؤقت');
        }

        if (metrics.memoryUsage.includes('M') && 
            parseInt(metrics.memoryUsage) > 1000) {
          healthScore = Math.min(healthScore, 75);
          recommendations.push('استخدام ذاكرة مرتفع - مراجعة البيانات المخزنة');
        }

        if (metrics.evictedKeys > 1000) {
          healthScore = Math.min(healthScore, 70);
          recommendations.push('Keys متعددة تم طردها - زيادة الذاكرة أو تحسين TTL');
        }
      }

      // تحديد درجة الخطورة بناءً على النتيجة الصحية
      if (healthScore >= 90) {
        severity = 'low';
      } else if (healthScore >= 70) {
        severity = 'medium';
      } else if (healthScore >= 50) {
        severity = 'high';
      } else {
        severity = 'critical';
      }

      if (recommendations.length === 0) {
        recommendations.push('النظام يعمل بشكل مثالي');
      }

      return {
        url: redisUrl,
        diagnosis: `الاتصال ناجح - الاستجابة: ${healthResult.responseTime}ms`,
        recommendations,
        severity,
        metrics: healthResult.metrics,
        healthScore: Math.round(healthScore)
      };

    } catch (error) {
      const redisError = this.errorHandler.handleError(error);
      
      return {
        url: redisUrl,
        diagnosis: `خطأ في التشخيص: ${redisError.message}`,
        recommendations: ['إعادة فحص التكوين والاتصال'],
        severity: 'critical',
        healthScore: 0
      };
    } finally {
      if (connection) {
        try {
          await connection.disconnect();
        } catch {
          // تجاهل أخطاء قطع الاتصال
        }
      }
    }
  }

  // دوال استخراج المعلومات من Redis INFO
  private extractVersion(info: string): string {
    const match = info.match(/redis_version:([^\r\n]+)/);
    return match ? match[1] : 'unknown';
  }

  private extractMemoryUsage(memoryInfo: string): string {
    const match = memoryInfo.match(/used_memory_human:([^\r\n]+)/);
    return match ? match[1] : 'unknown';
  }

  private extractMemoryPeak(memoryInfo: string): string {
    const match = memoryInfo.match(/used_memory_peak_human:([^\r\n]+)/);
    return match ? match[1] : 'unknown';
  }

  private extractMemoryRss(memoryInfo: string): string {
    const match = memoryInfo.match(/used_memory_rss_human:([^\r\n]+)/);
    return match ? match[1] : 'unknown';
  }

  private extractConnectedClients(info: string): number {
    const match = info.match(/connected_clients:(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  private extractBlockedClients(info: string): number {
    const match = info.match(/blocked_clients:(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  private extractUptime(info: string): number {
    const match = info.match(/uptime_in_seconds:(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  private extractTotalCommands(stats: string): number {
    const match = stats.match(/total_commands_processed:(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  private extractOpsPerSec(stats: string): number {
    const match = stats.match(/instantaneous_ops_per_sec:(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  private extractKeyspaceHits(stats: string): number {
    const match = stats.match(/keyspace_hits:(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  private extractKeyspaceMisses(stats: string): number {
    const match = stats.match(/keyspace_misses:(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  private extractExpiredKeys(stats: string): number {
    const match = stats.match(/expired_keys:(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  private extractEvictedKeys(stats: string): number {
    const match = stats.match(/evicted_keys:(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }
}

export default RedisHealthMonitor;