export abstract class RedisBaseError extends Error {
  abstract readonly code: string;
  public readonly timestamp: Date;
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    context?: Record<string, unknown>,
    cause?: Error
  ) {
    super(message);
    this.name = this.constructor.name;
    this.timestamp = new Date();
    if (context) {
      this.context = context;
    }
    
    if (cause) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }

    // Maintain proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp,
      context: this.context,
      stack: this.stack
    };
  }
}

export class RedisConnectionError extends RedisBaseError {
  readonly code = 'REDIS_CONNECTION_ERROR';

  constructor(message: string, context?: Record<string, unknown>, cause?: Error) {
    super(message, context, cause);
  }
}

export class RedisValidationError extends RedisBaseError {
  readonly code = 'REDIS_VALIDATION_ERROR';

  constructor(message: string, context?: Record<string, unknown>, cause?: Error) {
    super(message, context, cause);
  }
}

export class RedisHealthCheckError extends RedisBaseError {
  readonly code = 'REDIS_HEALTH_CHECK_ERROR';

  constructor(message: string, context?: Record<string, unknown>, cause?: Error) {
    super(message, context, cause);
  }
}

export class RedisMetricsError extends RedisBaseError {
  readonly code = 'REDIS_METRICS_ERROR';

  constructor(message: string, context?: Record<string, unknown>, cause?: Error) {
    super(message, context, cause);
  }
}

export class RedisQueueError extends RedisBaseError {
  readonly code = 'REDIS_QUEUE_ERROR';

  constructor(message: string, context?: Record<string, unknown>, cause?: Error) {
    super(message, context, cause);
  }
}

export class RedisConfigurationError extends RedisBaseError {
  readonly code = 'REDIS_CONFIGURATION_ERROR';

  constructor(message: string, context?: Record<string, unknown>, cause?: Error) {
    super(message, context, cause);
  }
}

export class RedisTimeoutError extends RedisBaseError {
  readonly code = 'REDIS_TIMEOUT_ERROR';

  constructor(message: string, context?: Record<string, unknown>, cause?: Error) {
    super(message, context, cause);
  }
}

export class RedisCircuitBreakerError extends RedisBaseError {
  readonly code = 'REDIS_CIRCUIT_BREAKER_ERROR';

  constructor(message: string, context?: Record<string, unknown>, cause?: Error) {
    super(message, context, cause);
  }
}

export class RedisAuthenticationError extends RedisBaseError {
  readonly code = 'REDIS_AUTHENTICATION_ERROR';

  constructor(message: string, context?: Record<string, unknown>, cause?: Error) {
    super(message, context, cause);
  }
}

export class RedisNetworkError extends RedisBaseError {
  readonly code = 'REDIS_NETWORK_ERROR';

  constructor(message: string, context?: Record<string, unknown>, cause?: Error) {
    super(message, context, cause);
  }
}

export class RedisMemoryError extends RedisBaseError {
  readonly code = 'REDIS_MEMORY_ERROR';

  constructor(message: string, context?: Record<string, unknown>, cause?: Error) {
    super(message, context, cause);
  }
}

export class RedisRateLimitError extends RedisBaseError {
  readonly code = 'REDIS_RATE_LIMIT_ERROR';

  constructor(message: string, context?: Record<string, unknown>, cause?: Error) {
    super(message, context, cause);
  }
}

// Error Factory لإنشاء الأخطاء بناءً على نوع المشكلة
type IoRedisErrorLike = {
  message?: unknown;
  code?: unknown;
  name?: unknown;
};

