/**
 * ===============================================
 * Instagram API Client - Graph API Integration
 * Complete Instagram Business API integration for sales automation
 * ===============================================
 */

import { getEncryptionService } from './encryption.js';
import { getDatabase } from '../database/connection.js';
import { GRAPH_API_BASE_URL } from '../config/graph-api.js';
import { telemetry } from './telemetry.js';
import { getMetaRateLimiter } from './meta-rate-limiter.js';
import type { Platform } from '../types/database.js';
import { createHash } from 'crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { InstagramAPICredentials, SendMessageRequest } from '../types/instagram.js';
import { getLogger } from './logger.js';
export type { InstagramAPICredentials } from '../types/instagram.js';

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

function isInstagramProfile(data: unknown): data is InstagramProfile {
  if (!data || typeof data !== 'object') return false;
  const info = data as Record<string, unknown>;
  return typeof info.id === 'string' && typeof info.username === 'string';
}

export class InstagramAPIClient {
  private readonly baseUrl = GRAPH_API_BASE_URL;
  private encryptionService = getEncryptionService();
  private db = getDatabase();
  private rateLimiter = getMetaRateLimiter();
  private logger = getLogger({ component: 'InstagramAPIClient' });

  private credentials: InstagramAPICredentials | null = null;
  private merchantId: string | null = null;

  constructor() {}

  public initialize(credentials: InstagramAPICredentials, merchantId: string): void {
    this.credentials = credentials;
    this.merchantId = merchantId;
  }

