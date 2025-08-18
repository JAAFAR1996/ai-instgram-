/**
 * ===============================================
 * Production-Grade AES-256-GCM Encryption Service
 * ✅ معايير 2025 - تشفير آمن للتوكنات والبيانات الحساسة
 * ===============================================
 */

import crypto from 'node:crypto';

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
   * HMAC verification for webhooks
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