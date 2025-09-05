import { RedisOptions } from 'ioredis';
import { getEnv } from './env.js';

export enum RedisUsageType {
  HEALTH_CHECK = 'health_check',
  QUEUE_SYSTEM = 'queue_system', 
  CACHING = 'caching',
  CACHE = 'cache',
  RATE_LIMITER = 'rate_limiter',
  SESSION = 'session',
  PUBSUB = 'pubsub',
  IDEMPOTENCY = 'idempotency',
  OAUTH = 'oauth'
}

export enum RedisEnvironment {
  DEVELOPMENT = 'development',
  STAGING = 'staging',
  PRODUCTION = 'production',
  DOCKER = 'docker',
  RENDER = 'render',
  HEROKU = 'heroku'
}

export interface BaseRedisConfig {
  host?: string;
  port?: number;
  password?: string;
  keyPrefix?: string;
  tls?: {
    rejectUnauthorized?: boolean;
    servername?: string;
  };
}

export interface HealthCheckRedisConfig extends RedisOptions {
  connectTimeout: number;
  lazyConnect: boolean;
  maxRetriesPerRequest: number;
  enableOfflineQueue: boolean;
  family: number;
}

export interface QueueRedisConfig extends RedisOptions {
  connectTimeout: number;
  lazyConnect: boolean;
  family: number;
  commandTimeout: number;
  retryDelayOnFailover?: number;
}

export interface CachingRedisConfig extends RedisOptions {
  connectTimeout: number;
  lazyConnect: boolean;
  maxRetriesPerRequest: number;
  family: number;
  enableOfflineQueue: boolean;
}

export interface SessionRedisConfig extends RedisOptions {
  connectTimeout: number;
  lazyConnect: boolean;
  maxRetriesPerRequest: number;
  family: number;
  enableReadyCheck: boolean;
  enableOfflineQueue: boolean;
}

export interface PubSubRedisConfig extends RedisOptions {
  connectTimeout: number;
  lazyConnect: boolean;
  maxRetriesPerRequest: number;
  family: number;
  enableReadyCheck: boolean;
  enableOfflineQueue: boolean;
}

// Simplified: Only essential configurations
export type RedisConfiguration = 
  | HealthCheckRedisConfig 
  | QueueRedisConfig 
  | CachingRedisConfig
  | SessionRedisConfig
  | PubSubRedisConfig;

export interface RedisConfigurationFactory {
  createConfiguration(
    usageType: RedisUsageType,
    environment: RedisEnvironment,
    redisUrl: string
  ): RedisConfiguration;
}

export class ProductionRedisConfigurationFactory implements RedisConfigurationFactory {

  createConfiguration(
    usageType: RedisUsageType,
    environment: RedisEnvironment,
    redisUrl: string
  ): RedisConfiguration {

    const baseConfig = this.getBaseConfiguration(redisUrl, environment);

    switch (usageType) {
      case RedisUsageType.QUEUE_SYSTEM:
        return this.createQueueConfiguration(baseConfig);

      case RedisUsageType.HEALTH_CHECK:
        return this.createHealthCheckConfiguration(baseConfig);

      case RedisUsageType.CACHING:
      case RedisUsageType.CACHE:
        return this.createCachingConfiguration(baseConfig);
      
      case RedisUsageType.RATE_LIMITER:
        return this.createRateLimiterConfiguration(baseConfig);
        
      case RedisUsageType.IDEMPOTENCY:
        return this.createIdempotencyConfiguration(baseConfig);

      case RedisUsageType.SESSION:
        return this.createSessionConfiguration(baseConfig);

      case RedisUsageType.PUBSUB:
        return this.createPubSubConfiguration(baseConfig);

      default:
        throw new Error(`Unsupported Redis usage type: ${usageType}`);
    }
  }

  private getBaseConfiguration(redisUrl: string, environment: RedisEnvironment): BaseRedisConfig {
    const isSecure = redisUrl.startsWith('rediss://');
    
    // استخراج معلومات الاتصال من URL
    let parsedConfig: BaseRedisConfig = {};
    
    try {
      const url = new URL(redisUrl);
      parsedConfig = {
        host: url.hostname,
        port: parseInt(url.port) || 6379,
        ...(url.password && { password: url.password }),
        keyPrefix: this.getKeyPrefix(environment),
        ...(isSecure && (() => {
          const strict = process.env.REDIS_SSL_STRICT === 'true';
          const ca = process.env.REDIS_CA;
          return {
            tls: {
              rejectUnauthorized: strict ? true : false,
              ...(ca ? { ca } : {}),
              servername: url.hostname
            }
          };
        })())
      };
    } catch (error) {
      // في حالة URL غير صحيح، استخدم الإعدادات الافتراضية
      parsedConfig = {
        host: 'localhost',
        port: 6379,
        keyPrefix: this.getKeyPrefix(environment)
      };
    }

    return parsedConfig;
  }

