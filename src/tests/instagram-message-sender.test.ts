import { describe, test, expect, beforeEach, afterAll, mock } from 'bun:test';
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
  let initializeMock: any;

  beforeEach(async () => {
    initializeMock = mock(async () => {});
    const client = {
      initialize: initializeMock,
      uploadMedia: mock(async () => 'media123'),
      sendMessage: mock(async () => ({ success: true, messageId: 'msg1' }))
    };

    mock.module('../services/instagram-api.js', () => ({ getInstagramClient: () => client }));
    mock.module('../database/connection.js', () => ({ getDatabase: () => ({ getSQL: () => async () => [] }) }));
    mock.module('../services/message-window.js', () => ({
      getMessageWindowService: () => ({
        recordMerchantResponse: mock(async () => {}),
        checkWindow: mock(async () => ({ canSend: true }))
      })
    }));

    const mod = await import('../services/instagram-message-sender.js');
    sender = new mod.InstagramMessageSender();
  });

  afterEach(() => {
    mock.restore();
  });

  test('caches initialization per merchant', async () => {
    await sender.sendMediaMessage('merchant1', 'user1', 'image.jpg', 'image');
    await sender.sendMediaMessage('merchant1', 'user2', 'image.jpg', 'image');

    expect(initializeMock.mock.calls.length).toBe(1);
  });

  test('reloads credentials when requested', async () => {
    await sender.sendMediaMessage('merchant1', 'user1', 'image.jpg', 'image');
    await sender.reloadMerchant('merchant1');
    await sender.sendMediaMessage('merchant1', 'user1', 'image.jpg', 'image');

    expect(initializeMock.mock.calls.length).toBe(2);
  });
});