import { RedisOptions } from 'ioredis';

export enum RedisUsageType {
  HEALTH_CHECK = 'health_check',
  QUEUE_SYSTEM = 'queue_system',
  CACHING = 'caching',
  SESSION = 'session',
  PUBSUB = 'pubsub',
  OAUTH = 'oauth',
  RATE_LIMITER = 'rate_limiter',
  IDEMPOTENCY = 'idempotency'
}

export enum Environment {
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
  keepAlive: number;
}

export interface PubSubRedisConfig extends RedisOptions {
  connectTimeout: number;
  lazyConnect: boolean;
  family: number;
  enableOfflineQueue: boolean;
  maxRetriesPerRequest: number;
}

export type RedisConfiguration = 
  | HealthCheckRedisConfig 
  | QueueRedisConfig 
  | CachingRedisConfig 
  | SessionRedisConfig 
  | PubSubRedisConfig;

export interface RedisConfigurationFactory {
  createConfiguration(
    usageType: RedisUsageType,
    environment: Environment,
    redisUrl: string
  ): RedisConfiguration;
}

export class ProductionRedisConfigurationFactory implements RedisConfigurationFactory {

  createConfiguration(
    usageType: RedisUsageType,
    environment: Environment,
    redisUrl: string
  ): RedisConfiguration {

    const baseConfig = this.getBaseConfiguration(redisUrl, environment);

    switch (usageType) {
      case RedisUsageType.QUEUE_SYSTEM:
        return this.createQueueConfiguration(baseConfig);

      case RedisUsageType.HEALTH_CHECK:
        return this.createHealthCheckConfiguration(baseConfig);

      case RedisUsageType.CACHING:
        return this.createCachingConfiguration(baseConfig);

      case RedisUsageType.SESSION:
        return this.createSessionConfiguration(baseConfig);

      case RedisUsageType.PUBSUB:
        return this.createPubSubConfiguration(baseConfig);

      default:
        throw new Error(`Unsupported Redis usage type: ${usageType}`);
    }
  }

