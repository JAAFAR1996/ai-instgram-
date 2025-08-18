import { RedisOptions } from 'ioredis';

export interface ProductionRedisConfig extends RedisOptions {
  // إعدادات خاصة بالإنتاج
  enableReadyCheck?: boolean;
  maxLoadingTimeout?: number;
  enableAutoPipelining?: boolean;
}

export class RedisProductionConfig {
  static getProductionConfig(redisUrl: string): ProductionRedisConfig {
    const isSecure = redisUrl.startsWith('rediss://');
    
    return {
      // إعدادات الاتصال الأساسية
      connectTimeout: 10000,           // 10 ثواني للاتصال
      lazyConnect: true,               // عدم الاتصال الفوري
      maxLoadingTimeout: 5000,         // أقصى انتظار للتحميل
      enableReadyCheck: true,          // التحقق من جاهزية الخادم

      // إعدادات إعادة المحاولة المتقدمة
      maxRetriesPerRequest: 5,         // أقصى محاولات لكل طلب
      
      // إعدادات الشبكة
      family: 4,                       // IPv4
      keepAlive: 10000,                // الحفاظ على الاتصال حياً (10 ثوان)
      
      // معالجة الأخطاء والاستعادة
      reconnectOnError: (error: Error) => {
        // إعادة الاتصال في حالات معينة
        const targetErrors = [
          'READONLY',
          'ECONNRESET', 
          'ENOTFOUND',
          'ENETUNREACH'
        ];
        
        return targetErrors.some(targetError => 
          error.message.includes(targetError)
        );
      },
      
      // مراقبة الصحة وتحسين الأداء
      enableOfflineQueue: false,       // عدم تشغيل طابور في وضع عدم الاتصال
      enableAutoPipelining: true,      // تحسين أداء العمليات المتعددة
      
      // مهل زمنية للإنتاج
      commandTimeout: 8000,            // 8 ثواني لكل أمر
      
      // بادئة المفاتيح لتنظيم البيانات
      keyPrefix: 'ai-sales:',
      
      // إعدادات TLS للاتصالات المشفرة
      ...(isSecure && {
        tls: {
          rejectUnauthorized: false,   // للبيئات الاستضافة المدارة
          servername: RedisProductionConfig.extractHostname(redisUrl)
        }
      }),

      // إعدادات متقدمة للأداء - سياسة إدارة الذاكرة يتم تعيينها على خادم ريديس نفسه
    };
  }

  static getRedisClusterConfig(redisUrls: string[]): ProductionRedisConfig {
    return {
      ...RedisProductionConfig.getProductionConfig(redisUrls[0]),
      
      // إعدادات خاصة بـ Redis Cluster
      enableReadyCheck: false,         // غير مطلوب في Cluster
      
      // ملاحظة: إعدادات Cluster يتم تكوينها منفصلة في ioredis cluster mode
    };
  }

  static getLocalDevelopmentConfig(): ProductionRedisConfig {
    return {
      host: 'localhost',
      port: 6379,
      connectTimeout: 5000,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      keyPrefix: 'ai-sales-dev:',
      enableOfflineQueue: true,        // مسموح في التطوير
      maxLoadingTimeout: 2000
    };
  }

  static getDockerConfig(containerName: string = 'redis'): ProductionRedisConfig {
    return {
      host: containerName,
      port: 6379,
      connectTimeout: 5000,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      keyPrefix: 'ai-sales-docker:',
      enableOfflineQueue: false
    };
  }

  static getRenderConfig(): ProductionRedisConfig {
    const redisUrl = process.env.REDIS_URL || process.env.REDISCLOUD_URL;
    
    if (!redisUrl) {
      throw new Error('REDIS_URL not found in Render environment');
    }

    return {
      ...RedisProductionConfig.getProductionConfig(redisUrl),
      
      // إعدادات خاصة بـ Render
      connectTimeout: 15000,           // Render قد يحتاج وقت أطول
      maxRetriesPerRequest: 6,         // محاولات إضافية
      keyPrefix: 'ai-sales-render:',
      
      // مراقبة محسنة للاستضافة السحابية
      enableReadyCheck: true,
      maxLoadingTimeout: 8000
    };
  }

  static getHerokuConfig(): ProductionRedisConfig {
    const redisUrl = process.env.REDIS_URL || process.env.REDISCLOUD_URL;
    
    if (!redisUrl) {
      throw new Error('REDIS_URL not found in Heroku environment');
    }

    return {
      ...RedisProductionConfig.getProductionConfig(redisUrl),
      
      // إعدادات خاصة بـ Heroku
      connectTimeout: 12000,
      maxRetriesPerRequest: 5,
      keyPrefix: 'ai-sales-heroku:',
      
      // تحسينات Heroku محددة
      enableAutoPipelining: true,
      maxLoadingTimeout: 6000
    };
  }

  // دوال مساعدة
  private static extractHostname(url: string): string {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.hostname;
    } catch {
      return 'localhost';
    }
  }

  static validateConfig(config: ProductionRedisConfig): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // فحص المهل الزمنية
    if (config.connectTimeout && config.connectTimeout < 1000) {
      warnings.push('connectTimeout أقل من ثانية واحدة - قد يسبب مشاكل');
    }

    if (config.commandTimeout && config.commandTimeout < 1000) {
      warnings.push('commandTimeout أقل من ثانية واحدة - قد يسبب مشاكل');
    }

    // فحص عدد المحاولات
    if (config.maxRetriesPerRequest && config.maxRetriesPerRequest > 10) {
      warnings.push('maxRetriesPerRequest عالي جداً - قد يسبب بطء');
    }

    // فحص البادئة
    if (!config.keyPrefix || config.keyPrefix === '') {
      warnings.push('keyPrefix غير محدد - ينصح بتحديده لتنظيم البيانات');
    }

    // فحص إعدادات TLS
    if (config.tls && config.tls.rejectUnauthorized === false) {
      warnings.push('TLS rejectUnauthorized=false - أقل أماناً لكن ضروري لبعض مقدمي الخدمة');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  static createConfigForEnvironment(): ProductionRedisConfig {
    const environment = process.env.NODE_ENV || 'development';
    const platform = process.env.PLATFORM || 'unknown';

    // اختيار التكوين بناءً على البيئة والمنصة
    if (environment === 'development') {
      return RedisProductionConfig.getLocalDevelopmentConfig();
    }

    if (platform === 'render' || process.env.RENDER) {
      return RedisProductionConfig.getRenderConfig();
    }

    if (platform === 'heroku' || process.env.DYNO) {
      return RedisProductionConfig.getHerokuConfig();
    }

    if (process.env.REDIS_URL) {
      return RedisProductionConfig.getProductionConfig(process.env.REDIS_URL);
    }

    // التراجع إلى الإعداد المحلي
    console.warn('لم يتم العثور على تكوين ريديس محدد، استخدام التكوين المحلي');
    return RedisProductionConfig.getLocalDevelopmentConfig();
  }
}

export default RedisProductionConfig;