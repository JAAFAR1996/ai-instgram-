import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

const tmpDir = path.join(process.cwd(), 'tmp-upload-tests');

describe('InstagramAPIClient.uploadMedia', () => {
  let client: any;

  beforeEach(async () => {
    mock.module('../services/telemetry.js', () => ({ telemetry: { recordMetaRequest: () => {} } }));
    mock.module('../database/connection.js', () => ({ getDatabase: () => ({ getSQL: () => async () => [] }) }));
    mock.module('../services/meta-rate-limiter.js', () => ({ getMetaRateLimiter: () => ({ checkRedisRateLimit: async () => ({ allowed: true }) }) }));
    const mod = await import('../services/instagram-api.js');
    client = new mod.InstagramAPIClient();
    await fs.mkdir(tmpDir, { recursive: true });
    client.initialize(
      {
        businessAccountId: 'user123',
        pageAccessToken: 'token123',
        pageId: 'page',
        webhookVerifyToken: '',
        appSecret: ''
      },
      'merchant123'
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    mock.restore();
  });

  test('uploads valid image', async () => {
    const filePath = path.join(tmpDir, 'image.jpg');
    await fs.writeFile(filePath, Buffer.alloc(1024));

    global.fetch = mock(async () => ({
      ok: true,
      json: async () => ({ id: 'media123' })
    })) as any;

    const id = await client.uploadMedia(filePath, 'image');
    expect(id).toBe('media123');
  });

  test('rejects unsupported media type', async () => {
    const filePath = path.join(tmpDir, 'file.txt');
    await fs.writeFile(filePath, 'hello');

    await expect(client.uploadMedia(filePath, 'image')).rejects.toThrow('Unsupported');
  });

  test('handles Graph API error', async () => {
    const filePath = path.join(tmpDir, 'image.jpg');
    await fs.writeFile(filePath, Buffer.alloc(1024));

    global.fetch = mock(async () => ({
      ok: false,
      text: async () => 'Bad Request',
      statusText: 'Bad Request'
    })) as any;

    await expect(client.uploadMedia(filePath, 'image')).rejects.toThrow('Bad Request');
  });
});

describe('InstagramMessageSender client caching', () => {
  let sender: any;
  let loadCredsMock: any;

  beforeEach(async () => {
    loadCredsMock = mock(async () => ({ tokenExpiresAt: new Date(Date.now() + 3600_000) }));
    const client = {
      uploadMedia: mock(async () => 'media123'),
      sendMessage: mock(async () => ({ success: true, messageId: 'msg1' })),
      loadMerchantCredentials: loadCredsMock,
      validateCredentials: mock(async () => {})
    };

    mock.module('../services/instagram-api.js', () => ({ getInstagramClient: () => client }));
    mock.module('../database/connection.js', () => ({ getDatabase: () => ({ getSQL: () => async () => [] }) }));
    mock.module('../services/message-window.js', () => ({
      getMessageWindowService: () => ({
        recordMerchantResponse: mock(async () => {}),
        getWindowStatus: mock(async () => ({ canSendMessage: true }))
      })
    }));

    const mod = await import('../services/instagram-message-sender.js');
    sender = new mod.InstagramMessageSender();
  });

  afterEach(() => {
    mock.restore();
  });

  test('caches credentials per merchant', async () => {
    await sender.sendMediaMessage('merchant1', 'user1', 'image.jpg', 'image');
    await sender.sendMediaMessage('merchant1', 'user2', 'image.jpg', 'image');

    expect(loadCredsMock.mock.calls.length).toBe(1);
  });

  test('reloads credentials when requested', async () => {
    await sender.sendMediaMessage('merchant1', 'user1', 'image.jpg', 'image');
    await sender.reloadMerchant('merchant1');
    await sender.sendMediaMessage('merchant1', 'user1', 'image.jpg', 'image');

    expect(loadCredsMock.mock.calls.length).toBe(2);
  });
});

describe('InstagramMessageSender error logging', () => {
  let sender: any;
  let errorMock: any;

  beforeEach(async () => {
    errorMock = mock(() => {});

    const client = {
      loadMerchantCredentials: mock(async () => ({ token: 'x', tokenExpiresAt: new Date(Date.now() + 3600_000) })),
      validateCredentials: mock(async () => {}),
      sendMessage: mock(async (_cred: any, _merchant: string, { recipientId }: any) => {
        if (recipientId === 'user2') {
          return { success: false, error: 'fail' };
        }
        return { success: true, messageId: `msg-${recipientId}` };
      })
    };

    mock.module('../services/logger.js', () => ({
      getLogger: () => ({
        error: errorMock,
        info: () => {},
        warn: () => {},
        debug: () => {},
        child: () => ({ error: errorMock, info: () => {}, warn: () => {}, debug: () => {} })
      })
    }));

    mock.module('../services/instagram-api.js', () => ({ getInstagramClient: () => client }));
    mock.module('../database/connection.js', () => ({ getDatabase: () => ({ getSQL: () => async () => [] }) }));
    mock.module('../services/message-window.js', () => ({
      getMessageWindowService: () => ({
        getWindowStatus: mock(async (_merchantId: string, recipient: any) => {
          if (recipient.instagram === 'user2') {
            throw new Error('window fail');
          }
          return { canSendMessage: true };
        }),
        recordMerchantResponse: mock(async () => {})
      })
    }));

    const mod = await import(`../services/instagram-message-sender.js?test=${Date.now()}`);
    sender = new mod.InstagramMessageSender();
  });

  afterEach(() => {
    mock.restore();
  });

  test('counts successes and logger errors', async () => {
    const recipients = ['user1', 'user2', 'user3'];
    const results = [];
    for (const r of recipients) {
      results.push(await sender.sendTextMessage('merchant1', r, 'hi', 'conv1'));
    }

    const successCount = results.filter(r => r.success).length;
    expect(successCount).toBe(2);
    expect(errorMock.mock.calls.length).toBe(1);
  });
});