/**
 * ===============================================
 * Production-Grade AES-256-GCM Encryption Service
 * ✅ معايير 2025 - تشفير آمن للتوكنات والبيانات الحساسة
 * ===============================================
 */

import crypto from 'node:crypto';

export type HmacVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'missing_params' | 'bad_format' | 'mismatch' | 'error' };

export function verifyHMACRaw(payload: Buffer, signature: string, secret: string): HmacVerifyResult {
  try {
    // 1) وجود القيم
    if (!payload || !signature || !secret) return { ok: false, reason: 'missing_params' };

    // 2) تنظيف التوقيع
    const sig = signature.startsWith('sha256=') ? signature.slice(7) : signature;

    // 3) تحقق من الصيغة: 64 hex
    if (!/^[a-f0-9]{64}$/i.test(sig)) return { ok: false, reason: 'bad_format' };

    // 4) حساب المتوقع على الـ raw payload
    const expectedHex = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    // 5) مقارنة ثابتة الوقت
    const a = Buffer.from(expectedHex, 'hex');
    const b = Buffer.from(sig, 'hex');
    if (a.length !== b.length) return { ok: false, reason: 'bad_format' }; // نظرياً دائمًا 32 بايت

    const equal = crypto.timingSafeEqual(a, b);
    return equal ? { ok: true } : { ok: false, reason: 'mismatch' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/**
 * Read raw body from Hono request (preserves exact bytes)
 */
export async function readRawBody(c: any): Promise<Buffer> {
  const r = c.req.raw.body;
  if (!r) return Buffer.alloc(0);
  const reader = r.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const size = chunks.reduce((n, u) => n + u.length, 0);
  const out = Buffer.allocUnsafe(size);
  let off = 0;
  for (const u of chunks) { out.set(u, off); off += u.length; }
  return out;
}

export interface EncryptedData {
  iv: string;
  ct: string;
  tag: string;
}

export interface DecryptedData {
  data: string;
  timestamp: number;
}

export class EncryptionService {
  private readonly encryptionKey: Buffer;

  constructor(masterKey?: string) {
    const key = masterKey || process.env.ENCRYPTION_KEY_HEX;
    if (!key) {
      throw new Error('ENCRYPTION_KEY_HEX environment variable required');
    }
    
    // Validate hex key (64 characters = 32 bytes)
    if (!/^[0-9a-fA-F]{64}$/.test(key)) {
      throw new Error('ENCRYPTION_KEY_HEX must be 64 hex characters (32 bytes)');
    }
    
    this.encryptionKey = Buffer.from(key, 'hex');
  }

  /**
   * Encrypt sensitive data using AES-256-GCM (Production 2025 standard)
   */
  public encrypt(plaintext: string, aad = 'v1'): EncryptedData {
    const iv = crypto.randomBytes(12); // GCM-recommended 12 bytes
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    cipher.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    
    return { 
      iv: iv.toString('hex'), 
      ct: ct.toString('hex'), 
      tag: tag.toString('hex') 
    };
  }

  /**
   * Decrypt sensitive data using AES-256-GCM
   */
  public decrypt({ iv, ct, tag }: EncryptedData, aad = 'v1'): string {
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(iv, 'hex'));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'hex')), decipher.final()]).toString('utf8');
  }

  /**
   * Encrypt platform tokens with metadata
   */
  public encryptToken(token: string, platform: 'whatsapp' | 'instagram', identifier: string): EncryptedData {
    const payload = JSON.stringify({
      token,
      platform,
      identifier,
      timestamp: Date.now()
    });
    return this.encrypt(payload, `token:${platform}`);
  }

  /**
   * Decrypt platform tokens 
   */
  public decryptToken(encryptedPayload: EncryptedData, platform: 'whatsapp' | 'instagram'): { token: string; identifier: string; timestamp: number } {
    const decrypted = this.decrypt(encryptedPayload, `token:${platform}`);
    return JSON.parse(decrypted);
  }

  /**
   * Generate secure random string for verification tokens
   */
  public generateSecureRandom(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * @deprecated Use verifyHMACRaw(payload: Buffer, signature, secret) instead
   * HMAC verification for webhooks - kept for backward compatibility
   */
  public verifyHMAC(payload: string, signature: string, secret: string): boolean {
    const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const receivedSig = signature.replace('sha256=', '');
    return crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(receivedSig));
  }

  /**
   * Convenience methods for WhatsApp/Instagram tokens
   */
  public encryptInstagramToken(token: string): string {
    return JSON.stringify(this.encrypt(token));
  }

  public decryptInstagramToken(encryptedData: string): string {
    const data = JSON.parse(encryptedData) as EncryptedData;
    return this.decrypt(data);
  }

  public encryptWhatsAppToken(token: string): string {
    return JSON.stringify(this.encrypt(token));
  }

  public decryptWhatsAppToken(encryptedData: string): string {
    const data = JSON.parse(encryptedData) as EncryptedData;
    return this.decrypt(data);
  }
}

// Singleton instance
let encryptionInstance: EncryptionService | null = null;

/**
 * Get encryption service instance
 */
export function getEncryptionService(): EncryptionService {
  if (!encryptionInstance) {
    encryptionInstance = new EncryptionService();
  }
  return encryptionInstance;
}

// Export main functions for convenience
const service = new EncryptionService();
export const encrypt = service.encrypt.bind(service);
export const decrypt = service.decrypt.bind(service);
export const encryptToken = service.encryptToken.bind(service);
export const decryptToken = service.decryptToken.bind(service);
export const verifyHMAC = service.verifyHMAC.bind(service);

export default EncryptionService;