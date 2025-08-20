import { describe, test, expect } from 'bun:test';
import { InstagramWebhookHandler } from '../services/instagram-webhook.js';

describe('Media ID generation', () => {
  test('generates unique IDs across multiple calls', async () => {
    const handler = new InstagramWebhookHandler();

    const ids: string[] = [];

    // Stub media manager to capture generated IDs without performing real processing
    (handler as any).mediaManager = {
      processIncomingMedia: async (media: any) => {
        ids.push(media.id);
        return { success: true };
      }
    };

    const attachment = { type: 'image', payload: { url: 'http://example.com/image.jpg' } };
    const conversationId = 'conv-1';
    const merchantId = 'merchant-1';
    const userId = 'user-1';
    const textContent = 'hello';
    const timestamp = new Date();

    for (let i = 0; i < 20; i++) {
      await (handler as any).processMediaAttachment(
        attachment,
        conversationId,
        merchantId,
        userId,
        textContent,
        timestamp
      );
    }

    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});