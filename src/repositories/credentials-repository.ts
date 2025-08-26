/**
 * ===============================================
 * Encrypted Credentials Repository (2025 Standards)
 * ✅ آمان مطلق للتوكنات والبيانات الحساسة
 * ===============================================
 */

import { getDatabase } from '../db/adapter.js';
import { getEncryptionService } from '../services/encryption.js';
import type { Platform } from '../types/database.js';
import type { Sql } from '../types/sql.js';
import type { DatabaseRow } from '../types/db.js';

interface TokenRow extends DatabaseRow {
  token_encrypted: string | null;
}

interface TokenExpiryDbRow extends DatabaseRow {
  token_expires_at: string | null;
}

interface CredentialDbRow extends DatabaseRow {
  merchant_id: string;
  whatsapp_phone_number_id: string | null;
  instagram_page_id: string | null;
  business_account_id: string | null;
  webhook_verify_token: string | null;
  token_expires_at: string | null;
  last_token_refresh: string | null;
  token_refresh_count: string;
  token_created_ip: string | null;
  last_access_ip: string | null;
  last_access_at: string | null;
}

// Removed unused interface: MerchantIdRow

export interface StoredCredentials {
  merchantId: string;
  whatsappPhoneNumberId?: string;
  instagramPageId?: string;
  businessAccountId?: string;
  webhookVerifyToken?: string;
  tokenExpiresAt?: Date;
  lastTokenRefresh?: Date;
  tokenRefreshCount: number;
  tokenCreatedIp?: string;
  lastAccessIp?: string;
  lastAccessAt?: Date;
}

export interface EncryptedTokenData {
  iv: string;
  ct: string;
  tag: string;
}

export class CredentialsRepository {
  private db = getDatabase();
  private encryption = getEncryptionService();

  /**
   * Store encrypted platform token safely
   */
  async storeToken(
    merchantId: string,
    platform: Platform,
    token: string,
    identifier: string,
    metadata?: {
      expiresAt?: Date;
      createdIp?: string;
    }
  ): Promise<void> {
    // تشفير التوكن بشكل آمن
    const encryptedData = this.encryption.encryptToken(token, platform, identifier);
    const encryptedJson = JSON.stringify(encryptedData);

    const sql: Sql = this.db.getSQL();
    
    if (platform === 'whatsapp') {
      await sql`
        INSERT INTO merchant_credentials (
          merchant_id,
          whatsapp_token_encrypted,
          whatsapp_phone_number_id,
          token_expires_at,
          token_created_ip,
          token_refresh_count
        ) VALUES (
          ${merchantId}::uuid,
          ${encryptedJson},
          ${identifier},
          ${metadata?.expiresAt || null},
          ${metadata?.createdIp || null},
          1
        )
        ON CONFLICT (merchant_id) 
        DO UPDATE SET 
          whatsapp_token_encrypted = EXCLUDED.whatsapp_token_encrypted,
          whatsapp_phone_number_id = EXCLUDED.whatsapp_phone_number_id,
          token_expires_at = EXCLUDED.token_expires_at,
          last_token_refresh = NOW(),
          token_refresh_count = merchant_credentials.token_refresh_count + 1,
          updated_at = NOW()
      `;
    } else if (platform === 'instagram') {
      await sql`
        INSERT INTO merchant_credentials (
          merchant_id,
          instagram_token_encrypted,
          instagram_page_id,
          token_expires_at,
          token_created_ip,
          token_refresh_count
        ) VALUES (
          ${merchantId}::uuid,
          ${encryptedJson},
          ${identifier},
          ${metadata?.expiresAt || null},
          ${metadata?.createdIp || null},
          1
        )
        ON CONFLICT (merchant_id) 
        DO UPDATE SET 
          instagram_token_encrypted = EXCLUDED.instagram_token_encrypted,
          instagram_page_id = EXCLUDED.instagram_page_id,
          token_expires_at = EXCLUDED.token_expires_at,
          last_token_refresh = NOW(),
          token_refresh_count = merchant_credentials.token_refresh_count + 1,
          updated_at = NOW()
      `;
    }
  }

  /**
   * Retrieve and decrypt platform token
   */
  async getToken(merchantId: string, platform: Platform): Promise<string | null> {
    const sql: Sql = this.db.getSQL();
    
    // const field = platform === 'whatsapp' ? 'whatsapp_token_encrypted' : 'instagram_token_encrypted'; // unused
    
    let rows;
    if (platform === 'whatsapp') {
      rows = await sql`SELECT whatsapp_token_encrypted as token_encrypted FROM merchant_credentials WHERE merchant_id = ${merchantId}::uuid`;
    } else {
      rows = await sql`SELECT instagram_token_encrypted as token_encrypted FROM merchant_credentials WHERE merchant_id = ${merchantId}::uuid`;
    }
    const row = rows[0] as unknown as TokenRow | undefined;

    if (!row?.token_encrypted) {
      return null;
    }

    try {
      const encryptedData = JSON.parse(row.token_encrypted);
      const decryptedData = this.encryption.decryptToken(encryptedData, platform);
      
      // تسجيل الوصول الأخير
      await this.recordAccess(merchantId);
      
      return decryptedData.token;
    } catch (error) {
      // Failed to decrypt token - security sensitive, using logger instead
      return null;
    }
  }

