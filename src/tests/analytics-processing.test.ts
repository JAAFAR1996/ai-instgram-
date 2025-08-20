/**
 * ===============================================
 * Analytics Processing Tests
 * Validates analytics job processor writes events and returns aggregation
 * ===============================================
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { MessageQueue, QueueJob } from '../queue/message-queue.js';
import { getAnalyticsService } from '../services/analytics-service.js';

describe('ANALYTICS_PROCESSING handler', () => {
  beforeEach(() => {
    // Reset analytics service mock state if needed
    const analytics = getAnalyticsService();
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - allow overriding for test
    analytics._events = [];
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    analytics.recordEvent = async (event: any) => {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      analytics._events.push(event);
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      return { success: true, total: analytics._events.length };
    };
  });

  test('records analytics event and returns total count', async () => {
    const queue = new MessageQueue();
    const processor = queue['processors'].get('ANALYTICS_PROCESSING');

    const job: QueueJob = {
      id: '1',
      type: 'ANALYTICS_PROCESSING',
      payload: { type: 'test_event', merchantId: 'm1', data: { a: 1 } },
      priority: 'NORMAL',
      status: 'PENDING',
      attempts: 0,
      maxAttempts: 3,
      scheduledAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await processor!.process(job);

    expect(result.success).toBe(true);
    expect(result.result.total).toBe(1);
  });
});