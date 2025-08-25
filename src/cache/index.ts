/**
 * ===============================================
 * Redis Cache Layer - Production Ready
 * Uses existing RedisConnectionManager infrastructure
 * ===============================================
 */

import { getRedisConnectionManager } from '../services/RedisConnectionManager.js';
import { RedisUsageType } from '../config/RedisConfigurationFactory.js';
import { getLogger } from '../services/logger.js';
import type { Redis } from 'ioredis';

const log = getLogger({ component: 'cache' });

export interface CacheOptions {
  ttl?: number; // TTL in seconds
  prefix?: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  errors: number;
}

/**
 * Production Cache Service using Redis
 */
export class CacheService {
  private connectionManager = getRedisConnectionManager();
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    errors: 0
  };

  constructor(private defaultTTL = 3600) {} // 1 hour default

  /**
   * Get cached value with automatic fallback
   */
  async get<T>(key: string, options?: CacheOptions): Promise<T | null> {
    const fullKey = this.buildKey(key, options?.prefix);
    
    try {
      const result = await this.connectionManager.safeRedisOperation(
        RedisUsageType.CACHE,
        async (redis: Redis) => {
          const value = await redis.get(fullKey);
          return value ? JSON.parse(value) : null;
        }
      );

      if (result.ok && result.result !== undefined && result.result !== null) {
        this.stats.hits++;
        return result.result;
      } else {
        this.stats.misses++;
        return null;
      }
    } catch (error: any) {
      this.stats.errors++;
      log.warn('Cache get failed, falling back to null', {
        key: fullKey,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Set cached value with TTL
   */
  async set<T>(key: string, value: T, options?: CacheOptions): Promise<boolean> {
    const fullKey = this.buildKey(key, options?.prefix);
    const ttl = options?.ttl ?? this.defaultTTL;
    
    try {
      const result = await this.connectionManager.safeRedisOperation(
        RedisUsageType.CACHE,
        async (redis: Redis) => {
          const serialized = JSON.stringify(value);
          await redis.setex(fullKey, ttl, serialized);
          return true;
        }
      );

      if (result.ok && result.result !== undefined) {
        this.stats.sets++;
        return result.result;
      } else {
        log.debug('Cache set skipped', {
          key: fullKey,
          reason: result.reason,
          skipped: result.skipped
        });
        return false;
      }
    } catch (error: any) {
      this.stats.errors++;
      log.warn('Cache set failed', {
        key: fullKey,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Delete cached value
   */
  async delete(key: string, options?: CacheOptions): Promise<boolean> {
    const fullKey = this.buildKey(key, options?.prefix);
    
    try {
      const result = await this.connectionManager.safeRedisOperation(
        RedisUsageType.CACHE,
        async (redis: Redis) => {
          const deleted = await redis.del(fullKey);
          return deleted > 0;
        }
      );

      if (result.ok && result.result !== undefined) {
        this.stats.deletes++;
        return result.result;
      } else {
        return false;
      }
    } catch (error: any) {
      this.stats.errors++;
      log.warn('Cache delete failed', {
        key: fullKey,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string, options?: CacheOptions): Promise<boolean> {
    const fullKey = this.buildKey(key, options?.prefix);
    
    try {
      const result = await this.connectionManager.safeRedisOperation(
        RedisUsageType.CACHE,
        async (redis: Redis) => {
          const exists = await redis.exists(fullKey);
          return exists === 1;
        }
      );

      return result.ok && result.result !== undefined ? result.result : false;
    } catch (error: any) {
      this.stats.errors++;
      log.warn('Cache exists check failed', {
        key: fullKey,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Get multiple keys at once
   */
  async mget<T>(keys: string[], options?: CacheOptions): Promise<(T | null)[]> {
    const fullKeys = keys.map(key => this.buildKey(key, options?.prefix));
    
    try {
      const result = await this.connectionManager.safeRedisOperation(
        RedisUsageType.CACHE,
        async (redis: Redis) => {
          const values = await redis.mget(...fullKeys);
          return values.map(value => value ? JSON.parse(value) : null);
        }
      );

      if (result.ok && result.result) {
        const values = result.result;
        this.stats.hits += values.filter(v => v !== null).length;
        this.stats.misses += values.filter(v => v === null).length;
        return values;
      } else {
        this.stats.misses += keys.length;
        return keys.map(() => null);
      }
    } catch (error: any) {
      this.stats.errors++;
      log.warn('Cache mget failed', {
        keys: fullKeys,
        error: error instanceof Error ? error.message : String(error)
      });
      return keys.map(() => null);
    }
  }

  /**
   * Set multiple keys at once
   */
  async mset(entries: Array<[string, any]>, options?: CacheOptions): Promise<boolean> {
    const ttl = options?.ttl ?? this.defaultTTL;
    
    try {
      const result = await this.connectionManager.safeRedisOperation(
        RedisUsageType.CACHE,
        async (redis: Redis) => {
          const pipeline = redis.pipeline();
          
          for (const [key, value] of entries) {
            const fullKey = this.buildKey(key, options?.prefix);
            const serialized = JSON.stringify(value);
            pipeline.setex(fullKey, ttl, serialized);
          }
          
          await pipeline.exec();
          return true;
        }
      );

      if (result.ok) {
        this.stats.sets += entries.length;
        return true;
      } else {
        return false;
      }
    } catch (error: any) {
      this.stats.errors++;
      log.warn('Cache mset failed', {
        count: entries.length,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats & { hitRate: number } {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? Math.round((this.stats.hits / total) * 100) : 0;
    
    return {
      ...this.stats,
      hitRate
    };
  }

  /**
   * Clear cache statistics
   */
  clearStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0
    };
  }

  /**
   * Build cache key with optional prefix
   */
  private buildKey(key: string, prefix?: string): string {
    const basePrefix = 'aiplt'; // AI Platform prefix
    return prefix 
      ? `${basePrefix}:${prefix}:${key}`
      : `${basePrefix}:${key}`;
  }
}

// Specialized cache services for different use cases
export class MerchantCache extends CacheService {
  constructor() {
    super(300); // 5 minutes TTL for merchant data
  }

  async getMerchantByPageId(pageId: string): Promise<string | null> {
    return this.get<string>(`merchant:pageid:${pageId}`, { prefix: 'mapping' });
  }

  async setMerchantByPageId(pageId: string, merchantId: string): Promise<boolean> {
    return this.set(`merchant:pageid:${pageId}`, merchantId, { prefix: 'mapping' });
  }

  async deleteMerchantMapping(pageId: string): Promise<boolean> {
    return this.delete(`merchant:pageid:${pageId}`, { prefix: 'mapping' });
  }
}

export class TemplateCache extends CacheService {
  constructor() {
    super(1800); // 30 minutes TTL for templates
  }

  async getTemplate(merchantId: string, templateId: string): Promise<any> {
    return this.get(`template:${merchantId}:${templateId}`, { prefix: 'templates' });
  }

  async setTemplate(merchantId: string, templateId: string, template: any): Promise<boolean> {
    return this.set(`template:${merchantId}:${templateId}`, template, { prefix: 'templates' });
  }

  async deleteTemplate(merchantId: string, templateId: string): Promise<boolean> {
    return this.delete(`template:${merchantId}:${templateId}`, { prefix: 'templates' });
  }
}

export class SessionCache extends CacheService {
  constructor() {
    super(86400); // 24 hours TTL for sessions
  }

  async getSession(sessionId: string): Promise<any> {
    return this.get(`session:${sessionId}`, { prefix: 'sessions' });
  }

  async setSession(sessionId: string, sessionData: any): Promise<boolean> {
    return this.set(`session:${sessionId}`, sessionData, { prefix: 'sessions' });
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    return this.delete(`session:${sessionId}`, { prefix: 'sessions' });
  }
}

// Singleton instances
let generalCache: CacheService | null = null;
let merchantCache: MerchantCache | null = null;
let templateCache: TemplateCache | null = null;
let sessionCache: SessionCache | null = null;

export function getCache(): CacheService {
  if (!generalCache) {
    generalCache = new CacheService();
  }
  return generalCache;
}

export function getMerchantCache(): MerchantCache {
  if (!merchantCache) {
    merchantCache = new MerchantCache();
  }
  return merchantCache;
}

export function getTemplateCache(): TemplateCache {
  if (!templateCache) {
    templateCache = new TemplateCache();
  }
  return templateCache;
}

export function getSessionCache(): SessionCache {
  if (!sessionCache) {
    sessionCache = new SessionCache();
  }
  return sessionCache;
}