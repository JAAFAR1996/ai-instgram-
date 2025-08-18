import Redis from 'ioredis';

export interface RedisHealthResult {
  connected: boolean;
  responseTime?: number;
  error?: string;
  serverInfo?: any;
  version?: string;
  memory?: string;
  clients?: number;
}

export class RedisHealthChecker {
  private timeout: number;

  constructor(timeout: number = 5000) {
    this.timeout = timeout;
  }

  async checkConnection(redisUrl: string): Promise<RedisHealthResult> {
    const redis = new Redis(redisUrl, {
      connectTimeout: this.timeout,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryDelayOnFailover: 100,
      enableOfflineQueue: false,
      family: 4
    });

    try {
      await redis.connect();
      
      const startTime = Date.now();
      await redis.ping();
      const responseTime = Date.now() - startTime;
      
      // جمع معلومات إضافية عن الخادم
      const [info, memory, clients] = await Promise.all([
        redis.info(),
        redis.info('memory'),
        redis.info('clients')
      ]);
      
      // استخراج المعلومات المهمة
      const version = this.extractVersion(info);
      const memoryUsage = this.extractMemoryUsage(memory);
      const connectedClients = this.extractConnectedClients(clients);
      
      await redis.disconnect();
      
      return {
        connected: true,
        responseTime,
        serverInfo: info,
        version,
        memory: memoryUsage,
        clients: connectedClients
      };

    } catch (error) {
      try {
        await redis.disconnect();
      } catch {
        // تجاهل أخطاء قطع الاتصال
      }

      return {
        connected: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async checkMultipleConnections(redisUrls: string[]): Promise<{
    totalChecked: number;
    successful: number;
    failed: number;
    results: Array<{ url: string; result: RedisHealthResult }>;
  }> {
    const results = await Promise.all(
      redisUrls.map(async (url) => ({
        url,
        result: await this.checkConnection(url)
      }))
    );

    const successful = results.filter(r => r.result.connected).length;
    const failed = results.length - successful;

    return {
      totalChecked: results.length,
      successful,
      failed,
      results
    };
  }

  async performLoadTest(redisUrl: string, operations: number = 100): Promise<{
    success: boolean;
    totalOperations: number;
    successfulOperations: number;
    failedOperations: number;
    averageResponseTime: number;
    errors: string[];
  }> {
    const redis = new Redis(redisUrl, {
      connectTimeout: this.timeout,
      lazyConnect: true,
      maxRetriesPerRequest: 1
    });

    let successfulOps = 0;
    let failedOps = 0;
    const responseTimes: number[] = [];
    const errors: string[] = [];

    try {
      await redis.connect();

      // تنفيذ عمليات اختبار التحميل
      for (let i = 0; i < operations; i++) {
        try {
          const start = Date.now();
          
          // عملية بسيطة: كتابة وقراءة
          const key = `load_test_${i}_${Date.now()}`;
          await redis.set(key, `value_${i}`, 'EX', 10); // انتهاء خلال 10 ثوان
          await redis.get(key);
          await redis.del(key);
          
          const responseTime = Date.now() - start;
          responseTimes.push(responseTime);
          successfulOps++;

        } catch (error) {
          failedOps++;
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }

      await redis.disconnect();

      const averageResponseTime = responseTimes.length > 0 
        ? responseTimes.reduce((a, b) => a + b) / responseTimes.length 
        : 0;

      return {
        success: failedOps === 0,
        totalOperations: operations,
        successfulOperations: successfulOps,
        failedOperations: failedOps,
        averageResponseTime,
        errors: [...new Set(errors)] // إزالة الأخطاء المكررة
      };

    } catch (error) {
      try {
        await redis.disconnect();
      } catch {
        // تجاهل أخطاء قطع الاتصال
      }

      return {
        success: false,
        totalOperations: operations,
        successfulOperations: successfulOps,
        failedOperations: operations,
        averageResponseTime: 0,
        errors: [error instanceof Error ? error.message : String(error)]
      };
    }
  }

  private extractVersion(info: string): string {
    const versionMatch = info.match(/redis_version:([^\r\n]+)/);
    return versionMatch ? versionMatch[1] : 'unknown';
  }

  private extractMemoryUsage(memoryInfo: string): string {
    const memoryMatch = memoryInfo.match(/used_memory_human:([^\r\n]+)/);
    return memoryMatch ? memoryMatch[1] : 'unknown';
  }

  private extractConnectedClients(clientsInfo: string): number {
    const clientsMatch = clientsInfo.match(/connected_clients:(\d+)/);
    return clientsMatch ? parseInt(clientsMatch[1]) : 0;
  }

  async diagnoseConnection(redisUrl: string): Promise<{
    url: string;
    diagnosis: string;
    recommendations: string[];
    severity: 'low' | 'medium' | 'high' | 'critical';
  }> {
    const result = await this.checkConnection(redisUrl);
    
    if (result.connected) {
      const recommendations: string[] = [];
      let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';

      // تحليل زمن الاستجابة
      if (result.responseTime && result.responseTime > 100) {
        recommendations.push('زمن الاستجابة مرتفع - فحص شبكة الاتصال');
        severity = result.responseTime > 500 ? 'high' : 'medium';
      }

      // تحليل عدد العملاء
      if (result.clients && result.clients > 1000) {
        recommendations.push('عدد كبير من الاتصالات المتزامنة - فحص تجميع الاتصالات');
        severity = 'medium';
      }

      return {
        url: redisUrl,
        diagnosis: `الاتصال ناجح - الاستجابة: ${result.responseTime}ms`,
        recommendations,
        severity
      };

    } else {
      let severity: 'high' | 'critical' = 'high';
      const recommendations = ['فحص URL الخاص بريديس', 'التأكد من تشغيل خادم ريديس'];

      if (result.error?.includes('ENOTFOUND')) {
        recommendations.push('فحص DNS والشبكة');
        severity = 'critical';
      } else if (result.error?.includes('ECONNREFUSED')) {
        recommendations.push('فحص البورت والFirewall');
        severity = 'critical';
      } else if (result.error?.includes('timeout')) {
        recommendations.push('زيادة مهلة الاتصال');
        severity = 'high';
      }

      return {
        url: redisUrl,
        diagnosis: `فشل الاتصال: ${result.error}`,
        recommendations,
        severity
      };
    }
  }
}

export default RedisHealthChecker;