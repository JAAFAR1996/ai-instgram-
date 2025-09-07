import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as timeoutUtils from '../../../src/utils/timeout';
import { TimeoutRetryError } from '../../../src/utils/timeout';

describe('withTimeoutRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test('should retry with exponential backoff and jitter', async () => {
    const callTimes: number[] = [];
    const operation = vi.fn().mockImplementation(() => {
      callTimes.push(Date.now());
      return Promise.reject(new Error('Simulated failure'));
    });

    const promise = timeoutUtils.withTimeoutRetry(operation, 100, 3, 'Test Operation');

    // Run all timers to completion
    await vi.runAllTimersAsync();
    
    await expect(promise).rejects.toThrow(TimeoutRetryError);
    
    expect(operation).toHaveBeenCalledTimes(3);

    const baseDelay = timeoutUtils.DEFAULT_TIMEOUTS.RETRY_BASE; // 1000

    const delay1 = callTimes[1] - callTimes[0];
    const delay2 = callTimes[2] - callTimes[1];
    
    const baseBackoff1 = baseDelay * Math.pow(2, 0);
    expect(delay1).toBeGreaterThanOrEqual(baseBackoff1);
    expect(delay1).toBeLessThan(baseBackoff1 + baseDelay);

    const baseBackoff2 = baseDelay * Math.pow(2, 1);
    expect(delay2).toBeGreaterThanOrEqual(baseBackoff2);
    expect(delay2).toBeLessThan(baseBackoff2 + baseDelay);
  });
});