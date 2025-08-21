/**
 * ===============================================
 * Instagram API Client - Graph API Integration
 * Complete Instagram Business API integration for sales automation
 * ===============================================
 */

import { getEncryptionService } from './encryption.js';
import { getDatabase } from '../database/connection.js';
import { GRAPH_API_BASE_URL } from '../config/graph-api.js';
import { getMetaRateLimiter } from './meta-rate-limiter.js';
import type { Platform } from '../types/database.js';
import { telemetry } from './telemetry.js';

export interface InstagramCredentials {
  businessAccountId: string;
  pageAccessToken: string;
  pageId: string;
  webhookVerifyToken: string;
  appSecret: string;
  scopes?: string[]; // OAuth scopes granted
  tokenExpiresAt?: Date;
}

export interface InstagramOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  requiredScopes: string[];
}

export interface InstagramMessage {
  id: string;
  from: {
    id: string;
    username?: string;
  };
  to: {
    id: string;
  };
  message: {
    text?: string;
    attachments?: InstagramAttachment[];
  };
  timestamp: string;
  platform: 'instagram';
}

export interface InstagramAttachment {
  type: 'image' | 'video' | 'audio' | 'file';
  payload: {
    url: string;
    is_reusable?: boolean;
  };
}

export interface InstagramComment {
  id: string;
  from: {
    id: string;
    username: string;
  };
  message: string;
  created_time: string;
  media_id: string;
  parent_id?: string;
}

export interface InstagramStoryMention {
  id: string;
  from: {
    id: string;
    username: string;
  };
  story_id: string;
  media_url?: string;
  timestamp: string;
}

export interface SendMessageRequest {
  recipientId: string;
  messageType: 'text' | 'image' | 'template';
  content: string;
  imageUrl?: string;
  quickReplies?: QuickReply[];
}

export interface QuickReply {
  content_type: 'text';
  title: string;
  payload: string;
}

export interface InstagramAPIResponse {
  success: boolean;
  messageId?: string;
  error?: {
    code: number;
    message: string;
    type: string;
  };
  rateLimitRemaining?: number;
}

export interface InstagramProfile {
  id: string;
  username: string;
  name?: string;
  profile_picture_url?: string;
  followers_count?: number;
  media_count?: number;
  biography?: string;
}

export class InstagramAPIClient {
  private readonly baseUrl = GRAPH_API_BASE_URL;
  private credentials: InstagramCredentials | null = null;
  private merchantId: string | null = null;
  private encryptionService = getEncryptionService();
  private db = getDatabase();
  private rateLimiter = getMetaRateLimiter();

  constructor() {}

