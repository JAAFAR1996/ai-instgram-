import { Redis } from 'ioredis';
import type { Redis as RedisType } from 'ioredis';
import {
  RedisUsageType,
  Environment,
  ProductionRedisConfigurationFactory,
  RedisConfiguration
} from '../config/RedisConfigurationFactory.js';
import RedisHealthMonitor from './RedisHealthMonitor.js';
import {
  RedisConnectionError,
  RedisValidationError,
  RedisErrorHandler,
  isConnectionError,
  isTimeoutError,
  RedisRateLimitError
} from '../errors/RedisErrors.js';

export interface ConnectionInfo {
  usageType: RedisUsageType;
  host?: string;
  port?: number;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  connectedAt?: Date;
  lastError?: string;
  reconnectAttempts: number;
  healthScore: number; // 0-100
}

export interface ConnectionStats {
  totalConnections: number;
  activeConnections: number;
  errorConnections: number;
  totalReconnects: number;
  averageHealthScore: number;
  connectionsByType: Record<RedisUsageType, number>;
}

export interface ConnectionPoolConfig {
  maxConnections: number;
  connectionTimeout: number;
  healthCheckInterval: number;
  reconnectDelay: number;
  maxReconnectAttempts: number;
}

export class RedisConnectionManager {
  private connections: Map<RedisUsageType, RedisType> = new Map();
  private connectionInfo: Map<RedisUsageType, ConnectionInfo> = new Map();
  private configFactory: ProductionRedisConfigurationFactory;
  private healthMonitor: RedisHealthMonitor;
  private errorHandler: RedisErrorHandler;
  private healthCheckInterval?: NodeJS.Timeout;
  private poolConfig: ConnectionPoolConfig;
  private rateLimitResetAt?: Date;

  constructor(
    private redisUrl: string,
    private environment: Environment,
    private logger?: any,
    poolConfig?: Partial<ConnectionPoolConfig>
  ) {
    this.configFactory = new ProductionRedisConfigurationFactory();
    this.healthMonitor = new RedisHealthMonitor(logger);
    this.errorHandler = new RedisErrorHandler(logger);
    
    this.poolConfig = {
      maxConnections: 10,
      connectionTimeout: 10000,
      healthCheckInterval: 30000, // 30 ثانية
      reconnectDelay: 5000,
      maxReconnectAttempts: 5,
      ...poolConfig
    };

    // this.startHealthChecking(); // DISABLED: Using centralized health check instead
  }

  private setRateLimitReset(): Date {
    const now = new Date();
    const reset = new Date(now);
    reset.setHours(reset.getHours() + 1, 0, 0, 0);
    this.rateLimitResetAt = reset;
    return reset;
  }

  private isRateLimited(): boolean {
    return !!this.rateLimitResetAt && this.rateLimitResetAt > new Date();
  }

  async getConnection(usageType: RedisUsageType): Promise<RedisType> {
    if (this.isRateLimited()) {
      const error = new RedisRateLimitError('Rate limit exceeded', {
        retryAt: this.rateLimitResetAt
      });
      this.logger?.warn('Redis rate limit active - connection blocked', {
        usageType,
        retryAt: this.rateLimitResetAt
      });
      throw error;
    }

    // التحقق من وجود اتصال صحي
    if (this.connections.has(usageType)) {
      const connection = this.connections.get(usageType)!;
      const info = this.connectionInfo.get(usageType);
      
      if (info?.status === 'connected') {
        // فحص سريع للصحة
        const isHealthy = await this.healthMonitor.isConnectionHealthy(connection, 1000);
        if (isHealthy) {
          return connection;
        } else {
          // الاتصال غير صحي، إعادة الاتصال
          this.logger?.warn('Connection unhealthy, reconnecting', { usageType });
          await this.closeConnection(usageType);
        }
      }
    }

    return await this.createConnection(usageType);
  }

