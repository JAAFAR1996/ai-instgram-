import { describe, test, expect } from 'bun:test';
import { MessageDeliveryProcessor } from './message-delivery-processor.js';

class FakeMessageSender {
  constructor(private shouldFail = false) {}
  async sendTextMessage() {
    if (this.shouldFail) {
      throw new Error('send failed');
    }
    return { success: true, messageId: 'platform-msg-1', deliveryStatus: 'sent', timestamp: new Date() };
  }
}

class FakeMessageRepo {
  delivered = false;
  failed = false;
  async markAsDelivered() {
    this.delivered = true;
    return true;
  }
  async markAsFailed() {
    this.failed = true;
    return true;
  }
}

describe('MessageDeliveryProcessor', () => {
  test('marks message as failed when sending throws', async () => {
    const sender = new FakeMessageSender(true);
    const repo = new FakeMessageRepo();
    const processor = new MessageDeliveryProcessor(sender as any, { message: repo } as any);

    const result = await processor.process({
      id: 'job1',
      type: 'MESSAGE_DELIVERY',
        payload: {
          messageId: 'msg1',
          conversationId: 'conv1',
          merchantId: '123e4567-e89b-12d3-a456-426614174000',
          customerId: 'c1',
          content: 'hello',
          platform: 'instagram'
        }
      } as any);

    expect(result.success).toBe(false);
    expect(repo.failed).toBe(true);
  });
});