  /**
   * Unified Graph API request with Redis sliding-window rate limiting
   */
  private async graphRequest<T>(
    method: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH',
    path: string,
    accessToken: string,
    body: Record<string, any> | undefined,
    merchantId: string
  ): Promise<T> {
    if (!merchantId) {
      throw Object.assign(new Error('MERCHANT_ID is required'), {
        code: 'MERCHANT_ID_MISSING'
      });
    }
    const windowMs = 60_000;         // 1 دقيقة
    const maxRequests = 90;          // حد لكل تاجر/دقيقة (عدّله كما يلزم)
    const rateKey = `ig:${merchantId}:${method}:${path}`;

    // ✅ فحص المعدّل قبل الإرسال
      const check = await this.rateLimiter.checkRedisRateLimit(rateKey, windowMs, maxRequests);
    if (!check.allowed) {
      throw Object.assign(new Error('RATE_LIMIT_EXCEEDED'), {
        resetTime: check.resetTime,
        remaining: check.remaining,
        code: 'RATE_LIMIT_EXCEEDED'
      });
    }

      const url = `${GRAPH_API_BASE_URL}${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(accessToken)}`;
    const start = Date.now();
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });

    const latency = Date.now() - start;
    telemetry.recordMetaRequest('instagram', path, res.status, latency, res.status === 429);

    // اختياري: قراءة رؤوس فيسبوك الخاصة بالاستهلاك (إن وُجدت) لتسجيلها
    const appUsage = res.headers.get('x-app-usage');
    const pageUsage = res.headers.get('x-page-usage');
    if (appUsage || pageUsage) {
      console.log(`📊 Graph API usage - App: ${appUsage}, Page: ${pageUsage}`);
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      const e = new Error(`IG Graph error ${res.status}: ${errBody}`);
      (e as any).status = res.status;
      throw e;
    }

    return res.json() as Promise<T>;
  }

  /**
   * Initialize with merchant credentials
   */
  public async initialize(merchantId: string): Promise<void> {
    try {
      this.credentials = await this.loadMerchantCredentials(merchantId);
      this.merchantId = merchantId;

      if (!this.credentials) {
        throw new Error(`Instagram credentials not found for merchant: ${merchantId}`);
      }

      // Validate credentials
      await this.validateCredentials();
      
      console.log(`✅ Instagram API initialized for merchant: ${merchantId}`);
    } catch (error) {
      console.error('❌ Instagram API initialization failed:', error);
      throw error;
    }
  }

  /**
   * Send text message to Instagram user
   */
  public async sendMessage(request: SendMessageRequest): Promise<InstagramAPIResponse> {
    try {
      if (!this.credentials || !this.merchantId) {
        throw new Error('Instagram API not initialized');
      }

      const payload = this.buildMessagePayload(request);
      
      const result = await this.graphRequest<any>(
        'POST',
        `/${this.credentials.businessAccountId}/messages`,
        this.credentials.pageAccessToken,
        payload,
        this.merchantId
      );

      return {
        success: true,
        messageId: result.message_id,
        rateLimitRemaining: 200 // Default rate limit
      };
    } catch (error) {
      console.error('❌ Instagram message send failed:', error);
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
   * Send image message
   */
  public async sendImageMessage(
    recipientId: string, 
    imageUrl: string, 
    caption?: string
  ): Promise<InstagramAPIResponse> {
    return this.sendMessage({
      recipientId,
      messageType: 'image',
      content: caption || '',
      imageUrl
    });
  }

  /**
   * Reply to comment (invites to DM)
   */
  public async replyToComment(
    commentId: string, 
    message: string
  ): Promise<InstagramAPIResponse> {
    try {
      if (!this.credentials || !this.merchantId) {
        throw new Error('Instagram API not initialized');
      }

      const payload = {
        message: message
      };

      const result = await this.graphRequest<any>(
        'POST',
        `/${commentId}/replies`,
        this.credentials.pageAccessToken,
        payload,
        this.merchantId
      );

      return {
        success: true,
        messageId: result.id
      };
    } catch (error) {
      console.error('❌ Instagram comment reply failed:', error);
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
   * Get user profile information
   */
  public async getUserProfile(userId: string): Promise<InstagramProfile | null> {
    try {
      if (!this.credentials || !this.merchantId) {
        throw new Error('Instagram API not initialized');
      }

      const result = await this.graphRequest<InstagramProfile>(
        'GET',
        `/${userId}?fields=id,username,name,profile_picture_url,followers_count,media_count,biography`,
        this.credentials.pageAccessToken,
        undefined,
        this.merchantId
      );
      
      return result;
    } catch (error) {
      console.error('❌ Get user profile failed:', error);
      return null;
    }
  }

  /**
   * Validate webhook signature
   */
  public async validateWebhookSignature(
    signature: string, 
    payload: string
  ): Promise<boolean> {
    try {
      if (!this.credentials) {
        return false;
      }

      const crypto = await import('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', this.credentials.appSecret)
        .update(payload)
        .digest('hex');

      const receivedSignature = signature.replace('sha256=', '');
      const isHex = /^[0-9a-f]+$/i;
      if (
        receivedSignature.length !== expectedSignature.length ||
        !isHex.test(receivedSignature) ||
        !isHex.test(expectedSignature)
      ) {
        console.warn('⚠️ Invalid webhook signature length or format');
        return false;
      }

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
   * Subscribe to webhook events
   */
  public async subscribeToWebhooks(webhookUrl: string): Promise<boolean> {
    try {
      if (!this.credentials || !this.merchantId) {
        throw new Error('Instagram API not initialized');
      }

      const payload = {
        subscribed_fields: 'messages,messaging_postbacks,comments,mentions',
        callback_url: webhookUrl,
        verify_token: this.credentials.webhookVerifyToken
      };

      const result = await this.graphRequest<any>(
        'POST',
        `/${this.credentials.pageId}/subscribed_apps`,
        this.credentials.pageAccessToken,
        payload,
        this.merchantId
      );

      console.log('✅ Instagram webhook subscribed successfully');
      return true;
    } catch (error) {
      console.error('❌ Webhook subscription error:', error);
      return false;
    }
  }

  /**
   * Get Instagram business account info
   */
  public async getBusinessAccountInfo(): Promise<any> {
    try {
      if (!this.credentials || !this.merchantId) {
        throw new Error('Instagram API not initialized');
      }

      return await this.graphRequest<any>(
        'GET',
        `/${this.credentials.businessAccountId}?fields=id,username,name,profile_picture_url,followers_count,media_count`,
        this.credentials.pageAccessToken,
        undefined,
        this.merchantId
      );
    } catch (error) {
      console.error('❌ Get business account info failed:', error);
      throw error;
    }
  }

  /**
   * Check API health and rate limits
   */
  public async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    rateLimitRemaining: number;
    businessAccountId: string;
    lastChecked: Date;
  }> {
    try {
      if (!this.credentials) {
        return {
          status: 'unhealthy',
          rateLimitRemaining: 0,
          businessAccountId: 'not_initialized',
          lastChecked: new Date()
        };
      }

      const accountInfo = await this.getBusinessAccountInfo();
      
      return {
        status: 'healthy',
        rateLimitRemaining: 200, // Default rate limit
        businessAccountId: accountInfo.id,
        lastChecked: new Date()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        rateLimitRemaining: 0,
        businessAccountId: this.credentials?.businessAccountId || 'unknown',
        lastChecked: new Date()
      };
    }
  }

  /**
   * Private: Load merchant credentials from database
   */
  private async loadMerchantCredentials(merchantId: string): Promise<InstagramCredentials | null> {
    try {
      const sql = this.db.getSQL();
      
      const credentials = await sql`
        SELECT 
          instagram_token_encrypted,
          instagram_page_id,
          webhook_verify_token
        FROM merchant_credentials
        WHERE merchant_id = ${merchantId}::uuid
      `;

      if (credentials.length === 0) {
        return null;
      }

      const cred = credentials[0];
      
      if (!cred.instagram_token_encrypted) {
        return null;
      }

      // Decrypt the token
      const decryptedToken = this.encryptionService.decryptInstagramToken(
        cred.instagram_token_encrypted
      );

      return {
        businessAccountId: process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || '',
        pageAccessToken: decryptedToken,
        pageId: cred.instagram_page_id || '',
        webhookVerifyToken: cred.webhook_verify_token || '',
        appSecret: process.env.INSTAGRAM_APP_SECRET || ''
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
      await this.getBusinessAccountInfo();
    } catch (error) {
      throw new Error(`Invalid Instagram credentials: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Private: Build message payload for API
   */
  private buildMessagePayload(request: SendMessageRequest): any {
    const basePayload = {
      recipient: {
        id: request.recipientId
      },
      messaging_type: 'RESPONSE' // Within 24h window
    };

    if (request.attachment) {
      return {
        ...basePayload,
        message: {
          attachment: request.attachment,
          text: request.content || undefined
        }
      };
    }

    switch (request.messageType) {
      case 'text':
        return {
          ...basePayload,
          message: {
            text: request.content,
            quick_replies: request.quickReplies
          }
        };

      case 'image':
        return {
          ...basePayload,
          message: {
            attachment: {
              type: 'image',
              payload: request.attachmentId
                ? { attachment_id: request.attachmentId }
                : { url: request.imageUrl, is_reusable: true }
            },
            text: request.content || undefined
          }
        };

      case 'template':
        return {
          ...basePayload,
          message: {
            attachment: {
              type: 'template',
              payload: JSON.parse(request.content)
            }
          }
        };

      default:
        throw new Error(`Unsupported message type: ${request.messageType}`);
    }
  }

  /**
   * Private: Parse rate limit from response headers
   */
  private parseRateLimitHeaders(response: Response): number {
    const remaining = response.headers.get('X-App-Usage');
    if (remaining) {
      try {
        const usage = JSON.parse(remaining);
        return Math.max(0, 100 - (usage.call_count || 0));
      } catch {
        return 100; // Default
      }
    }
    return 100;
  }
}

/**
 * Instagram Credentials Manager
 */
export class InstagramCredentialsManager {
  private encryptionService = getEncryptionService();
  private db = getDatabase();

  /**
   * Store encrypted Instagram credentials for merchant
   */
  public async storeCredentials(
    merchantId: string,
    credentials: {
      pageAccessToken: string;
      businessAccountId: string;
      pageId: string;
      webhookVerifyToken: string;
    },
    ipAddress?: string
  ): Promise<void> {
    try {
      // Encrypt the access token
      const encryptedToken = this.encryptionService.encryptInstagramToken(
        credentials.pageAccessToken
      );

      const sql = this.db.getSQL();
      
      await sql`
        INSERT INTO merchant_credentials (
          merchant_id,
          instagram_token_encrypted,
          instagram_page_id,
          webhook_verify_token,
          token_created_ip,
          last_access_ip,
          last_access_at
        ) VALUES (
          ${merchantId}::uuid,
          ${JSON.stringify(encryptedToken)},
          ${credentials.pageId},
          ${credentials.webhookVerifyToken},
          ${ipAddress || null}::inet,
          ${ipAddress || null}::inet,
          NOW()
        )
        ON CONFLICT (merchant_id)
        DO UPDATE SET
          instagram_token_encrypted = EXCLUDED.instagram_token_encrypted,
          instagram_page_id = EXCLUDED.instagram_page_id,
          webhook_verify_token = EXCLUDED.webhook_verify_token,
          last_access_ip = EXCLUDED.last_access_ip,
          last_access_at = NOW(),
          updated_at = NOW()
      `;

      console.log(`✅ Instagram credentials stored for merchant: ${merchantId}`);
    } catch (error) {
      console.error('❌ Failed to store Instagram credentials:', error);
      throw error;
    }
  }

  /**
   * Remove Instagram credentials for merchant
   */
  public async removeCredentials(merchantId: string): Promise<void> {
    try {
      const sql = this.db.getSQL();
      
      await sql`
        UPDATE merchant_credentials
        SET 
          instagram_token_encrypted = NULL,
          instagram_page_id = NULL,
          updated_at = NOW()
        WHERE merchant_id = ${merchantId}::uuid
      `;

      console.log(`✅ Instagram credentials removed for merchant: ${merchantId}`);
      const { getInstagramStoriesManager } = await import('./instagram-stories-manager.js');
      getInstagramStoriesManager().clearMerchantClient(merchantId);
    } catch (error) {
      console.error('❌ Failed to remove Instagram credentials:', error);
      throw error;
    }
  }

  /**
   * Check if merchant has valid Instagram credentials
   */
  public async hasValidCredentials(merchantId: string): Promise<boolean> {
    try {
      const sql = this.db.getSQL();
      
      const result = await sql`
        SELECT instagram_token_encrypted
        FROM merchant_credentials
        WHERE merchant_id = ${merchantId}::uuid
        AND instagram_token_encrypted IS NOT NULL
      `;

      return result.length > 0;
    } catch (error) {
      console.error('❌ Failed to check Instagram credentials:', error);
      return false;
    }
  }

  /**
   * Get credentials expiry info
   */
  public async getCredentialsInfo(merchantId: string): Promise<{
    hasCredentials: boolean;
    lastAccess?: Date;
    pageId?: string;
  }> {
    try {
      const sql = this.db.getSQL();
      
      const result = await sql`
        SELECT 
          instagram_token_encrypted,
          instagram_page_id,
          last_access_at
        FROM merchant_credentials
        WHERE merchant_id = ${merchantId}::uuid
      `;

      if (result.length === 0) {
        return { hasCredentials: false };
      }

      const cred = result[0];
      
      return {
        hasCredentials: !!cred.instagram_token_encrypted,
        lastAccess: cred.last_access_at,
        pageId: cred.instagram_page_id
      };
    } catch (error) {
      console.error('❌ Failed to get credentials info:', error);
      return { hasCredentials: false };
    }
  }
}

// Singleton instances
let instagramClientInstance: InstagramAPIClient | null = null;
let credentialsManagerInstance: InstagramCredentialsManager | null = null;

/**
 * Get Instagram API client instance
 */
export function getInstagramClient(): InstagramAPIClient {
  if (!instagramClientInstance) {
    instagramClientInstance = new InstagramAPIClient();
  }
  return instagramClientInstance;
}

/**
 * Get credentials manager instance
 */
export function getInstagramCredentialsManager(): InstagramCredentialsManager {
  if (!credentialsManagerInstance) {
    credentialsManagerInstance = new InstagramCredentialsManager();
  }
  return credentialsManagerInstance;
}

export default InstagramAPIClient;