  async createConnection(usageType: RedisUsageType): Promise<RedisType> {
    if (this.connections.size >= this.poolConfig.maxConnections) {
      throw new RedisConnectionError(
        'Connection pool limit exceeded',
        { 
          currentConnections: this.connections.size, 
          maxConnections: this.poolConfig.maxConnections 
        }
      );
    }

    const info: ConnectionInfo = {
      usageType,
      status: 'connecting',
      connectedAt: undefined,
      reconnectAttempts: 0,
      healthScore: 0
    };

    this.connectionInfo.set(usageType, info);

    try {
      const config = this.configFactory.createConfiguration(
        usageType,
        this.environment,
        this.redisUrl
      );

      info.host = config.host;
      info.port = config.port;

      this.logger?.info('Creating Redis connection', {
        usageType,
        host: config.host,
        port: config.port,
        environment: this.environment
      });

      const connection = new Redis(config);

      // إعداد مراقبة الأحداث أولاً
      this.setupConnectionMonitoring(connection, usageType, info);

      // التحقق من صحة الاتصال مباشرة (بدون انتظار ready state)
      // العمليات ستنجح إذا كان الاتصال يعمل، حتى لو status !== 'ready'
      await this.healthMonitor.validateConnection(connection);

      // تحديث معلومات الاتصال
      info.status = 'connected';
      info.connectedAt = new Date();
      info.lastError = undefined;
      info.healthScore = 100;

      this.connections.set(usageType, connection);

      this.logger?.info('Redis connection established successfully', {
        usageType,
        host: config.host,
        port: config.port,
        totalConnections: this.connections.size
      });

      return connection;

    } catch (error) {
      const redisError = this.errorHandler.handleError(error, {
        usageType,
        operation: 'createConnection'
      });
      if (redisError instanceof RedisRateLimitError) {
        const retryAt = this.setRateLimitReset();
        info.status = 'error';
        info.lastError = redisError.message;
        info.healthScore = 0;
        this.logger?.warn('Redis rate limit exceeded, reconnection paused', {
          usageType,
          retryAt
        });
        // schedule reconnection after the rate limit resets
        this.scheduleReconnection(usageType, info);
        throw redisError;
      }

      info.status = 'error';
      info.lastError = redisError.message;
      info.healthScore = 0;

      this.logger?.error('Failed to create Redis connection', {
        usageType,
        error: redisError.message,
        code: redisError.code
      });

      throw new RedisConnectionError(
        `Failed to create ${usageType} connection: ${redisError.message}`,
        { usageType },
        redisError
      );
    }
  }

  private setupConnectionMonitoring(
    connection: RedisType, 
    usageType: RedisUsageType, 
    info: ConnectionInfo
  ): void {
    connection.on('connect', () => {
      info.status = 'connected';
      info.connectedAt = new Date();
      info.healthScore = 100;
      
      this.logger?.info('Redis connection established', { 
        usageType,
        host: info.host,
        port: info.port 
      });
    });

    connection.on('ready', () => {
      info.status = 'connected';
      info.healthScore = 100;
      
      this.logger?.info('Redis connection ready', { usageType });
    });

    connection.on('error', (error: any) => {
      const redisError = this.errorHandler.handleError(error, { usageType });
      info.status = 'error';
      info.lastError = redisError.message;
      info.healthScore = 0;

      this.logger?.error('Redis connection error', {
        usageType,
        error: redisError.message,
        host: info.host,
        port: info.port
      });

      if (redisError instanceof RedisRateLimitError) {
        const retryAt = this.setRateLimitReset();
        this.logger?.warn('Redis rate limit exceeded, disconnecting', {
          usageType,
          retryAt
        });
        connection.disconnect();
        // pause reconnection until the limit resets
        this.scheduleReconnection(usageType, info);
        return;
      }

      if (isConnectionError(redisError) || isTimeoutError(redisError)) {
        this.scheduleReconnection(usageType, info);
      }
    });

    connection.on('close', () => {
      info.status = 'disconnected';
      info.healthScore = 0;
      
      this.logger?.warn('Redis connection closed', { 
        usageType,
        host: info.host,
        port: info.port 
      });
    });

    connection.on('reconnecting', (delay: number) => {
      info.status = 'connecting';
      info.reconnectAttempts++;
      
      this.logger?.info('Redis reconnecting', { 
        usageType, 
        delay, 
        attempt: info.reconnectAttempts 
      });
    });

    connection.on('end', () => {
      info.status = 'disconnected';
      info.healthScore = 0;
      
      this.logger?.warn('Redis connection ended', { usageType });
      this.connections.delete(usageType);
    });
  }

