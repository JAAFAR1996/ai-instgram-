import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('InstagramAPIClient.uploadMedia', () => {
  let client: any;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-test-'));
    vi.mock('../services/meta-rate-limiter.js', () => ({ getMetaRateLimiter: () => ({ checkRateLimit: vi.fn(async () => true) }) }));
    const mod = await import('../services/instagram-api.js');
    client = new mod.InstagramAPIClient();
    client.initialize(
      {
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
  });

  test('uploads valid image', async () => {
    const filePath = path.join(tmpDir, 'image.jpg');
    await fs.writeFile(filePath, Buffer.alloc(1024));

    global.fetch = vi.fn(async () => ({
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

    global.fetch = vi.fn(async () => ({
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
    loadCredsMock = vi.fn(async () => ({ tokenExpiresAt: new Date(Date.now() + 3600_000) }));
    const client = {
      uploadMedia: vi.fn(async () => 'media123'),
      sendMessage: vi.fn(async () => ({ success: true, messageId: 'msg1' })),
      loadMerchantCredentials: loadCredsMock,
      validateCredentials: vi.fn(async () => {})
    };

    vi.mock('../services/instagram-api.js', () => ({ getInstagramClient: () => client }));
    vi.mock('../database/connection.js', () => ({ getDatabase: () => ({ getSQL: () => async () => [] }) }));
    vi.mock('../services/message-window.js', () => ({
      getMessageWindowService: () => ({
        recordMerchantResponse: vi.fn(async () => {}),
        getWindowStatus: vi.fn(async () => ({ canSendMessage: true }))
      })
    }));

    const mod = await import('../services/instagram-message-sender.js');
    sender = new mod.InstagramMessageSender();
  });

  afterEach(() => {
    sender.dispose();
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
    errorMock = vi.fn(() => {});

    const client = {
      loadMerchantCredentials: vi.fn(async () => ({ token: 'x', tokenExpiresAt: new Date(Date.now() + 3600_000) })),
      validateCredentials: vi.fn(async () => {}),
      sendMessage: vi.fn(async (_cred: any, _merchant: string, { recipientId }: any) => {
        if (recipientId === 'user2') {
          return { success: false, error: 'fail' };
        }
        return { success: true, messageId: `msg-${recipientId}` };
      })
    };

    vi.mock('../services/logger.js', () => ({
      getLogger: () => ({
        error: errorMock,
        info: () => {},
        warn: () => {},
        debug: () => {},
        child: () => ({ error: errorMock, info: () => {}, warn: () => {}, debug: () => {} })
      })
    }));

    vi.mock('../services/instagram-api.js', () => ({ getInstagramClient: () => client }));
    vi.mock('../database/connection.js', () => ({ getDatabase: () => ({ getSQL: () => async () => [] }) }));
    vi.mock('../services/message-window.js', () => ({
      getMessageWindowService: () => ({
        getWindowStatus: vi.fn(async (_merchantId: string, recipient: any) => {
          if (recipient.instagram === 'user2') {
            throw new Error('window fail');
          }
          return { canSendMessage: true };
        }),
        recordMerchantResponse: vi.fn(async () => {})
      })
    }));

    const mod = await import(`../services/instagram-message-sender.js?test=${Date.now()}`);
    sender = new mod.InstagramMessageSender();
  });

  afterEach(() => {
    sender.dispose();
  });

  test('counts successes and logger errors', async () => {
    const recipients = ['user1', 'user2', 'user3'];
    const results = [];
    for (const r of recipients) {
      try {
        const result = await sender.sendTextMessage('merchant1', r, 'hello');
        results.push(result);
      } catch (e) {
        results.push(e);
      }
    }

    expect(results[0]).toEqual({ success: true, messageId: 'msg-user1' });
    expect(results[1]).toEqual({ success: false, error: 'fail' });
    expect(results[2]).toBeInstanceOf(Error);
    expect(errorMock).toHaveBeenCalledTimes(2);
  });
});