  private getBaseConfiguration(redisUrl: string, environment: Environment): BaseRedisConfig {
    const isSecure = redisUrl.startsWith('rediss://');
    
    // استخراج معلومات الاتصال من URL
    let parsedConfig: BaseRedisConfig = {};
    
    try {
      const url = new URL(redisUrl);
      parsedConfig = {
        host: url.hostname,
        port: parseInt(url.port) || 6379,
        password: url.password || undefined,
        keyPrefix: this.getKeyPrefix(environment),
        ...(isSecure && {
          tls: {
            rejectUnauthorized: false,
            servername: url.hostname
          }
        })
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
      host: baseConfig.host,
      port: baseConfig.port,
      password: baseConfig.password,
      connectTimeout: this.getTimeoutByEnvironment(10000, 15000),
      lazyConnect: true,
      family: 4,
      keyPrefix: `${baseConfig.keyPrefix}queue:`,
      commandTimeout: 8000,
      enableOfflineQueue: true,
      // Upstash rate limit configuration
      maxRetriesPerRequest: isUpstash ? 1 : 3,
      autoResendUnfulfilledCommands: isUpstash ? false : true,
      reconnectOnError: isUpstash ? (err: Error) => {
        // Return false for rate limit errors to prevent reconnection spinning
        return err.message.includes('max requests limit exceeded') ? false : 1;
      } : undefined,
      ...(baseConfig.tls && { tls: baseConfig.tls })
    };
  }

  private createHealthCheckConfiguration(baseConfig: BaseRedisConfig): HealthCheckRedisConfig {
    const isUpstash = baseConfig.host?.includes('upstash.io') || 
                     baseConfig.host?.includes('redis.upstash.com');
    
    return {
      host: baseConfig.host,
      port: baseConfig.port,
      password: baseConfig.password,
      connectTimeout: 5000,
      lazyConnect: true,
      maxRetriesPerRequest: isUpstash ? 1 : 3,
      enableOfflineQueue: true,
      family: 4,
      keyPrefix: `${baseConfig.keyPrefix}health:`,
      // Upstash rate limit handling
      autoResendUnfulfilledCommands: isUpstash ? false : true,
      reconnectOnError: isUpstash ? (err: Error) => {
        return err.message.includes('max requests limit exceeded') ? false : 1;
      } : undefined,
      ...(baseConfig.tls && { tls: baseConfig.tls })
    };
  }

  private createCachingConfiguration(baseConfig: BaseRedisConfig): CachingRedisConfig {
    return {
      host: baseConfig.host,
      port: baseConfig.port,
      password: baseConfig.password,
      connectTimeout: 8000,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      family: 4,
      keyPrefix: `${baseConfig.keyPrefix}cache:`,
      enableOfflineQueue: true, // ✅ تغيير لضمان التوافق مع Upstash
      ...(baseConfig.tls && { tls: baseConfig.tls })
    };
  }

  private createSessionConfiguration(baseConfig: BaseRedisConfig): SessionRedisConfig {
    return {
      host: baseConfig.host,
      port: baseConfig.port,
      password: baseConfig.password,
      connectTimeout: 10000,
      lazyConnect: true,
      maxRetriesPerRequest: 5, // مهم للsessions
      family: 4,
      keyPrefix: `${baseConfig.keyPrefix}session:`,
      keepAlive: 30000, // 30 ثانية للsessions
      enableOfflineQueue: true, // مسموح للsessions
      ...(baseConfig.tls && { tls: baseConfig.tls })
    };
  }

  private createPubSubConfiguration(baseConfig: BaseRedisConfig): PubSubRedisConfig {
    return {
      host: baseConfig.host,
      port: baseConfig.port,
      password: baseConfig.password,
      connectTimeout: 5000,
      lazyConnect: true,
      family: 4,
      keyPrefix: `${baseConfig.keyPrefix}pubsub:`,
      enableOfflineQueue: true, // ✅ تغيير للتوافق مع Upstash (سيتم تجاهلها للpubsub)
      maxRetriesPerRequest: 0, // لا نريد إعادة محاولة للpubsub
      ...(baseConfig.tls && { tls: baseConfig.tls })
    };
  }

  private getKeyPrefix(environment: Environment): string {
    switch (environment) {
      case Environment.DEVELOPMENT:
        return 'ai-sales-dev:';
      case Environment.STAGING:
        return 'ai-sales-staging:';
      case Environment.PRODUCTION:
        return 'ai-sales-prod:';
      case Environment.DOCKER:
        return 'ai-sales-docker:';
      case Environment.RENDER:
        return 'ai-sales-render:';
      case Environment.HEROKU:
        return 'ai-sales-heroku:';
      default:
        return 'ai-sales:';
    }
  }

  private getTimeoutByEnvironment(defaultTimeout: number, cloudTimeout: number): number {
    const environment = this.detectEnvironment();
    
    // البيئات السحابية تحتاج timeout أطول
    if (environment === Environment.RENDER || 
        environment === Environment.HEROKU) {
      return cloudTimeout;
    }
    
    return defaultTimeout;
  }

  private detectEnvironment(): Environment {
    const nodeEnv = process.env.NODE_ENV;
    
    if (nodeEnv === 'development') {
      return Environment.DEVELOPMENT;
    }
    
    if (nodeEnv === 'test') {
      return Environment.DEVELOPMENT; // Treat test as development
    }
    
    if (process.env.ENVIRONMENT === 'staging') {
      return Environment.STAGING;
    }
    
    if (process.env.RENDER || process.env.RENDER_SERVICE_ID) {
      return Environment.RENDER;
    }
    
    if (process.env.DYNO) {
      return Environment.HEROKU;
    }
    
    if (process.env.DOCKER || process.env.IS_DOCKER) {
      return Environment.DOCKER;
    }
    
    return Environment.PRODUCTION;
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
    const url = redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';

    return factory.createConfiguration(usageType, environment, url);
  }
}

export default ProductionRedisConfigurationFactory;