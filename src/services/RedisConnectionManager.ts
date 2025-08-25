import { Redis } from 'ioredis';
import {
  RedisUsageType,
  RedisEnvironment as Environment,
  ProductionRedisConfigurationFactory
} from '../config/RedisConfigurationFactory.js';
import { 
  isConnectionHealthy as healthCheck, 
  validateConnection as validateConn, 
  performHealthCheck 
} from './RedisSimpleHealthCheck.js';
// Removed unused import: RedisErrorHandler

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
  private connections: Map<RedisUsageType, Redis> = new Map();
  private connectionInfo: Map<RedisUsageType, ConnectionInfo> = new Map();
  private configFactory: ProductionRedisConfigurationFactory;
  
  // Redis availability flag - set to false when quota exceeded
  private redisEnabled: boolean = true;
  // Simplified health monitoring methods
  private healthCheckInterval: NodeJS.Timeout | undefined;
  private poolConfig: ConnectionPoolConfig;
  private rateLimitResetAt?: Date;
  private pauseReconnectionsUntil?: Date;

  constructor(
    private redisUrl: string,
    private environment: Environment,
    private logger?: any,
    poolConfig?: Partial<ConnectionPoolConfig>
  ) {
    this.configFactory = new ProductionRedisConfigurationFactory();
    
    const isRender = process.env.IS_RENDER === 'true' || process.env.RENDER === 'true';
    
    this.poolConfig = {
      maxConnections: isRender ? 5 : 10, // أقل لـ Render
      connectionTimeout: isRender ? 15000 : 10000, // أكثر تسامحاً لـ Render
      healthCheckInterval: isRender ? 60000 : 30000, // أقل تكراراً لـ Render
      reconnectDelay: isRender ? 10000 : 5000, // أطول لـ Render
      maxReconnectAttempts: 3,
      ...poolConfig
    };

    // this.startHealthChecking(); // DISABLED: Using centralized health check instead
  }

  // Simple health check methods
  async isConnectionHealthy(connection: Redis, timeoutMs: number = 2000): Promise<boolean> {
    return healthCheck(connection, timeoutMs);
  }

  async validateConnection(connection: Redis): Promise<void> {
    return validateConn(connection);
  }

  async performHealthCheck(connection: Redis) {
    return performHealthCheck(connection);
  }

  /**
   * Get Redis connection for specific usage type
   */
  async getConnection(usageType: RedisUsageType): Promise<Redis> {
    // Check if we have a healthy connection
    const existingConnection = this.connections.get(usageType);
    if (existingConnection && await this.isConnectionHealthy(existingConnection)) {
      return existingConnection;
    }

    // Check rate limiting
    if (!this.redisEnabled || this.isRateLimited()) {
      throw new Error('Redis is currently rate limited or disabled');
    }

    // Create new connection
    const connection = await this.createConnection(usageType);
    this.connections.set(usageType, connection);
    
    return connection;
  }

  /**
   * Check if Redis is currently rate limited
   */
  private isRateLimited(): boolean {
    if (!this.rateLimitResetAt) return false;
    
    const now = new Date();
    const isLimited = now < this.rateLimitResetAt;
    
    // Auto-reset if time has passed
    if (!isLimited) {
      delete this.rateLimitResetAt;
      this.redisEnabled = true;
    }
    
    return isLimited;
  }

  /**
   * Set rate limit reset time (usually next hour)
   */
  private setRateLimitReset(): Date {
    const resetTime = new Date();
    resetTime.setHours(resetTime.getHours() + 1, 0, 0, 0);
    this.rateLimitResetAt = resetTime;
    return resetTime;
  }

  /**
   * Get current connection statistics
   */
  getConnectionStats(): ConnectionStats {
    const stats: ConnectionStats = {
      totalConnections: this.connections.size,
      activeConnections: 0,
      errorConnections: 0,
      totalReconnects: 0,
      averageHealthScore: 0,
      connectionsByType: {} as Record<RedisUsageType, number>
    };

    let totalHealthScore = 0;
    
    for (const [usageType, info] of this.connectionInfo) {
      stats.connectionsByType[usageType] = 1;
      
      if (info.status === 'connected') {
        stats.activeConnections++;
      } else if (info.status === 'error') {
        stats.errorConnections++;
      }
      
      stats.totalReconnects += info.reconnectAttempts;
      totalHealthScore += info.healthScore;
    }

    if (this.connectionInfo.size > 0) {
      stats.averageHealthScore = Math.round(totalHealthScore / this.connectionInfo.size);
    }

    return stats;
  }

  /**
   * Create a new Redis connection with proper error handling
   */
  private async createConnection(usageType: RedisUsageType): Promise<Redis> {
    const info: ConnectionInfo = this.connectionInfo.get(usageType) || {
      usageType,
      status: 'connecting',
      reconnectAttempts: 0,
      healthScore: 0
    };

    try {
      this.logger?.info('Creating Redis connection', { usageType });

      // Get configuration for this usage type
      const config = this.configFactory.createConfiguration(usageType, this.environment, this.redisUrl);
      
      // تحسينات خاصة لـ Render
      const isRender = process.env.IS_RENDER === 'true' || process.env.RENDER === 'true';
      if (isRender) {
        config.maxRetriesPerRequest = 2;
        config.connectTimeout = 15000;
        config.commandTimeout = 10000;
        config.keepAlive = 30000;
      }

      // Create Redis connection with proper error handling
      const connection = new Redis({
        ...config,
        lazyConnect: true,
        maxRetriesPerRequest: Number(process.env.REDIS_MAX_RETRIES || 5), // زيادة من 3 إلى 5
        connectTimeout: this.poolConfig.connectionTimeout,
        enableReadyCheck: true,
        enableOfflineQueue: false,
        reconnectOnError: (err) => {
          // Don't reconnect on rate limit errors
          if (err.message.includes('max requests limit exceeded')) {
            return false;
          }
          // Don't reconnect on connection reset errors
          if (err.message.includes('ECONNRESET')) {
            return false;
          }
          return 1;
        }
      });

      // Set up connection monitoring
      this.setupConnectionMonitoring(connection, usageType, info);

      // Connect with timeout and proper error handling
      await Promise.race([
        connection.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), this.poolConfig.connectionTimeout)
        )
      ]);

      // Validate connection
      await this.validateConnection(connection);

      // Update connection info
      info.status = 'connected';
      info.connectedAt = new Date();
      delete info.lastError;
      info.healthScore = 100;

      this.logger?.info('Redis connection established successfully', {
        usageType,
        host: config.host,
        port: config.port,
        totalConnections: this.connections.size
      });

      return connection;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Handle rate limiting
      if (errorMessage.includes('max requests limit exceeded')) {
        this.redisEnabled = false;
        this.setRateLimitReset();
        
        this.logger?.warn('Redis rate limit exceeded - disabling Redis', {
          usageType,
          retryAt: this.rateLimitResetAt?.toISOString()
        });
        
        throw new Error('Redis rate limit exceeded');
      }

      // Handle connection reset errors
      if (errorMessage.includes('ECONNRESET')) {
        this.logger?.warn('Redis connection reset - will retry later', {
          usageType,
          error: errorMessage
        });
        
        throw new Error('Redis connection reset');
      }

      // Handle connection errors
      info.status = 'error';
      info.lastError = errorMessage;
      info.healthScore = 0;

      this.logger?.error('Failed to create Redis connection', {
        usageType,
        error: errorMessage
      });

      throw new Error(`Failed to create ${usageType} connection: ${errorMessage}`);
    } finally {
      this.connectionInfo.set(usageType, info);
    }
  }

  private setupConnectionMonitoring(
    connection: Redis, 
    usageType: RedisUsageType, 
    info: ConnectionInfo
  ): void {
    connection.on('connect', () => {
      info.status = 'connected';
      info.connectedAt = new Date();
      info.healthScore = 100;
      this.logger?.info('Redis connection established', { usageType });
    });

    connection.on('error', (error) => {
      info.status = 'error';
      info.lastError = error.message;
      info.healthScore = 0;
      
      this.logger?.error('Redis connection error', {
        usageType,
        error: error.message
      });
    });

    connection.on('close', () => {
      info.status = 'disconnected';
      info.healthScore = 0;
      this.logger?.warn('Redis connection closed', { usageType });
    });

    connection.on('reconnecting', () => {
      info.status = 'connecting';
      info.reconnectAttempts++;
      this.logger?.info('Redis reconnecting', { 
        usageType, 
        attempts: info.reconnectAttempts 
      });
    });
  }

  /**
   * Safe Redis operation with fallback handling
   */
  async safeRedisOperation<T>(
    usageType: RedisUsageType,
    callback: (redis: Redis) => Promise<T>
  ): Promise<{ ok: boolean; result?: T; reason?: string; skipped?: boolean }> {
    
    // Check rate limiting first
    if (!this.redisEnabled || this.isRateLimited()) {
      return {
        ok: false,
        skipped: true,
        reason: 'rate_limited'
      };
    }

    try {
      const connection = await this.getConnection(usageType);
      const result = await callback(connection);
      return { ok: true, result };
    } catch (error: any) {
      // تجنب الاستدعاء المتكرر للـ error handler
      let errorMessage = 'Unknown error occurred';
      
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else if (error && typeof error === 'object') {
        try {
          errorMessage = JSON.stringify(error);
        } catch {
          errorMessage = String(error);
        }
      }

      if (errorMessage.includes('max requests limit exceeded')) {
        this.redisEnabled = false;
        this.setRateLimitReset();
        
        return {
          ok: false,
          skipped: true,
          reason: 'rate_limit_exceeded'
        };
      }

      return {
        ok: false,
        reason: errorMessage
      };
    }
  }

  /**
   * Close specific connection
   */
  async closeConnection(usageType: RedisUsageType): Promise<void> {
    const connection = this.connections.get(usageType);
    if (connection) {
      try {
        await connection.quit();
      } catch (error) {
        // Force disconnect if quit fails
        await connection.disconnect();
      }
      
      this.connections.delete(usageType);
      
      const info = this.connectionInfo.get(usageType);
      if (info) {
        info.status = 'disconnected';
        info.healthScore = 0;
      }
      
      this.logger?.info('Redis connection closed', { usageType });
    }
  }

  /**
   * Close all connections
   */
  async closeAllConnections(): Promise<void> {
    const closePromises = Array.from(this.connections.keys()).map(usageType => 
      this.closeConnection(usageType)
    );
    
    await Promise.allSettled(closePromises);
    
    // ✅ إصلاح مشكلة clearInterval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
    
    this.logger?.info('All Redis connections closed');
  }

  /**
   * Get Redis status for monitoring
   */
  getRedisStatus() {
    return {
      enabled: this.redisEnabled,
      rateLimited: this.isRateLimited(),
      rateLimitResetAt: this.rateLimitResetAt?.toISOString(),
      connections: this.getConnectionStats(),
      connectionDetails: Array.from(this.connectionInfo.values())
    };
  }

  /**
   * Enable Redis (reset rate limiting)
   */
  enableRedis(): void {
    this.redisEnabled = true;
            delete this.rateLimitResetAt;
          delete this.pauseReconnectionsUntil;
    this.logger?.info('Redis re-enabled');
  }

  /**
   * Disable Redis temporarily
   */
  disableRedis(reason: string = 'manual'): void {
    this.redisEnabled = false;
    this.logger?.warn('Redis disabled', { reason });
    
    // ✅ إضافة إعادة تفعيل تلقائية بعد 5 دقائق
    if (reason === 'rate_limit') {
      setTimeout(() => {
        this.logger?.info('Redis auto-re-enabling after rate limit cooldown');
        this.enableRedis();
      }, 5 * 60 * 1000); // 5 دقائق
    }
  }

  /**
   * Manual health check for all connections
   */
  async performHealthCheckOnAllConnections(): Promise<void> {
    this.logger?.debug('Starting health check for all Redis connections...');
    
    const connections = Array.from(this.connections.entries());
    
    for (const [usageType, connection] of connections) {
      const info = this.connectionInfo.get(usageType);
      if (!info) continue;

      try {
        const isHealthy = await this.isConnectionHealthy(connection, 2000);
        
        if (isHealthy) {
          info.healthScore = Math.min(100, info.healthScore + 5); // تحسن تدريجي
          if (info.status === 'error') {
            info.status = 'connected';
            this.logger?.info('Connection recovered', { usageType });
          }
        } else {
          info.healthScore = Math.max(0, info.healthScore - 10); // تدهور تدريجي
          if (info.healthScore <= 20) {
            info.status = 'error';
            this.logger?.warn('Connection marked as unhealthy', { 
              usageType, 
              healthScore: info.healthScore 
            });
          }
        }
      } catch (error: any) {
        info.status = 'error';
        info.healthScore = 0;
        info.lastError = error.message;
        
        this.logger?.error('Health check failed for connection', {
          usageType,
          error: error.message
        });
      }
    }

    this.logger?.debug('Health check completed for all connections');
  }

  // removed unused method
}

// Singleton instance
let connectionManager: RedisConnectionManager | null = null;

export function getRedisConnectionManager(): RedisConnectionManager {
  if (!connectionManager) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const environment = (process.env.NODE_ENV === 'production') ? Environment.PRODUCTION : Environment.DEVELOPMENT;
    connectionManager = new RedisConnectionManager(redisUrl, environment);
  }
  return connectionManager;
}

export default RedisConnectionManager;

// Simple Redis client for basic operations (kept for compatibility)
let _client: Redis | null = null;

// removed unused function

export function getRedis() {
  if (!_client) throw new Error('Redis not connected');
  return _client;
}

export async function closeRedis() {
  if (_client) {
    try { await _client.quit(); } catch { await _client.disconnect(); }
    _client = null;
  }
}