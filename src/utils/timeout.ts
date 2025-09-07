/**
 * ===============================================
 * Centralized Timeout Utilities
 * Replaces Promise.race patterns with robust timeout handling
 * 
 * ✅ Production-grade timeout handling
 * ✅ Proper cleanup and error handling
 * ✅ Environment-based configuration
 * ✅ Retry logic with exponential backoff
 * ✅ Specialized timeouts for different services
 * ===============================================
 */

import { z } from 'zod';

// ===============================================
// CONSTANTS & CONFIGURATION
// ===============================================

/**
 * Default timeout values in milliseconds
 * Can be overridden via environment variables
 */
export const DEFAULT_TIMEOUTS = {
  DATABASE: 10000,    // 10 seconds
  API: 30000,         // 30 seconds
  REDIS: 5000,        // 5 seconds
  WEBHOOK: 15000,     // 15 seconds
  RETRY_BASE: 1000,   // 1 second
  RETRY_MAX: 5000     // 5 seconds
} as const;

/**
 * Maximum retry attempts for timeout operations
 */
export const MAX_RETRY_ATTEMPTS = 5;

// ===============================================
// VALIDATION SCHEMAS
// ===============================================

/**
 * Zod schema for timeout configuration validation
 */
export const TimeoutConfigSchema = z.object({
  timeoutMs: z.number().positive().max(300000), // Max 5 minutes
  label: z.string().optional(),
  maxRetries: z.number().int().min(1).max(10).optional()
});

/**
 * Zod schema for retry configuration validation
 */
export const RetryConfigSchema = z.object({
  maxRetries: z.number().int().min(1).max(10),
  baseDelay: z.number().positive(),
  maxDelay: z.number().positive(),
  label: z.string().optional()
});

// ===============================================
// CORE TIMEOUT FUNCTIONS
// ===============================================

/**
 * Production-grade Promise timeout with proper cleanup
 * Replaces Promise.race anti-patterns with robust error handling
 * 
 * @param promise - The promise to wrap with timeout
 * @param timeoutMs - Timeout duration in milliseconds
 * @param label - Optional label for error messages
 * @returns Promise that resolves/rejects within the timeout period
 * 
 * @example
 * ```typescript
 * const result = await withTimeout(
 *   fetch('https://api.example.com/data'),
 *   5000,
 *   'API call'
 * );
 * ```
 */
export function withTimeout<T>(
  promise: Promise<T>, 
  timeoutMs: number, 
  label?: string
): Promise<T> {
  // Validate inputs
  const config = TimeoutConfigSchema.parse({ timeoutMs, label });
  
  let timeoutHandle: NodeJS.Timeout;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new TimeoutError(`${config.label || 'Operation'} timed out after ${config.timeoutMs}ms`));
    }, config.timeoutMs);
  });

  return Promise.race([
    promise.then((result) => {
      clearTimeout(timeoutHandle);
      return result;
    }).catch((error) => {
      clearTimeout(timeoutHandle);
      throw error;
    }),
    timeoutPromise
  ]);
}

/**
 * Timeout with graceful degradation
 * Returns fallback value instead of throwing on timeout
 * 
 * @param promise - The promise to wrap with timeout
 * @param timeoutMs - Timeout duration in milliseconds
 * @param fallback - Value to return if timeout occurs
 * @param label - Optional label for error messages
 * @returns Promise that resolves to result or fallback value
 * 
 * @example
 * ```typescript
 * const data = await withTimeoutFallback(
 *   fetchData(),
 *   3000,
 *   { status: 'default' },
 *   'Data fetch'
 * );
 * ```
 */
export function withTimeoutFallback<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
  label?: string
): Promise<T> {
  return withTimeout(promise, timeoutMs, label).catch((error) => {
    if (error instanceof TimeoutError) {
      return fallback;
    }
    throw error;
  });
}

/**
 * Timeout with retry logic and exponential backoff
 * Automatically retries failed operations with increasing delays
 * 
 * @param operation - Function that returns a promise to retry
 * @param timeoutMs - Timeout duration for each attempt
 * @param maxRetries - Maximum number of retry attempts
 * @param label - Optional label for error messages
 * @returns Promise that resolves after successful retry or final failure
 * 
 * @example
 * ```typescript
 * const result = await withTimeoutRetry(
 *   () => apiCall(),
 *   5000,
 *   3,
 *   'API operation'
 * );
 * ```
 */
export async function withTimeoutRetry<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  maxRetries: number = MAX_RETRY_ATTEMPTS,
  label?: string
): Promise<T> {
  // Validate retry configuration
  const config = RetryConfigSchema.parse({
    maxRetries,
    baseDelay: DEFAULT_TIMEOUTS.RETRY_BASE,
    maxDelay: DEFAULT_TIMEOUTS.RETRY_MAX,
    label
  });
  
  let lastError: Error;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      return await withTimeout(
        operation(), 
        timeoutMs, 
        `${config.label} (attempt ${attempt})`
      );
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === config.maxRetries) {
        throw new TimeoutRetryError(
          `${config.label || 'Operation'} failed after ${config.maxRetries} attempts`,
          lastError
        );
      }

      // Exponential backoff with jitter
      const baseBackoff = Math.min(
        config.baseDelay * Math.pow(2, attempt - 1),
        config.maxDelay
      );
      // Add jitter to prevent thundering herd. Jitter is a random value up to the base delay.
      const jitter = Math.random() * config.baseDelay;
      const backoffMs = baseBackoff + jitter;
      await delay(backoffMs);
    }
  }

  throw lastError!;
}

