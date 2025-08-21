/**
 * ===============================================
 * WhatsApp Business API Client
 * Complete WhatsApp Business API integration for sales automation
 * ===============================================
 */

import { createHash } from 'crypto';
import { getEncryptionService } from './encryption.js';
import { getDatabase } from '../database/connection.js';
import { GRAPH_API_BASE_URL } from '../config/graph-api.js';
import type { Platform } from '../types/database.js';

export interface WhatsAppCredentials {
  phoneNumberId: string;
  accessToken: string;
  businessAccountId: string;
  webhookVerifyToken: string;
  appSecret: string;
}

export interface WhatsAppMessage {
  id: string;
  from: string;
  to: string;
  timestamp: string;
  type: 'text' | 'image' | 'document' | 'audio' | 'video';
  text?: {
    body: string;
  };
  image?: {
    id: string;
    mime_type: string;
    sha256: string;
    caption?: string;
  };
  document?: {
    id: string;
    filename: string;
    mime_type: string;
    sha256: string;
    caption?: string;
  };
  context?: {
    message_id: string;
  };
}

export interface SendMessageRequest {
  to: string;
  type: 'text' | 'image' | 'template' | 'document';
  text?: {
    body: string;
    preview_url?: boolean;
  };
  image?: {
    id?: string;
    link?: string;
    caption?: string;
  };
  template?: {
    name: string;
    language: { code: string };
    components?: any[];
  };
}

export interface WhatsAppAPIResponse {
  success: boolean;
  messageId?: string;
  error?: {
    code: number;
    message: string;
    type: string;
    details?: any;
  };
  rateLimitRemaining?: number;
}

export interface WhatsAppProfile {
  name: string;
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  profile_picture_url?: string;
  websites?: string[];
  vertical?: string;
}

export class WhatsAppAPIClient {
  private readonly baseUrl = GRAPH_API_BASE_URL;
  private credentials: WhatsAppCredentials | null = null;
  private encryptionService = getEncryptionService();
  private db = getDatabase();

  constructor() {}

  /**
   * Initialize with merchant credentials
   */
  public async initialize(merchantId: string): Promise<void> {
    try {
      this.credentials = await this.loadMerchantCredentials(merchantId);
      
      if (!this.credentials) {
        throw new Error(`WhatsApp credentials not found for merchant: ${merchantId}`);
      }

      // Validate credentials
      await this.validateCredentials();
      
      console.log(`✅ WhatsApp API initialized for merchant: ${merchantId}`);
    } catch (error) {
      console.error('❌ WhatsApp API initialization failed:', error);
      throw error;
    }
  }

