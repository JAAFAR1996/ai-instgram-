/**
 * ===============================================
 * Redis Error Handling System
 * نظام شامل لمعالجة أخطاء Redis
 * ===============================================
 */

import { getLogger } from '../services/logger.js';

const log = getLogger({ component: 'redis-errors' });

/**
 * Error Categories
 */
export enum ErrorCategory {
  CONNECTION = 'connection',
  AUTHENTICATION = 'authentication',
  NETWORK = 'network',
  TIMEOUT = 'timeout',
  MEMORY = 'memory',
  RATE_LIMIT = 'rate_limit',
  VALIDATION = 'validation',
  CONFIGURATION = 'configuration',
  QUEUE = 'queue',
  HEALTH_CHECK = 'health_check',
  METRICS = 'metrics',
  CIRCUIT_BREAKER = 'circuit_breaker'
}

/**
 * Error Severity Levels
 */
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

/**
 * Error Recovery Strategy
 */
export enum RecoveryStrategy {
  RETRY = 'retry',
  CIRCUIT_BREAKER = 'circuit_breaker',
  FALLBACK = 'fallback',
  IGNORE = 'ignore',
  ALERT = 'alert'
}

/**
 * Error Metrics
 */
export interface ErrorMetrics {
  totalErrors: number;
  errorsByCategory: Record<ErrorCategory, number>;
  errorsBySeverity: Record<ErrorSeverity, number>;
  errorsByCode: Record<string, number>;
  lastErrorTime: Date | null;
  errorRate: number; // errors per minute
  recoveryRate: number; // successful recoveries per minute
}

/**
 * Rate Limiting Configuration
 */
export interface RateLimitConfig {
  maxErrorsPerMinute: number;
  maxErrorsPerHour: number;
  windowSizeMs: number;
  cooldownPeriodMs: number;
}

export abstract class RedisBaseError extends Error {
  abstract readonly code: string;
  abstract readonly category: ErrorCategory;
  abstract readonly severity: ErrorSeverity;
  abstract readonly recoveryStrategy: RecoveryStrategy;
  
  public readonly timestamp: Date;
  public readonly context?: Record<string, unknown>;
  public readonly retryCount: number = 0;

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
      category: this.category,
      severity: this.severity,
      recoveryStrategy: this.recoveryStrategy,
      message: this.message,
      timestamp: this.timestamp,
      context: this.context,
      retryCount: this.retryCount,
      stack: this.stack
    };
  }

  /**
   * Increment retry count
   */
  incrementRetryCount(): void {
    (this as any).retryCount = (this.retryCount || 0) + 1;
  }

  /**
   * Check if error should be retried
   */
  shouldRetry(): boolean {
    return this.recoveryStrategy === RecoveryStrategy.RETRY && this.retryCount < 3;
  }
}

export class RedisConnectionError extends RedisBaseError {
  readonly code = 'REDIS_CONNECTION_ERROR';
  readonly category = ErrorCategory.CONNECTION;
  readonly severity = ErrorSeverity.HIGH;
  readonly recoveryStrategy = RecoveryStrategy.RETRY;

  constructor(message: string, context?: Record<string, unknown>, cause?: Error) {
    super(message, context, cause);
  }
}

export class RedisValidationError extends RedisBaseError {
  readonly code = 'REDIS_VALIDATION_ERROR';
  readonly category = ErrorCategory.VALIDATION;
  readonly severity = ErrorSeverity.MEDIUM;
  readonly recoveryStrategy = RecoveryStrategy.IGNORE;

  constructor(message: string, context?: Record<string, unknown>, cause?: Error) {
    super(message, context, cause);
  }
}

export class RedisHealthCheckError extends RedisBaseError {
  readonly code = 'REDIS_HEALTH_CHECK_ERROR';
  readonly category = ErrorCategory.HEALTH_CHECK;
  readonly severity = ErrorSeverity.MEDIUM;
  readonly recoveryStrategy = RecoveryStrategy.ALERT;

  constructor(message: string, context?: Record<string, unknown>, cause?: Error) {
    super(message, context, cause);
  }
}

export class RedisMetricsError extends RedisBaseError {
  readonly code = 'REDIS_METRICS_ERROR';
  readonly category = ErrorCategory.METRICS;
  readonly severity = ErrorSeverity.LOW;
  readonly recoveryStrategy = RecoveryStrategy.IGNORE;

