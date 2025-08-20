import { describe, test, expect } from 'bun:test';
import { NotificationProcessor } from './notification-processor.js';

class FakeNotificationService {
  constructor(private shouldFail = false) {}
  async send() {
    if (this.shouldFail) {
      throw new Error('notify failed');
    }
    return { success: true };
  }
}

describe('NotificationProcessor', () => {
  test('returns error when notification service fails', async () => {
    const service = new FakeNotificationService(true);
    const processor = new NotificationProcessor(service as any);

    const result = await processor.process({
      id: 'job1',
      type: 'NOTIFICATION_SEND',
      payload: { type: 'email', recipient: 'user@test.com', content: {} }
    } as any);

    expect(result.success).toBe(false);
    expect(result.error).toContain('notify failed');
  });
});