  private createQueueConfiguration(baseConfig: BaseRedisConfig): QueueRedisConfig {
    // Upstash-specific configuration for rate limiting
    const isUpstash = baseConfig.host?.includes('upstash.io') || 
                     baseConfig.host?.includes('redis.upstash.com');
    
    return {
      host: baseConfig.host || 'localhost',
      port: baseConfig.port || 6379,
      ...(baseConfig.password && { password: baseConfig.password }),
      connectTimeout: this.getTimeoutByEnvironment(10000, 15000),
      lazyConnect: true,
      family: 4,
      commandTimeout: 8000,
      enableOfflineQueue: true,
      // Upstash rate limit configuration
      maxRetriesPerRequest: Number(process.env.REDIS_MAX_RETRIES || (isUpstash ? 3 : 5)),
      autoResendUnfulfilledCommands: isUpstash ? false : true,
      ...(isUpstash && {
        reconnectOnError: (err: Error) => {
          // Return false for rate limit errors to prevent reconnection spinning
          return err.message.includes('max requests limit exceeded') ? false : 1;
        }
      }),
      ...(baseConfig.tls && { tls: baseConfig.tls })
    };
  }

  private createHealthCheckConfiguration(baseConfig: BaseRedisConfig): HealthCheckRedisConfig {
    const isUpstash = baseConfig.host?.includes('upstash.io') || 
                     baseConfig.host?.includes('redis.upstash.com');
    
    return {
      host: baseConfig.host || 'localhost',
      port: baseConfig.port || 6379,
      ...(baseConfig.password && { password: baseConfig.password }),
      connectTimeout: 5000,
      lazyConnect: true,
      maxRetriesPerRequest: Number(process.env.REDIS_MAX_RETRIES || (isUpstash ? 3 : 5)),
      enableOfflineQueue: true,
      family: 4,
      keyPrefix: `${baseConfig.keyPrefix}health:`,
      // Upstash rate limit handling
      autoResendUnfulfilledCommands: isUpstash ? false : true,
      ...(isUpstash && {
        reconnectOnError: (err: Error) => {
          return err.message.includes('max requests limit exceeded') ? false : 1;
        }
      }),
      ...(baseConfig.tls && { tls: baseConfig.tls })
    };
  }

  private createCachingConfiguration(baseConfig: BaseRedisConfig): CachingRedisConfig {
    const config: CachingRedisConfig = {
      connectTimeout: 8000,
      lazyConnect: true,
      maxRetriesPerRequest: 1, // تقليل إلى 1 لتجنب MaxRetriesPerRequestError
      family: 4,
      keyPrefix: `${baseConfig.keyPrefix}cache:`,
      enableOfflineQueue: true
    };
    
    if (baseConfig.host) config.host = baseConfig.host;
    if (baseConfig.port) config.port = baseConfig.port;
    if (baseConfig.password) config.password = baseConfig.password;
    if (baseConfig.tls) config.tls = baseConfig.tls;
    
    return config;
  }

  private createRateLimiterConfiguration(baseConfig: BaseRedisConfig): CachingRedisConfig {
    const config: CachingRedisConfig = {
      connectTimeout: 8000,
      lazyConnect: true,
      maxRetriesPerRequest: 1, // تقليل إلى 1 لتجنب MaxRetriesPerRequestError
      family: 4,
      keyPrefix: `${baseConfig.keyPrefix}ratelimit:`,
      enableOfflineQueue: true
    };
    
    if (baseConfig.host) config.host = baseConfig.host;
    if (baseConfig.port) config.port = baseConfig.port;
    if (baseConfig.password) config.password = baseConfig.password;
    if (baseConfig.tls) config.tls = baseConfig.tls;
    
    return config;
  }

  private createIdempotencyConfiguration(baseConfig: BaseRedisConfig): CachingRedisConfig {
    const config: CachingRedisConfig = {
      connectTimeout: 8000,
      lazyConnect: true,
      maxRetriesPerRequest: 1, // تقليل إلى 1 لتجنب MaxRetriesPerRequestError
      family: 4,
      keyPrefix: `${baseConfig.keyPrefix}idempotency:`,
      enableOfflineQueue: true,
      enableReadyCheck: true // إضافة ready check
    };
    
    if (baseConfig.host) config.host = baseConfig.host;
    if (baseConfig.port) config.port = baseConfig.port;
    if (baseConfig.password) config.password = baseConfig.password;
    if (baseConfig.tls) config.tls = baseConfig.tls;
    
    return config;
  }

