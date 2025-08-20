/**
 * ===============================================
 * Centralized Timeout Utilities
 * Replaces Promise.race patterns with robust timeout handling
 * ===============================================
 */

/**
 * Production-grade Promise timeout with proper cleanup
 * Replaces Promise.race anti-patterns
 */
export function withTimeout<T>(
  promise: Promise<T>, 
  timeoutMs: number, 
  label?: string
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new TimeoutError(`${label || 'Operation'} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
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
 * Returns fallback value instead of throwing
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
 * Timeout with retry logic
 */
export async function withTimeoutRetry<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  maxRetries: number = 3,
  label?: string
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await withTimeout(operation(), timeoutMs, `${label} (attempt ${attempt})`);
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxRetries) {
        throw new TimeoutRetryError(
          `${label || 'Operation'} failed after ${maxRetries} attempts`,
          lastError
        );
      }

      // Exponential backoff
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      await delay(backoffMs);
    }
  }

  throw lastError!;
}

/**
 * Timeout for database operations
 */
export function withDbTimeout<T>(promise: Promise<T>, label?: string): Promise<T> {
  const timeoutMs = parseInt(process.env.DB_TIMEOUT_MS || '10000');
  return withTimeout(promise, timeoutMs, `DB ${label || 'operation'}`);
}

/**
 * Timeout for external API calls
 */
export function withApiTimeout<T>(promise: Promise<T>, label?: string): Promise<T> {
  const timeoutMs = parseInt(process.env.API_TIMEOUT_MS || '30000');
  return withTimeout(promise, timeoutMs, `API ${label || 'call'}`);
}

/**
 * Timeout for Redis operations
 */
export function withRedisTimeout<T>(promise: Promise<T>, label?: string): Promise<T> {
  const timeoutMs = parseInt(process.env.REDIS_TIMEOUT_MS || '5000');
  return withTimeout(promise, timeoutMs, `Redis ${label || 'operation'}`);
}

/**
 * Timeout for webhook processing
 */
export function withWebhookTimeout<T>(promise: Promise<T>, label?: string): Promise<T> {
  const timeoutMs = parseInt(process.env.WEBHOOK_TIMEOUT_MS || '15000');
  return withTimeout(promise, timeoutMs, `Webhook ${label || 'processing'}`);
}

/**
 * Helper to create a delay promise
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Timeout error class
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Timeout retry error class
 */
export class TimeoutRetryError extends Error {
  constructor(message: string, public readonly cause: Error) {
    super(message);
    this.name = 'TimeoutRetryError';
  }
}

/**
 * Create a timeout wrapper for any async function
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
  createTimeoutWrapper
};