  /**
   * Send message via WhatsApp Business API
   */
  public async sendMessage(request: SendMessageRequest): Promise<WhatsAppAPIResponse> {
    try {
      if (!this.credentials) {
        throw new Error('WhatsApp API not initialized');
      }

      const url = `${this.baseUrl}/${this.credentials.phoneNumberId}/messages`;
      
      const payload = this.buildMessagePayload(request);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.credentials.accessToken}`
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: {
            code: ((result as any).error)?.code || response.status,
            message: ((result as any).error)?.message || 'Failed to send message',
            type: ((result as any).error)?.type || 'API_ERROR',
            details: ((result as any).error)
          }
        };
      }

      return {
        success: true,
        messageId: ((result as any).messages)?.[0]?.id,
        rateLimitRemaining: this.parseRateLimitHeaders(response)
      };
    } catch (error) {
      console.error('❌ WhatsApp message send failed:', error);
      return {
        success: false,
        error: {
          code: 500,
          message: error instanceof Error ? error.message : 'Unknown error',
          type: 'NETWORK_ERROR'
        }
      };
    }
  }

  /**
   * Send template message (for users outside 24h window)
   */
  public async sendTemplateMessage(
    to: string,
    templateName: string,
    languageCode: string = 'ar',
    components?: any[]
  ): Promise<WhatsAppAPIResponse> {
    return this.sendMessage({
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components
      }
    });
  }

  /**
   * Send text message with optional preview
   */
  public async sendTextMessage(
    to: string, 
    text: string, 
    previewUrl: boolean = false
  ): Promise<WhatsAppAPIResponse> {
    return this.sendMessage({
      to,
      type: 'text',
      text: {
        body: text,
        preview_url: previewUrl
      }
    });
  }

  /**
   * Send image message with optional caption
   */
  public async sendImageMessage(
    to: string, 
    imageUrl: string, 
    caption?: string
  ): Promise<WhatsAppAPIResponse> {
    return this.sendMessage({
      to,
      type: 'image',
      image: {
        link: imageUrl,
        caption
      }
    });
  }

  /**
   * Mark message as read
   */
  public async markMessageAsRead(messageId: string): Promise<boolean> {
    try {
      if (!this.credentials) {
        throw new Error('WhatsApp API not initialized');
      }

      const url = `${this.baseUrl}/${this.credentials.phoneNumberId}/messages`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.credentials.accessToken}`
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId
        })
      });

      return response.ok;
    } catch (error) {
      console.error('❌ Failed to mark message as read:', error);
      return false;
    }
  }

  /**
   * Get business profile
   */
  public async getBusinessProfile(): Promise<WhatsAppProfile | null> {
    try {
      if (!this.credentials) {
        throw new Error('WhatsApp API not initialized');
      }

      const url = `${this.baseUrl}/${this.credentials.phoneNumberId}/whatsapp_business_profile`;
      const params = new URLSearchParams({
        fields: 'about,address,description,email,profile_picture_url,websites,vertical'
      });

      const response = await fetch(`${url}?${params}`, {
        headers: {
          'Authorization': `Bearer ${this.credentials.accessToken}`
        }
      });

      if (!response.ok) {
        console.error('Failed to fetch business profile:', await response.text());
        return null;
      }

      const result = await response.json();
      return ((result as any).data)?.[0] || null;
    } catch (error) {
      console.error('❌ Get business profile failed:', error);
      return null;
    }
  }

  /**
   * Update business profile
   */
  public async updateBusinessProfile(profile: Partial<WhatsAppProfile>): Promise<boolean> {
    try {
      if (!this.credentials) {
        throw new Error('WhatsApp API not initialized');
      }

      const url = `${this.baseUrl}/${this.credentials.phoneNumberId}/whatsapp_business_profile`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.credentials.accessToken}`
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          ...profile
        })
      });

      return response.ok;
    } catch (error) {
      console.error('❌ Update business profile failed:', error);
      return false;
    }
  }

  /**
   * Get phone number information
   */
  public async getPhoneNumberInfo(): Promise<any> {
    try {
      if (!this.credentials) {
        throw new Error('WhatsApp API not initialized');
      }

      const url = `${this.baseUrl}/${this.credentials.phoneNumberId}`;
      const params = new URLSearchParams({
        fields: 'id,display_phone_number,verified_name,quality_rating'
      });

      const response = await fetch(`${url}?${params}`, {
        headers: {
          'Authorization': `Bearer ${this.credentials.accessToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to get phone number info: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('❌ Get phone number info failed:', error);
      throw error;
    }
  }

  /**
   * Check API health and quality rating
   */
  public async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    qualityRating?: string;
    displayPhoneNumber?: string;
    rateLimitRemaining: number;
    lastChecked: Date;
  }> {
    try {
      if (!this.credentials) {
        return {
          status: 'unhealthy',
          rateLimitRemaining: 0,
          lastChecked: new Date()
        };
      }

      const phoneInfo = await this.getPhoneNumberInfo();
      
      return {
        status: 'healthy',
        qualityRating: phoneInfo.quality_rating,
        displayPhoneNumber: phoneInfo.display_phone_number,
        rateLimitRemaining: 1000, // Default WhatsApp rate limit
        lastChecked: new Date()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        rateLimitRemaining: 0,
        lastChecked: new Date()
      };
    }
  }

  /**
   * Validate webhook signature
   */
  public async validateWebhookSignature(signature: string, payload: string): Promise<boolean> {
    try {
      if (!this.credentials?.appSecret) {
        return false;
      }

      const crypto = await import('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', this.credentials.appSecret)
        .update(payload)
        .digest('hex');

      const receivedSignature = signature.replace('sha256=', '');
      
      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(receivedSignature, 'hex')
      );
    } catch (error) {
      console.error('❌ Webhook signature validation failed:', error);
      return false;
    }
  }

  /**
   * Private: Load merchant credentials from database
   */
  private async loadMerchantCredentials(merchantId: string): Promise<WhatsAppCredentials | null> {
    try {
      const sql = this.db.getSQL();
      
      const credentials = await sql`
        SELECT
          whatsapp_token_encrypted,
          whatsapp_phone_number_id,
          webhook_verify_token,
          COALESCE(business_account_id, whatsapp_business_account_id) AS business_account_id,
          app_secret
        FROM merchant_credentials
        WHERE merchant_id = ${merchantId}::uuid
      `;

      if (credentials.length === 0) {
        return null;
      }

      const cred = credentials[0];
      
      if (!cred.whatsapp_token_encrypted) {
        return null;
      }

      // Decrypt the token
      const decryptedToken = this.encryptionService.decryptWhatsAppToken(
        JSON.parse(cred.whatsapp_token_encrypted)
      );

      return {
        phoneNumberId: cred.whatsapp_phone_number_id || '',
        accessToken: decryptedToken,
        businessAccountId: cred.business_account_id || '',
        webhookVerifyToken: cred.webhook_verify_token || '',
        appSecret: cred.app_secret || ''
      };
    } catch (error) {
      console.error('❌ Failed to load merchant credentials:', error);
      return null;
    }
  }

  /**
   * Private: Validate API credentials
   */
  private async validateCredentials(): Promise<void> {
    try {
      await this.getPhoneNumberInfo();
    } catch (error) {
      throw new Error(`Invalid WhatsApp credentials: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Private: Build message payload for API
   */
  private buildMessagePayload(request: SendMessageRequest): any {
    const basePayload = {
      messaging_product: 'whatsapp',
      to: request.to
    };

    switch (request.type) {
      case 'text':
        return {
          ...basePayload,
          type: 'text',
          text: request.text
        };

      case 'image':
        return {
          ...basePayload,
          type: 'image',
          image: request.image
        };

      case 'template':
        return {
          ...basePayload,
          type: 'template',
          template: request.template
        };

      case 'document':
        return {
          ...basePayload,
          type: 'document',
          document: request.image // Reuse image structure
        };

      default:
        throw new Error(`Unsupported message type: ${request.type}`);
    }
  }

  /**
   * Private: Parse rate limit from response headers
   */
  private parseRateLimitHeaders(response: Response): number {
    // WhatsApp doesn't expose rate limits in headers
    // Return default estimate based on tier
    return 1000; // Default business tier limit
  }
}

/**
 * WhatsApp Credentials Manager
 */
export class WhatsAppCredentialsManager {
  private encryptionService = getEncryptionService();
  private db = getDatabase();

  /**
   * Store encrypted WhatsApp credentials for merchant
   */
  public async storeCredentials(
    merchantId: string,
    credentials: {
      accessToken: string;
      phoneNumberId: string;
      businessAccountId: string;
      appSecret: string;
      webhookVerifyToken: string;
    },
    ipAddress?: string
  ): Promise<void> {
    try {
      // Encrypt the access token
      const encryptedToken = this.encryptionService.encryptWhatsAppToken(
        credentials.accessToken
      );

      const sql = this.db.getSQL();
      
      const hashedToken = createHash('sha256')
        .update(credentials.webhookVerifyToken)
        .digest('hex');

      await sql`
        INSERT INTO merchant_credentials (
          merchant_id,
          whatsapp_token_encrypted,
          whatsapp_phone_number_id,
          business_account_id,
          app_secret,
          whatsapp_business_account_id,
          webhook_verify_token,
          platform,
          token_created_ip,
          last_access_ip,
          last_access_at
        ) VALUES (
          ${merchantId}::uuid,
          ${JSON.stringify(encryptedToken)},
          ${credentials.phoneNumberId},
          ${credentials.businessAccountId},
          ${credentials.appSecret},
          ${credentials.businessAccountId},
          ${hashedToken},
          'whatsapp',
          ${ipAddress || null}::inet,
          ${ipAddress || null}::inet,
          NOW()
        )
        ON CONFLICT (merchant_id, platform)
        DO UPDATE SET
          whatsapp_token_encrypted = EXCLUDED.whatsapp_token_encrypted,
          whatsapp_phone_number_id = EXCLUDED.whatsapp_phone_number_id,
          business_account_id = EXCLUDED.business_account_id,
          app_secret = EXCLUDED.app_secret,
          whatsapp_business_account_id = EXCLUDED.whatsapp_business_account_id,
          webhook_verify_token = EXCLUDED.webhook_verify_token,
          platform = EXCLUDED.platform,
          last_access_ip = EXCLUDED.last_access_ip,
          last_access_at = NOW(),
          updated_at = NOW()
      `;

      console.log(`✅ WhatsApp credentials stored for merchant: ${merchantId}`);
    } catch (error) {
      console.error('❌ Failed to store WhatsApp credentials:', error);
      throw error;
    }
  }

  /**
   * Remove WhatsApp credentials for merchant
   */
  public async removeCredentials(merchantId: string): Promise<void> {
    try {
      const sql = this.db.getSQL();
      
      await sql`
        UPDATE merchant_credentials
        SET
          whatsapp_token_encrypted = NULL,
          whatsapp_phone_number_id = NULL,
          whatsapp_business_account_id = NULL,
          business_account_id = NULL,
          app_secret = NULL,
          updated_at = NOW()
        WHERE merchant_id = ${merchantId}::uuid
      `;

      console.log(`✅ WhatsApp credentials removed for merchant: ${merchantId}`);
    } catch (error) {
      console.error('❌ Failed to remove WhatsApp credentials:', error);
      throw error;
    }
  }

  /**
   * Check if merchant has valid WhatsApp credentials
   */
  public async hasValidCredentials(merchantId: string): Promise<boolean> {
    try {
      const sql = this.db.getSQL();
      
      const result = await sql`
        SELECT whatsapp_token_encrypted
        FROM merchant_credentials
        WHERE merchant_id = ${merchantId}::uuid
        AND whatsapp_token_encrypted IS NOT NULL
      `;

      return result.length > 0;
    } catch (error) {
      console.error('❌ Failed to check WhatsApp credentials:', error);
      return false;
    }
  }

  /**
   * Get credentials info
   */
  public async getCredentialsInfo(merchantId: string): Promise<{
    hasCredentials: boolean;
    lastAccess?: Date;
    phoneNumberId?: string;
    businessAccountId?: string;
  }> {
    try {
      const sql = this.db.getSQL();
      
      const result = await sql`
        SELECT
          whatsapp_token_encrypted,
          whatsapp_phone_number_id,
          COALESCE(business_account_id, whatsapp_business_account_id) AS business_account_id,
          last_access_at
        FROM merchant_credentials
        WHERE merchant_id = ${merchantId}::uuid
      `;

      if (result.length === 0) {
        return { hasCredentials: false };
      }

      const cred = result[0];
      
      return {
        hasCredentials: !!cred.whatsapp_token_encrypted,
        lastAccess: cred.last_access_at,
        phoneNumberId: cred.whatsapp_phone_number_id,
        businessAccountId: cred.business_account_id
      };
    } catch (error) {
      console.error('❌ Failed to get credentials info:', error);
      return { hasCredentials: false };
    }
  }
}

// Singleton instances
let whatsappClientInstance: WhatsAppAPIClient | null = null;
let whatsappCredentialsManagerInstance: WhatsAppCredentialsManager | null = null;

/**
 * Get WhatsApp API client instance
 */
export function getWhatsAppClient(): WhatsAppAPIClient {
  if (!whatsappClientInstance) {
    whatsappClientInstance = new WhatsAppAPIClient();
  }
  return whatsappClientInstance;
}

/**
 * Get WhatsApp credentials manager instance
 */
export function getWhatsAppCredentialsManager(): WhatsAppCredentialsManager {
  if (!whatsappCredentialsManagerInstance) {
    whatsappCredentialsManagerInstance = new WhatsAppCredentialsManager();
  }
  return whatsappCredentialsManagerInstance;
}

export default WhatsAppAPIClient;