/**
 * ===============================================
 * Expiring Map Utility
 * In-memory cache with automatic expiration
 * 
 * ✅ Thread-safe cache implementation
 * ✅ Automatic cleanup of expired entries
 * ✅ Memory-efficient with lazy cleanup
 * ✅ Type-safe generic implementation
 * ✅ Production-ready with proper disposal
 * ===============================================
 */

import { z } from 'zod';

// ===============================================
// CONSTANTS & CONFIGURATION
// ===============================================

/**
 * Default cleanup interval in milliseconds
 * How often to check for and remove expired entries
 */
export const DEFAULT_CLEANUP_INTERVAL = 60_000; // 1 minute

/**
 * Minimum TTL (Time To Live) in milliseconds
 * Prevents setting extremely short expiration times
 */
export const MIN_TTL_MS = 1000; // 1 second

/**
 * Maximum TTL (Time To Live) in milliseconds
 * Prevents setting extremely long expiration times
 */
export const MAX_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ===============================================
// VALIDATION SCHEMAS
// ===============================================

/**
 * Zod schema for TTL validation
 */
export const TTLValidationSchema = z.number()
  .min(MIN_TTL_MS, `TTL must be at least ${MIN_TTL_MS}ms`)
  .max(MAX_TTL_MS, `TTL must not exceed ${MAX_TTL_MS}ms`);

/**
 * Zod schema for cleanup interval validation
 */
export const CleanupIntervalValidationSchema = z.number()
  .min(1000, 'Cleanup interval must be at least 1000ms')
  .max(300000, 'Cleanup interval must not exceed 5 minutes');

// ===============================================
// TYPES & INTERFACES
// ===============================================

/**
 * Cache entry with expiration timestamp
 * Stores the actual value and when it expires
 * 
 * @template V - Type of the cached value
 */
export interface CacheEntry<V> {
  /** The cached value */
  value: V;
  /** Timestamp when this entry expires (milliseconds since epoch) */
  expiresAt: number;
}

/**
 * Configuration options for ExpiringMap
 */
export interface ExpiringMapConfig {
  /** How often to clean up expired entries (in milliseconds) */
  cleanupInterval?: number;
  /** Whether to enable automatic cleanup */
  enableCleanup?: boolean;
}

// ===============================================
// MAIN CLASS
// ===============================================

/**
 * Thread-safe in-memory cache with automatic expiration
 * Provides a Map-like interface with automatic cleanup of expired entries
 * 
 * @template K - Type of the cache keys
 * @template V - Type of the cached values
 * 
 * @example
 * ```typescript
 * const cache = new ExpiringMap<string, UserData>();
 * 
 * // Set a value with 5 minute TTL
 * cache.set('user:123', userData, 5 * 60 * 1000);
 * 
 * // Get a value (returns undefined if expired)
 * const user = cache.get('user:123');
 * 
 * // Clean up when done
 * cache.dispose();
 * ```
 */
export class ExpiringMap<K, V> {
  /** Internal map storing cache entries */
  private map = new Map<K, CacheEntry<V>>();
  
  /** Interval for automatic cleanup */
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  
  /** Whether cleanup is enabled */
  private cleanupEnabled: boolean;

  /**
   * Create a new ExpiringMap instance
   * 
   * @param config - Configuration options for the cache
   * 
   * @example
   * ```typescript
   * // Default configuration (1 minute cleanup)
   * const cache = new ExpiringMap<string, number>();
   * 
   * // Custom cleanup interval
   * const cache = new ExpiringMap<string, number>({
   *   cleanupInterval: 30000, // 30 seconds
   *   enableCleanup: true
   * });
   * ```
   */
  constructor(config: ExpiringMapConfig | number = {}) {
    const options = typeof config === 'number' 
      ? { cleanupInterval: config }
      : config;
    
    this.cleanupEnabled = options.enableCleanup !== false;
    
    if (this.cleanupEnabled) {
      const interval = options.cleanupInterval || DEFAULT_CLEANUP_INTERVAL;
      const validatedInterval = CleanupIntervalValidationSchema.parse(interval);
      
      this.cleanupInterval = setInterval(() => this.cleanup(), validatedInterval);
      
      // Allow process to exit if this is the only active timer
      if (this.cleanupInterval.unref) {
        this.cleanupInterval.unref();
      }
    }
  }

  /**
   * Set a value in the cache with expiration
   * 
   * @param key - Cache key
   * @param value - Value to cache
   * @param ttlMs - Time to live in milliseconds
   * 
   * @example
   * ```typescript
   * cache.set('session:123', sessionData, 30 * 60 * 1000); // 30 minutes
   * ```
   */
  set(key: K, value: V, ttlMs: number): void {
    const validatedTTL = TTLValidationSchema.parse(ttlMs);
    const expiresAt = Date.now() + validatedTTL;
    this.map.set(key, { value, expiresAt });
  }

