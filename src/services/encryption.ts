/**
 * ===============================================
 * Production-Grade AES-256-GCM Encryption Service
 * ✅ معايير 2025 - تشفير آمن للتوكنات والبيانات الحساسة
 * ===============================================
 */

import * as crypto from 'node:crypto';
import { getLogger } from './logger.js';

// ✅ Safe environment access without config dependency
function getEnvVar(name: string, defaultValue?: string): string {
  const value = process.env[name];
  if (!value) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

export type HmacVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'missing_params' | 'bad_format' | 'mismatch' | 'error' };

/**
 * Validate encryption key entropy and security
 */
export function validateKeyEntropy(key: string): KeyEntropyValidation {
  const issues: string[] = [];
  const recommendations: string[] = [];
  let entropyScore = 0;

  try {
    // Check key length
    if (key.length < 32) {
      issues.push('Key length is too short (minimum 32 characters)');
      entropyScore -= 30;
    } else if (key.length >= 64) {
      entropyScore += 20;
    } else {
      entropyScore += 10;
    }

    // Check for hex format (preferred)
    if (/^[0-9a-fA-F]{64}$/.test(key)) {
      entropyScore += 25;
      recommendations.push('Hex format detected - excellent for entropy');
    } else if (key.length === 32) {
      entropyScore += 15;
      recommendations.push('ASCII format detected - acceptable but hex is preferred');
    }

    // Check for common weak patterns
    const weakPatterns = [
      /^(.)\1+$/, // Repeated characters
      /^[0-9]+$/, // Only numbers
      /^[a-zA-Z]+$/, // Only letters
      /^(password|secret|key|default|changeme|test|admin|root|123456|abcdef)/i, // Common weak values
      /(password|secret|key|default|changeme|test|admin|root|123456|abcdef)$/i // Common weak values at end
    ];

    for (const pattern of weakPatterns) {
      if (pattern.test(key)) {
        issues.push(`Key contains weak pattern: ${pattern.source}`);
        entropyScore -= 20;
      }
    }

    // Check character diversity
    const uniqueChars = new Set(key.split('')).size;
    const diversityRatio = uniqueChars / key.length;
    
    if (diversityRatio < 0.3) {
      issues.push('Low character diversity detected');
      entropyScore -= 15;
    } else if (diversityRatio > 0.7) {
      entropyScore += 15;
      recommendations.push('High character diversity detected');
    }

    // Check for sequential patterns
    const sequentialPatterns = [
      'abcdefghijklmnopqrstuvwxyz',
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      '0123456789',
      'qwertyuiop',
      'asdfghjkl'
    ];

    for (const pattern of sequentialPatterns) {
      if (key.toLowerCase().includes(pattern.toLowerCase())) {
        issues.push(`Sequential pattern detected: ${pattern}`);
        entropyScore -= 25;
      }
    }

    // Check for repeated substrings
    for (let len = 3; len <= Math.floor(key.length / 2); len++) {
      for (let i = 0; i <= key.length - len; i++) {
        const substring = key.substring(i, i + len);
        const count = (key.match(new RegExp(substring, 'g')) || []).length;
        if (count > 2) {
          issues.push(`Repeated substring detected: "${substring}" (${count} times)`);
          entropyScore -= 10;
          break;
        }
      }
    }

    // Final entropy score calculation
    entropyScore = Math.max(0, Math.min(100, entropyScore + 50)); // Base score + adjustments

    // Determine validity
    const isValid = entropyScore >= 70 && issues.length <= 2;

    if (!isValid) {
      recommendations.push('Generate a new key with higher entropy');
      recommendations.push('Use a cryptographically secure random generator');
      recommendations.push('Consider using hex format for better entropy');
    }

    return {
      isValid,
      entropyScore,
      issues,
      recommendations
    };

  } catch (error) {
    return {
      isValid: false,
      entropyScore: 0,
      issues: ['Error during entropy validation'],
      recommendations: ['Check key format and try again']
    };
  }
}

