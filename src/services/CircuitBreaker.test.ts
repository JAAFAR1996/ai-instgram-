/**
 * ===============================================
 * Circuit Breaker Tests - اختبارات شاملة لـ Circuit Breaker
 * Production-grade tests for circuit breaker resilience patterns
 * ===============================================
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { CircuitBreaker } from './CircuitBreaker.js';

// Mock logger to avoid console noise during tests
const mockLogger = {
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {})
};

mock.module('./logger.js', () => ({
  createLogger: () => mockLogger,
  getLogger: () => mockLogger
}));

describe('CircuitBreaker - Production Tests', () => {
  let circuitBreaker: CircuitBreaker;
  let mockService: any;
  let callCount = 0;

  beforeEach(() => {
    callCount = 0;
    mockService = {
      successfulCall: mock(async () => {
        callCount++;
        return { success: true, data: `Result ${callCount}` };
      }),
      
      failingCall: mock(async () => {
        callCount++;
        throw new Error(`Service failure ${callCount}`);
      }),
      
      intermittentCall: mock(async () => {
        callCount++;
        if (callCount % 3 === 0) {
          return { success: true, data: `Success ${callCount}` };
        }
        throw new Error(`Intermittent failure ${callCount}`);
      }),

      slowCall: mock(async () => {
        callCount++;
        await new Promise(resolve => setTimeout(resolve, 200));
        return { success: true, data: `Slow result ${callCount}` };
      }),

      timeoutCall: mock(async () => {
        callCount++;
        await new Promise(resolve => setTimeout(resolve, 2000)); // Very slow
        return { success: true, data: `Timeout result ${callCount}` };
      })
    };
    
    // Reset mocks
    Object.values(mockService).forEach(mockFn => {
      if (typeof mockFn.mockReset === 'function') {
        mockFn.mockReset();
      }
    });
    
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
  });

  describe('Circuit Breaker Configuration Tests', () => {
    test('should initialize with default configuration', () => {
      circuitBreaker = new CircuitBreaker('test-service');

      expect(circuitBreaker.getName()).toBe('test-service');
      expect(circuitBreaker.getState()).toBe('CLOSED');
      expect(circuitBreaker.getFailureCount()).toBe(0);
      expect(circuitBreaker.getStats().totalCalls).toBe(0);
    });

    test('should initialize with custom configuration', () => {
      const options = {
        failureThreshold: 3,
        recoveryTimeout: 30000,
        timeout: 2000,
        resetTimeout: 60000,
        monitoringPeriod: 120000
      };

      circuitBreaker = new CircuitBreaker('custom-service', options);

      expect(circuitBreaker.getName()).toBe('custom-service');
      expect(circuitBreaker.getState()).toBe('CLOSED');
    });
  });

  describe('CLOSED State Behavior Tests', () => {
    beforeEach(() => {
      circuitBreaker = new CircuitBreaker('closed-test', {
        failureThreshold: 3,
        timeout: 1000
      });
    });

    test('should allow successful calls in CLOSED state', async () => {
      const result = await circuitBreaker.execute(mockService.successfulCall);

      expect(result.success).toBe(true);
      expect(result.data).toBe('Result 1');
      expect(circuitBreaker.getState()).toBe('CLOSED');
      expect(circuitBreaker.getFailureCount()).toBe(0);
      expect(mockService.successfulCall).toHaveBeenCalledTimes(1);
    });

    test('should track failures without opening circuit initially', async () => {
      // Make 2 failing calls (below threshold of 3)
      for (let i = 0; i < 2; i++) {
        await expect(circuitBreaker.execute(mockService.failingCall))
          .rejects.toThrow(`Service failure ${i + 1}`);
      }

      expect(circuitBreaker.getState()).toBe('CLOSED');
      expect(circuitBreaker.getFailureCount()).toBe(2);
      expect(mockService.failingCall).toHaveBeenCalledTimes(2);
    });

    test('should open circuit after reaching failure threshold', async () => {
      // Make 3 failing calls to reach threshold
      for (let i = 0; i < 3; i++) {
        await expect(circuitBreaker.execute(mockService.failingCall))
          .rejects.toThrow(`Service failure ${i + 1}`);
      }

      expect(circuitBreaker.getState()).toBe('OPEN');
      expect(circuitBreaker.getFailureCount()).toBe(3);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Circuit breaker opened for service: closed-test')
      );
    });

    test('should reset failure count on successful call', async () => {
      // Make 2 failing calls
      for (let i = 0; i < 2; i++) {
        await expect(circuitBreaker.execute(mockService.failingCall))
          .rejects.toThrow();
      }

      expect(circuitBreaker.getFailureCount()).toBe(2);

      // Make successful call
      const result = await circuitBreaker.execute(mockService.successfulCall);

      expect(result.success).toBe(true);
      expect(circuitBreaker.getFailureCount()).toBe(0);
      expect(circuitBreaker.getState()).toBe('CLOSED');
    });

    test('should handle timeout as failure', async () => {
      circuitBreaker = new CircuitBreaker('timeout-test', {
        failureThreshold: 2,
        timeout: 100 // Very short timeout
      });

      // First timeout
      await expect(circuitBreaker.execute(mockService.timeoutCall))
        .rejects.toThrow('Operation timed out');

      expect(circuitBreaker.getFailureCount()).toBe(1);
      expect(circuitBreaker.getState()).toBe('CLOSED');

      // Second timeout should open circuit
      await expect(circuitBreaker.execute(mockService.timeoutCall))
        .rejects.toThrow('Operation timed out');

      expect(circuitBreaker.getState()).toBe('OPEN');
    });
  });

  describe('OPEN State Behavior Tests', () => {
    beforeEach(async () => {
      circuitBreaker = new CircuitBreaker('open-test', {
        failureThreshold: 2,
        recoveryTimeout: 100, // Short for testing
        timeout: 1000
      });

      // Force circuit to open
      for (let i = 0; i < 2; i++) {
        await expect(circuitBreaker.execute(mockService.failingCall))
          .rejects.toThrow();
      }
      
      expect(circuitBreaker.getState()).toBe('OPEN');
    });

    test('should reject calls immediately in OPEN state', async () => {
      await expect(circuitBreaker.execute(mockService.successfulCall))
        .rejects.toThrow('Circuit breaker is OPEN');

      // Service should not be called
      expect(mockService.successfulCall).not.toHaveBeenCalled();
    });

    test('should provide circuit breaker error details', async () => {
      try {
        await circuitBreaker.execute(mockService.successfulCall);
        expect.unreachable('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toBe('Circuit breaker is OPEN');
        expect(error.circuitBreakerState).toBe('OPEN');
        expect(error.serviceName).toBe('open-test');
      }
    });

    test('should transition to HALF_OPEN after recovery timeout', async () => {
      expect(circuitBreaker.getState()).toBe('OPEN');

      // Wait for recovery timeout
      await new Promise(resolve => setTimeout(resolve, 150));

      // Next call should attempt to transition to HALF_OPEN
      const result = await circuitBreaker.execute(mockService.successfulCall);

      expect(result.success).toBe(true);
      expect(circuitBreaker.getState()).toBe('CLOSED'); // Success closes circuit
      expect(mockService.successfulCall).toHaveBeenCalledTimes(1);
    });

    test('should remain OPEN if recovery call fails', async () => {
      expect(circuitBreaker.getState()).toBe('OPEN');

      // Wait for recovery timeout
      await new Promise(resolve => setTimeout(resolve, 150));

      // Failed recovery call should keep circuit open
      await expect(circuitBreaker.execute(mockService.failingCall))
        .rejects.toThrow();

      expect(circuitBreaker.getState()).toBe('OPEN');
    });
  });

  describe('HALF_OPEN State Behavior Tests', () => {
    beforeEach(async () => {
      circuitBreaker = new CircuitBreaker('half-open-test', {
        failureThreshold: 2,
        recoveryTimeout: 100,
        timeout: 1000
      });

      // Open circuit
      for (let i = 0; i < 2; i++) {
        await expect(circuitBreaker.execute(mockService.failingCall))
          .rejects.toThrow();
      }

      // Wait for recovery
      await new Promise(resolve => setTimeout(resolve, 150));
    });

    test('should allow single test call in HALF_OPEN state', async () => {
      // Create a promise that we'll resolve when we detect HALF_OPEN state
      let halfOpenDetected = false;
      
      const testCall = mock(async () => {
        // Check state during execution
        if (circuitBreaker.getState() === 'HALF_OPEN') {
          halfOpenDetected = true;
        }
        return { success: true, data: 'Recovery test' };
      });

      const result = await circuitBreaker.execute(testCall);

      expect(result.success).toBe(true);
      expect(circuitBreaker.getState()).toBe('CLOSED'); // Success closes circuit
    });

    test('should close circuit on successful recovery', async () => {
      const result = await circuitBreaker.execute(mockService.successfulCall);

      expect(result.success).toBe(true);
      expect(circuitBreaker.getState()).toBe('CLOSED');
      expect(circuitBreaker.getFailureCount()).toBe(0);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Circuit breaker closed for service: half-open-test')
      );
    });

    test('should reopen circuit on failed recovery', async () => {
      await expect(circuitBreaker.execute(mockService.failingCall))
        .rejects.toThrow();

      expect(circuitBreaker.getState()).toBe('OPEN');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Circuit breaker reopened for service: half-open-test')
      );
    });
  });

  describe('Statistics and Monitoring Tests', () => {
    beforeEach(() => {
      circuitBreaker = new CircuitBreaker('stats-test', {
        failureThreshold: 3,
        timeout: 1000
      });
    });

    test('should track comprehensive statistics', async () => {
      // Make mixed calls
      await circuitBreaker.execute(mockService.successfulCall);
      await expect(circuitBreaker.execute(mockService.failingCall)).rejects.toThrow();
      await circuitBreaker.execute(mockService.successfulCall);

      const stats = circuitBreaker.getStats();

      expect(stats.totalCalls).toBe(3);
      expect(stats.successCalls).toBe(2);
      expect(stats.failedCalls).toBe(1);
      expect(stats.rejectedCalls).toBe(0);
      expect(stats.timeoutCalls).toBe(0);
      expect(stats.averageResponseTime).toBeGreaterThan(0);
      expect(stats.uptime).toBeGreaterThan(0);
    });

    test('should track rejected calls in OPEN state', async () => {
      // Open circuit
      for (let i = 0; i < 3; i++) {
        await expect(circuitBreaker.execute(mockService.failingCall))
          .rejects.toThrow();
      }

      // Make rejected calls
      await expect(circuitBreaker.execute(mockService.successfulCall))
        .rejects.toThrow('Circuit breaker is OPEN');
      await expect(circuitBreaker.execute(mockService.successfulCall))
        .rejects.toThrow('Circuit breaker is OPEN');

      const stats = circuitBreaker.getStats();

      expect(stats.rejectedCalls).toBe(2);
      expect(stats.totalCalls).toBe(5); // 3 failed + 2 rejected
    });

    test('should track timeout calls separately', async () => {
      circuitBreaker = new CircuitBreaker('timeout-stats-test', {
        failureThreshold: 5,
        timeout: 100
      });

      // Make timeout calls
      await expect(circuitBreaker.execute(mockService.timeoutCall))
        .rejects.toThrow('Operation timed out');
      await expect(circuitBreaker.execute(mockService.timeoutCall))
        .rejects.toThrow('Operation timed out');

      const stats = circuitBreaker.getStats();

      expect(stats.timeoutCalls).toBe(2);
      expect(stats.failedCalls).toBe(2); // Timeouts count as failures too
    });

    test('should calculate error rate correctly', async () => {
      // 3 successes, 2 failures = 40% error rate
      for (let i = 0; i < 3; i++) {
        await circuitBreaker.execute(mockService.successfulCall);
      }
      
      for (let i = 0; i < 2; i++) {
        await expect(circuitBreaker.execute(mockService.failingCall))
          .rejects.toThrow();
      }

      const stats = circuitBreaker.getStats();
      const errorRate = stats.failedCalls / stats.totalCalls;

      expect(errorRate).toBeCloseTo(0.4, 2); // 2/5 = 0.4
      expect(stats.totalCalls).toBe(5);
    });
  });

  describe('Integration and Real-world Scenarios', () => {
    test('should handle Instagram API service failure scenario', async () => {
      const instagramAPI = new CircuitBreaker('instagram-api', {
        failureThreshold: 3,
        recoveryTimeout: 5000,
        timeout: 3000
      });

      const mockInstagramCall = mock(async (endpoint: string) => {
        if (endpoint === 'failing-endpoint') {
          throw new Error('Instagram API rate limit exceeded');
        }
        return { data: 'Instagram response', endpoint };
      });

      // Simulate API failures
      for (let i = 0; i < 3; i++) {
        await expect(instagramAPI.execute(() => mockInstagramCall('failing-endpoint')))
          .rejects.toThrow('Instagram API rate limit exceeded');
      }

      expect(instagramAPI.getState()).toBe('OPEN');

      // Subsequent calls should be rejected immediately
      await expect(instagramAPI.execute(() => mockInstagramCall('any-endpoint')))
        .rejects.toThrow('Circuit breaker is OPEN');
    });

    test('should handle AI service timeout scenario', async () => {
      const aiService = new CircuitBreaker('ai-service', {
        failureThreshold: 2,
        timeout: 1000,
        recoveryTimeout: 2000
      });

      const mockAICall = mock(async (prompt: string) => {
        if (prompt.includes('complex')) {
          // Simulate very slow AI processing
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        return { response: `AI response to: ${prompt}` };
      });

      // Cause timeouts to open circuit
      await expect(aiService.execute(() => mockAICall('complex prompt 1')))
        .rejects.toThrow('Operation timed out');
      await expect(aiService.execute(() => mockAICall('complex prompt 2')))
        .rejects.toThrow('Operation timed out');

      expect(aiService.getState()).toBe('OPEN');

      // Fast prompts should still be rejected
      await expect(aiService.execute(() => mockAICall('simple')))
        .rejects.toThrow('Circuit breaker is OPEN');
    });

    test('should handle database connection failure recovery', async () => {
      const dbService = new CircuitBreaker('database', {
        failureThreshold: 2,
        recoveryTimeout: 1000,
        timeout: 2000
      });

      let dbHealthy = false;
      const mockDbCall = mock(async (query: string) => {
        if (!dbHealthy) {
          throw new Error('Database connection lost');
        }
        return { rows: [`Result for: ${query}`] };
      });

      // Cause failures to open circuit
      await expect(dbService.execute(() => mockDbCall('SELECT 1')))
        .rejects.toThrow('Database connection lost');
      await expect(dbService.execute(() => mockDbCall('SELECT 2')))
        .rejects.toThrow('Database connection lost');

      expect(dbService.getState()).toBe('OPEN');

      // Simulate database recovery
      dbHealthy = true;
      
      // Wait for recovery timeout
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Circuit should recover on successful call
      const result = await dbService.execute(() => mockDbCall('SELECT 3'));
      
      expect(result.rows[0]).toBe('Result for: SELECT 3');
      expect(dbService.getState()).toBe('CLOSED');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    beforeEach(() => {
      circuitBreaker = new CircuitBreaker('edge-cases', {
        failureThreshold: 2,
        timeout: 1000
      });
    });

    test('should handle null/undefined function gracefully', async () => {
      await expect(circuitBreaker.execute(null as any))
        .rejects.toThrow('Function is required');
      
      await expect(circuitBreaker.execute(undefined as any))
        .rejects.toThrow('Function is required');
    });

    test('should handle non-function arguments', async () => {
      await expect(circuitBreaker.execute('not a function' as any))
        .rejects.toThrow('Function is required');
      
      await expect(circuitBreaker.execute(123 as any))
        .rejects.toThrow('Function is required');
    });

    test('should preserve original error information', async () => {
      const originalError = new Error('Original service error');
      originalError.stack = 'Original stack trace';
      (originalError as any).statusCode = 500;

      const failingService = mock(async () => {
        throw originalError;
      });

      try {
        await circuitBreaker.execute(failingService);
        expect.unreachable('Should have thrown error');
      } catch (error: any) {
        expect(error.message).toBe('Original service error');
        expect(error.statusCode).toBe(500);
        expect(error.stack).toContain('Original stack trace');
      }
    });

    test('should handle rapid state transitions correctly', async () => {
      // Very low threshold for rapid testing
      const rapidCircuit = new CircuitBreaker('rapid-test', {
        failureThreshold: 1,
        recoveryTimeout: 50,
        timeout: 1000
      });

      // Open circuit quickly
      await expect(rapidCircuit.execute(mockService.failingCall))
        .rejects.toThrow();
      
      expect(rapidCircuit.getState()).toBe('OPEN');

      // Wait for recovery
      await new Promise(resolve => setTimeout(resolve, 60));

      // Should recover on success
      const result = await rapidCircuit.execute(mockService.successfulCall);
      
      expect(result.success).toBe(true);
      expect(rapidCircuit.getState()).toBe('CLOSED');
    });
  });

  describe('Performance and Load Tests', () => {
    test('should handle high concurrency without race conditions', async () => {
      const concurrentCircuit = new CircuitBreaker('concurrent-test', {
        failureThreshold: 10,
        timeout: 1000
      });

      // Make 50 concurrent calls
      const promises = Array.from({ length: 50 }, (_, i) =>
        concurrentCircuit.execute(async () => {
          await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
          return { id: i, success: true };
        })
      );

      const results = await Promise.all(promises);

      expect(results.length).toBe(50);
      expect(concurrentCircuit.getStats().totalCalls).toBe(50);
      expect(concurrentCircuit.getStats().successCalls).toBe(50);
    });

    test('should maintain performance under load', async () => {
      const loadTestCircuit = new CircuitBreaker('load-test', {
        failureThreshold: 100,
        timeout: 5000
      });

      const startTime = Date.now();

      // Make 100 sequential calls
      for (let i = 0; i < 100; i++) {
        await loadTestCircuit.execute(async () => ({ iteration: i }));
      }

      const totalTime = Date.now() - startTime;
      const averageCallTime = totalTime / 100;

      // Should maintain reasonable performance
      expect(averageCallTime).toBeLessThan(50); // Less than 50ms per call on average
      expect(loadTestCircuit.getStats().totalCalls).toBe(100);
    });
  });
});