  private createSessionConfiguration(baseConfig: BaseRedisConfig): SessionRedisConfig {
    const config: SessionRedisConfig = {
      connectTimeout: 10000,
      lazyConnect: true,
      maxRetriesPerRequest: 1, // تقليل إلى 1 لتجنب MaxRetriesPerRequestError
      family: 4,
      keyPrefix: `${baseConfig.keyPrefix}session:`,
      keepAlive: 30000, // 30 ثانية للsessions
      enableOfflineQueue: true, // مسموح للsessions
      enableReadyCheck: true // إضافة enableReadyCheck
    };
    
    if (baseConfig.host) config.host = baseConfig.host;
    if (baseConfig.port) config.port = baseConfig.port;
    if (baseConfig.password) config.password = baseConfig.password;
    if (baseConfig.tls) config.tls = baseConfig.tls;
    
    return config;
  }

  private createPubSubConfiguration(baseConfig: BaseRedisConfig): PubSubRedisConfig {
    const config: PubSubRedisConfig = {
      connectTimeout: 5000,
      lazyConnect: true,
      family: 4,
      keyPrefix: `${baseConfig.keyPrefix}pubsub:`,
      enableOfflineQueue: true, // ✅ تغيير للتوافق مع Upstash (سيتم تجاهلها للpubsub)
      maxRetriesPerRequest: 0, // لا نريد إعادة محاولة للpubsub
      enableReadyCheck: true // إضافة enableReadyCheck
    };
    
    if (baseConfig.host) config.host = baseConfig.host;
    if (baseConfig.port) config.port = baseConfig.port;
    if (baseConfig.password) config.password = baseConfig.password;
    if (baseConfig.tls) config.tls = baseConfig.tls;
    
    return config;
  }

  private getKeyPrefix(environment: RedisEnvironment): string {
    switch (environment) {
      case RedisEnvironment.DEVELOPMENT:
        return 'ai-sales-dev:';
      case RedisEnvironment.STAGING:
        return 'ai-sales-staging:';
      case RedisEnvironment.PRODUCTION:
        return 'ai-sales-prod:';
      case RedisEnvironment.DOCKER:
        return 'ai-sales-docker:';
      case RedisEnvironment.RENDER:
        return 'ai-sales-render:';
      case RedisEnvironment.HEROKU:
        return 'ai-sales-heroku:';
      default:
        return 'ai-sales:';
    }
  }

  private getTimeoutByEnvironment(defaultTimeout: number, cloudTimeout: number): number {
    const environment = this.detectEnvironment();
    
    // البيئات السحابية تحتاج timeout أطول
    if (environment === RedisEnvironment.RENDER || 
        environment === RedisEnvironment.HEROKU) {
      return cloudTimeout;
    }
    
    return defaultTimeout;
  }

  private detectEnvironment(): RedisEnvironment {
    const nodeEnv = getEnv('NODE_ENV');
    
    if (nodeEnv === 'development') {
      return RedisEnvironment.DEVELOPMENT;
    }
    
    if (nodeEnv === 'test') {
      return RedisEnvironment.DEVELOPMENT; // Treat test as development
    }
    
    if (getEnv('ENVIRONMENT') === 'staging') {
      return RedisEnvironment.STAGING;
    }
    
    if (getEnv('RENDER') || getEnv('RENDER_SERVICE_ID')) {
      return RedisEnvironment.RENDER;
    }
    
    if (getEnv('DYNO')) {
      return RedisEnvironment.HEROKU;
    }
    
    if (getEnv('DOCKER') || getEnv('IS_DOCKER')) {
      return RedisEnvironment.DOCKER;
    }
    
    return RedisEnvironment.PRODUCTION;
  }

  static validateConfiguration(config: RedisConfiguration): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // فحص الحقول المطلوبة
    if (!config.host && !config.port) {
      errors.push('Host or port configuration is missing');
    }

    // فحص المهل الزمنية
    if (config.connectTimeout && config.connectTimeout < 1000) {
      warnings.push('connectTimeout is less than 1 second - may cause connection issues');
    }

    if (config.connectTimeout && config.connectTimeout > 30000) {
      warnings.push('connectTimeout is very high - may cause slow startup');
    }

    // فحص عدد المحاولات
    if ('maxRetriesPerRequest' in config && 
        config.maxRetriesPerRequest && 
        config.maxRetriesPerRequest > 5) {
      warnings.push('maxRetriesPerRequest is high - may cause delays');
    }

    // فحص البادئة
    if (!config.keyPrefix) {
      warnings.push('keyPrefix is not set - recommended for data organization');
    }

    // فحص إعدادات TLS
    if (config.tls && config.tls.rejectUnauthorized === false) {
      warnings.push('TLS rejectUnauthorized=false - less secure but needed for some providers');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  static createForEnvironment(
    usageType: RedisUsageType,
    redisUrl?: string
  ): RedisConfiguration {
    const factory = new ProductionRedisConfigurationFactory();
    const environment = factory.detectEnvironment();
    const url = redisUrl || getEnv('REDIS_URL') || 'redis://localhost:6379';

    return factory.createConfiguration(usageType, environment, url);
  }
}

export default ProductionRedisConfigurationFactory;