  constructor(message: string, context?: Record<string, unknown>, cause?: Error) {
    super(message, context, cause);
  }
}

export class RedisQueueError extends RedisBaseError {
  readonly code = 'REDIS_QUEUE_ERROR';
  readonly category = ErrorCategory.QUEUE;
  readonly severity = ErrorSeverity.HIGH;
  readonly recoveryStrategy = RecoveryStrategy.RETRY;

  constructor(message: string, context?: Record<string, unknown>, cause?: Error) {
    super(message, context, cause);
  }
}

export class RedisConfigurationError extends RedisBaseError {
  readonly code = 'REDIS_CONFIGURATION_ERROR';
  readonly category = ErrorCategory.CONFIGURATION;
  readonly severity = ErrorSeverity.CRITICAL;
  readonly recoveryStrategy = RecoveryStrategy.ALERT;

  constructor(message: string, context?: Record<string, unknown>, cause?: Error) {
    super(message, context, cause);
  }
}

export class RedisTimeoutError extends RedisBaseError {
  readonly code = 'REDIS_TIMEOUT_ERROR';
  readonly category = ErrorCategory.TIMEOUT;
  readonly severity = ErrorSeverity.MEDIUM;
  readonly recoveryStrategy = RecoveryStrategy.RETRY;

  constructor(message: string, context?: Record<string, unknown>, cause?: Error) {
    super(message, context, cause);
  }
}

export class RedisCircuitBreakerError extends RedisBaseError {
  readonly code = 'REDIS_CIRCUIT_BREAKER_ERROR';
  readonly category = ErrorCategory.CIRCUIT_BREAKER;
  readonly severity = ErrorSeverity.HIGH;
  readonly recoveryStrategy = RecoveryStrategy.CIRCUIT_BREAKER;

  constructor(message: string, context?: Record<string, unknown>, cause?: Error) {
    super(message, context, cause);
  }
}

export class RedisAuthenticationError extends RedisBaseError {
  readonly code = 'REDIS_AUTHENTICATION_ERROR';
  readonly category = ErrorCategory.AUTHENTICATION;
  readonly severity = ErrorSeverity.CRITICAL;
  readonly recoveryStrategy = RecoveryStrategy.ALERT;

  constructor(message: string, context?: Record<string, unknown>, cause?: Error) {
    super(message, context, cause);
  }
}

export class RedisNetworkError extends RedisBaseError {
  readonly code = 'REDIS_NETWORK_ERROR';
  readonly category = ErrorCategory.NETWORK;
  readonly severity = ErrorSeverity.HIGH;
  readonly recoveryStrategy = RecoveryStrategy.RETRY;

  constructor(message: string, context?: Record<string, unknown>, cause?: Error) {
    super(message, context, cause);
  }
}

export class RedisMemoryError extends RedisBaseError {
  readonly code = 'REDIS_MEMORY_ERROR';
  readonly category = ErrorCategory.MEMORY;
  readonly severity = ErrorSeverity.CRITICAL;
  readonly recoveryStrategy = RecoveryStrategy.ALERT;

  constructor(message: string, context?: Record<string, unknown>, cause?: Error) {
    super(message, context, cause);
  }
}

export class RedisRateLimitError extends RedisBaseError {
  readonly code = 'REDIS_RATE_LIMIT_ERROR';
  readonly category = ErrorCategory.RATE_LIMIT;
  readonly severity = ErrorSeverity.MEDIUM;
  readonly recoveryStrategy = RecoveryStrategy.FALLBACK;

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

