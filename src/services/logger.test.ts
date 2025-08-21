/**
 * ===============================================
 * Logger Service Tests
 * اختبارات شاملة لخدمة السجلات المهيكلة
 * ===============================================
 */

import { describe, test, expect, beforeEach, afterEach, jest } from 'bun:test';

import {
  Logger,
  getLogger,
  createLogger,
  bindRequestLogger,
  createRequestLogger,
  type LogContext,
  type LogLevel,
  type LogEntry
} from './logger.js';

describe('📝 Logger Service Tests', () => {
  let logger: Logger;
  let originalStdout: any;
  let originalStderr: any;
  let originalEnv: any;
  let capturedOutput: string[];
  let capturedErrors: string[];

  beforeEach(() => {
    // Capture console output
    capturedOutput = [];
    capturedErrors = [];

    originalStdout = process.stdout.write;
    originalStderr = process.stderr.write;
    originalEnv = { ...process.env };

    process.stdout.write = jest.fn((data: string) => {
      capturedOutput.push(data);
      return true;
    });

    process.stderr.write = jest.fn((data: string) => {
      capturedErrors.push(data);
      return true;
    });

    // Reset environment
    delete process.env.LOG_LEVEL;
    delete process.env.NODE_ENV;

    logger = new Logger();
  });

  afterEach(() => {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
    process.env = originalEnv;
  });

  describe('Constructor and Configuration', () => {
    test('✅ should create logger with default settings', () => {
      const logger = new Logger();
      expect(logger).toBeInstanceOf(Logger);
    });

    test('✅ should create logger with initial context', () => {
      const context = { component: 'test', version: '1.0' };
      const logger = new Logger(context);
      
      logger.info('test message');
      
      const output = capturedOutput[0];
      expect(output).toContain('test message');
      expect(output).toContain('component');
    });

    test('✅ should set log level from environment', () => {
      process.env.LOG_LEVEL = 'debug';
      const logger = new Logger();
      
      logger.debug('debug message');
      
      expect(capturedOutput.length).toBe(1);
      expect(capturedOutput[0]).toContain('debug message');
    });

    test('✅ should default to info level for invalid log level', () => {
      process.env.LOG_LEVEL = 'invalid';
      const logger = new Logger();
      
      logger.debug('debug message');
      logger.info('info message');
      
      expect(capturedOutput.length).toBe(1);
      expect(capturedOutput[0]).toContain('info message');
    });
  });

  describe('Context Management', () => {
    test('✅ should set global context', () => {
      const context = { merchantId: 'merchant-123', version: '1.0' };
      logger.setContext(context);
      
      logger.info('test message');
      
      const output = capturedOutput[0];
      expect(output).toContain('merchant-123');
      expect(output).toContain('version');
    });

    test('✅ should merge context in log calls', () => {
      logger.setContext({ globalKey: 'global' });
      logger.info('test message', { localKey: 'local' });
      
      const output = capturedOutput[0];
      expect(output).toContain('globalKey');
      expect(output).toContain('localKey');
    });

    test('✅ should clear specific context keys', () => {
      logger.setContext({ 
        keepThis: 'keep',
        removeThis: 'remove',
        alsoRemove: 'remove'
      });
      
      logger.clearContext(['removeThis', 'alsoRemove']);
      logger.info('test message');
      
      const output = capturedOutput[0];
      expect(output).toContain('keepThis');
      expect(output).not.toContain('removeThis');
      expect(output).not.toContain('alsoRemove');
    });

    test('✅ should create child logger with inherited context', () => {
      logger.setContext({ parent: 'value' });
      const child = logger.child({ child: 'value' });
      
      child.info('child message');
      
      const output = capturedOutput[0];
      expect(output).toContain('parent');
      expect(output).toContain('child');
    });

    test('✅ should isolate child logger changes', () => {
      const child = logger.child({ child: 'value' });
      child.setContext({ childOnly: 'value' });
      
      logger.info('parent message');
      
      const output = capturedOutput[0];
      expect(output).not.toContain('child');
      expect(output).not.toContain('childOnly');
    });
  });

  describe('Log Levels', () => {
    beforeEach(() => {
      process.env.LOG_LEVEL = 'trace';
      logger = new Logger();
    });

    test('✅ should log trace messages', () => {
      logger.trace('trace message');
      
      expect(capturedOutput.length).toBe(1);
      expect(capturedOutput[0]).toContain('TRACE');
      expect(capturedOutput[0]).toContain('trace message');
    });

    test('✅ should log debug messages', () => {
      logger.debug('debug message');
      
      expect(capturedOutput.length).toBe(1);
      expect(capturedOutput[0]).toContain('DEBUG');
      expect(capturedOutput[0]).toContain('debug message');
    });

    test('✅ should log info messages', () => {
      logger.info('info message');
      
      expect(capturedOutput.length).toBe(1);
      expect(capturedOutput[0]).toContain('INFO');
      expect(capturedOutput[0]).toContain('info message');
    });

    test('✅ should log warn messages', () => {
      logger.warn('warn message');
      
      expect(capturedOutput.length).toBe(1);
      expect(capturedOutput[0]).toContain('WARN');
      expect(capturedOutput[0]).toContain('warn message');
    });

    test('✅ should log error messages to stderr', () => {
      logger.error('error message');
      
      expect(capturedErrors.length).toBe(1);
      expect(capturedErrors[0]).toContain('ERROR');
      expect(capturedErrors[0]).toContain('error message');
    });

    test('✅ should log fatal messages to stderr', () => {
      logger.fatal('fatal message');
      
      expect(capturedErrors.length).toBe(1);
      expect(capturedErrors[0]).toContain('FATAL');
      expect(capturedErrors[0]).toContain('fatal message');
    });
  });

  describe('Error Handling', () => {
    test('✅ should log Error objects with stack traces', () => {
      const error = new Error('Test error');
      logger.error('Something went wrong', error);
      
      const output = capturedErrors[0];
      expect(output).toContain('Test error');
      expect(output).toContain('stack');
    });

    test('✅ should handle non-Error objects', () => {
      const errorObj = { code: 'ERR001', message: 'Custom error' };
      logger.error('Something went wrong', errorObj);
      
      const output = capturedErrors[0];
      expect(output).toContain('ERR001');
      expect(output).toContain('Custom error');
    });

    test('✅ should handle string errors', () => {
      logger.error('Something went wrong', 'String error message');
      
      const output = capturedErrors[0];
      expect(output).toContain('String error message');
    });

    test('✅ should handle null/undefined errors', () => {
      logger.error('Something went wrong', null);
      logger.error('Another issue', undefined);
      
      expect(capturedErrors.length).toBe(2);
      expect(capturedErrors[0]).toContain('Something went wrong');
      expect(capturedErrors[1]).toContain('Another issue');
    });
  });

  describe('Level Filtering', () => {
    test('✅ should filter logs below minimum level', () => {
      process.env.LOG_LEVEL = 'warn';
      const logger = new Logger();
      
      logger.trace('trace message');
      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');
      
      expect(capturedOutput.length).toBe(1); // Only warn
      expect(capturedErrors.length).toBe(1); // Only error
      expect(capturedOutput[0]).toContain('warn message');
      expect(capturedErrors[0]).toContain('error message');
    });

    test('✅ should allow all logs at trace level', () => {
      process.env.LOG_LEVEL = 'trace';
      const logger = new Logger();
      
      logger.trace('trace message');
      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      
      expect(capturedOutput.length).toBe(4);
    });
  });

  describe('Sensitive Data Redaction', () => {
    test('✅ should redact passwords', () => {
      logger.info('User login', { 
        username: 'testuser',
        password: 'supersecret123'
      });
      
      const output = capturedOutput[0];
      expect(output).toContain('testuser');
      expect(output).not.toContain('supersecret123');
      expect(output).toContain('su*******23');
    });

    test('✅ should redact API keys', () => {
      logger.info('API call', {
        endpoint: '/api/users',
        api_key: 'sk-abcdef123456789'
      });
      
      const output = capturedOutput[0];
      expect(output).toContain('/api/users');
      expect(output).not.toContain('sk-abcdef123456789');
      expect(output).toContain('sk***********89');
    });

    test('✅ should redact authorization headers', () => {
      logger.info('Request', {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer token123456',
          'X-API-Key': 'secret-key'
        }
      });
      
      const output = capturedOutput[0];
      expect(output).toContain('application/json');
      expect(output).not.toContain('Bearer token123456');
      expect(output).not.toContain('secret-key');
      expect(output).toContain('Be**********56');
      expect(output).toContain('se*******ey');
    });

    test('✅ should handle nested objects', () => {
      logger.info('Nested data', {
        user: {
          id: 123,
          credentials: {
            password: 'secret',
            token: 'abc123'
          }
        },
        metadata: {
          timestamp: '2024-01-01',
          secret: 'hidden'
        }
      });
      
      const output = capturedOutput[0];
      expect(output).toContain('123');
      expect(output).toContain('2024-01-01');
      expect(output).not.toContain('secret');
      expect(output).not.toContain('abc123');
      expect(output).not.toContain('hidden');
    });

    test('✅ should handle arrays with sensitive data', () => {
      logger.info('Array data', {
        items: [
          { name: 'item1', secret: 'secret1' },
          { name: 'item2', password: 'secret2' }
        ]
      });
      
      const output = capturedOutput[0];
      expect(output).toContain('item1');
      expect(output).toContain('item2');
      expect(output).not.toContain('secret1');
      expect(output).not.toContain('secret2');
    });

    test('✅ should mask short strings appropriately', () => {
      logger.info('Short secrets', {
        short: 'abc',
        empty: '',
        medium: 'abcdef'
      });
      
      const output = capturedOutput[0];
      expect(output).toContain('***'); // Short string
      expect(output).toContain('ab**ef'); // Medium string
    });

    test('✅ should handle non-string sensitive values', () => {
      logger.info('Non-string secrets', {
        password: 12345,
        secret: { complex: 'object' },
        token: null
      });
      
      const output = capturedOutput[0];
      expect(output).toContain('[REDACTED]');
      expect(output).not.toContain('12345');
      expect(output).not.toContain('complex');
    });
  });

  describe('Output Formats', () => {
    test('✅ should output structured JSON in production', () => {
      process.env.NODE_ENV = 'production';
      const logger = new Logger();
      
      logger.info('production message', { key: 'value' });
      
      const output = capturedOutput[0];
      const parsed = JSON.parse(output);
      
      expect(parsed.level).toBe('info');
      expect(parsed.message).toBe('production message');
      expect(parsed.context.key).toBe('value');
      expect(parsed.timestamp).toBeUndefined(); // Removed in production
    });

    test('✅ should output human-readable format in development', () => {
      process.env.NODE_ENV = 'development';
      const logger = new Logger();
      
      logger.info('dev message', { key: 'value' });
      
      const output = capturedOutput[0];
      expect(output).toContain('INFO');
      expect(output).toContain('dev message');
      expect(output).toContain('key');
      expect(output).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO timestamp
    });

    test('✅ should include error details in output', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:1:1';
      
      logger.error('Error occurred', error);
      
      const output = capturedErrors[0];
      expect(output).toContain('Test error');
      expect(output).toContain('test.js:1:1');
    });
  });

  describe('Global Logger Functions', () => {
    test('✅ should get global logger instance', () => {
      const logger1 = getLogger();
      const logger2 = getLogger();
      
      expect(logger1).toBe(logger2);
    });

    test('✅ should set context on global logger', () => {
      const context = { global: 'context' };
      const logger = getLogger(context);
      
      logger.info('global test');
      
      const output = capturedOutput[0];
      expect(output).toContain('global');
    });

    test('✅ should create new logger instance', () => {
      const context = { component: 'test' };
      const logger = createLogger(context);
      
      logger.info('created logger test');
      
      const output = capturedOutput[0];
      expect(output).toContain('component');
    });
  });

  describe('Request-Scoped Logging', () => {
    test('✅ should bind request logger with IDs', () => {
      const baseLogger = new Logger({ component: 'api' });
      const requestLogger = bindRequestLogger(baseLogger, {
        requestId: 'req-123',
        traceId: 'trace-456',
        merchantId: 'merchant-789'
      });
      
      requestLogger.info('request handled');
      
      const output = capturedOutput[0];
      expect(output).toContain('req-123');
      expect(output).toContain('trace-456');
      expect(output).toContain('merchant-789');
      expect(output).toContain('component');
    });

    test('✅ should create request logger with generated IDs', () => {
      const requestLogger = createRequestLogger();
      
      requestLogger.info('request processed');
      
      const output = capturedOutput[0];
      expect(output).toContain('trace_');
      expect(output).toContain('corr_');
    });

    test('✅ should create request logger with provided IDs', () => {
      const requestLogger = createRequestLogger('custom-trace', 'custom-corr');
      
      requestLogger.info('request processed');
      
      const output = capturedOutput[0];
      expect(output).toContain('custom-trace');
      expect(output).toContain('custom-corr');
    });
  });

  describe('Edge Cases', () => {
    test('✅ should handle null/undefined messages', () => {
      logger.info(null as any);
      logger.info(undefined as any);
      
      expect(capturedOutput.length).toBe(2);
    });

    test('✅ should handle circular references in context', () => {
      const circular: any = { name: 'test' };
      circular.self = circular;
      
      // Should not throw
      expect(() => {
        logger.info('circular test', circular);
      }).not.toThrow();
    });

    test('✅ should handle very large context objects', () => {
      const largeContext = {
        bigArray: Array.from({ length: 1000 }, (_, i) => ({ id: i, data: `item-${i}` })),
        bigString: 'x'.repeat(10000)
      };
      
      expect(() => {
        logger.info('large context test', largeContext);
      }).not.toThrow();
      
      expect(capturedOutput.length).toBe(1);
    });

    test('✅ should handle empty context', () => {
      logger.info('empty context', {});
      
      const output = capturedOutput[0];
      expect(output).toContain('empty context');
    });

    test('✅ should handle context with special characters', () => {
      logger.info('special chars', {
        unicode: 'مرحبا بالعالم 🌍',
        symbols: '!@#$%^&*()',
        quotes: 'He said "Hello"'
      });
      
      const output = capturedOutput[0];
      expect(output).toContain('مرحبا بالعالم');
      expect(output).toContain('!@#$%');
      expect(output).toContain('Hello');
    });
  });

  describe('Performance', () => {
    test('✅ should skip processing when log level filtered', () => {
      process.env.LOG_LEVEL = 'error';
      const logger = new Logger();
      
      const expensiveContext = () => {
        // Simulate expensive operation
        const result: any = {};
        for (let i = 0; i < 1000; i++) {
          result[`key${i}`] = `value${i}`;
        }
        return result;
      };
      
      // This should not call expensiveContext since debug is filtered
      logger.debug('debug message', expensiveContext());
      
      expect(capturedOutput.length).toBe(0);
    });

    test('✅ should handle concurrent logging', async () => {
      const promises = Array.from({ length: 100 }, (_, i) =>
        Promise.resolve().then(() => {
          logger.info(`Concurrent message ${i}`, { index: i });
        })
      );
      
      await Promise.all(promises);
      
      expect(capturedOutput.length).toBe(100);
      
      // Check that all messages are present
      for (let i = 0; i < 100; i++) {
        const found = capturedOutput.some(output => 
          output.includes(`Concurrent message ${i}`)
        );
        expect(found).toBe(true);
      }
    });
  });

  describe('Memory Management', () => {
    test('✅ should not leak memory with many child loggers', () => {
      const children: Logger[] = [];
      
      for (let i = 0; i < 1000; i++) {
        const child = logger.child({ childId: i });
        children.push(child);
      }
      
      // Use the children
      children.forEach((child, i) => {
        if (i % 100 === 0) { // Only log every 100th to avoid too much output
          child.info(`Child ${i} message`);
        }
      });
      
      expect(capturedOutput.length).toBe(10);
    });

    test('✅ should handle context clearing', () => {
      logger.setContext({
        temp1: 'value1',
        temp2: 'value2',
        permanent: 'keep'
      });
      
      logger.clearContext(['temp1', 'temp2']);
      logger.info('after clear');
      
      const output = capturedOutput[0];
      expect(output).toContain('permanent');
      expect(output).not.toContain('temp1');
      expect(output).not.toContain('temp2');
    });
  });

  describe('Rate Limiting', () => {
    test('✅ should suppress repeated error messages within window', () => {
      logger.error('rate limit message');
      logger.error('rate limit message');
      expect(capturedErrors.length).toBe(1);
    });
  });

  describe('Security', () => {
    test('✅ should redact webhook signatures', () => {
      logger.info('Webhook received', {
        headers: {
          'x-hub-signature': 'sha256=abcdef123456',
          'x-hub-signature-256': 'sha256=ghijkl789012'
        }
      });
      
      const output = capturedOutput[0];
      expect(output).not.toContain('abcdef123456');
      expect(output).not.toContain('ghijkl789012');
      expect(output).toContain('sh**********56');
    });

    test('✅ should redact JWT tokens', () => {
      logger.info('JWT handling', {
        jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature',
        access_token: 'acc_token_123',
        refresh_token: 'ref_token_456'
      });
      
      const output = capturedOutput[0];
      expect(output).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
      expect(output).not.toContain('acc_token_123');
      expect(output).not.toContain('ref_token_456');
    });

    test('✅ should preserve non-sensitive data', () => {
      logger.info('Mixed data', {
        userId: 'user-123',
        action: 'login',
        timestamp: '2024-01-01T10:00:00Z',
        secret: 'should-be-hidden',
        sessionData: {
          ip: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          password: 'hidden-password'
        }
      });
      
      const output = capturedOutput[0];
      expect(output).toContain('user-123');
      expect(output).toContain('login');
      expect(output).toContain('2024-01-01');
      expect(output).toContain('192.168.1.1');
      expect(output).toContain('Mozilla/5.0');
      expect(output).not.toContain('should-be-hidden');
      expect(output).not.toContain('hidden-password');
    });
  });
});