// ===============================================
// SPECIALIZED TIMEOUT FUNCTIONS
// ===============================================

/**
 * Timeout for database operations
 * Uses DB_TIMEOUT_MS environment variable or default value
 * 
 * @param promise - Database operation promise
 * @param label - Optional label for error messages
 * @returns Promise with database-specific timeout
 */
export function withDbTimeout<T>(promise: Promise<T>, label?: string): Promise<T> {
  const timeoutMs = parseInt(process.env.DB_TIMEOUT_MS || String(DEFAULT_TIMEOUTS.DATABASE));
  return withTimeout(promise, timeoutMs, `DB ${label || 'operation'}`);
}

/**
 * Timeout for external API calls
 * Uses API_TIMEOUT_MS environment variable or default value
 * 
 * @param promise - API call promise
 * @param label - Optional label for error messages
 * @returns Promise with API-specific timeout
 */
export function withApiTimeout<T>(promise: Promise<T>, label?: string): Promise<T> {
  const timeoutMs = parseInt(process.env.API_TIMEOUT_MS || String(DEFAULT_TIMEOUTS.API));
  return withTimeout(promise, timeoutMs, `API ${label || 'call'}`);
}

/**
 * Timeout for Redis operations
 * Uses REDIS_TIMEOUT_MS environment variable or default value
 * 
 * @param promise - Redis operation promise
 * @param label - Optional label for error messages
 * @returns Promise with Redis-specific timeout
 */
export function withRedisTimeout<T>(promise: Promise<T>, label?: string): Promise<T> {
  const timeoutMs = parseInt(process.env.REDIS_TIMEOUT_MS || String(DEFAULT_TIMEOUTS.REDIS));
  return withTimeout(promise, timeoutMs, `Redis ${label || 'operation'}`);
}

/**
 * Timeout for webhook processing
 * Uses WEBHOOK_TIMEOUT_MS environment variable or default value
 * 
 * @param promise - Webhook processing promise
 * @param label - Optional label for error messages
 * @returns Promise with webhook-specific timeout
 */
export function withWebhookTimeout<T>(promise: Promise<T>, label?: string): Promise<T> {
  const timeoutMs = parseInt(process.env.WEBHOOK_TIMEOUT_MS || String(DEFAULT_TIMEOUTS.WEBHOOK));
  return withTimeout(promise, timeoutMs, `Webhook ${label || 'processing'}`);
}

// ===============================================
// UTILITY FUNCTIONS
// ===============================================

/**
 * Helper to create a delay promise
 * Useful for implementing backoff strategies
 * 
 * @param ms - Delay duration in milliseconds
 * @returns Promise that resolves after the specified delay
 * 
 * @example
 * ```typescript
 * await delay(1000); // Wait for 1 second
 * ```
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a timeout wrapper for any async function
 * Returns a new function that automatically applies timeout
 * 
 * @param fn - Async function to wrap
 * @param timeoutMs - Timeout duration in milliseconds
 * @param label - Optional label for error messages
 * @returns Wrapped function with timeout applied
 * 
 * @example
 * ```typescript
 * const timeoutFetch = createTimeoutWrapper(fetch, 5000, 'HTTP request');
 * const result = await timeoutFetch('https://api.example.com');
 * ```
 */
export function createTimeoutWrapper<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  timeoutMs: number,
  label?: string
) {
  return async (...args: T): Promise<R> => {
    return withTimeout(fn(...args), timeoutMs, label);
  };
}

// ===============================================
// ERROR CLASSES
// ===============================================

/**
 * Timeout error class
 * Represents errors that occur when operations exceed their timeout
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Timeout retry error class
 * Represents errors that occur after all retry attempts are exhausted
 */
export class TimeoutRetryError extends Error {
  constructor(message: string, public readonly cause: Error) {
    super(message);
    this.name = 'TimeoutRetryError';
  }
}

// ===============================================
// HELPER FUNCTIONS
// ===============================================

/**
 * Validate timeout configuration
 * Ensures timeout values are within acceptable ranges
 * 
 * @param timeoutMs - Timeout value to validate
 * @returns True if timeout is valid, false otherwise
 */
export function isValidTimeout(timeoutMs: number): boolean {
  return TimeoutConfigSchema.shape.timeoutMs.safeParse(timeoutMs).success;
}

/**
 * Get timeout value from environment or use default
 * 
 * @param envVar - Environment variable name
 * @param defaultValue - Default timeout value
 * @returns Parsed timeout value
 */
export function getTimeoutFromEnv(envVar: string, defaultValue: number): number {
  const envValue = process.env[envVar];
  if (!envValue) return defaultValue;
  
  const parsed = parseInt(envValue);
  return isValidTimeout(parsed) ? parsed : defaultValue;
}

// ===============================================
// DEFAULT EXPORT
// ===============================================

export default { 
  withTimeout, 
  withTimeoutFallback, 
  withTimeoutRetry,
  withDbTimeout,
  withApiTimeout,
  withRedisTimeout,
  withWebhookTimeout,
  delay,
  TimeoutError,
  TimeoutRetryError,
  createTimeoutWrapper,
  DEFAULT_TIMEOUTS,
  MAX_RETRY_ATTEMPTS,
  isValidTimeout,
  getTimeoutFromEnv
};