function getString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export class RedisErrorFactory {
  static createFromIORedisError(error: unknown, context?: Record<string, unknown>): RedisBaseError {
    const err = (error as IoRedisErrorLike) || {};
    const message = getString(err.message, 'Unknown Redis error');
    
    if (getString(err.code) === 'ECONNREFUSED' || getString(err.code) === 'ENOTFOUND') {
      return new RedisConnectionError(
        `Connection failed: ${message}`,
        { ...context, originalCode: getString(err.code) },
        error instanceof Error ? error : undefined
      );
    }

    if (getString(err.code) === 'NOAUTH' || getString(err.message).includes('AUTH')) {
      return new RedisAuthenticationError(
        `Authentication failed: ${message}`,
        context,
        error instanceof Error ? error : undefined
      );
    }

    if (getString(err.code) === 'TIMEOUT' || getString(err.message).toLowerCase().includes('timeout')) {
      return new RedisTimeoutError(
        `Operation timeout: ${message}`,
        context,
        error instanceof Error ? error : undefined
      );
    }

    if (getString(err.code) === 'ECONNRESET' || getString(err.code) === 'EPIPE') {
      return new RedisNetworkError(
        `Network error: ${message}`,
        { ...context, originalCode: getString(err.code) },
        error instanceof Error ? error : undefined
      );
    }

    const errMsg = getString(err.message).toLowerCase();
    if (errMsg.includes('oom') || errMsg.includes('memory')) {
      return new RedisMemoryError(
        `Memory error: ${message}`,
        context,
        error instanceof Error ? error : undefined
      );
    }

    if (message.toLowerCase().includes('max requests limit exceeded')) {
      return new RedisRateLimitError(
        `Rate limit exceeded: ${message}`,
        context,
        error instanceof Error ? error : undefined
      );
    }

    // Default Redis connection error
    return new RedisConnectionError(
      message,
      { ...context, originalError: getString(err.code) || getString(err.name) },
      error instanceof Error ? error : undefined
    );
  }

  static createValidationError(
    field: string, 
    value: unknown,
    expectedType?: string
  ): RedisValidationError {
    const message = expectedType 
      ? `Invalid ${field}: expected ${expectedType}, got ${typeof value}`
      : `Invalid ${field}: ${value}`;
      
    return new RedisValidationError(message, { field, value, expectedType });
  }

  static createHealthCheckError(
    checkType: string, 
    details?: Record<string, unknown>
  ): RedisHealthCheckError {
    return new RedisHealthCheckError(
      `Health check failed: ${checkType}`,
      { checkType, ...details }
    );
  }

  static createQueueError(
    operation: string, 
    queueName?: string, 
    jobId?: string,
    cause?: Error
  ): RedisQueueError {
    return new RedisQueueError(
      `Queue operation failed: ${operation}`,
      { operation, queueName, jobId },
      cause
    );
  }
}

// Type Guards
export function isRedisError(error: unknown): error is RedisBaseError {
  return error instanceof RedisBaseError;
}

export function isConnectionError(error: unknown): error is RedisConnectionError {
  return error instanceof RedisConnectionError;
}

export function isValidationError(error: unknown): error is RedisValidationError {
  return error instanceof RedisValidationError;
}

export function isTimeoutError(error: unknown): error is RedisTimeoutError {
  return error instanceof RedisTimeoutError;
}

export function isAuthenticationError(error: unknown): error is RedisAuthenticationError {
  return error instanceof RedisAuthenticationError;
}

// Error Handler Utility
export class RedisErrorHandler {
  constructor(private logger?: { error: (...args: unknown[]) => void }) {}

  handleError(error: unknown, context?: Record<string, unknown>): RedisBaseError {
    let redisError: RedisBaseError;

    if (isRedisError(error)) {
      redisError = error;
    } else if (error instanceof Error) {
      redisError = RedisErrorFactory.createFromIORedisError(error, context);
    } else {
      redisError = new RedisConnectionError(
        'Unknown error occurred',
        { ...context, originalError: String(error) }
      );
    }

    if (this.logger) {
      this.logger.error('Redis Error', {
        code: redisError.code,
        message: redisError.message,
        context: redisError.context,
        timestamp: redisError.timestamp
      });
    }

    return redisError;
  }

  shouldRetry(error: RedisBaseError): boolean {
    // لا نعيد المحاولة في حالات معينة
    if (isAuthenticationError(error)) {
      return false;
    }

    if (error instanceof RedisConfigurationError) {
      return false;
    }

    if (error instanceof RedisValidationError) {
      return false;
    }

    // يمكن إعادة المحاولة للأخطاء الأخرى
    return true;
  }

  getRetryDelay(error: RedisBaseError, attempt: number): number {
    // تأخير متزايد للمحاولات
    const baseDelay = 1000; // 1 ثانية
    const maxDelay = 30000;  // 30 ثانية
    
    if (isTimeoutError(error)) {
      return Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    }

    if (isConnectionError(error)) {
      return Math.min(baseDelay * Math.pow(1.5, attempt), maxDelay);
    }

    return Math.min(baseDelay * attempt, maxDelay);
  }
}

export default {
  RedisConnectionError,
  RedisValidationError,
  RedisHealthCheckError,
  RedisMetricsError,
  RedisQueueError,
  RedisConfigurationError,
  RedisTimeoutError,
  RedisCircuitBreakerError,
  RedisAuthenticationError,
  RedisNetworkError,
  RedisMemoryError,
  RedisRateLimitError,
  RedisErrorFactory,
  RedisErrorHandler,
  isRedisError,
  isConnectionError,
  isValidationError,
  isTimeoutError,
  isAuthenticationError
};