  static createCircuitBreakerError(
    operation: string,
    failureCount: number,
    threshold: number
  ): RedisCircuitBreakerError {
    return new RedisCircuitBreakerError(
      `Circuit breaker opened: ${operation}`,
      { operation, failureCount, threshold }
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

export function isNetworkError(error: unknown): error is RedisNetworkError {
  return error instanceof RedisNetworkError;
}

export function isMemoryError(error: unknown): error is RedisMemoryError {
  return error instanceof RedisMemoryError;
}

export function isRateLimitError(error: unknown): error is RedisRateLimitError {
  return error instanceof RedisRateLimitError;
}

export function isCircuitBreakerError(error: unknown): error is RedisCircuitBreakerError {
  return error instanceof RedisCircuitBreakerError;
}

// Error Handler Utility
export class RedisErrorHandler {
  private errorHistory: RedisBaseError[] = [];
  private readonly maxHistorySize = 1000;
  private readonly rateLimitConfig: RateLimitConfig;
  private errorCounts: Record<string, number> = {};
  private lastErrorTime: Date | null = null;

  constructor(
    private logger = log,
    rateLimitConfig?: Partial<RateLimitConfig>
  ) {
    this.rateLimitConfig = {
      maxErrorsPerMinute: 100,
      maxErrorsPerHour: 1000,
      windowSizeMs: 60000, // 1 minute
      cooldownPeriodMs: 300000, // 5 minutes
      ...rateLimitConfig
    };
  }

  /**
   * Log error with structured logging
   */
  logError(error: RedisBaseError, additionalContext?: Record<string, unknown>): void {
    const logContext = {
      code: error.code,
      category: error.category,
      severity: error.severity,
      recoveryStrategy: error.recoveryStrategy,
      retryCount: error.retryCount,
      timestamp: error.timestamp,
      ...error.context,
      ...additionalContext
    };

    switch (error.severity) {
      case ErrorSeverity.CRITICAL:
        this.logger.error('🚨 Critical Redis error', logContext);
        break;
      case ErrorSeverity.HIGH:
        this.logger.error('❌ High severity Redis error', logContext);
        break;
      case ErrorSeverity.MEDIUM:
        this.logger.warn('⚠️ Medium severity Redis error', logContext);
        break;
      case ErrorSeverity.LOW:
        this.logger.info('ℹ️ Low severity Redis error', logContext);
        break;
    }

    // Add to history
    this.errorHistory.push(error);
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory = this.errorHistory.slice(-this.maxHistorySize);
    }

    // Update error counts
    this.errorCounts[error.code] = (this.errorCounts[error.code] || 0) + 1;
    this.lastErrorTime = new Date();
  }

  /**
   * Categorize error based on its properties
   */
  categorizeError(error: RedisBaseError): {
    category: ErrorCategory;
    severity: ErrorSeverity;
    recoveryStrategy: RecoveryStrategy;
    isRetryable: boolean;
  } {
    return {
      category: error.category,
      severity: error.severity,
      recoveryStrategy: error.recoveryStrategy,
      isRetryable: this.isRetryableError(error)
    };
  }

  /**
   * Check if error is retryable
   */
  isRetryableError(error: RedisBaseError): boolean {
    // Don't retry certain error types
    if (error instanceof RedisAuthenticationError) {
      return false;
    }

    if (error instanceof RedisConfigurationError) {
      return false;
    }

    if (error instanceof RedisValidationError) {
      return false;
    }

    if (error instanceof RedisMemoryError) {
      return false;
    }

    // Check retry count
    if (error.retryCount >= 3) {
      return false;
    }

    // Check rate limiting
    if (this.isRateLimited()) {
      return false;
    }

    return true;
  }

  /**
   * Check if we're currently rate limited
   */
  private isRateLimited(): boolean {
    if (!this.lastErrorTime) {
      return false;
    }

    const now = new Date();
    const timeSinceLastError = now.getTime() - this.lastErrorTime.getTime();

    // Check if we're in cooldown period
    if (timeSinceLastError < this.rateLimitConfig.cooldownPeriodMs) {
      return true;
    }

    // Check error rate in the last minute
    const recentErrors = this.errorHistory.filter(
      error => now.getTime() - error.timestamp.getTime() < this.rateLimitConfig.windowSizeMs
    );

    return recentErrors.length >= this.rateLimitConfig.maxErrorsPerMinute;
  }

  /**
   * Get comprehensive error metrics
   */
  getErrorMetrics(): ErrorMetrics {
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60000);
    const oneHourAgo = new Date(now.getTime() - 3600000);

    const recentErrors = this.errorHistory.filter(
      error => error.timestamp >= oneMinuteAgo
    );

    const errorsByCategory: Record<ErrorCategory, number> = {
      [ErrorCategory.CONNECTION]: 0,
      [ErrorCategory.AUTHENTICATION]: 0,
      [ErrorCategory.NETWORK]: 0,
      [ErrorCategory.TIMEOUT]: 0,
      [ErrorCategory.MEMORY]: 0,
      [ErrorCategory.RATE_LIMIT]: 0,
      [ErrorCategory.VALIDATION]: 0,
      [ErrorCategory.CONFIGURATION]: 0,
      [ErrorCategory.QUEUE]: 0,
      [ErrorCategory.HEALTH_CHECK]: 0,
      [ErrorCategory.METRICS]: 0,
      [ErrorCategory.CIRCUIT_BREAKER]: 0
    };

    const errorsBySeverity: Record<ErrorSeverity, number> = {
      [ErrorSeverity.LOW]: 0,
      [ErrorSeverity.MEDIUM]: 0,
      [ErrorSeverity.HIGH]: 0,
      [ErrorSeverity.CRITICAL]: 0
    };

    // Count errors by category and severity
    this.errorHistory.forEach(error => {
      errorsByCategory[error.category]++;
      errorsBySeverity[error.severity]++;
    });

    // Calculate error rate (errors per minute)
    const errorRate = recentErrors.length;

    // Calculate recovery rate (successful retries)
    const successfulRecoveries = this.errorHistory.filter(
      error => error.retryCount > 0 && error.retryCount < 3
    ).length;

    return {
      totalErrors: this.errorHistory.length,
      errorsByCategory,
      errorsBySeverity,
      errorsByCode: this.errorCounts,
      lastErrorTime: this.lastErrorTime,
      errorRate,
      recoveryRate: successfulRecoveries
    };
  }

  /**
   * Handle error with comprehensive error handling
   */
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

    // Log the error
    this.logError(redisError, context);

    // Categorize the error
    const categorization = this.categorizeError(redisError);

    // Apply recovery strategy
    this.applyRecoveryStrategy(redisError, categorization);

    return redisError;
  }

