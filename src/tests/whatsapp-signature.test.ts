import { describe, test, expect } from 'bun:test';
import { WhatsAppAPIClient } from '../services/whatsapp-api.js';

describe('WhatsApp webhook signature validation', () => {
  test('rejects signatures when app secret is missing', async () => {
    const client = new WhatsAppAPIClient();
    // simulate credentials without app secret
    (client as any).credentials = {
      phoneNumberId: '123',
      accessToken: 'token',
      businessAccountId: 'biz',
      webhookVerifyToken: 'verify',
      appSecret: undefined
    } as any;

    const result = await client.validateWebhookSignature('sha256=deadbeef', '{}');
    expect(result).toBe(false);
  });
});