  /**
   * Get a value from the cache
   * Returns undefined if the key doesn't exist or has expired
   * Automatically removes expired entries
   * 
   * @param key - Cache key
   * @returns The cached value or undefined if not found/expired
   * 
   * @example
   * ```typescript
   * const user = cache.get('user:123');
   * if (user) {
   *   // Use cached user data
   * }
   * ```
   */
  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    
    return entry.value;
  }

  /**
   * Check if a key exists and is not expired
   * 
   * @param key - Cache key
   * @returns True if the key exists and is not expired
   */
  has(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return false;
    }
    
    return true;
  }

  /**
   * Remove a specific key from the cache
   * 
   * @param key - Cache key to remove
   * @returns True if the key was found and removed
   * 
   * @example
   * ```typescript
   * const wasRemoved = cache.delete('user:123');
   * ```
   */
  delete(key: K): boolean {
    return this.map.delete(key);
  }

  /**
   * Get the number of entries in the cache
   * Note: This includes expired entries that haven't been cleaned up yet
   * 
   * @returns Number of entries in the cache
   */
  get size(): number {
    return this.map.size;
  }

  /**
   * Get all keys in the cache
   * Note: This includes expired entries that haven't been cleaned up yet
   * 
   * @returns Array of cache keys
   */
  keys(): K[] {
    return Array.from(this.map.keys());
  }

  /**
   * Get all values in the cache
   * Note: This includes expired entries that haven't been cleaned up yet
   * 
   * @returns Array of cache values
   */
  values(): V[] {
    return Array.from(this.map.values()).map(entry => entry.value);
  }

  /**
   * Clear all entries from the cache
   * 
   * @example
   * ```typescript
   * cache.clear(); // Remove all cached data
   * ```
   */
  clear(): void {
    this.map.clear();
  }

  /**
   * Clean up expired entries manually
   * This is called automatically by the cleanup interval
   * 
   * @returns Number of expired entries removed
   */
  cleanup(): number {
    const now = Date.now();
    let removedCount = 0;
    
    const entries = Array.from(this.map.entries());
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) {
        this.map.delete(key);
        removedCount++;
      }
    }
    
    return removedCount;
  }

  /**
   * Dispose of the cache and clean up resources
   * Should be called when the cache is no longer needed
   * 
   * @example
   * ```typescript
   * // When shutting down the application
   * cache.dispose();
   * ```
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.map.clear();
  }

  /**
   * Get cache statistics
   * Useful for monitoring cache performance
   * 
   * @returns Cache statistics
   */
  getStats(): {
    totalEntries: number;
    expiredEntries: number;
    validEntries: number;
    cleanupEnabled: boolean;
  } {
    const now = Date.now();
    let expiredCount = 0;
    let validCount = 0;
    
    const values = Array.from(this.map.values());
    for (const entry of values) {
      if (entry.expiresAt <= now) {
        expiredCount++;
      } else {
        validCount++;
      }
    }
    
    return {
      totalEntries: this.map.size,
      expiredEntries: expiredCount,
      validEntries: validCount,
      cleanupEnabled: this.cleanupEnabled
    };
  }
}

// ===============================================
// HELPER FUNCTIONS
// ===============================================

/**
 * Validate TTL value
 * 
 * @param ttlMs - TTL value to validate
 * @returns True if TTL is valid
 */
export function isValidTTL(ttlMs: number): boolean {
  return TTLValidationSchema.safeParse(ttlMs).success;
}

/**
 * Validate cleanup interval value
 * 
 * @param intervalMs - Cleanup interval to validate
 * @returns True if interval is valid
 */
export function isValidCleanupInterval(intervalMs: number): boolean {
  return CleanupIntervalValidationSchema.safeParse(intervalMs).success;
}

/**
 * Create a cache entry with expiration
 * 
 * @param value - Value to cache
 * @param ttlMs - Time to live in milliseconds
 * @returns Cache entry
 */
export function createCacheEntry<V>(value: V, ttlMs: number): CacheEntry<V> {
  const validatedTTL = TTLValidationSchema.parse(ttlMs);
  return {
    value,
    expiresAt: Date.now() + validatedTTL
  };
}

// ===============================================
// DEFAULT EXPORT
// ===============================================

export default {
  ExpiringMap,
  DEFAULT_CLEANUP_INTERVAL,
  MIN_TTL_MS,
  MAX_TTL_MS,
  isValidTTL,
  isValidCleanupInterval,
  createCacheEntry
};