  /**
   * Apply recovery strategy based on error type
   */
  private applyRecoveryStrategy(
    error: RedisBaseError,
    categorization: ReturnType<typeof this.categorizeError>
  ): void {
    switch (categorization.recoveryStrategy) {
      case RecoveryStrategy.RETRY:
        if (categorization.isRetryable) {
          this.logger.info('🔄 Applying retry strategy', {
            code: error.code,
            retryCount: error.retryCount
          });
        }
        break;

      case RecoveryStrategy.CIRCUIT_BREAKER:
        this.logger.warn('⚡ Circuit breaker activated', {
          code: error.code,
          category: error.category
        });
        break;

      case RecoveryStrategy.FALLBACK:
        this.logger.info('🔄 Applying fallback strategy', {
          code: error.code,
          category: error.category
        });
        break;

      case RecoveryStrategy.ALERT:
        this.logger.error('🚨 Alert: Critical error detected', {
          code: error.code,
          category: error.category,
          severity: error.severity
        });
        break;

      case RecoveryStrategy.IGNORE:
        this.logger.debug('ℹ️ Ignoring error', {
          code: error.code,
          category: error.category
        });
        break;
    }
  }

  /**
   * Get retry delay for error
   */
  getRetryDelay(error: RedisBaseError, attempt: number): number {
    // Exponential backoff with jitter
    const baseDelay = 1000; // 1 second
    const maxDelay = 30000;  // 30 seconds
    
    if (isTimeoutError(error)) {
      return Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    }

    if (isConnectionError(error)) {
      return Math.min(baseDelay * Math.pow(1.5, attempt), maxDelay);
    }

    if (isNetworkError(error)) {
      return Math.min(baseDelay * Math.pow(1.8, attempt), maxDelay);
    }

    return Math.min(baseDelay * attempt, maxDelay);
  }

  /**
   * Clear error history
   */
  clearHistory(): void {
    this.errorHistory = [];
    this.errorCounts = {};
    this.lastErrorTime = null;
  }

  /**
   * Get error summary for monitoring
   */
  getErrorSummary(): {
    totalErrors: number;
    criticalErrors: number;
    highSeverityErrors: number;
    errorRate: number;
    lastErrorTime: Date | null;
  } {
    const metrics = this.getErrorMetrics();
    
    return {
      totalErrors: metrics.totalErrors,
      criticalErrors: metrics.errorsBySeverity[ErrorSeverity.CRITICAL],
      highSeverityErrors: metrics.errorsBySeverity[ErrorSeverity.HIGH],
      errorRate: metrics.errorRate,
      lastErrorTime: metrics.lastErrorTime
    };
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
  ErrorCategory,
  ErrorSeverity,
  RecoveryStrategy,
  isRedisError,
  isConnectionError,
  isValidationError,
  isTimeoutError,
  isAuthenticationError,
  isNetworkError,
  isMemoryError,
  isRateLimitError,
  isCircuitBreakerError
};