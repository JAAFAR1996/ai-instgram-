import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

const initializeMock = mock(async () => {});
const client = {
  initialize: initializeMock,
  credentials: { businessAccountId: 'user123', pageAccessToken: 'token123' }
};

mock.module('../services/instagram-api.js', () => ({
  getInstagramClient: () => client
}));

mock.module('../database/connection.js', () => ({
  getDatabase: () => ({ getSQL: () => async () => [] })
}));

mock.module('../services/message-window.js', () => ({
  getMessageWindowService: () => ({
    recordMerchantResponse: mock(async () => {}),
    getWindowStatus: mock(async () => ({ canSend: true }))
  })
}));

const { InstagramMessageSender } = await import('../services/instagram-message-sender.js');

const tmpDir = path.join(process.cwd(), 'tmp-upload-tests');

describe('InstagramMessageSender.uploadMedia', () => {
  const sender = new InstagramMessageSender();

  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true });
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
      json: async () => ({ attachment_id: 'attach123' })
    })) as any;

    const result = await (sender as any).uploadMedia('merchant1', filePath, 'image');
    expect(result.success).toBe(true);
    expect(result.attachmentId).toBe('attach123');
  });

  test('rejects unsupported media type', async () => {
    const filePath = path.join(tmpDir, 'file.txt');
    await fs.writeFile(filePath, 'hello');

    const result = await (sender as any).uploadMedia('merchant1', filePath, 'image');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported');
  });

  test('handles Graph API error', async () => {
    const filePath = path.join(tmpDir, 'image.jpg');
    await fs.writeFile(filePath, Buffer.alloc(1024));

    global.fetch = mock(async () => ({
      ok: false,
      text: async () => 'Bad Request',
      statusText: 'Bad Request'
    })) as any;

    const result = await (sender as any).uploadMedia('merchant1', filePath, 'image');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Bad Request');
  });

  test('caches initialization per merchant', async () => {
    const filePath = path.join(tmpDir, 'image.jpg');
    await fs.writeFile(filePath, Buffer.alloc(1024));

    global.fetch = mock(async () => ({
      ok: true,
      json: async () => ({ id: 'media123' })
    })) as any;

    await (sender as any).uploadMedia('merchant1', filePath, 'image');
    await (sender as any).uploadMedia('merchant1', filePath, 'image');

    expect(initializeMock.mock.calls.length).toBe(1);
  });

  test('reloads credentials when requested', async () => {
    const filePath = path.join(tmpDir, 'image.jpg');
    await fs.writeFile(filePath, Buffer.alloc(1024));

    global.fetch = mock(async () => ({
      ok: true,
      json: async () => ({ id: 'media123' })
    })) as any;

    await (sender as any).uploadMedia('merchant1', filePath, 'image');
    await sender.reloadMerchant('merchant1');
    await (sender as any).uploadMedia('merchant1', filePath, 'image');

    expect(initializeMock.mock.calls.length).toBe(2);
  });
});