  private async scheduleReconnection(usageType: RedisUsageType, info: ConnectionInfo): Promise<void> {
    if (this.isRateLimited()) {
      const delay = this.rateLimitResetAt!.getTime() - Date.now();
      this.logger?.warn('Reconnection paused due to rate limit', {
        usageType,
        retryAt: this.rateLimitResetAt
      });
      setTimeout(() => {
        info.reconnectAttempts = 0;
        this.createConnection(usageType).catch(error => {
          this.logger?.error('Reconnection after rate limit failed', {
            usageType,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }, delay);
      return;
    }

    if (info.reconnectAttempts >= this.poolConfig.maxReconnectAttempts) {
      this.logger?.error('Max reconnection attempts exceeded', {
        usageType,
        attempts: info.reconnectAttempts
      });
      return;
    }

    const delay = Math.min(
      this.poolConfig.reconnectDelay * Math.pow(2, info.reconnectAttempts),
      30000 // أقصى تأخير 30 ثانية
    );

    setTimeout(async () => {
      try {
        this.logger?.info('Attempting reconnection', { usageType, attempt: info.reconnectAttempts + 1 });
        await this.closeConnection(usageType);
        await this.createConnection(usageType);
      } catch (error) {
        this.logger?.error('Reconnection failed', { usageType, error });
        // ستحاول مرة أخرى بناءً على error event
      }
    }, delay);
  }

  async closeConnection(usageType: RedisUsageType): Promise<void> {
    const connection = this.connections.get(usageType);
    const info = this.connectionInfo.get(usageType);

    if (connection) {
      try {
        await connection.disconnect();
        this.connections.delete(usageType);
        
        if (info) {
          info.status = 'disconnected';
          info.healthScore = 0;
        }

        this.logger?.info('Redis connection closed successfully', { usageType });
        
      } catch (error) {
        this.logger?.warn('Error closing Redis connection', { 
          usageType, 
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    this.connectionInfo.delete(usageType);
  }

  async closeAllConnections(): Promise<void> {
    this.logger?.info('Closing all Redis connections', { 
      totalConnections: this.connections.size 
    });

    const closePromises = Array.from(this.connections.keys()).map(
      usageType => this.closeConnection(usageType)
    );

    await Promise.all(closePromises);

    // إيقاف مراقبة الصحة
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    this.logger?.info('All Redis connections closed');
  }

  getConnectionInfo(usageType: RedisUsageType): ConnectionInfo | undefined {
    return this.connectionInfo.get(usageType);
  }

  getAllConnectionsInfo(): Map<RedisUsageType, ConnectionInfo> {
    return new Map(this.connectionInfo);
  }

  getConnectionStats(): ConnectionStats {
    const connections = Array.from(this.connectionInfo.values());
    
    const stats: ConnectionStats = {
      totalConnections: connections.length,
      activeConnections: connections.filter(c => c.status === 'connected').length,
      errorConnections: connections.filter(c => c.status === 'error').length,
      totalReconnects: connections.reduce((sum, c) => sum + c.reconnectAttempts, 0),
      averageHealthScore: connections.length > 0 
        ? Math.round(connections.reduce((sum, c) => sum + c.healthScore, 0) / connections.length)
        : 0,
      connectionsByType: {} as Record<RedisUsageType, number>
    };

    // حساب عدد الاتصالات لكل نوع
    Object.values(RedisUsageType).forEach(type => {
      stats.connectionsByType[type] = connections.filter(c => c.usageType === type).length;
    });

    return stats;
  }

  private startHealthChecking(): void {
    // DISABLED: Background health checking disabled in favor of centralized health check
    // The new health-check.ts service handles health monitoring with proper timeout handling
    this.logger?.debug('Background health checking disabled - using centralized service');
  }

  private async performHealthChecks(): Promise<void> {
    const connections = Array.from(this.connections.entries());
    
    for (const [usageType, connection] of connections) {
      const info = this.connectionInfo.get(usageType);
      if (!info) continue;

      try {
        const isHealthy = await this.healthMonitor.isConnectionHealthy(connection, 2000);
        
        if (isHealthy) {
          info.healthScore = Math.min(100, info.healthScore + 5); // تحسن تدريجي
          if (info.status === 'error') {
            info.status = 'connected';
            info.lastError = undefined;
          }
        } else {
          info.healthScore = Math.max(0, info.healthScore - 10); // تدهور تدريجي
          
          if (info.healthScore <= 20) {
            info.status = 'error';
            this.logger?.warn('Connection health degraded', { 
              usageType, 
              healthScore: info.healthScore 
            });
            
            // إعادة الاتصال إذا كانت الصحة سيئة جداً
            if (info.healthScore === 0) {
              this.scheduleReconnection(usageType, info);
            }
          }
        }

      } catch (error) {
        info.status = 'error';
        info.healthScore = 0;
        info.lastError = error instanceof Error ? error.message : String(error);
        
        this.logger?.error('Health check failed', { 
          usageType, 
          error: info.lastError 
        });
      }
    }
  }

  async validateAllConnections(): Promise<{
    valid: boolean;
    results: Array<{
      usageType: RedisUsageType;
      valid: boolean;
      error?: string;
    }>;
  }> {
    const results: Array<{
      usageType: RedisUsageType;
      valid: boolean;
      error?: string;
    }> = [];

    for (const [usageType, connection] of this.connections.entries()) {
      try {
        await this.healthMonitor.validateConnection(connection);
        results.push({ usageType, valid: true });
      } catch (error) {
        results.push({
          usageType,
          valid: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const allValid = results.every(r => r.valid);

    return {
      valid: allValid,
      results
    };
  }

  // الحصول على اتصال محدد للاستخدام المباشر (للحالات الخاصة)
  getDirectConnection(usageType: RedisUsageType): RedisType | undefined {
    return this.connections.get(usageType);
  }

  private async waitForConnection(connection: RedisType, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new RedisConnectionError(
          'Connection timeout waiting for ready state',
          { 
            status: connection.status,
            timeout: timeoutMs,
            options: {
              host: connection.options.host,
              port: connection.options.port
            }
          }
        ));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        connection.removeListener('ready', onReady);
        connection.removeListener('error', onError);
      };

      const onReady = () => {
        cleanup();
        resolve();
      };

      const onError = (error: Error) => {
        cleanup();
        reject(new RedisConnectionError(
          'Connection error while waiting for ready state',
          { error: error.message }
        ));
      };

      if (connection.status === 'ready') {
        cleanup();
        resolve();
        return;
      }

      connection.once('ready', onReady);
      connection.once('error', onError);
    });
  }

  // إنشاء اتصال مؤقت للعمليات الخاصة
  async createTemporaryConnection(
    usageType: RedisUsageType,
    ttl: number = 60000 // 60 ثانية افتراضياً
  ): Promise<RedisType> {
    const config = this.configFactory.createConfiguration(
      usageType,
      this.environment,
      this.redisUrl
    );

    const connection = new Redis(config);
    
    // اختبار سريع للاتصال بدون انتظار ready state
    try {
      await connection.ping();
      this.logger?.debug('Temporary connection established', { usageType });
    } catch (error) {
      this.logger?.warn({ err: error, usageType }, 'Temporary connection ping failed');
    }
    
    // إعداد إغلاق تلقائي
    setTimeout(async () => {
      try {
        await connection.disconnect();
        this.logger?.debug('Temporary connection closed', { usageType });
      } catch (error) {
        this.logger?.warn({ err: error }, 'Error closing temporary connection');
      }
    }, ttl);

    return connection;
  }
}

// Singleton instance for global access
let globalRedisManager: RedisConnectionManager | null = null;

function toEnv(): Environment {
  const n = (process.env.NODE_ENV || 'production').toLowerCase();
  if (n === 'development' || n === 'dev') return Environment.DEVELOPMENT;
  if (n === 'test' || n === 'testing') return Environment.STAGING; // Using STAGING for test
  return Environment.PRODUCTION;
}

export function getRedisConnectionManager(): RedisConnectionManager {
  if (!globalRedisManager) {
    const url = process.env.REDIS_URL; // الزامي في الإنتاج
    if (!url && toEnv() === Environment.PRODUCTION) {
      throw new Error('REDIS_URL is required in production');
    }
    globalRedisManager = new RedisConnectionManager(
      url || 'redis://localhost:6379',
      toEnv()
    );
  }
  return globalRedisManager;
}

export default RedisConnectionManager;