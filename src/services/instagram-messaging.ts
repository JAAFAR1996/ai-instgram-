/**
 * ===============================================
 * Instagram Messaging API - Production Ready
 * ===============================================
 */
// Node بيئات بدون DOM: نُصرّح Response من undici لتجنب أخطاء الـ TS
// (لا يغيّر التنفيذ لأننا نتعامل مع response من rateLimiter)
// Type for Response to avoid undici dependency issues

import { getConfig } from '../config/index.js';
import { getDatabase } from '../db/adapter.js';
import { hashMerchantAndBody } from '../middleware/idempotency.js';
import { getRedisConnectionManager } from './RedisConnectionManager.js';
import { getEncryptionService } from './encryption.js';
import { RedisUsageType } from '../config/RedisConfigurationFactory.js';
import { GRAPH_API_BASE_URL } from '../config/graph-api.js';
import { getMetaRateLimiter } from './meta-rate-limiter.js';
import { InstagramOAuthService } from './instagram-oauth.js';
import { getNotificationService } from './notification-service.js';
import { getLogger } from './logger.js';

const logger = getLogger({ component: 'InstagramMessagingService' });

export async function retryFetch(
  fetchFn: () => Promise<any>,
  maxAttempts = 3,
  initialDelayMs = 500
): Promise<any> {
  let attempt = 0;
  let delay = initialDelayMs;
  while (attempt < maxAttempts) {
    try {
      const res = await fetchFn();
      if (res.status !== 429) {
        return res;
      }
      logger.warn(`retryFetch: attempt ${attempt + 1} received 429`);
    } catch (err) {
      logger.warn(`retryFetch: attempt ${attempt + 1} failed with ${(err as Error).message}`);
    }
    attempt++;
    if (attempt >= maxAttempts) break;
    logger.debug(`retryFetch: waiting ${delay}ms before attempt ${attempt + 1}`);
    await new Promise(resolve => setTimeout(resolve, delay));
    delay *= 2;
  }
  logger.error(`retryFetch: exhausted ${maxAttempts} attempts`);
  throw new Error(`Network request failed after ${maxAttempts} attempts`);
}

// Normalization بسيطة للنص تمنع اختلاف المفاتيح لمحتوى متطابق بصياغة مختلفة
function normalizeMessageText(s: string) {
  return (s || '').trim().replace(/\s+/g, ' ').slice(0, 1000);
}

export interface InstagramMessage {
  id: string;
  recipientId: string;
  messageType: 'text' | 'image' | 'generic';
  content: string;
  mediaUrl?: string;
  timestamp: Date;
}

export interface InstagramMessageResponse {
  messageId: string;
  recipientId: string;
  success: boolean;
  error?: string;
}

export interface MessageContext {
  conversationId: string;
  lastMessageTime?: Date;
  withinWindow: boolean;
  windowExpiresAt?: Date;
}

export class InstagramMessagingService {
  // removed unused __config
  private db = getDatabase();
  private redis = getRedisConnectionManager();
  private encryptionService = getEncryptionService();
  private rateLimiter = getMetaRateLimiter();
  private notification = getNotificationService();
  private readonly MESSAGING_WINDOW_HOURS = 24;

