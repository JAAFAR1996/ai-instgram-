import { describe, test, expect, mock } from 'bun:test';
import { retryFetch } from '../services/instagram-messaging.ts';

// Helper to create mock Response
const response = (status: number) => new Response('', { status });

describe('retryFetch rate limit handling', () => {
  test('retries after rate limit and eventually succeeds', async () => {
    // Fake timers: capture scheduled delays and run them manually
    const originalSetTimeout = globalThis.setTimeout;
    const timers: { ms: number; cb: () => void }[] = [];
    // @ts-ignore - setTimeout override for test
    globalThis.setTimeout = (cb: () => void, ms?: number) => {
      timers.push({ ms: ms || 0, cb });
      return 0 as any;
    };

    // First call returns 429 (rate limit), second succeeds
    const fetchFn = mock(async () => response(200));
    fetchFn.mockImplementationOnce(async () => response(429));

    const promise = retryFetch(fetchFn, 3, 1000);

    // Allow async fetch to resolve and schedule the retry delay
    await Promise.resolve();
    expect(fetchFn.mock.calls.length).toBe(1);
    expect(timers[0].ms).toBe(1000); // expects 1s delay before retry

    // Simulate waiting by running scheduled timer
    timers.shift()?.cb();

    const res = await promise;
    expect(fetchFn.mock.calls.length).toBe(2);
    expect(res.status).toBe(200);

    // Restore original timer
    globalThis.setTimeout = originalSetTimeout;
  });

  test('throws after exceeding retry attempts', async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const timers: { ms: number; cb: () => void }[] = [];
    // @ts-ignore - setTimeout override for test
    globalThis.setTimeout = (cb: () => void, ms?: number) => {
      timers.push({ ms: ms || 0, cb });
      return 0 as any;
    };

    // Always hit rate limit to exhaust retries
    const fetchFn = mock(async () => response(429));
    const promise = retryFetch(fetchFn, 3, 500);
    const errorPromise = promise.catch(e => e);

    // Allow first attempt to schedule retry
    await Promise.resolve();
    expect(fetchFn.mock.calls.length).toBe(1);
    expect(timers[0].ms).toBe(500);
    timers.shift()?.cb(); // After first wait

    // Run second scheduled timer without waiting in real time
    await Promise.resolve();
    await Promise.resolve(); // ensure timer is scheduled
    expect(fetchFn.mock.calls.length).toBe(2);
    expect(timers.length).toBe(1);
    timers.shift()?.cb(); // After second wait

    // Allow third attempt to complete and capture the rejection
    await Promise.resolve();
    const err = await errorPromise;
    expect(fetchFn.mock.calls.length).toBe(3);
    expect(err).toBeInstanceOf(Error);

    globalThis.setTimeout = originalSetTimeout;
  });
});