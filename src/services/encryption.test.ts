import { describe, it, expect } from 'bun:test';
import EncryptionService, { verifyHMAC, readRawBody } from './encryption.js';

describe('verifyHMAC', () => {
  it('returns false for signatures with wrong length', () => {
    const payload = 'test-payload';
    const secret = 'test-secret';
    const badSig = 'sha256=' + 'a'.repeat(63); // 63 hex chars instead of 64
    expect(verifyHMAC(payload, badSig, secret)).toBe(false);
  });
});

describe('readRawBody', () => {
  it('throws 413 when payload exceeds limit', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(2048));
        controller.close();
      }
    });

    const ctx = {
      req: { raw: { body: stream } },
      throw(status: number, message: string) {
        const err: any = new Error(message);
        err.status = status;
        throw err;
      }
    };

    await expect(readRawBody(ctx, 1024)).rejects.toHaveProperty('status', 413);
  });
});

describe('decryptToken', () => {
  const key =
    process.env.ENCRYPTION_KEY_HEX ||
    process.env.ENCRYPTION_KEY ||
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  process.env.ENCRYPTION_KEY_HEX = key;
  const svc = new EncryptionService();

  it('returns payload for valid token', () => {
    const enc = svc.encryptToken('abc', 'instagram', 'id');
    expect(svc.decryptToken(enc, 'instagram')).toMatchObject({
      token: 'abc',
      identifier: 'id'
    });
  });

  it('throws on invalid JSON', () => {
    const bad = svc.encrypt('not-json', 'token:instagram');
    expect(() => svc.decryptToken(bad, 'instagram')).toThrow('Invalid token payload');
  });

  it('throws when required keys missing', () => {
    const missing = svc.encrypt('{"token":"only"}', 'token:instagram');
    expect(() => svc.decryptToken(missing, 'instagram')).toThrow('Invalid token payload');
  });
});