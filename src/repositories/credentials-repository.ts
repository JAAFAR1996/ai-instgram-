/**
 * ===============================================
 * Encrypted Credentials Repository (2025 Standards)
 * ✅ آمان مطلق للتوكنات والبيانات الحساسة
 * ===============================================
 */

import { getDatabase } from '../database/connection.js';
import { getEncryptionService } from '../services/encryption.js';
import type { MerchantCredentials, Platform } from '../types/database.js';
import type { Sql } from 'postgres';

interface TokenRow {
  token_encrypted: string | null;
}

interface TokenExpiryRow {
  token_expires_at: string | null;
}

interface CredentialRow {
  merchant_id: string;
  whatsapp_phone_number_id: string | null;
  instagram_page_id: string | null;
  webhook_verify_token: string | null;
  token_expires_at: string | null;
  last_token_refresh: string | null;
  token_refresh_count: string;
  token_created_ip: string | null;
  last_access_ip: string | null;
  last_access_at: string | null;
}

interface MerchantIdRow {
  merchant_id: string;
}

export interface StoredCredentials {
  merchantId: string;
  whatsappPhoneNumberId?: string;
  instagramPageId?: string;
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

    const sql = this.db.getSQL() as any;
    
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
    const sql = this.db.getSQL() as any;
    
    const field = platform === 'whatsapp' ? 'whatsapp_token_encrypted' : 'instagram_token_encrypted';
    
    const [row] = await sql<TokenRow>`
      SELECT ${sql(field)} as token_encrypted
      FROM merchant_credentials 
      WHERE merchant_id = ${merchantId}::uuid
    `;

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
      console.error(`❌ Failed to decrypt ${platform} token for merchant ${merchantId}:`, error);
      return null;
    }
  }

  /**
   * Check if token exists and is not expired
   */
  async isTokenValid(merchantId: string, platform: Platform): Promise<boolean> {
    const sql = this.db.getSQL() as any;
    
    const [row] = await sql<TokenExpiryRow>`
      SELECT token_expires_at
      FROM merchant_credentials 
      WHERE merchant_id = ${merchantId}::uuid
      AND ${sql(platform === 'whatsapp' ? 'whatsapp_token_encrypted' : 'instagram_token_encrypted')} IS NOT NULL
    `;

    if (!row) {
      return false;
    }

    // تحقق من انتهاء صلاحية التوكن
    if (row.token_expires_at && new Date() > new Date(row.token_expires_at)) {
      return false;
    }

    return true;
  }

  /**
   * Remove platform token (secure deletion)
   */
  async removeToken(merchantId: string, platform: Platform): Promise<void> {
    const sql = this.db.getSQL() as any;
    
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
  async getCredentials(merchantId: string): Promise<StoredCredentials | null> {
    const sql = this.db.getSQL() as any;
    
    const [row] = await sql<CredentialRow>`
      SELECT 
        merchant_id,
        whatsapp_phone_number_id,
        instagram_page_id,
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

    if (!row) {
      return null;
    }

    return {
      merchantId: row.merchant_id,
      whatsappPhoneNumberId: row.whatsapp_phone_number_id,
      instagramPageId: row.instagram_page_id,
      webhookVerifyToken: row.webhook_verify_token,
      tokenExpiresAt: row.token_expires_at ? new Date(row.token_expires_at) : undefined,
      lastTokenRefresh: row.last_token_refresh ? new Date(row.last_token_refresh) : undefined,
      tokenRefreshCount: parseInt(row.token_refresh_count) || 0,
      tokenCreatedIp: row.token_created_ip,
      lastAccessIp: row.last_access_ip,
      lastAccessAt: row.last_access_at ? new Date(row.last_access_at) : undefined
    };
  }

  /**
   * Record access for audit trail
   */
  private async recordAccess(merchantId: string, ip?: string): Promise<void> {
    const sql = this.db.getSQL() as any;
    
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
    console.log(`✅ All tokens rotated for merchant ${merchantId}`);
  }

  /**
   * Get expired tokens for cleanup
   */
  async getExpiredTokens(): Promise<string[]> {
    const sql: Sql = this.db.getSQL();

    const rows = await sql<MerchantIdRow>`
      SELECT DISTINCT merchant_id
      FROM merchant_credentials
      WHERE token_expires_at IS NOT NULL
      AND token_expires_at < NOW()
      AND (whatsapp_token_encrypted IS NOT NULL OR instagram_token_encrypted IS NOT NULL)
    `;

    return rows.map((row: MerchantIdRow) => row.merchant_id);
  }

  /**
   * Cleanup expired tokens (scheduled job)
   */
  async cleanupExpiredTokens(): Promise<number> {
    const expiredMerchants = await this.getExpiredTokens();
    
    for (const merchantId of expiredMerchants) {
      await this.rotateAllTokens(merchantId);
    }

    console.log(`🧹 Cleaned up tokens for ${expiredMerchants.length} merchants`);
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