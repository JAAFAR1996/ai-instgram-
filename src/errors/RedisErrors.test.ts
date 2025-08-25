/**
 * ===============================================
 * Redis Errors Tests
 * اختبارات شاملة لأخطاء Redis والتعامل معها
 * ===============================================
 */

import { describe, test, expect, beforeEach, mock } from 'vitest';
import {
  RedisBaseError,
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
} from './RedisErrors.js';

describe('Redis Errors - أخطاء Redis', () => {
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      error: mock(),
      warn: mock(),
      info: mock(),
      debug: mock()
    };
  });

  describe('RedisBaseError - الخطأ الأساسي', () => {
    test('should create base error with required properties', () => {
      const context = { operation: 'test', key: 'user:123' };
      const cause = new Error('Original error');
      
      class TestRedisError extends RedisBaseError {
        readonly code = 'TEST_ERROR';
      }

      const error = new TestRedisError('Test error message', context, cause);

      expect(error.message).toBe('Test error message');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.context).toEqual(context);
      expect(error.timestamp).toBeInstanceOf(Date);
      expect(error.name).toBe('TestRedisError');
      expect(error.stack).toBeDefined();
    });

    test('should serialize to JSON correctly', () => {
      class TestRedisError extends RedisBaseError {
        readonly code = 'TEST_ERROR';
      }

      const context = { operation: 'get', key: 'test:key' };
      const error = new TestRedisError('Test message', context);
      const json = error.toJSON();

      expect(json).toEqual({
        name: 'TestRedisError',
        code: 'TEST_ERROR',
        message: 'Test message',
        timestamp: error.timestamp,
        context: context,
        stack: error.stack
      });
    });

    test('should capture stack trace correctly', () => {
      class TestRedisError extends RedisBaseError {
        readonly code = 'TEST_ERROR';
      }

      const error = new TestRedisError('Test error');

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('TestRedisError');
    });

    test('should handle missing context and cause', () => {
      class TestRedisError extends RedisBaseError {
        readonly code = 'TEST_ERROR';
      }

      const error = new TestRedisError('Simple error');

      expect(error.context).toBeUndefined();
      expect(error.stack).not.toContain('Caused by:');
    });
  });

  describe('Specific Error Types - أنواع الأخطاء المحددة', () => {
    test('should create RedisConnectionError with correct code', () => {
      const error = new RedisConnectionError('Connection failed', { host: 'localhost' });

      expect(error.code).toBe('REDIS_CONNECTION_ERROR');
      expect(error.message).toBe('Connection failed');
      expect(error.context).toEqual({ host: 'localhost' });
      expect(error).toBeInstanceOf(RedisBaseError);
    });

    test('should create RedisValidationError with correct code', () => {
      const error = new RedisValidationError('Invalid parameter', { field: 'timeout' });

      expect(error.code).toBe('REDIS_VALIDATION_ERROR');
      expect(error.message).toBe('Invalid parameter');
      expect(error.context).toEqual({ field: 'timeout' });
    });

    test('should create RedisHealthCheckError with correct code', () => {
      const error = new RedisHealthCheckError('Health check failed');

      expect(error.code).toBe('REDIS_HEALTH_CHECK_ERROR');
      expect(error.message).toBe('Health check failed');
    });

    test('should create RedisMetricsError with correct code', () => {
      const error = new RedisMetricsError('Metrics collection failed');

      expect(error.code).toBe('REDIS_METRICS_ERROR');
      expect(error.message).toBe('Metrics collection failed');
    });

    test('should create RedisQueueError with correct code', () => {
      const error = new RedisQueueError('Queue operation failed');

      expect(error.code).toBe('REDIS_QUEUE_ERROR');
      expect(error.message).toBe('Queue operation failed');
    });

    test('should create RedisConfigurationError with correct code', () => {
      const error = new RedisConfigurationError('Invalid configuration');

      expect(error.code).toBe('REDIS_CONFIGURATION_ERROR');
      expect(error.message).toBe('Invalid configuration');
    });

    test('should create RedisTimeoutError with correct code', () => {
      const error = new RedisTimeoutError('Operation timed out');

      expect(error.code).toBe('REDIS_TIMEOUT_ERROR');
      expect(error.message).toBe('Operation timed out');
    });

    test('should create RedisCircuitBreakerError with correct code', () => {
      const error = new RedisCircuitBreakerError('Circuit breaker open');

      expect(error.code).toBe('REDIS_CIRCUIT_BREAKER_ERROR');
      expect(error.message).toBe('Circuit breaker open');
    });

    test('should create RedisAuthenticationError with correct code', () => {
      const error = new RedisAuthenticationError('Authentication failed');

      expect(error.code).toBe('REDIS_AUTHENTICATION_ERROR');
      expect(error.message).toBe('Authentication failed');
    });

    test('should create RedisNetworkError with correct code', () => {
      const error = new RedisNetworkError('Network connection lost');

      expect(error.code).toBe('REDIS_NETWORK_ERROR');
      expect(error.message).toBe('Network connection lost');
    });

    test('should create RedisMemoryError with correct code', () => {
      const error = new RedisMemoryError('Out of memory');

      expect(error.code).toBe('REDIS_MEMORY_ERROR');
      expect(error.message).toBe('Out of memory');
    });

    test('should create RedisRateLimitError with correct code', () => {
      const error = new RedisRateLimitError('Rate limit exceeded');

      expect(error.code).toBe('REDIS_RATE_LIMIT_ERROR');
      expect(error.message).toBe('Rate limit exceeded');
    });
  });

  describe('RedisErrorFactory - مصنع الأخطاء', () => {
    test('should create connection error from ECONNREFUSED', () => {
      const originalError = {
        code: 'ECONNREFUSED',
        message: 'Connection refused'
      };

      const redisError = RedisErrorFactory.createFromIORedisError(originalError, { host: 'localhost' });

      expect(redisError).toBeInstanceOf(RedisConnectionError);
      expect(redisError.message).toContain('Connection failed');
      expect(redisError.context).toEqual({ host: 'localhost', originalCode: 'ECONNREFUSED' });
    });

    test('should create connection error from ENOTFOUND', () => {
      const originalError = {
        code: 'ENOTFOUND',
        message: 'Host not found'
      };

      const redisError = RedisErrorFactory.createFromIORedisError(originalError);

      expect(redisError).toBeInstanceOf(RedisConnectionError);
      expect(redisError.message).toContain('Connection failed');
      expect(redisError.context?.originalCode).toBe('ENOTFOUND');
    });

    test('should create authentication error from NOAUTH', () => {
      const originalError = {
        code: 'NOAUTH',
        message: 'NOAUTH Authentication required'
      };

      const redisError = RedisErrorFactory.createFromIORedisError(originalError);

      expect(redisError).toBeInstanceOf(RedisAuthenticationError);
      expect(redisError.message).toContain('Authentication failed');
    });

    test('should create authentication error from AUTH message', () => {
      const originalError = {
        message: 'ERR AUTH failed'
      };

      const redisError = RedisErrorFactory.createFromIORedisError(originalError);

      expect(redisError).toBeInstanceOf(RedisAuthenticationError);
      expect(redisError.message).toContain('Authentication failed');
    });

    test('should create timeout error from TIMEOUT code', () => {
      const originalError = {
        code: 'TIMEOUT',
        message: 'Operation timeout'
      };

      const redisError = RedisErrorFactory.createFromIORedisError(originalError);

      expect(redisError).toBeInstanceOf(RedisTimeoutError);
      expect(redisError.message).toContain('Operation timeout');
    });

    test('should create timeout error from timeout message', () => {
      const originalError = {
        message: 'Command timeout error'
      };

      const redisError = RedisErrorFactory.createFromIORedisError(originalError);

      expect(redisError).toBeInstanceOf(RedisTimeoutError);
      expect(redisError.message).toContain('Operation timeout');
    });

    test('should create network error from ECONNRESET', () => {
      const originalError = {
        code: 'ECONNRESET',
        message: 'Connection reset by peer'
      };

      const redisError = RedisErrorFactory.createFromIORedisError(originalError);

      expect(redisError).toBeInstanceOf(RedisNetworkError);
      expect(redisError.message).toContain('Network error');
      expect(redisError.context?.originalCode).toBe('ECONNRESET');
    });

    test('should create network error from EPIPE', () => {
      const originalError = {
        code: 'EPIPE',
        message: 'Broken pipe'
      };

      const redisError = RedisErrorFactory.createFromIORedisError(originalError);

      expect(redisError).toBeInstanceOf(RedisNetworkError);
      expect(redisError.context?.originalCode).toBe('EPIPE');
    });

    test('should create memory error from OOM message', () => {
      const originalError = {
        message: 'OOM command not allowed when used memory'
      };

      const redisError = RedisErrorFactory.createFromIORedisError(originalError);

      expect(redisError).toBeInstanceOf(RedisMemoryError);
      expect(redisError.message).toContain('Memory error');
    });

    test('should create memory error from memory message', () => {
      const originalError = {
        message: 'Redis memory usage exceeded'
      };

      const redisError = RedisErrorFactory.createFromIORedisError(originalError);

      expect(redisError).toBeInstanceOf(RedisMemoryError);
    });

    test('should create rate limit error from limit message', () => {
      const originalError = {
        message: 'max requests limit exceeded'
      };

      const redisError = RedisErrorFactory.createFromIORedisError(originalError);

      expect(redisError).toBeInstanceOf(RedisRateLimitError);
      expect(redisError.message).toContain('Rate limit exceeded');
    });

    test('should create default connection error for unknown errors', () => {
      const originalError = {
        message: 'Unknown Redis error',
        customField: 'custom value'
      };

      const redisError = RedisErrorFactory.createFromIORedisError(originalError, { operation: 'get' });

      expect(redisError).toBeInstanceOf(RedisConnectionError);
      expect(redisError.message).toBe('Unknown Redis error');
      expect(redisError.context).toEqual({ 
        operation: 'get', 
        originalError: undefined 
      });
    });

    test('should create validation error with field information', () => {
      const error = RedisErrorFactory.createValidationError('timeout', 'invalid', 'number');

      expect(error).toBeInstanceOf(RedisValidationError);
      expect(error.message).toBe('Invalid timeout: expected number, got string');
      expect(error.context).toEqual({
        field: 'timeout',
        value: 'invalid',
        expectedType: 'number'
      });
    });

    test('should create validation error without expected type', () => {
      const error = RedisErrorFactory.createValidationError('key', null);

      expect(error.message).toBe('Invalid key: null');
      expect(error.context).toEqual({
        field: 'key',
        value: null,
        expectedType: undefined
      });
    });

    test('should create health check error with details', () => {
      const details = { latency: 5000, memoryUsage: '90%' };
      const error = RedisErrorFactory.createHealthCheckError('performance', details);

      expect(error).toBeInstanceOf(RedisHealthCheckError);
      expect(error.message).toBe('Health check failed: performance');
      expect(error.context).toEqual({
        checkType: 'performance',
        latency: 5000,
        memoryUsage: '90%'
      });
    });

    test('should create queue error with operation details', () => {
      const cause = new Error('Job processing failed');
      const error = RedisErrorFactory.createQueueError('process', 'email-queue', 'job-123', cause);

      expect(error).toBeInstanceOf(RedisQueueError);
      expect(error.message).toBe('Queue operation failed: process');
      expect(error.context).toEqual({
        operation: 'process',
        queueName: 'email-queue',
        jobId: 'job-123'
      });
    });
  });

  describe('Type Guards - حراس الأنواع', () => {
    test('should identify Redis errors correctly', () => {
      const redisError = new RedisConnectionError('Test error');
      const regularError = new Error('Regular error');

      expect(isRedisError(redisError)).toBe(true);
      expect(isRedisError(regularError)).toBe(false);
      expect(isRedisError(null)).toBe(false);
      expect(isRedisError(undefined)).toBe(false);
      expect(isRedisError('string')).toBe(false);
    });

    test('should identify connection errors correctly', () => {
      const connectionError = new RedisConnectionError('Connection failed');
      const validationError = new RedisValidationError('Validation failed');

      expect(isConnectionError(connectionError)).toBe(true);
      expect(isConnectionError(validationError)).toBe(false);
      expect(isConnectionError(new Error('Regular error'))).toBe(false);
    });

    test('should identify validation errors correctly', () => {
      const validationError = new RedisValidationError('Validation failed');
      const connectionError = new RedisConnectionError('Connection failed');

      expect(isValidationError(validationError)).toBe(true);
      expect(isValidationError(connectionError)).toBe(false);
    });

    test('should identify timeout errors correctly', () => {
      const timeoutError = new RedisTimeoutError('Timeout occurred');
      const networkError = new RedisNetworkError('Network failed');

      expect(isTimeoutError(timeoutError)).toBe(true);
      expect(isTimeoutError(networkError)).toBe(false);
    });

    test('should identify authentication errors correctly', () => {
      const authError = new RedisAuthenticationError('Auth failed');
      const configError = new RedisConfigurationError('Config invalid');

      expect(isAuthenticationError(authError)).toBe(true);
      expect(isAuthenticationError(configError)).toBe(false);
    });
  });

  describe('RedisErrorHandler - معالج الأخطاء', () => {
    let errorHandler: RedisErrorHandler;

    beforeEach(() => {
      errorHandler = new RedisErrorHandler(mockLogger);
    });

    test('should handle Redis errors directly', () => {
      const originalError = new RedisConnectionError('Connection failed', { host: 'localhost' });
      
      const handledError = errorHandler.handleError(originalError);

      expect(handledError).toBe(originalError);
      expect(mockLogger.error).toHaveBeenCalledWith('Redis Error', {
        code: 'REDIS_CONNECTION_ERROR',
        message: 'Connection failed',
        context: { host: 'localhost' },
        timestamp: originalError.timestamp
      });
    });

    test('should convert regular errors to Redis errors', () => {
      const originalError = new Error('ECONNREFUSED');
      originalError.name = 'ECONNREFUSED';
      
      const handledError = errorHandler.handleError(originalError, { operation: 'connect' });

      expect(handledError).toBeInstanceOf(RedisConnectionError);
      expect(handledError.context?.operation).toBe('connect');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should handle unknown error types', () => {
      const unknownError = 'String error';
      
      const handledError = errorHandler.handleError(unknownError, { operation: 'unknown' });

      expect(handledError).toBeInstanceOf(RedisConnectionError);
      expect(handledError.message).toBe('Unknown error occurred');
      expect(handledError.context).toEqual({
        operation: 'unknown',
        originalError: 'String error'
      });
    });

    test('should work without logger', () => {
      const handlerWithoutLogger = new RedisErrorHandler();
      const error = new Error('Test error');
      
      expect(() => {
        handlerWithoutLogger.handleError(error);
      }).not.toThrow();
    });

    test('should determine retry eligibility correctly', () => {
      const connectionError = new RedisConnectionError('Connection failed');
      const authError = new RedisAuthenticationError('Auth failed');
      const configError = new RedisConfigurationError('Config invalid');
      const validationError = new RedisValidationError('Validation failed');
      const timeoutError = new RedisTimeoutError('Timeout occurred');

      expect(errorHandler.shouldRetry(connectionError)).toBe(true);
      expect(errorHandler.shouldRetry(timeoutError)).toBe(true);
      expect(errorHandler.shouldRetry(authError)).toBe(false);
      expect(errorHandler.shouldRetry(configError)).toBe(false);
      expect(errorHandler.shouldRetry(validationError)).toBe(false);
    });

    test('should calculate retry delays for timeout errors', () => {
      const timeoutError = new RedisTimeoutError('Timeout occurred');

      const delay1 = errorHandler.getRetryDelay(timeoutError, 1);
      const delay2 = errorHandler.getRetryDelay(timeoutError, 2);
      const delay3 = errorHandler.getRetryDelay(timeoutError, 3);

      expect(delay1).toBe(2000);  // 1000 * 2^1
      expect(delay2).toBe(4000);  // 1000 * 2^2
      expect(delay3).toBe(8000);  // 1000 * 2^3
    });

    test('should calculate retry delays for connection errors', () => {
      const connectionError = new RedisConnectionError('Connection failed');

      const delay1 = errorHandler.getRetryDelay(connectionError, 1);
      const delay2 = errorHandler.getRetryDelay(connectionError, 2);

      expect(delay1).toBe(1500);  // 1000 * 1.5^1
      expect(delay2).toBe(2250);  // 1000 * 1.5^2
    });

    test('should calculate linear retry delays for other errors', () => {
      const queueError = new RedisQueueError('Queue failed');

      const delay1 = errorHandler.getRetryDelay(queueError, 1);
      const delay2 = errorHandler.getRetryDelay(queueError, 2);
      const delay3 = errorHandler.getRetryDelay(queueError, 3);

      expect(delay1).toBe(1000);  // 1000 * 1
      expect(delay2).toBe(2000);  // 1000 * 2
      expect(delay3).toBe(3000);  // 1000 * 3
    });

    test('should cap retry delays at maximum', () => {
      const timeoutError = new RedisTimeoutError('Timeout occurred');

      const delay = errorHandler.getRetryDelay(timeoutError, 10); // Very high attempt

      expect(delay).toBe(30000); // Maximum delay cap
    });
  });

  describe('Error Context and Metadata - سياق الأخطاء والبيانات الوصفية', () => {
    test('should preserve error context through factory creation', () => {
      const originalError = {
        code: 'ECONNREFUSED',
        message: 'Connection refused',
        host: 'redis.example.com',
        port: 6379
      };

      const context = {
        operation: 'connect',
        retryAttempt: 3,
        timeout: 5000
      };

      const redisError = RedisErrorFactory.createFromIORedisError(originalError, context);

      expect(redisError.context).toEqual({
        operation: 'connect',
        retryAttempt: 3,
        timeout: 5000,
        originalCode: 'ECONNREFUSED'
      });
    });

    test('should track error timestamps', () => {
      const beforeCreation = new Date();
      const error = new RedisConnectionError('Test error');
      const afterCreation = new Date();

      expect(error.timestamp.getTime()).toBeGreaterThanOrEqual(beforeCreation.getTime());
      expect(error.timestamp.getTime()).toBeLessThanOrEqual(afterCreation.getTime());
    });

    test('should maintain error chains with cause', () => {
      const rootCause = new Error('Root cause error');
      const networkError = new Error('Network layer error');
      const redisError = new RedisConnectionError('Redis connection failed', {}, networkError);

      expect(redisError.stack).toContain('Caused by:');
      expect(redisError.stack).toContain(networkError.stack);
    });

    test('should serialize complex context correctly', () => {
      const complexContext = {
        connection: {
          host: 'redis.example.com',
          port: 6379,
          database: 0
        },
        operation: {
          command: 'GET',
          key: 'user:123',
          options: { timeout: 5000 }
        },
        metrics: {
          attempts: 3,
          totalDuration: 15000
        }
      };

      const error = new RedisConnectionError('Complex error', complexContext);
      const json = error.toJSON();

      expect(json.context).toEqual(complexContext);
      expect(JSON.stringify(json)).not.toThrow();
    });
  });

  describe('Error Recovery Scenarios - سيناريوهات استرداد الأخطاء', () => {
    test('should handle cascading error scenarios', () => {
      const handler = new RedisErrorHandler(mockLogger);

      // Simulate cascade: timeout -> connection reset -> authentication required
      const timeoutError = new RedisTimeoutError('Initial timeout');
      const networkError = new RedisNetworkError('Connection reset', {}, timeoutError);
      const authError = new RedisAuthenticationError('Auth required after reconnect', {}, networkError);

      expect(handler.shouldRetry(timeoutError)).toBe(true);
      expect(handler.shouldRetry(networkError)).toBe(true);
      expect(handler.shouldRetry(authError)).toBe(false); // Auth errors shouldn't retry

      const timeoutDelay = handler.getRetryDelay(timeoutError, 1);
      const networkDelay = handler.getRetryDelay(networkError, 1);

      expect(timeoutDelay).toBeGreaterThan(networkDelay);
    });

    test('should handle memory pressure scenarios', () => {
      const memoryError = new RedisMemoryError('OOM during operation', {
        memoryUsage: '95%',
        operation: 'SET',
        keySize: 1024000
      });

      const handler = new RedisErrorHandler(mockLogger);
      
      expect(handler.shouldRetry(memoryError)).toBe(true);
      expect(handler.getRetryDelay(memoryError, 1)).toBeGreaterThan(0);
    });

    test('should handle rate limiting scenarios', () => {
      const rateLimitError = new RedisRateLimitError('Rate limit exceeded', {
        currentRate: 1000,
        maxRate: 500,
        resetTime: new Date(Date.now() + 60000)
      });

      const handler = new RedisErrorHandler(mockLogger);
      
      expect(handler.shouldRetry(rateLimitError)).toBe(true);
      
      // Rate limit errors should have longer delays
      const delay = handler.getRetryDelay(rateLimitError, 1);
      expect(delay).toBe(1000); // Linear backoff
    });
  });

  describe('Integration with Real Redis Errors - التكامل مع أخطاء Redis الحقيقية', () => {
    test('should handle real IORedis connection errors', () => {
      // Simulate real IORedis error structure
      const ioRedisError = {
        name: 'ReplyError',
        message: 'ECONNREFUSED: Connection refused',
        code: 'ECONNREFUSED',
        errno: -111,
        syscall: 'connect',
        address: '127.0.0.1',
        port: 6379
      };

      const redisError = RedisErrorFactory.createFromIORedisError(ioRedisError);

      expect(redisError).toBeInstanceOf(RedisConnectionError);
      expect(redisError.message).toContain('Connection failed');
      expect(redisError.context?.originalCode).toBe('ECONNREFUSED');
    });

    test('should handle Redis AUTH errors', () => {
      const authError = {
        name: 'ReplyError',
        message: 'NOAUTH Authentication required.',
        command: { name: 'get', args: ['key'] }
      };

      const redisError = RedisErrorFactory.createFromIORedisError(authError);

      expect(redisError).toBeInstanceOf(RedisAuthenticationError);
      expect(redisError.message).toContain('Authentication failed');
    });

    test('should handle Redis cluster errors', () => {
      const clusterError = {
        name: 'ClusterAllFailedError',
        message: 'Failed to refresh slots cache.',
        lastNodeError: {
          code: 'ENOTFOUND',
          message: 'getaddrinfo ENOTFOUND redis-cluster'
        }
      };

      const redisError = RedisErrorFactory.createFromIORedisError(clusterError);

      expect(redisError).toBeInstanceOf(RedisConnectionError);
      expect(redisError.message).toContain('Failed to refresh slots cache');
    });
  });
});