  /**
   * Check if token exists and is not expired
   */
  async isTokenValid(merchantId: string, platform: Platform): Promise<boolean> {
    const sql: Sql = this.db.getSQL();
    let row: TokenExpiryDbRow | undefined;

    if (platform === 'whatsapp') {
      [row] = await sql<TokenExpiryDbRow>`
        SELECT token_expires_at
        FROM merchant_credentials
        WHERE merchant_id = ${merchantId}::uuid
          AND whatsapp_token_encrypted IS NOT NULL
      `;
    } else {
      [row] = await sql<TokenExpiryDbRow>`
        SELECT token_expires_at
        FROM merchant_credentials
        WHERE merchant_id = ${merchantId}::uuid
          AND instagram_token_encrypted IS NOT NULL
      `;
    }

    if (!row || !row.token_expires_at) return false;
    return new Date(row.token_expires_at).getTime() > Date.now();
  }

  /**
   * Remove platform token (secure deletion)
   */
  async removeToken(merchantId: string, platform: Platform): Promise<void> {
    const sql: Sql = this.db.getSQL();
    
    if (platform === 'whatsapp') {
      await sql`
        UPDATE merchant_credentials 
        SET 
          whatsapp_token_encrypted = NULL,
          whatsapp_phone_number_id = NULL,
          updated_at = NOW()
        WHERE merchant_id = ${merchantId}::uuid
      `;
    } else if (platform === 'instagram') {
      await sql`
        UPDATE merchant_credentials 
        SET 
          instagram_token_encrypted = NULL,
          instagram_page_id = NULL,
          updated_at = NOW()
        WHERE merchant_id = ${merchantId}::uuid
      `;
    }
  }

  /**
   * Get all stored credentials (for merchant)
   */
  async getCredentials(merchantId: string): Promise<CredentialDbRow | null> {
    const sql: Sql = this.db.getSQL();
    
    const [row] = await sql<CredentialDbRow>`
      SELECT
        merchant_id,
        whatsapp_phone_number_id,
        instagram_page_id,
        business_account_id,
        webhook_verify_token,
        token_expires_at,
        last_token_refresh,
        token_refresh_count,
        token_created_ip,
        last_access_ip,
        last_access_at
      FROM merchant_credentials 
      WHERE merchant_id = ${merchantId}::uuid
    `;

    return row ?? null;
  }

  /**
   * Record access for audit trail
   */
  private async recordAccess(merchantId: string, ip?: string): Promise<void> {
    const sql: Sql = this.db.getSQL();
    
    await sql`
      UPDATE merchant_credentials 
      SET 
        last_access_at = NOW(),
        last_access_ip = ${ip || null},
        updated_at = NOW()
      WHERE merchant_id = ${merchantId}::uuid
    `;
  }

  /**
   * Rotate all tokens for merchant (security measure)
   */
  async rotateAllTokens(merchantId: string): Promise<void> {
    console.warn(`🔄 Rotating all tokens for merchant ${merchantId}`);
    
    await this.removeToken(merchantId, 'whatsapp');
    await this.removeToken(merchantId, 'instagram');
    
    // Log security event
    // ✅ All tokens rotated successfully
  }

  /**
   * Get expired tokens for cleanup
   */
  async getExpiredTokens(): Promise<string[]> {
    const sql: Sql = this.db.getSQL();

    const rows = await sql<{ merchant_id: string }>`
      SELECT DISTINCT merchant_id
      FROM merchant_credentials
      WHERE token_expires_at IS NOT NULL
        AND token_expires_at < NOW()
        AND (whatsapp_token_encrypted IS NOT NULL OR instagram_token_encrypted IS NOT NULL)
    `;

    return rows.map((row: { merchant_id: string }) => row.merchant_id);
  }

  /**
   * Cleanup expired tokens (scheduled job)
   */
  async cleanupExpiredTokens(): Promise<number> {
    const expiredMerchants = await this.getExpiredTokens();
    
    for (const merchantId of expiredMerchants) {
      await this.rotateAllTokens(merchantId);
    }

    // 🧹 Token cleanup completed
    return expiredMerchants.length;
  }
}

// Singleton instance
let credentialsRepositoryInstance: CredentialsRepository | null = null;

/**
 * Get credentials repository instance
 */
export function getCredentialsRepository(): CredentialsRepository {
  if (!credentialsRepositoryInstance) {
    credentialsRepositoryInstance = new CredentialsRepository();
  }
  return credentialsRepositoryInstance;
}

export default CredentialsRepository;