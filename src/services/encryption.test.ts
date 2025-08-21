import { describe, it, expect } from 'bun:test';
import { verifyHMAC } from './encryption.js';

describe('verifyHMAC', () => {
  it('returns false for signatures with wrong length', () => {
    const payload = 'test-payload';
    const secret = 'test-secret';
    const badSig = 'sha256=' + 'a'.repeat(63); // 63 hex chars instead of 64
    expect(verifyHMAC(payload, badSig, secret)).toBe(false);
  });
});