export function verifyHMACRaw(payload: Buffer, signature: string, secret: string): HmacVerifyResult {
  try {
    // 1) وجود القيم
    if (!payload || !signature || !secret) return { ok: false, reason: 'missing_params' };

    // 2) دعم SHA256 و SHA1 للتوافقية
    let algorithm = 'sha256';
    let sig = signature;
    
    if (signature.startsWith('sha256=')) {
      algorithm = 'sha256';
      sig = signature.slice(7);
    } else if (signature.startsWith('sha1=')) {
      algorithm = 'sha1';
      sig = signature.slice(5);
    } else {
      // Try to detect based on length
      if (signature.length === 64) {
        algorithm = 'sha256';
      } else if (signature.length === 40) {
        algorithm = 'sha1';
      } else {
        return { ok: false, reason: 'bad_format' };
      }
    }

    // 3) تحقق من الصيغة: 64 hex للsha256 أو 40 hex للsha1
    const expectedLength = algorithm === 'sha256' ? 64 : 40;
    if (sig.length !== expectedLength || !/^[a-f0-9]+$/i.test(sig)) {
      return { ok: false, reason: 'bad_format' };
    }

    // 4) حساب المتوقع على الـ raw payload
    const expectedHex = crypto.createHmac(algorithm, secret).update(payload).digest('hex');

    // 5) مقارنة ثابتة الوقت
    const a = Buffer.from(expectedHex, 'hex');
    const b = Buffer.from(sig, 'hex');
    if (a.length !== b.length) return { ok: false, reason: 'bad_format' };

    const equal = crypto.timingSafeEqual(a, b);
    return equal ? { ok: true } : { ok: false, reason: 'mismatch' };
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error({ err }, "Timing-safe comparison failed");
    return { ok: false, reason: 'error' };
  }
}

/**
 * Read raw body from Hono request (preserves exact bytes)
 *
 * Monitors the accumulated payload size while reading. If the size
 * exceeds `maxBytes` (default 1MB), the reader is cancelled and an
 * HTTP 413 error is thrown.
 */
export async function readRawBody(c: { req: { raw: { body?: ReadableStream } }; throw?: (status: number, message: string) => never }, maxBytes = 1024 * 1024): Promise<Buffer> {
  const r = c.req.raw.body;
  if (!r) return Buffer.alloc(0);
  const reader = r.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        size += value.length;
        if (size > maxBytes) {
          try { await reader.cancel(); } catch (e) {
            // Non-fatal: log at debug level, continue throwing 413
            const log = getLogger({ component: 'encryption' });
            log.debug('reader.cancel failed after exceeding maxBytes', { error: String(e) });
          }
          if (typeof c.throw === 'function') {
            c.throw(413, 'payload too large');
          }
          throw Object.assign(new Error('payload too large'), { status: 413 });
        }
        chunks.push(value);
      }
    }

    const out = Buffer.allocUnsafe(size);
    let off = 0;
    for (const u of chunks) {
      out.set(u, off);
      off += u.length;
    }
    return out;
  } finally {
    reader.releaseLock();
  }
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

export interface KeyRotationConfig {
  rotationIntervalDays: number;
  maxKeyAgeDays: number;
  keyVersion: string;
  lastRotationDate?: Date;
}

export interface KeyEntropyValidation {
  isValid: boolean;
  entropyScore: number;
  issues: string[];
  recommendations: string[];
}

export class EncryptionService {
  private readonly encryptionKey: Buffer;
  private readonly keyRotationConfig: KeyRotationConfig;
  private readonly keyVersion: string;
  private readonly logger = getLogger({ component: 'encryption-service' });