  /**
   * Unified Graph API request with Redis sliding-window rate limiting
   */
  public async graphRequest<T>(
    method: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH',
    path: string,
    accessToken: string,
    body: Record<string, any> | undefined,
    merchantId: string,
    returnResponse?: true
  ): Promise<Response>;
  public async graphRequest<T>(
    method: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH',
    path: string,
    accessToken: string,
    body: Record<string, any> | undefined,
    merchantId: string,
    returnResponse?: false
  ): Promise<T>;
  public async graphRequest<T>(
    method: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH',
    path: string,
    accessToken: string,
    body: Record<string, any> | undefined,
    merchantId: string,
    returnResponse: boolean = false
  ): Promise<T | Response> {
    if (!merchantId) {
      throw Object.assign(new Error('MERCHANT_ID is required'), {
        code: 'MERCHANT_ID_MISSING'
      });
    }
    const windowMs = 60_000;         // 1 دقيقة
    const maxRequests = 90;          // حد لكل تاجر/دقيقة (عدّله كما يلزم)
    const rateKey = `ig:${merchantId}:${method}:${path}`;

    // ✅ فحص المعدّل قبل الإرسال
    let check: { allowed: boolean; remaining: number; resetTime: number };
    try {
      check = await this.rateLimiter.checkRedisRateLimit(rateKey, windowMs, maxRequests);
    } catch (error) {
      this.logger.warn(
        `⚠️ Redis rate limit check failed for ${rateKey}:`,
        { err: error }
      );
      telemetry.recordRateLimitStoreFailure('instagram', path);
      check = { allowed: true, remaining: maxRequests, resetTime: Date.now() + windowMs };
    }
    if (!check.allowed) {
      throw Object.assign(new Error('RATE_LIMIT_EXCEEDED'), {
        resetTime: check.resetTime,
        remaining: check.remaining,
        code: 'RATE_LIMIT_EXCEEDED'
      });
    }

      const url = `${GRAPH_API_BASE_URL}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const start = Date.now();
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      const latency = Date.now() - start;
      telemetry.recordMetaRequest('instagram', path, res.status, latency, res.status === 429);

      // اختياري: قراءة رؤوس فيسبوك الخاصة بالاستهلاك (إن وُجدت) لتسجيلها
      const appUsage = res.headers.get('x-app-usage');
      const pageUsage = res.headers.get('x-page-usage');
      if (appUsage || pageUsage) {
        this.logger.info(`📊 Graph API usage - App: ${appUsage}, Page: ${pageUsage}`);
      }

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        const e = new Error(`IG Graph error ${res.status}: ${errBody}`);
        (e as any).status = res.status;
        throw e;
      }

      return returnResponse ? res : (res.json() as Promise<T>);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Send text message to Instagram user
   */
  public async sendMessage(
    credentials: InstagramAPICredentials,
    merchantId: string,
    request: SendMessageRequest
  ): Promise<InstagramAPIResponse> {
    try {
      const payload = this.buildMessagePayload(request);

      const response = await this.graphRequest<Response>(
        'POST',
        `/${credentials.businessAccountId}/messages`,
        credentials.pageAccessToken,
        payload,
        merchantId,
        true
      );

      const rateLimitRemaining =
        this.parseRateLimitHeaders(response) ?? 200;
      const result: any = await response.json();

      return {
        success: true,
        messageId: result.message_id,
        rateLimitRemaining
      };
    } catch (error) {
      this.logger.error('❌ Instagram message send failed:', error);
      const status = typeof (error as any)?.status === 'number'
        ? (error as any).status
        : 500;
      const message = typeof (error as any)?.message === 'string'
        ? (error as any).message
        : 'Unknown error';
      return {
        success: false,
        error: {
          code: status,
          message,
          type: status >= 400 && status < 500 ? 'API_ERROR' : 'NETWORK_ERROR'
        }
      };
    }
  }



  /**
   * Upload media to Instagram and return media_id
   */
  public async uploadMedia(
    mediaPath: string,
    mediaType: 'image' | 'video' | 'audio'
  ): Promise<string> {
    if (!this.credentials) {
      throw new Error('Instagram API not initialized');
    }

    const stats = await fs.stat(mediaPath);
    const ext = path.extname(mediaPath).toLowerCase();

    const typeConfig: Record<string, { exts: string[]; max: number }> = {
      image: { exts: ['.jpg', '.jpeg', '.png', '.gif'], max: 8 * 1024 * 1024 },
      video: { exts: ['.mp4', '.mov'], max: 50 * 1024 * 1024 },
      audio: { exts: ['.mp3', '.aac', '.wav'], max: 25 * 1024 * 1024 }
    };

    const config = typeConfig[mediaType];
    if (!config.exts.includes(ext)) {
      throw new Error(`Unsupported ${mediaType} format: ${ext}`);
    }

    if (stats.size > config.max) {
      throw new Error(
        `${mediaType} exceeds ${(config.max / 1024 / 1024).toFixed(0)}MB limit`
      );
    }

    const fileBuffer = await fs.readFile(mediaPath);
    const form = new FormData();
    form.append('file', new Blob([fileBuffer]), path.basename(mediaPath));
    form.append('media_type', mediaType);

    const uploadUrl = `${GRAPH_API_BASE_URL}/${this.credentials.businessAccountId}/media?access_token=${encodeURIComponent(
      this.credentials.pageAccessToken
    )}`;

    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: form
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(errText);
    }

    const data: any = await response.json().catch(() => ({}));
    return data.id || data.media_id || data.attachment_id || data.mediaId;
  }

  /**
   * Send image message
   */
  public async sendImageMessage(
    credentials: InstagramAPICredentials,
    merchantId: string,
    recipientId: string,
    imageUrl: string,
    caption?: string
  ): Promise<InstagramAPIResponse> {
    return this.sendMessage(credentials, merchantId, {
      recipientId,
      messageType: 'image',
      content: caption || '',
      attachment: { type: 'image', payload: { url: imageUrl } }
    });
  }

  /**
   * Reply to comment (invites to DM)
   */
  public async replyToComment(
    credentials: InstagramAPICredentials,
    merchantId: string,
    commentId: string, 
    message: string
  ): Promise<InstagramAPIResponse> {
    try {
      const payload = {
        message: message
      };

      const result: any = await this.graphRequest<any>(
        'POST',
        `/${commentId}/replies`,
        credentials.pageAccessToken,
        payload,
        merchantId
      );

      return {
        success: true,
        messageId: result.id
      };
    } catch (error) {
      this.logger.error('❌ Instagram comment reply failed:', error);
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
  public async getUserProfile(
    credentials: InstagramAPICredentials,
    merchantId: string,
    userId: string
  ): Promise<InstagramProfile | null> {
    try {
      const res = await this.graphRequest(
        'GET',
        `/${userId}?fields=id,username,name,profile_picture_url,followers_count,media_count,biography`,
        credentials.pageAccessToken,
        undefined,
        merchantId,
        true
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Instagram API error ${res.status}: ${text}`);
      }
      const data = await res.json();
      if (!isInstagramProfile(data)) {
        throw new Error('Invalid profile response');
      }
      return data;
    } catch (error) {
      this.logger.error('❌ Get user profile failed:', error);
      return null;
    }
  }

  /**
   * Validate webhook signature
   */
  public async validateWebhookSignature(
    appSecret: string,
    signature: string, 
    payload: string
  ): Promise<boolean> {
    try {
      const crypto = await import('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', appSecret)
        .update(payload)
        .digest('hex');

      const receivedSignature = signature.replace('sha256=', '');
      const isHex = /^[0-9a-f]+$/i;
      if (
        receivedSignature.length !== expectedSignature.length ||
        !isHex.test(receivedSignature) ||
        !isHex.test(expectedSignature)
      ) {
        this.logger.warn('⚠️ Invalid webhook signature length or format');
        return false;
      }

      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(receivedSignature, 'hex')
      );
    } catch (error) {
      this.logger.error('❌ Webhook signature validation failed:', error);
      return false;
    }
  }

  /**
   * Subscribe to webhook events
   */
  public async subscribeToWebhooks(
    credentials: InstagramAPICredentials,
    merchantId: string,
    webhookUrl: string
  ): Promise<boolean> {
    try {
      const payload = {
        subscribed_fields: 'messages,messaging_postbacks,comments,mentions',
        callback_url: webhookUrl,
        verify_token: credentials.webhookVerifyToken
      };

      const result: any = await this.graphRequest<any>(
        'POST',
        `/${credentials.pageId}/subscribed_apps`,
        credentials.pageAccessToken,
        payload,
        merchantId
      );

      this.logger.info('✅ Instagram webhook subscribed successfully');
      return true;
    } catch (error) {
      this.logger.error('❌ Webhook subscription error:', error);
      return false;
    }
  }

  /**
   * Get Instagram business account info
   */
  public async getBusinessAccountInfo(
    credentials: InstagramAPICredentials,
    merchantId: string
  ): Promise<any> {
    try {
      return await this.graphRequest<any>(
        'GET',
        `/${credentials.businessAccountId}?fields=id,username,name,profile_picture_url,followers_count,media_count`,
        credentials.pageAccessToken,
        undefined,
        merchantId
      );
    } catch (error) {
      this.logger.error('❌ Get business account info failed:', error);
      throw error;
    }
  }

  /**
   * Check API health and rate limits
   */
  public async healthCheck(
    credentials: InstagramAPICredentials | null,
    merchantId: string
  ): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    rateLimitRemaining: number;
    businessAccountId: string;
    lastChecked: Date;
  }> {
    try {
      if (!credentials) {
        return {
          status: 'unhealthy',
          rateLimitRemaining: 0,
          businessAccountId: 'not_initialized',
          lastChecked: new Date()
        };
      }

      const accountInfo = await this.getBusinessAccountInfo(credentials, merchantId);

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
        businessAccountId: credentials?.businessAccountId || 'unknown',
        lastChecked: new Date()
      };
    }
  }

  /**
   * Private: Load merchant credentials from database
   */
  public async loadMerchantCredentials(merchantId: string): Promise<InstagramAPICredentials | null> {
    try {
      const sql = this.db.getSQL();
      
      const credentials = await sql`
        SELECT
          instagram_token_encrypted,
          instagram_page_id,
          webhook_verify_token,
          COALESCE(business_account_id, instagram_business_account_id) AS business_account_id,
          app_secret
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
        businessAccountId: cred.business_account_id || '',
        pageAccessToken: decryptedToken,
        pageId: cred.instagram_page_id || '',
        webhookVerifyToken: cred.webhook_verify_token || '',
        appSecret: cred.app_secret || ''
      };
    } catch (error) {
      this.logger.error('❌ Failed to load merchant credentials:', error);
      return null;
    }
  }

  /**
   * Validate API credentials
   */
  public async validateCredentials(
    credentials: InstagramAPICredentials,
    merchantId: string
  ): Promise<void> {
    try {
      await this.getBusinessAccountInfo(credentials, merchantId);
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
          text: request.content || undefined,
          quick_replies: request.quickReplies
        }
      };
    }

    if (request.messageType === 'template') {
      return {
        ...basePayload,
        message: {
          attachment: {
            type: 'template',
            payload: JSON.parse(request.content)
          }
        }
      };
    }

    return {
      ...basePayload,
      message: {
        text: request.content,
        quick_replies: request.quickReplies
      }
    };
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
export class InstagramAPICredentialsManager {
  private encryptionService = getEncryptionService();
  private db = getDatabase();
  private logger = getLogger({ component: 'InstagramAPICredentialsManager' });

  /**
   * Store encrypted Instagram credentials for merchant
   */
  public async storeCredentials(
    merchantId: string,
    credentials: {
      pageAccessToken: string;
      businessAccountId: string;
      pageId: string;
      appSecret: string;
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
      
      const hashedToken = createHash('sha256')
        .update(credentials.webhookVerifyToken)
        .digest('hex');

      await sql`
        INSERT INTO merchant_credentials (
          merchant_id,
          instagram_token_encrypted,
          instagram_page_id,
          business_account_id,
          app_secret,
          instagram_business_account_id,
          webhook_verify_token,
          platform,
          token_created_ip,
          last_access_ip,
          last_access_at
        ) VALUES (
          ${merchantId}::uuid,
          ${JSON.stringify(encryptedToken)},
          ${credentials.pageId},
          ${credentials.businessAccountId},
          ${credentials.appSecret},
          ${credentials.businessAccountId},
          ${hashedToken},
          'instagram',
          ${ipAddress || null}::inet,
          ${ipAddress || null}::inet,
          NOW()
        )
        ON CONFLICT (merchant_id, platform)
        DO UPDATE SET
          instagram_token_encrypted = EXCLUDED.instagram_token_encrypted,
          instagram_page_id = EXCLUDED.instagram_page_id,
          business_account_id = EXCLUDED.business_account_id,
          app_secret = EXCLUDED.app_secret,
          instagram_business_account_id = EXCLUDED.instagram_business_account_id,
          webhook_verify_token = EXCLUDED.webhook_verify_token,
          platform = EXCLUDED.platform,
          last_access_ip = EXCLUDED.last_access_ip,
          last_access_at = NOW(),
          updated_at = NOW()
      `;

      this.logger.info(`✅ Instagram credentials stored for merchant: ${merchantId}`);
    } catch (error) {
      this.logger.error('❌ Failed to store Instagram credentials:', error);
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
          business_account_id = NULL,
          app_secret = NULL,
          instagram_business_account_id = NULL,
          updated_at = NOW()
        WHERE merchant_id = ${merchantId}::uuid
      `;

      this.logger.info(`✅ Instagram credentials removed for merchant: ${merchantId}`);
      const { getInstagramStoriesManager } = await import('./instagram-stories-manager.js');
      getInstagramStoriesManager().clearMerchantClient(merchantId);
      clearInstagramClient(merchantId);
    } catch (error) {
      this.logger.error('❌ Failed to remove Instagram credentials:', error);
      throw error;
    }
  }

  /**
   * Check if merchant has valid Instagram credentials
   */
  public async hasValidCredentials(merchantId: string): Promise<boolean> {
    try {
      const sql = this.db.getSQL();
      
      const result: any[] = await sql`
        SELECT instagram_token_encrypted
        FROM merchant_credentials
        WHERE merchant_id = ${merchantId}::uuid
        AND instagram_token_encrypted IS NOT NULL
      `;

      return result.length > 0;
    } catch (error) {
      this.logger.error('❌ Failed to check Instagram credentials:', error);
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
      
      const result: any[] = await sql`
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
        lastAccess: cred.last_access_at ? new Date(cred.last_access_at) : undefined,
        pageId: cred.instagram_page_id ?? undefined
      };
    } catch (error) {
      this.logger.error('❌ Failed to get credentials info:', error);
      return { hasCredentials: false };
    }
  }
}

// Singleton instances
const instagramClients = new Map<string, InstagramAPIClient>();
let credentialsManagerInstance: InstagramAPICredentialsManager | null = null;

/**
 * Get Instagram API client instance for a merchant
 */
export function getInstagramClient(merchantId: string): InstagramAPIClient {
  let client = instagramClients.get(merchantId);
  if (!client) {
    client = new InstagramAPIClient();
    instagramClients.set(merchantId, client);
  }
  return client;
}

export function clearInstagramClient(merchantId: string): void {
  instagramClients.delete(merchantId);
}

/**
 * Get credentials manager instance
 */
export function getInstagramAPICredentialsManager(): InstagramAPICredentialsManager {
  if (!credentialsManagerInstance) {
    credentialsManagerInstance = new InstagramAPICredentialsManager();
  }
  return credentialsManagerInstance;
}

export default InstagramAPIClient;
