/**
 * ===============================================
 * Instagram API Client - Graph API Integration
 * Complete Instagram Business API integration for sales automation
 * ===============================================
 */



import { GRAPH_API_BASE_URL } from '../config/graph-api.js';
import { telemetry } from './telemetry.js';
import { createHash } from 'crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {

  InstagramAPIResponse,
  InstagramAPICredentials,
  SendMessageRequest
} from '../types/instagram.js';
import type { DIContainer } from '../container/index.js';

import type EncryptionService from './encryption.js';
import type Logger from './logger.js';
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
    url?: string;
    attachment_id?: string;
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
  private encryptionService!: EncryptionService;
  private logger: Logger;

  private credentials: InstagramAPICredentials | null = null;
  // removed unused fields

  constructor(container: DIContainer) {
    this.logger = container.get('logger');
    
    this.initializeDependencies();
  }

  private async initializeDependencies(): Promise<void> {
    try {
      const { getEncryptionService } = await import('./encryption.js');
      this.encryptionService = getEncryptionService();
    } catch (error: unknown) {
      this.logger.error('Failed to initialize InstagramAPIClient dependencies:', error);
      throw error;
    }
  }

  public initialize(credentials: InstagramAPICredentials, _merchantId: string): void {
    this.credentials = credentials;
    // removed unused assignment
  }

  /**
   * Unified Graph API request with Redis sliding-window rate limiting
   */
  public async graphRequest<T>(
    method: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH',
    path: string,
    accessToken: string,
    body: Record<string, unknown> | undefined,
    merchantId: string,
    returnResponse?: true
  ): Promise<Response>;
  public async graphRequest<T>(
    method: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH',
    path: string,
    accessToken: string,
    body: Record<string, unknown> | undefined,
    merchantId: string,
    returnResponse?: false
  ): Promise<T>;
  public async graphRequest<T>(
    method: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH',
    path: string,
    accessToken: string,
    body: Record<string, unknown> | undefined,
    merchantId: string,
    returnResponse: boolean = false
  ): Promise<T | Response> {
    if (!merchantId) {
      throw Object.assign(new Error('MERCHANT_ID is required'), {
        code: 'MERCHANT_ID_MISSING'
      });
    }
    // Rate limiting disabled for ManyChat flow

    const url = `${GRAPH_API_BASE_URL}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const start = Date.now();
    try {
      const init: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        signal: controller.signal
      };
      if (body !== undefined) {
        (init as Record<string, unknown>).body = JSON.stringify(body);
      }
      const res = await fetch(url, init);

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
        const err = new Error(`IG Graph error ${res.status}: ${errBody}`) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }

      return returnResponse ? res : await res.json() as T;
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
        (credentials.accessToken || credentials.pageAccessToken)!,
        payload,
        merchantId,
        true
      );

      const result = (await response.json()) as { message_id?: string };

      const out: InstagramAPIResponse = {
        success: true,
        ...(result.message_id ? { id: result.message_id } : {})
      };
      return out;
    } catch (error) {
      this.logger.error('❌ Instagram message send failed:', error);
      const status = typeof (error as { status?: unknown })?.status === 'number'
        ? (error as { status?: number }).status!
        : 500;
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: JSON.stringify({ code: status, message, type: status >= 400 && status < 500 ? 'API_ERROR' : 'NETWORK_ERROR' })
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
    if (!config || !config.exts.includes(ext)) {
      throw new Error(`Unsupported ${mediaType} format: ${ext}`);
    }

    if (!config) throw new Error('Missing media config');
    if (stats.size > config.max) {
      throw new Error(
        `${mediaType} exceeds ${(config.max / 1024 / 1024).toFixed(0)}MB limit`
      );
    }

    const fileBuffer = await fs.readFile(mediaPath);
    const form = new FormData();
    // Use Uint8Array to avoid unsafe casting
    form.append('file', new Blob([new Uint8Array(fileBuffer)]), path.basename(mediaPath));
    form.append('media_type', mediaType);

    const uploadUrl = `${GRAPH_API_BASE_URL}/${this.credentials.businessAccountId}/media?access_token=${encodeURIComponent(
      (this.credentials.accessToken || this.credentials.pageAccessToken)!
    )}`;

    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: form
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(errText);
    }

    const data = await response.json().catch<Partial<Record<'id'|'media_id'|'attachment_id'|'mediaId', string>>>(() => ({}));
    const d = data as Record<string, unknown>;
    return String(
      (d['id'] ??
       d['media_id'] ??
       d['attachment_id'] ??
       (d['mediaId'] as string | undefined)) ?? ''
    );
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
        messagingType: 'RESPONSE',
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

      const result = await this.graphRequest<{ id: string }>(
        'POST',
        `/${commentId}/replies`,
        (credentials.accessToken || credentials.pageAccessToken)!,
        payload,
        merchantId
      );

      return {
        success: true,
        ...(result && typeof result === 'object' && 'id' in result ? { id: String((result as { id: string }).id) } : {})
      };
    } catch (error) {
      this.logger.error('❌ Instagram comment reply failed:', error);
      return {
        success: false,
        error: JSON.stringify({ code: 500, message: error instanceof Error ? error.message : 'Unknown error', type: 'NETWORK_ERROR' })
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
        (credentials.accessToken || credentials.pageAccessToken)!,
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

      await this.graphRequest<{ success?: boolean }>(
        'POST',
        `/${credentials.pageId}/subscribed_apps`,
        (credentials.accessToken || credentials.pageAccessToken)!,
        payload,
        merchantId
      );

      this.logger.info('✅ Instagram webhook subscribed successfully');
      return true;
    } catch (error: unknown) {
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
  ): Promise<{ id: string; username?: string; name?: string; profile_picture_url?: string; followers_count?: number; media_count?: number }> {
    try {
      const response = await this.graphRequest(
        'GET',
        `/${credentials.businessAccountId}?fields=id,username,name,profile_picture_url,followers_count,media_count`,
        (credentials.accessToken || credentials.pageAccessToken)!,
        undefined,
        merchantId,
        true
      );
      
      const data = await response.json();
      return data as { id: string; username?: string; name?: string; profile_picture_url?: string; followers_count?: number; media_count?: number };
    } catch (error: unknown) {
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
    } catch (error: unknown) {
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
      // Use pool directly for SQL operations
      const { getDatabase } = await import('../db/adapter.js');
      const sql = getDatabase().getSQL();
      
      type CredRow = {
        instagram_token_encrypted: string | null;
        instagram_page_id: string | null;
        webhook_verify_token: string | null;
        business_account_id: string | null;
        app_secret: string | null;
        [key: string]: unknown;
      };
      const credentials = await sql<CredRow>`
        SELECT
          instagram_token_encrypted,
          instagram_page_id,
          webhook_verify_token,
          COALESCE(business_account_id, instagram_business_account_id) AS business_account_id,
          app_secret
        FROM merchant_credentials
        WHERE merchant_id = ${merchantId}::uuid
          AND is_active = true
          AND instagram_token_encrypted IS NOT NULL
      `;

      if (credentials.length === 0) {
        return null;
      }

      const cred = credentials[0] as CredRow;
      
      if (!cred.instagram_token_encrypted) {
        return null;
      }

      // Handle both encrypted and plain tokens
      let accessToken: string;
      try {
        if (cred.instagram_token_encrypted.startsWith('EAAP')) {
          // Plain Facebook/Instagram token
          accessToken = cred.instagram_token_encrypted;
        } else {
          // Encrypted token - decrypt it
          const decryptedTokenData = this.encryptionService.decryptInstagramToken(
            cred.instagram_token_encrypted
          );
          accessToken = decryptedTokenData.token;
        }
      } catch (decryptError) {
        // Fallback to plain token if decryption fails
        accessToken = cred.instagram_token_encrypted;
      }

      return {
        accessToken,
        businessAccountId: cred.business_account_id ?? '',
        pageAccessToken: accessToken,
        pageId: cred.instagram_page_id ?? '',
        webhookVerifyToken: cred.webhook_verify_token ?? '',
        appSecret: cred.app_secret ?? ''
      };
    } catch (error: unknown) {
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
      // اختبار الcredentials الحالية
      const response = await this.graphRequest<{ id: string; name: string }>(
        'GET',
        `/${credentials.businessAccountId}`,
        (credentials.accessToken || credentials.pageAccessToken)!,
        {},
        merchantId,
        false
      );
      
      this.logger.info('✅ Instagram credentials validated successfully', { 
        merchantId, 
        businessAccountId: credentials.businessAccountId,
        accountName: response.name 
      });
      
    } catch (error: unknown) {
      this.logger.error('❌ Instagram credentials validation failed:', {
        error: error instanceof Error ? error.message : String(error),
        merchantId,
        businessAccountId: credentials.businessAccountId
      });
      
      // محاولة تجديد التوكن
      const refreshed = await this.attemptTokenRefresh(merchantId, credentials);
      if (!refreshed) {
        throw new Error(`Instagram credentials expired and cannot refresh. Merchant: ${merchantId}`);
      }
    }
  }

  /**
   * Private: Build message payload for API
   */
  private buildMessagePayload(request: SendMessageRequest): Record<string, unknown> {
    const basePayload: Record<string, unknown> = {
      messaging_product: 'instagram',
      recipient: {
        id: request.recipientId
      },
      messaging_type: request.messagingType || 'RESPONSE'
    };

    if (request.attachment) {
      const message: Record<string, unknown> = { attachment: request.attachment };
      if (request.content) message.text = request.content;
      if (request.quickReplies && request.quickReplies.length) message.quick_replies = request.quickReplies;
      
      return {
        ...basePayload,
        message
      };
    }

    // Check if content is JSON template
    const isTemplate = request.content && 
      request.content.trim().startsWith('{') && 
      request.content.trim().endsWith('}');

    if (isTemplate) {
      return {
        ...basePayload,
        message: {
          attachment: {
            type: 'template',
            payload: JSON.parse(request.content!)
          }
        }
      };
    }

    const message: Record<string, unknown> = {};
    if (request.content) message.text = request.content;
    if (request.quickReplies && request.quickReplies.length) message.quick_replies = request.quickReplies;

    return {
      ...basePayload,
      message
    };
  }

  private async attemptTokenRefresh(
    merchantId: string, 
    credentials: InstagramAPICredentials
  ): Promise<boolean> {
    try {
      // محاولة تجديد التوكن باستخدام fb_exchange_token
      if (credentials.accessToken || credentials.pageAccessToken) {
        const currentToken = credentials.accessToken || credentials.pageAccessToken!;
        
        // استخدام fb_exchange_token لتجديد التوكن
        const refreshResponse = await this.graphRequest<{ access_token: string; expires_in: number }>(
          'GET',
          '/oauth/access_token',
          '',
          {
            grant_type: 'fb_exchange_token',
            client_id: process.env.FACEBOOK_APP_ID || '',
            client_secret: credentials.appSecret || '',
            fb_exchange_token: currentToken
          },
          merchantId,
          false
        );
        
        // حفظ التوكن الجديد في قاعدة البيانات
        await this.saveRefreshedToken(merchantId, refreshResponse.access_token);
        return true;
      }
      return false;
    } catch (refreshError) {
      this.logger.error('Token refresh failed', refreshError);
      return false;
    }
  }

  private async saveRefreshedToken(merchantId: string, newToken: string): Promise<void> {
    try {
      const { getDatabase } = await import('../db/adapter.js');
      const db = getDatabase();
      const sql = db.getSQL();
      
      await sql`
        UPDATE merchant_credentials 
        SET 
          instagram_token_encrypted = ${newToken},
          updated_at = NOW()
        WHERE merchant_id = ${merchantId}::uuid
      `;
      
      this.logger.info('✅ Token refreshed and saved successfully', { merchantId });
    } catch (error) {
      this.logger.error('❌ Failed to save refreshed token', error, { merchantId });
      throw error;
    }
  }


}

/**
 * Instagram Credentials Manager
 */
export class InstagramAPICredentialsManager {
  private encryptionService!: EncryptionService;
  private logger: Logger;

  constructor(_container: DIContainer) {
    this.logger = _container.get('logger');
    
    this.initializeDependencies();
  }

  private async initializeDependencies(): Promise<void> {
    try {
      const { getEncryptionService } = await import('./encryption.js');
      this.encryptionService = getEncryptionService();
    } catch (error: unknown) {
      this.logger.error('Failed to initialize InstagramAPICredentialsManager dependencies:', error);
      throw error;
    }
  }

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
        ('accessToken' in credentials ? (credentials as { accessToken?: string }).accessToken : undefined)
          || credentials.pageAccessToken!
      );

      // Use pool directly for SQL operations
      const { getDatabase } = await import('../db/adapter.js');
      const sql = getDatabase().getSQL();
      
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
      // Use pool directly for SQL operations
      const { getDatabase } = await import('../db/adapter.js');
      const sql = getDatabase().getSQL();
      
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
      // Use pool directly for SQL operations
      const { getDatabase } = await import('../db/adapter.js');
      const sql = getDatabase().getSQL();
      
      const result = await sql.unsafe<{ instagram_token_encrypted: string | null }>(`
        SELECT instagram_token_encrypted
        FROM merchant_credentials
        WHERE merchant_id = ${merchantId}::uuid
        AND instagram_token_encrypted IS NOT NULL
      `);

      return (result as Array<{ instagram_token_encrypted: string | null }>).length > 0;
    } catch (error: unknown) {
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
      // Use pool directly for SQL operations
      const { getDatabase } = await import('../db/adapter.js');
      const db = getDatabase();
      
      const sql = db.getSQL();
      const result = await sql<{
        instagram_token_encrypted: string | null;
        instagram_page_id: string | null;
        last_access_at: string | null;
        [key: string]: unknown;
      }>`
        SELECT
          instagram_token_encrypted,
          instagram_page_id,
          last_access_at
        FROM merchant_credentials
        WHERE merchant_id = ${merchantId}::uuid
      ` as Array<{
        instagram_token_encrypted: string | null;
        instagram_page_id: string | null;
        last_access_at: string | null;
        [key: string]: unknown;
      }>;

      if (result.length === 0) {
        return { hasCredentials: false };
      }

      const cred = result[0];
      if (!cred) {
        return { hasCredentials: false };
      }

      return {
        hasCredentials: !!cred.instagram_token_encrypted,
        ...(cred.last_access_at ? { lastAccess: new Date(cred.last_access_at) } : {}),
        ...(cred.instagram_page_id ? { pageId: cred.instagram_page_id } : {})
      };
    } catch (error: unknown) {
      this.logger.error('❌ Failed to get credentials info:', error);
      return { hasCredentials: false };
    }
  }


}

// Factory functions for DI container
export function createInstagramAPIClient(container: DIContainer): InstagramAPIClient {
  return new InstagramAPIClient(container);
}

export function createInstagramAPICredentialsManager(container: DIContainer): InstagramAPICredentialsManager {
  return new InstagramAPICredentialsManager(container);
}

// Legacy support (with DI container fallback)
const instagramClients = new Map<string, InstagramAPIClient>();

/**
 * Get Instagram API client instance for a merchant
 * @deprecated Use DI container instead
 */
export async function getInstagramClient(merchantId: string): Promise<InstagramAPIClient> {
  let client = instagramClients.get(merchantId);
  if (!client) {
    const { container } = await import('../container/index.js');
    client = new InstagramAPIClient(container);
    instagramClients.set(merchantId, client);
  }
  return client;
}

export function clearInstagramClient(merchantId: string): void {
  instagramClients.delete(merchantId);
}

/**
 * Get credentials manager instance
 * @deprecated Use DI container instead
 */
export async function getInstagramAPICredentialsManager(): Promise<InstagramAPICredentialsManager> {
  const { container } = await import('../container/index.js');
  if (!container.has('instagramCredentialsManager')) {
    container.registerSingleton('instagramCredentialsManager', () => 
      new InstagramAPICredentialsManager(container)
    );
  }
  return container.get('instagramCredentialsManager');
}

export default InstagramAPIClient;
