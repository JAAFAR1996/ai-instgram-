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
        payload: {
          type: 'email',
          recipient: 'user@test.com',
          content: {},
          merchantId: '123e4567-e89b-12d3-a456-426614174000'
        }
      } as any);

    expect(result.success).toBe(false);
    expect(result.error).toContain('notify failed');
  });
});