  /**
   * Execute Graph API request with rate limiting and logging
   */
  private async sendGraphMessage(
    merchantId: string,
    igUserId: string,
    accessToken: string,
    messagePayload: any
  ): Promise<any> {
    const url = `${GRAPH_API_BASE_URL}/${igUserId}/messages`;
    const rateKey = `ig:${merchantId}:${igUserId}:messages`;
    const maxAttempts = 3;
    let delay = 500;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      logger.debug(`🚀 Graph API message attempt ${attempt} for ${merchantId} -> ${igUserId}`);
      try {
        const response = await this.rateLimiter.graphRequest(
          url,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify(messagePayload)
          },
          rateKey
        );

        const data: any = await response.json();
        if (!response.ok) {
          logger.error('❌ Instagram message send failed', data);
          throw new Error(data.error?.message || 'Unknown error');
        }

        return data;
      } catch (error) {
        logger.error(`⚠️ Graph API attempt ${attempt} failed`, error);
        if (attempt === maxAttempts) {
          throw error;
        }

        logger.debug(`⏳ Waiting ${delay}ms before retry attempt ${attempt + 1}`);
        await new Promise(res => setTimeout(res, delay));
        delay *= 2;
      }
    }

    throw new Error('Message send failed after maximum attempts');
  }

  /**
   * Send text message to Instagram user
   * POST https://graph.instagram.com/{version}/{ig_user_id}/messages
   */
  async sendTextMessage(
    merchantId: string,
    recipientId: string,
    messageText: string,
    options: {
      conversationId?: string;
      priority?: 'normal' | 'high';
      tag?: string;
    } = {}
  ): Promise<InstagramMessageResponse> {
    try {
      logger.info(`📤 Sending Instagram message from ${merchantId} to ${recipientId}`);

      // 🔒 Idempotency check - prevent duplicate message sends
      const messageBody = {
        merchantId,
        recipientId,
        messageText: normalizeMessageText(messageText),
        conversationId: options.conversationId || 'unknown',
        timestamp: new Date().toISOString().split('T')[0] // Date only for deduplication
      };
      const idempotencyKey = `msg_send:${hashMerchantAndBody(merchantId, messageBody)}`;
      
      const redis = await this.redis.getConnection(RedisUsageType.IDEMPOTENCY);
      const existingResult = await redis.get(idempotencyKey);
      
      if (existingResult) {
        logger.debug(`🔒 Idempotent message send detected: ${idempotencyKey}`);
        try {
          return JSON.parse(existingResult);
        } catch (parseError) {
          logger.warn(
            `⚠️ Failed to parse cached message result for ${idempotencyKey}, proceeding with new send`,
            (parseError as unknown as LogContext | undefined)
          );
        }
      }

      // Get merchant access token
      const accessToken = await this.getMerchantAccessToken(merchantId);
      if (!accessToken) {
        await this.notification.send({
          type: 'instagram_token_missing',
          recipient: merchantId,
          content: { message: 'Instagram access token missing or expired' }
        });
        throw new Error('Merchant not authorized for Instagram messaging');
      }

      // Get merchant's Instagram user ID
      const igUserId = await this.getMerchantInstagramUserId(merchantId);
      if (!igUserId) {
        throw new Error('Merchant Instagram user ID not found');
      }

      // Check if we're within 24h messaging window
      const messageContext = await this.getMessageContext(merchantId, recipientId);
      if (!messageContext.withinWindow) {
        throw new Error('Outside 24-hour messaging window. User must initiate conversation first.');
      }

      // Prepare message payload
      const messagePayload = {
        recipient: {
          id: recipientId
        },
        message: {
          text: messageText
        }
      };

      // Send message via Instagram Graph API with rate limiter
      const responseData: any = await this.sendGraphMessage(
        merchantId,
        igUserId,
        accessToken,
        messagePayload
      );

      logger.info('✅ Instagram message sent successfully');

      // Log the sent message
      await this.logSentMessage(merchantId, recipientId, messageText, responseData.message_id, options);

      const successResult = {
        messageId: responseData.message_id,
        recipientId: recipientId,
        success: true
      };

      // 💾 Cache successful result for idempotency (24 hours TTL)
      await redis.setex(idempotencyKey, 86400, JSON.stringify(successResult));
      logger.debug(`💾 Cached message send result: ${idempotencyKey}`);

      return successResult;

    } catch (error) {
      logger.error('❌ Instagram messaging failed', error);

      const failureResult = {
        messageId: '',
        recipientId: recipientId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };

      try {
        await this.logFailedMessage(
          merchantId,
          recipientId,
          messageText,
          error instanceof Error ? error.message : 'Unknown error',
          options
        );
      } catch (logError) {
        logger.warn('⚠️ Failed to log failed Instagram message', logError as unknown as LogContext | undefined);
      }

      return failureResult;
    }
  }

  /**
   * Send image message to Instagram user
   */
  async sendImageMessage(
    merchantId: string,
    recipientId: string,
    imageUrl: string,
    caption?: string,
    options: {
      conversationId?: string;
      priority?: 'normal' | 'high';
      attachmentId?: string;
    } = {}
  ): Promise<InstagramMessageResponse> {
    try {
      logger.info(`📷 Sending Instagram image from ${merchantId} to ${recipientId}`);

      const accessToken = await this.getMerchantAccessToken(merchantId);
      if (!accessToken) {
        await this.notification.send({
          type: 'instagram_token_missing',
          recipient: merchantId,
          content: { message: 'Instagram access token missing or expired' }
        });
        throw new Error('Merchant not authorized for Instagram messaging');
      }

      const igUserId = await this.getMerchantInstagramUserId(merchantId);
      if (!igUserId) {
        throw new Error('Merchant Instagram user ID not found');
      }

      // Check messaging window
      const messageContext = await this.getMessageContext(merchantId, recipientId);
      if (!messageContext.withinWindow) {
        throw new Error('Outside 24-hour messaging window');
      }

      // Prepare image message payload with optional caption
      const messagePayload = {
          recipient: {
            id: recipientId
          },
          message: {
            attachment: {
              type: 'image',
              payload: options.attachmentId
                ? { attachment_id: options.attachmentId }
                : { url: imageUrl }
            },
            ...(caption ? { text: caption } : {})
          }
        };

      // Send message via Instagram Graph API with rate limiter
      const responseData: any = await this.sendGraphMessage(
        merchantId,
        igUserId,
        accessToken,
        messagePayload
      );

      logger.info('✅ Instagram image sent successfully');

      await this.logSentMessage(
        merchantId, 
        recipientId, 
        `[IMAGE: ${imageUrl}]${caption ? ` ${caption}` : ''}`, 
        responseData.message_id, 
        options
      );

      return {
        messageId: responseData.message_id,
        recipientId: recipientId,
        success: true
      };

    } catch (error) {
      logger.error('❌ Instagram image messaging failed', error);

      const failureResult = {
        messageId: '',
        recipientId: recipientId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };

      try {
        await this.logFailedMessage(
          merchantId,
          recipientId,
          `[IMAGE: ${imageUrl}]${caption ? ` ${caption}` : ''}`,
          error instanceof Error ? error.message : 'Unknown error',
          options
        );
      } catch (logError) {
        logger.warn('⚠️ Failed to log failed Instagram message', logError as unknown as LogContext | undefined);
      }

      return failureResult;
    }
  }

  /**
   * Send generic template message
   */
  async sendGenericTemplate(
    merchantId: string,
    recipientId: string,
    elements: Array<{
      title: string;
      imageUrl?: string;
      subtitle?: string;
      buttons?: Array<{
        type: 'web_url' | 'postback';
        title: string;
        url?: string;
        payload?: string;
      }>;
    }>,
    options: {
      conversationId?: string;
    } = {}
  ): Promise<InstagramMessageResponse> {
    try {
      logger.info(`📋 Sending Instagram template from ${merchantId} to ${recipientId}`);

      const accessToken = await this.getMerchantAccessToken(merchantId);
      if (!accessToken) {
        throw new Error('Merchant not authorized for Instagram messaging');
      }

      const igUserId = await this.getMerchantInstagramUserId(merchantId);
      if (!igUserId) {
        throw new Error('Merchant Instagram user ID not found');
      }

      // Check messaging window
      const messageContext = await this.getMessageContext(merchantId, recipientId);
      if (!messageContext.withinWindow) {
        throw new Error('Outside 24-hour messaging window');
      }

      // Prepare generic template payload
      const messagePayload = {
        recipient: {
          id: recipientId
        },
        message: {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'generic',
              elements: elements.map(element => ({
                title: element.title,
                image_url: element.imageUrl,
                subtitle: element.subtitle,
                buttons: element.buttons?.map(button => ({
                  type: button.type,
                  title: button.title,
                  url: button.url,
                  payload: button.payload
                }))
              }))
            }
          }
        }
      };

      // Send message via Instagram Graph API with rate limiter
      const responseData: any = await this.sendGraphMessage(
        merchantId,
        igUserId,
        accessToken,
        messagePayload
      );

      logger.info('✅ Instagram template sent successfully');

      await this.logSentMessage(
        merchantId, 
        recipientId, 
        `[TEMPLATE] ${elements[0]?.title || 'Generic template'}`, 
        responseData.message_id, 
        options
      );

      return {
        messageId: responseData.message_id,
        recipientId: recipientId,
        success: true
      };

    } catch (error) {
      logger.error('❌ Instagram template messaging failed', error);

      const failureResult = {
        messageId: '',
        recipientId: recipientId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };

      try {
        await this.logFailedMessage(
          merchantId,
          recipientId,
          `[TEMPLATE] ${elements[0]?.title || 'Generic template'}`,
          error instanceof Error ? error.message : 'Unknown error',
          options
        );
      } catch (logError) {
        logger.warn('⚠️ Failed to log failed Instagram message', logError as unknown as LogContext | undefined);
      }

      return failureResult;
    }
  }

  /**
   * Get merchant's Instagram access token
   */
  private async getMerchantAccessToken(merchantId: string): Promise<string | null> {
    try {
      const sql = this.db.getSQL();

      const result: any[] = await sql`
        SELECT instagram_token_encrypted, token_expires_at
        FROM merchant_credentials
        WHERE merchant_id = ${merchantId}::uuid
        AND instagram_token_encrypted IS NOT NULL
      `;

      if (result.length === 0) {
        return null;
      }

      const record = result[0];
      const currentToken = this.encryptionService.decryptInstagramToken(record.instagram_token_encrypted);

      // Check if token is expired
      if (record.token_expires_at && new Date(record.token_expires_at) <= new Date()) {
        logger.warn(`⚠️ Instagram token expired for merchant ${merchantId}`);
        try {
          const oauth = new InstagramOAuthService();
          const refreshed = await oauth.refreshLongLivedToken(currentToken, merchantId);
          const encrypted = this.encryptionService.encryptInstagramToken(refreshed.access_token);
          const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);

          await sql`
            UPDATE merchant_credentials
            SET instagram_token_encrypted = ${encrypted},
                token_expires_at = ${expiresAt}
            WHERE merchant_id = ${merchantId}::uuid
          `;

          return refreshed.access_token;
        } catch (err) {
          logger.error('❌ Failed to refresh Instagram token', err);
          return null;
        }
      }

      return currentToken;

    } catch (error) {
      logger.error('❌ Failed to get merchant access token', error);
      return null;
    }
  }

  /**
   * Get merchant's Instagram user ID
   */
  private async getMerchantInstagramUserId(merchantId: string): Promise<string | null> {
    try {
      const sql = this.db.getSQL();

      const result: any[] = await sql`
        SELECT instagram_user_id
        FROM merchant_credentials
        WHERE merchant_id = ${merchantId}::uuid
        AND instagram_user_id IS NOT NULL
      `;

      return result[0]?.instagram_user_id || null;

    } catch (error) {
      logger.error('❌ Failed to get merchant Instagram user ID', error);
      return null;
    }
  }

  /**
   * Get message context and check 24h window
   */
  private async getMessageContext(merchantId: string, recipientId: string): Promise<MessageContext> {
    try {
      const sql = this.db.getSQL();

      // Get the latest incoming message from this recipient
      const result: any[] = await sql`
        SELECT
          c.id as conversation_id,
          MAX(ml.created_at) as last_message_time
        FROM conversations c
        JOIN message_logs ml ON c.id = ml.conversation_id
        WHERE c.merchant_id = ${merchantId}::uuid
        AND c.customer_instagram = ${recipientId}
        AND c.platform = 'instagram'
        AND ml.direction = 'INCOMING'
        GROUP BY c.id
        ORDER BY last_message_time DESC
        LIMIT 1
      `;

      if (result.length === 0) {
        return {
          conversationId: '',
          withinWindow: false
        };
      }

      const record = result[0];
      const lastMessageTime = new Date(record.last_message_time);
      const now = new Date();
      const windowExpiresAt = new Date(lastMessageTime.getTime() + (this.MESSAGING_WINDOW_HOURS * 60 * 60 * 1000));
      
      const withinWindow = now <= windowExpiresAt;

      return {
        conversationId: record.conversation_id,
        lastMessageTime,
        withinWindow,
        windowExpiresAt
      };

    } catch (error) {
      logger.error('❌ Failed to get message context', error);
      return {
        conversationId: '',
        withinWindow: false
      };
    }
  }

  /**
   * Log successful message send
   */
  private async logSentMessage(
    merchantId: string,
    recipientId: string,
    content: string,
    messageId: string,
    options: any
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();

      await sql`
        INSERT INTO message_logs (
          conversation_id,
          direction,
          platform,
          message_type,
          content,
          external_message_id,
          status,
          created_at
        ) VALUES (
          ${options.conversationId || null}::uuid,
          'OUTGOING',
          'instagram',
          'TEXT',
          ${content},
          ${messageId},
          'SENT',
          NOW()
        )
      `;

      // Update conversation last activity
      if (options.conversationId) {
        await sql`
          UPDATE conversations 
          SET 
            last_message_at = NOW(),
            updated_at = NOW()
          WHERE id = ${options.conversationId}::uuid
        `;
      }

    } catch (error) {
      logger.error('❌ Failed to log sent message', error);
    }
  }

  /**
   * Log failed message send
   */
  private async logFailedMessage(
    merchantId: string,
    recipientId: string,
    content: string,
    errorMessage: string,
    options: any
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();

      await sql`
        INSERT INTO message_logs (
          conversation_id,
          direction,
          platform,
          message_type,
          content,
          status,
          error_message,
          created_at
        ) VALUES (
          ${options.conversationId || null}::uuid,
          'OUTGOING',
          'instagram',
          'TEXT',
          ${content},
          'FAILED',
          ${errorMessage},
          NOW()
        )
      `;

    } catch (error) {
      logger.error('❌ Failed to log failed message', error);
    }
  }

  /**
   * Check if messaging is available for a conversation
   */
  async isMessagingAvailable(merchantId: string, recipientId: string): Promise<{
    available: boolean;
    reason?: string;
    windowExpiresAt?: Date;
  }> {
    try {
      // Check if merchant has valid token
      const accessToken = await this.getMerchantAccessToken(merchantId);
      if (!accessToken) {
        return {
          available: false,
          reason: 'Merchant not authorized for Instagram messaging'
        };
      }

      // Check 24h window
      const context = await this.getMessageContext(merchantId, recipientId);
      if (!context.withinWindow) {
        return {
          available: false,
          reason: 'Outside 24-hour messaging window',
          ...(context.windowExpiresAt ? { windowExpiresAt: context.windowExpiresAt } : {})
        };
      }

      return {
        available: true
      };

    } catch (error) {
      logger.error('❌ Failed to check messaging availability', error);
      return {
        available: false,
        reason: 'Error checking messaging availability'
      };
    }
  }

  /**
   * Get messaging statistics for a merchant
   */
  async getMessagingStats(merchantId: string, days: number = 30): Promise<{
    totalSent: number;
    totalFailed: number;
    successRate: number;
    withinWindowMessages: number;
  }> {
    try {
      const sql = this.db.getSQL();

      const stats = await sql`
        SELECT 
          COUNT(*) FILTER (WHERE status = 'SENT') as total_sent,
          COUNT(*) FILTER (WHERE status = 'FAILED') as total_failed,
          COUNT(*) as total_attempts
        FROM message_logs ml
        JOIN conversations c ON ml.conversation_id = c.id
        WHERE c.merchant_id = ${merchantId}::uuid
        AND c.platform = 'instagram'
        AND ml.direction = 'OUTGOING'
        AND ml.created_at >= NOW() - INTERVAL '${days} days'
      `;

      const record = stats[0];
      const totalSent = parseInt(String(record!.total_sent)) || 0;
      const totalFailed = parseInt(String(record!.total_failed)) || 0;
      const totalAttempts = parseInt(String(record!.total_attempts)) || 0;
      
      const successRate = totalAttempts > 0 ? (totalSent / totalAttempts) * 100 : 0;

      return {
        totalSent,
        totalFailed,
        successRate: Math.round(successRate * 100) / 100,
        withinWindowMessages: totalSent // All sent messages were within window
      };

    } catch (error) {
      logger.error('❌ Failed to get messaging stats', error);
      return {
        totalSent: 0,
        totalFailed: 0,
        successRate: 0,
        withinWindowMessages: 0
      };
    }
  }
}

// Singleton instance
let instagramMessagingInstance: InstagramMessagingService | null = null;

/**
 * Get Instagram messaging service instance
 */
export function getInstagramMessagingService(): InstagramMessagingService {
  if (!instagramMessagingInstance) {
    instagramMessagingInstance = new InstagramMessagingService();
  }
  return instagramMessagingInstance;
}

export default InstagramMessagingService;