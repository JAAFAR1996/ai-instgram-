process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
process.env.DB_HOST = process.env.DB_HOST || 'localhost';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_NAME = process.env.DB_NAME || 'test_db';
process.env.DB_USER = process.env.DB_USER || 'test_user';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test_pass';
process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '0123456789abcdef';
process.env.BASE_URL = process.env.BASE_URL || 'http://localhost';
process.env.MERCHANT_ID = process.env.MERCHANT_ID || 'merchant1';

import { describe, test, expect, mock } from 'bun:test';
import { getEncryptionService } from '../services/encryption.js';

const encryption = getEncryptionService();

describe('Instagram encrypted token retrieval', () => {
  test('initializes API client with decrypted token', async () => {
    mock.module('../services/RedisConnectionManager.js', () => ({
      getRedisConnectionManager: () => ({
        getConnection: async () => ({
          get: async () => null,
          setex: async () => null,
          multi: () => ({ exec: async () => null })
        })
      })
    }));
    mock.module('../services/meta-rate-limiter.js', () => ({
      getMetaRateLimiter: () => ({ checkRedisRateLimit: async () => ({ allowed: true }) })
    }));
    (globalThis as any).requireMerchantId = () => 'merchant1';

    const { getInstagramClient } = await import('../services/instagram-api.js');
    const token = 'token123';
    const encrypted = encryption.encryptInstagramToken(token);
    const client = getInstagramClient();
    (client as any).db = { getSQL: () => mock(async () => [{
      instagram_token_encrypted: encrypted,
      instagram_page_id: 'page1',
      webhook_verify_token: 'verify'
    }]) } as any;

    const fetchMock = mock(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ id: 'biz1' })
    }));
    (globalThis as any).fetch = fetchMock;

    await client.initialize('merchant1');
    expect((client as any).credentials?.pageAccessToken).toBe(token);
  });

  test('sendTextMessage uses decrypted token', async () => {
    mock.module('../services/RedisConnectionManager.js', () => ({
      getRedisConnectionManager: () => ({
        getConnection: async () => ({ get: async () => null, setex: async () => null })
      })
    }));

    const { InstagramMessagingService } = await import('../services/instagram-messaging.js');
    const service = new InstagramMessagingService();
    const token = 'msgToken';
    const encrypted = encryption.encryptInstagramToken(token);

    const sqlMock = mock(async () => [{
      instagram_token_encrypted: encrypted,
      token_expires_at: new Date(Date.now() + 3600 * 1000)
    }]);
    (service as any).db = { getSQL: () => sqlMock } as any;

    (service as any).getMerchantInstagramUserId = async () => 'ig_user_1';
    (service as any).getMessageContext = async () => ({ conversationId: '', withinWindow: true });
    (service as any).logSentMessage = async () => {};
    (service as any).logFailedMessage = async () => {};

    const fetchMock = mock(async (_url: string, options: any) => {
      expect(options.headers.Authorization).toBe(`Bearer ${token}`);
      return { ok: true, json: async () => ({ message_id: 'mid1' }) } as any;
    });
    (globalThis as any).fetch = fetchMock;

    const res = await service.sendTextMessage('merchant1', 'recipient1', 'hello');
    expect(res.success).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(1);
  });
});