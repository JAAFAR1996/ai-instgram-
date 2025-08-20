/**
 * ===============================================
 * Instagram Messaging API - Production Ready
 * Implements Instagram Graph API messaging within 24h window
 * POST graph.instagram.com/{v}/{ig_user_id}/messages
 * ===============================================
 */

import { getConfig } from '../config/environment';
import { getDatabase } from '../database/connection';
import { hashMerchantAndBody } from '../middleware/idempotency';
import { getRedisConnectionManager } from './RedisConnectionManager';
import { RedisUsageType } from '../config/RedisConfigurationFactory';

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
  private config = getConfig();
  private db = getDatabase();
  private redis = getRedisConnectionManager();
  private readonly MESSAGING_WINDOW_HOURS = 24;

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
      console.log(`📤 Sending Instagram message from ${merchantId} to ${recipientId}`);

      // 🔒 Idempotency check - prevent duplicate message sends
      const messageBody = {
        merchantId,
        recipientId,
        messageText,
        options, // Include options to differentiate requests with different parameters
        timestamp: new Date().toISOString().split('T')[0] // Date only for deduplication
      };
      const idempotencyKey = `msg_send:${hashMerchantAndBody(merchantId, messageBody)}`;
      
      const redis = await this.redis.getConnection(RedisUsageType.IDEMPOTENCY);
      const existingResult = await redis.get(idempotencyKey);
      
      if (existingResult) {
        console.log(`🔒 Idempotent message send detected: ${idempotencyKey}`);
        return JSON.parse(existingResult);
      }

      // Get merchant access token
      const accessToken = await this.getMerchantAccessToken(merchantId);
      if (!accessToken) {
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

      // Send message via Instagram Graph API
      const response = await fetch(
        `https://graph.instagram.com/${this.config.instagram.apiVersion}/${igUserId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          },
          body: JSON.stringify(messagePayload)
        }
      );

      const responseData: any = await response.json();

      if (!response.ok) {
        console.error('❌ Instagram message send failed:', responseData);
        throw new Error(`Message send failed: ${responseData.error?.message || 'Unknown error'}`);
      }

      console.log('✅ Instagram message sent successfully');

      // Log the sent message
      await this.logSentMessage(merchantId, recipientId, messageText, responseData.message_id, options);

      const successResult = {
        messageId: responseData.message_id,
        recipientId: recipientId,
        success: true
      };

      // 💾 Cache successful result for idempotency (24 hours TTL)
      await redis.setex(idempotencyKey, 86400, JSON.stringify(successResult));
      console.log(`💾 Cached message send result: ${idempotencyKey}`);

      return successResult;

    } catch (error) {
      console.error('❌ Instagram messaging failed:', error);
      
      // Log the failed message
      await this.logFailedMessage(merchantId, recipientId, messageText, error.message, options);

      return {
        messageId: '',
        recipientId: recipientId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
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
    } = {}
  ): Promise<InstagramMessageResponse> {
    try {
      console.log(`📷 Sending Instagram image from ${merchantId} to ${recipientId}`);

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

      // Prepare image message payload
      const messagePayload = {
        recipient: {
          id: recipientId
        },
        message: {
          attachment: {
            type: 'image',
            payload: {
              url: imageUrl
            }
          }
        }
      };

      // Add caption if provided
      if (caption) {
        (messagePayload as any).message = { text: caption };
      }

      const response = await fetch(
        `https://graph.instagram.com/${this.config.instagram.apiVersion}/${igUserId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          },
          body: JSON.stringify(messagePayload)
        }
      );

      const responseData: any = await response.json();

      if (!response.ok) {
        console.error('❌ Instagram image send failed:', responseData);
        throw new Error(`Image send failed: ${responseData.error?.message || 'Unknown error'}`);
      }

      console.log('✅ Instagram image sent successfully');

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
      console.error('❌ Instagram image messaging failed:', error);

      await this.logFailedMessage(
        merchantId, 
        recipientId, 
        `[IMAGE: ${imageUrl}]${caption ? ` ${caption}` : ''}`, 
        error.message, 
        options
      );

      return {
        messageId: '',
        recipientId: recipientId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
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
      console.log(`📋 Sending Instagram template from ${merchantId} to ${recipientId}`);

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

      const response = await fetch(
        `https://graph.instagram.com/${this.config.instagram.apiVersion}/${igUserId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          },
          body: JSON.stringify(messagePayload)
        }
      );

      const responseData: any = await response.json();

      if (!response.ok) {
        console.error('❌ Instagram template send failed:', responseData);
        throw new Error(`Template send failed: ${responseData.error?.message || 'Unknown error'}`);
      }

      console.log('✅ Instagram template sent successfully');

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
      console.error('❌ Instagram template messaging failed:', error);

      await this.logFailedMessage(
        merchantId, 
        recipientId, 
        `[TEMPLATE] ${elements[0]?.title || 'Generic template'}`, 
        error.message, 
        options
      );

      return {
        messageId: '',
        recipientId: recipientId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get merchant's Instagram access token
   */
  private async getMerchantAccessToken(merchantId: string): Promise<string | null> {
    try {
      const sql = this.db.getSQL();

      const result = await sql`
        SELECT instagram_access_token, token_expires_at
        FROM merchant_credentials
        WHERE merchant_id = ${merchantId}::uuid
        AND instagram_access_token IS NOT NULL
      `;

      if (result.length === 0) {
        return null;
      }

      const record = result[0];
      
      // Check if token is expired
      if (record.token_expires_at && new Date(record.token_expires_at) <= new Date()) {
        console.warn(`⚠️ Instagram token expired for merchant ${merchantId}`);
        return null;
      }

      return record.instagram_access_token;

    } catch (error) {
      console.error('❌ Failed to get merchant access token:', error);
      return null;
    }
  }

  /**
   * Get merchant's Instagram user ID
   */
  private async getMerchantInstagramUserId(merchantId: string): Promise<string | null> {
    try {
      const sql = this.db.getSQL();

      const result = await sql`
        SELECT instagram_user_id
        FROM merchant_credentials
        WHERE merchant_id = ${merchantId}::uuid
        AND instagram_user_id IS NOT NULL
      `;

      return result[0]?.instagram_user_id || null;

    } catch (error) {
      console.error('❌ Failed to get merchant Instagram user ID:', error);
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
      const result = await sql`
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
      console.error('❌ Failed to get message context:', error);
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
      console.error('❌ Failed to log sent message:', error);
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
      console.error('❌ Failed to log failed message:', error);
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
          windowExpiresAt: context.windowExpiresAt
        };
      }

      return {
        available: true
      };

    } catch (error) {
      console.error('❌ Failed to check messaging availability:', error);
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
      const totalSent = parseInt(record.total_sent) || 0;
      const totalFailed = parseInt(record.total_failed) || 0;
      const totalAttempts = parseInt(record.total_attempts) || 0;
      
      const successRate = totalAttempts > 0 ? (totalSent / totalAttempts) * 100 : 0;

      return {
        totalSent,
        totalFailed,
        successRate: Math.round(successRate * 100) / 100,
        withinWindowMessages: totalSent // All sent messages were within window
      };

    } catch (error) {
      console.error('❌ Failed to get messaging stats:', error);
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