  constructor(masterKey?: string, rotationConfig?: Partial<KeyRotationConfig>) {
    const key = masterKey || getEnvVar('ENCRYPTION_KEY');
    if (!key) {
      throw new Error('ENCRYPTION_KEY environment variable required');
    }

    // Validate key entropy in startup
    const entropyValidation = validateKeyEntropy(key);
    if (!entropyValidation.isValid) {
      this.logger.warn('Encryption key entropy validation failed', {
        entropyScore: entropyValidation.entropyScore,
        issues: entropyValidation.issues,
        recommendations: entropyValidation.recommendations
      });
      
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Encryption key entropy validation failed: ${entropyValidation.issues.join(', ')}`);
      }
    }

    // Accept either 64 hex characters (32 bytes) or 32 ASCII characters
    if (/^[0-9a-fA-F]{64}$/.test(key)) {
      this.encryptionKey = Buffer.from(key, 'hex');
    } else if (key.length === 32) {
      this.encryptionKey = Buffer.from(key, 'utf8');
    } else {
      throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters) or 32 ASCII characters');
    }

    // Initialize key rotation configuration
    this.keyRotationConfig = {
      rotationIntervalDays: rotationConfig?.rotationIntervalDays || 90, // 90 days default
      maxKeyAgeDays: rotationConfig?.maxKeyAgeDays || 365, // 1 year max
      keyVersion: rotationConfig?.keyVersion || 'v1',
      lastRotationDate: rotationConfig?.lastRotationDate || new Date()
    };

    this.keyVersion = this.keyRotationConfig.keyVersion;
  }

  /**
   * Check if key rotation is needed
   */
  public shouldRotateKey(): boolean {
    const now = new Date();
    const lastRotation = this.keyRotationConfig.lastRotationDate;
    if (!lastRotation) {
      this.logger.warn('No last rotation date found, assuming key rotation needed');
      return true;
    }
    const daysSinceRotation = (now.getTime() - lastRotation.getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceRotation >= this.keyRotationConfig.rotationIntervalDays;
  }

  /**
   * Get key rotation status
   */
  public getKeyRotationStatus(): {
    shouldRotate: boolean;
    daysSinceRotation: number;
    rotationInterval: number;
    keyVersion: string;
    lastRotation: Date;
  } {
    const now = new Date();
    const lastRotation = this.keyRotationConfig.lastRotationDate;
    
    if (!lastRotation) {
      this.logger.warn('No last rotation date found for key rotation status');
      return {
        shouldRotate: true,
        daysSinceRotation: Infinity,
        rotationInterval: this.keyRotationConfig.rotationIntervalDays,
        keyVersion: this.keyVersion,
        lastRotation: new Date(0) // Unix epoch as fallback
      };
    }
    
    const daysSinceRotation = (now.getTime() - lastRotation.getTime()) / (1000 * 60 * 60 * 24);
    
    return {
      shouldRotate: daysSinceRotation >= this.keyRotationConfig.rotationIntervalDays,
      daysSinceRotation: Math.floor(daysSinceRotation),
      rotationInterval: this.keyRotationConfig.rotationIntervalDays,
      keyVersion: this.keyVersion,
      lastRotation: lastRotation
    };
  }

  /**
   * Generate new encryption key
   */
  public generateNewKey(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Rotate encryption key (returns new key)
   */
  public rotateKey(): {
    newKey: string;
    oldKeyVersion: string;
    newKeyVersion: string;
    rotationDate: Date;
  } {
    const newKey = this.generateNewKey();
    const oldKeyVersion = this.keyVersion;
    const newKeyVersion = `v${parseInt(this.keyVersion.slice(1)) + 1}`;
    const rotationDate = new Date();

    // Update rotation config
    this.keyRotationConfig.keyVersion = newKeyVersion;
    this.keyRotationConfig.lastRotationDate = rotationDate;

    this.logger.info('Encryption key rotated successfully', {
      oldKeyVersion,
      newKeyVersion,
      rotationDate: rotationDate.toISOString()
    });

    return {
      newKey,
      oldKeyVersion: oldKeyVersion,
      newKeyVersion: newKeyVersion,
      rotationDate: rotationDate
    };
  }

  /**
   * Encrypt with key version tracking
   */
  public encryptWithVersion(plaintext: string, aad = 'v1'): EncryptedData & { keyVersion: string } {
    const encrypted = this.encrypt(plaintext, aad);
    return {
      ...encrypted,
      keyVersion: this.keyVersion
    };
  }

  /**
   * Decrypt with key version validation
   */
  public decryptWithVersion(encryptedData: EncryptedData & { keyVersion?: string }, aad = 'v1'): string {
    // Check if key version is too old
    if (encryptedData.keyVersion && encryptedData.keyVersion !== this.keyVersion) {
      const versionDiff = parseInt(this.keyVersion.slice(1)) - parseInt(encryptedData.keyVersion.slice(1));
      if (versionDiff > 2) {
        throw new Error(`Key version too old: ${encryptedData.keyVersion}, current: ${this.keyVersion}`);
      }
    }

    return this.decrypt(encryptedData, aad);
  }

  /**
   * Encrypt sensitive data using AES-256-GCM (Production 2025 standard)
   */
  public encrypt(plaintext: string, aad = 'v1'): EncryptedData {
    try {
      const iv = crypto.randomBytes(12); // GCM-recommended 12 bytes
      const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
      cipher.setAAD(Buffer.from(aad));
      const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      
      this.logger.debug('Data encrypted successfully', {
        aad,
        plaintextLength: plaintext.length,
        ivLength: iv.length,
        ctLength: ct.length,
        tagLength: tag.length
      });
      
      return { 
        iv: iv.toString('hex'), 
        ct: ct.toString('hex'), 
        tag: tag.toString('hex') 
      };
    } catch (error) {
      this.logger.error('Encryption failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        aad,
        plaintextLength: plaintext?.length
      });
      throw error;
    }
  }

  /**
   * Decrypt sensitive data using AES-256-GCM
   */
  public decrypt({ iv, ct, tag }: EncryptedData, aad = 'v1'): string {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(iv, 'hex'));
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(Buffer.from(tag, 'hex'));
      return Buffer.concat([decipher.update(Buffer.from(ct, 'hex')), decipher.final()]).toString('utf8');
    } catch (error) {
      this.logger.error('Decryption failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        aad,
        ivLength: iv?.length,
        ctLength: ct?.length,
        tagLength: tag?.length
      });
      throw error;
    }
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
    
    let parsed;
    try { parsed = JSON.parse(decrypted); }
    catch { throw new Error('Invalid token payload'); }
    if (
      !parsed ||
      typeof parsed.token !== 'string' ||
      typeof parsed.identifier !== 'string' ||
      typeof parsed.timestamp !== 'number'
    ) {
      throw new Error('Invalid token payload');
    }
    return parsed;
  }

  /**
   * Generate secure random string for verification tokens
   */
  public generateSecureRandom(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Convenience methods for WhatsApp/Instagram tokens
   */
  public encryptInstagramToken(token: string, identifier: string = 'default'): string {
    const encrypted = this.encryptToken(token, 'instagram', identifier);
    return JSON.stringify(encrypted);
  }

  public decryptInstagramToken(encryptedData: string): { token: string; identifier: string; timestamp: number } {
    let data: EncryptedData;
    try {
      data = JSON.parse(encryptedData) as EncryptedData;
    } catch {
      throw new Error('Invalid encrypted data format');
    }
    return this.decryptToken(data, 'instagram');
  }

  public encryptWhatsAppToken(token: string, identifier: string = 'default'): string {
    const encrypted = this.encryptToken(token, 'whatsapp', identifier);
    return JSON.stringify(encrypted);
  }

  public decryptWhatsAppToken(encryptedData: string): { token: string; identifier: string; timestamp: number } {
    let data: EncryptedData;
    try {
      data = JSON.parse(encryptedData) as EncryptedData;
    } catch {
      throw new Error('Invalid encrypted data format');
    }
    return this.decryptToken(data, 'whatsapp');
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

// Export main functions for convenience using lazy-loaded service
export function encrypt(plaintext: string, aad?: string): EncryptedData {
  return getEncryptionService().encrypt(plaintext, aad);
}

export function decrypt(data: EncryptedData, aad?: string): string {
  return getEncryptionService().decrypt(data, aad);
}

export function encryptToken(
  token: string,
  platform: 'whatsapp' | 'instagram',
  identifier: string
): EncryptedData {
  return getEncryptionService().encryptToken(token, platform, identifier);
}

export function decryptToken(
  encryptedPayload: EncryptedData,
  platform: 'whatsapp' | 'instagram'
): { token: string; identifier: string; timestamp: number } {
  return getEncryptionService().decryptToken(encryptedPayload, platform);
}

export function verifyHMAC(
  payload: string | Buffer,
  signature: string,
  secret: string
): boolean {
  const buffer = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  return verifyHMACRaw(buffer, signature, secret).ok;
}

// Key rotation convenience functions
export function shouldRotateKey(): boolean {
  return getEncryptionService().shouldRotateKey();
}

export function getKeyRotationStatus(): {
  shouldRotate: boolean;
  daysSinceRotation: number;
  rotationInterval: number;
  keyVersion: string;
  lastRotation: Date;
} {
  return getEncryptionService().getKeyRotationStatus();
}

export function generateNewKey(): string {
  return getEncryptionService().generateNewKey();
}

export function rotateKey(): {
  newKey: string;
  oldKeyVersion: string;
  newKeyVersion: string;
  rotationDate: Date;
} {
  return getEncryptionService().rotateKey();
}

export function encryptWithVersion(plaintext: string, aad?: string): EncryptedData & { keyVersion: string } {
  return getEncryptionService().encryptWithVersion(plaintext, aad);
}

export function decryptWithVersion(encryptedData: EncryptedData & { keyVersion?: string }, aad?: string): string {
  return getEncryptionService().decryptWithVersion(encryptedData, aad);
}

export default EncryptionService;
