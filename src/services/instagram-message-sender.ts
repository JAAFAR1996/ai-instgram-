/**
 * ===============================================
 * Instagram Message Sender - STEP 4 Implementation
 * Handles sending messages, media, and responses via Instagram Graph API
 * ===============================================
 */

import {
  getInstagramClient,
  clearInstagramClient,
  type InstagramAPIResponse,
  type InstagramAPICredentials
} from './instagram-api.js';
import { ExpiringMap } from '../utils/expiring-map.js';
import { getDatabase } from '../database/connection.js';
import { getMessageWindowService } from './message-window.js';
import type { QuickReply, SendMessageRequest } from '../types/instagram.js';

export interface MessageTemplate {
  type: 'generic' | 'button' | 'receipt' | 'list';
  elements: TemplateElement[];
}

export interface TemplateElement {
  title: string;
  subtitle?: string;
  image_url?: string;
  default_action?: {
    type: 'web_url' | 'postback';
    url?: string;
    payload?: string;
  };
  buttons?: TemplateButton[];
}

export interface TemplateButton {
  type: 'web_url' | 'postback' | 'phone_number';
  title: string;
  url?: string;
  payload?: string;
  phone_number?: string;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  deliveryStatus: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: Date;
}



export class InstagramMessageSender {
  private db = getDatabase();
  private messageWindowService = getMessageWindowService();
  private credentialsCache = new ExpiringMap<string, InstagramAPICredentials>();

  /**
   * Get cached client or create new one
   */
  private getClient(merchantId: string) {
    return getInstagramClient(merchantId);
  }

  private async getCredentials(merchantId: string): Promise<InstagramAPICredentials> {
    const cached = this.credentialsCache.get(merchantId);
    if (cached && (!cached.tokenExpiresAt || cached.tokenExpiresAt > new Date())) {
      return cached;
    }

    const client = this.getClient(merchantId);
    const creds = await client.loadMerchantCredentials(merchantId);
    if (!creds) {
      throw new Error(`Instagram credentials not found for merchant: ${merchantId}`);
    }
    await client.validateCredentials(creds, merchantId);

    // Cache credentials until token expiry (default 1h if unknown)
    const ttlMs = creds.tokenExpiresAt
      ? Math.max(creds.tokenExpiresAt.getTime() - Date.now(), 0)
      : 60 * 60 * 1000;
    this.credentialsCache.set(merchantId, creds, ttlMs);
    return creds;
  }

  /**
   * Reload merchant credentials (clears cache)
   */
  public async reloadMerchant(merchantId: string): Promise<void> {
    console.log(`🔄 Reloading Instagram credentials for merchant: ${merchantId}`);

    // Clear caches
    this.credentialsCache.delete(merchantId);
    clearInstagramClient(merchantId);

    // Pre-warm the cache
    try {
      await this.getCredentials(merchantId);
      console.log(`✅ Instagram credentials reloaded for merchant: ${merchantId}`);
    } catch (error) {
      console.error(`❌ Failed to reload Instagram credentials for merchant ${merchantId}:`, error);
      throw error;
    }
  }

  /**
   * Send text message to Instagram user
   */
  public async sendTextMessage(
    merchantId: string,
    recipientId: string,
    message: string,
    conversationId?: string
  ): Promise<SendResult> {
    try {
      console.log(`📤 Sending Instagram message to ${recipientId}: ${message.substring(0, 50)}...`);

      // Check message window if available
      if (conversationId) {
        const canSend = await this.checkMessageWindow(merchantId, recipientId);
        if (!canSend) {
          return {
            success: false,
            error: 'Message window expired - cannot send message',
            deliveryStatus: 'failed',
            timestamp: new Date()
          };
        }
      }

      // Get Instagram client and credentials
      const client = this.getClient(merchantId);
      const credentials = await this.getCredentials(merchantId);

      // Send message via Instagram API
      const response = await client.sendMessage(credentials, merchantId, {
        recipientId,
        messageType: 'text',
        content: message
      });

      // Update delivery status
      const result: SendResult = {
        success: response.success,
        messageId: response.messageId,
        deliveryStatus: response.success ? 'sent' : 'failed',
        timestamp: new Date(),
        error: response.success ? undefined : (response.error ? JSON.stringify(response.error) : undefined)
      };

      // Log message sending
      await this.logMessageSent(merchantId, recipientId, message, result, conversationId);

      // Update message window (merchant response)
      if (conversationId && response.success) {
        await this.messageWindowService.recordMerchantResponse(
          merchantId,
          { instagram: recipientId, platform: 'instagram' },
          conversationId
        );
      }

      return result;

    } catch (error) {
      console.error('❌ Instagram message sending failed:', error);
      
      // Try reloading merchant credentials on auth errors
      if (error instanceof Error && 
          (error.message.includes('Invalid') || 
           error.message.includes('Expired') ||
           error.message.includes('Authentication'))) {
        try {
          await this.reloadMerchant(merchantId);
        } catch (reloadError) {
          console.error('❌ Failed to reload merchant credentials:', reloadError);
        }
      }
      
      const result: SendResult = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        deliveryStatus: 'failed',
        timestamp: new Date()
      };

      await this.logMessageSent(merchantId, recipientId, message, result, conversationId);
      return result;
    }
  }

  /**
   * Send media message (image, video, audio)
   */
  public async sendMediaMessage(
    merchantId: string,
    recipientId: string,
    mediaUrl: string,
    mediaType: 'image' | 'video' | 'audio',
    caption?: string,
    conversationId?: string,
    attachmentId?: string
  ): Promise<SendResult> {
    try {
      console.log(`📷 Sending Instagram ${mediaType} to ${recipientId}`);

      // Check message window
      if (conversationId) {
        const canSend = await this.checkMessageWindow(merchantId, recipientId);
        if (!canSend) {
          return {
            success: false,
            error: 'Message window expired - cannot send media',
            deliveryStatus: 'failed',
            timestamp: new Date()
          };
        }
      }

      // Get Instagram client and credentials
      const client = this.getClient(merchantId);
      const credentials = await this.getCredentials(merchantId);

      // Upload media first if it's a local file and no attachment is provided
      let finalMediaUrl = mediaUrl;
      let finalCaption = caption;
      let finalAttachmentId = attachmentId;
      if (!finalAttachmentId && !finalMediaUrl.startsWith('http')) {
        try {
          finalAttachmentId = await client.uploadMedia(finalMediaUrl, mediaType);
        } catch (error) {
          return {
            success: false,
            error: `Media upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            deliveryStatus: 'failed',
            timestamp: new Date()
          };
        }
      }

      // Send media message
      const payload = finalAttachmentId
        ? { attachment_id: finalAttachmentId }
        : { url: finalMediaUrl };

      const sendReq: SendMessageRequest & any = {
        recipientId,
        attachment: { type: mediaType, payload }
      };
      const response = await client.sendMessage(credentials, merchantId, sendReq);

      const result: SendResult = {
        success: response.success,
        messageId: response.messageId,
        deliveryStatus: response.success ? 'sent' : 'failed',
        timestamp: new Date(),
        error: response.success ? undefined : (response.error ? JSON.stringify(response.error) : undefined)
      };

      // Log media message
      await this.logMessageSent(
        merchantId,
        recipientId,
        `[${mediaType.toUpperCase()}] ${finalCaption || ''}`,
        result,
        conversationId,
        {
          mediaUrl: finalAttachmentId ? undefined : finalMediaUrl,
          mediaType,
          attachmentId: finalAttachmentId,
          reusedAttachment: Boolean(attachmentId)
        }
      );

      // Update message window
      if (conversationId && response.success) {
        await this.messageWindowService.recordMerchantResponse(
          merchantId,
          { instagram: recipientId, platform: 'instagram' },
          conversationId
        );
      }

      return result;

    } catch (error) {
      console.error('❌ Instagram media sending failed:', error);
      
      // Try reloading merchant credentials on auth errors
      if (error instanceof Error && 
          (error.message.includes('Invalid') || 
           error.message.includes('Expired') ||
           error.message.includes('Authentication'))) {
        try {
          await this.reloadMerchant(merchantId);
        } catch (reloadError) {
          console.error('❌ Failed to reload merchant credentials:', reloadError);
        }
      }
      
      const result: SendResult = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        deliveryStatus: 'failed',
        timestamp: new Date()
      };

      await this.logMessageSent(merchantId, recipientId, `[MEDIA_ERROR] ${mediaType}`, result, conversationId);
      return result;
    }
  }

  /**
   * Send template message (structured content)
   */
  public async sendTemplateMessage(
    merchantId: string,
    recipientId: string,
    template: MessageTemplate,
    conversationId?: string
  ): Promise<SendResult> {
    try {
      console.log(`📋 Sending Instagram template to ${recipientId}`);

      // Check message window
      if (conversationId) {
        const canSend = await this.checkMessageWindow(merchantId, recipientId);
        if (!canSend) {
          return {
            success: false,
            error: 'Message window expired - cannot send template',
            deliveryStatus: 'failed',
            timestamp: new Date()
          };
        }
      }

      // Get Instagram client and credentials
      const client = this.getClient(merchantId);
      const credentials = await this.getCredentials(merchantId);

      // Convert template to Instagram format
      const instagramTemplate = this.convertToInstagramTemplate(template);

      // Send template message
      const tplReq = {
        recipientId,
        messageType: 'template',
        content: JSON.stringify(instagramTemplate)
      };
      const response = await client.sendMessage(credentials, merchantId, tplReq);

      const result: SendResult = {
        success: response.success,
        messageId: response.messageId,
        deliveryStatus: response.success ? 'sent' : 'failed',
        timestamp: new Date(),
        error: response.success ? undefined : (response.error ? JSON.stringify(response.error) : undefined)
      };

      // Log template message
      await this.logMessageSent(
        merchantId, 
        recipientId, 
        `[TEMPLATE] ${template.type}`, 
        result, 
        conversationId,
        { template: template }
      );

      // Update message window
      if (conversationId && response.success) {
        await this.messageWindowService.recordMerchantResponse(
          merchantId,
          { instagram: recipientId, platform: 'instagram' },
          conversationId
        );
      }

      return result;

    } catch (error) {
      console.error('❌ Instagram template sending failed:', error);
      
      // Try reloading merchant credentials on auth errors
      if (error instanceof Error && 
          (error.message.includes('Invalid') || 
           error.message.includes('Expired') ||
           error.message.includes('Authentication'))) {
        try {
          await this.reloadMerchant(merchantId);
        } catch (reloadError) {
          console.error('❌ Failed to reload merchant credentials:', reloadError);
        }
      }
      
      const result: SendResult = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        deliveryStatus: 'failed',
        timestamp: new Date()
      };

      await this.logMessageSent(merchantId, recipientId, '[TEMPLATE_ERROR]', result, conversationId);
      return result;
    }
  }

  /**
   * Reply to Instagram comment
   */
  public async replyToComment(
    merchantId: string,
    commentId: string,
    replyText: string
  ): Promise<SendResult> {
    try {
      console.log(`💬 Replying to Instagram comment ${commentId}: ${replyText}`);

      // Get Instagram client and credentials
      const client = this.getClient(merchantId);
      const credentials = await this.getCredentials(merchantId);

      // Reply to comment
      const response = await client.replyToComment(credentials, merchantId, commentId, replyText);

      const result: SendResult = {
        success: response.success,
        messageId: response.messageId || commentId,
        deliveryStatus: response.success ? 'sent' : 'failed',
        timestamp: new Date(),
        error: response.success ? undefined : (response.error ? JSON.stringify(response.error) : undefined)
      };

      // Log comment reply
      await this.logCommentReply(merchantId, commentId, replyText, result);

      return result;

    } catch (error) {
      console.error('❌ Instagram comment reply failed:', error);
      
      // Try reloading merchant credentials on auth errors
      if (error instanceof Error && 
          (error.message.includes('Invalid') || 
           error.message.includes('Expired') ||
           error.message.includes('Authentication'))) {
        try {
          await this.reloadMerchant(merchantId);
        } catch (reloadError) {
          console.error('❌ Failed to reload merchant credentials:', reloadError);
        }
      }
      
      const result: SendResult = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        deliveryStatus: 'failed',
        timestamp: new Date()
      };

      await this.logCommentReply(merchantId, commentId, replyText, result);
      return result;
    }
  }

  /**
   * Send quick replies with message
   */
  public async sendMessageWithQuickReplies(
    merchantId: string,
    recipientId: string,
    message: string,
    quickReplies: QuickReply[],
    conversationId?: string
  ): Promise<SendResult> {
    try {
      console.log(`⚡ Sending Instagram message with quick replies to ${recipientId}`);

      // Check message window
      if (conversationId) {
        const canSend = await this.checkMessageWindow(merchantId, recipientId);
        if (!canSend) {
          return {
            success: false,
            error: 'Message window expired - cannot send quick replies',
            deliveryStatus: 'failed',
            timestamp: new Date()
          };
        }
      }

      // Get Instagram client and credentials
      const client = this.getClient(merchantId);
      const credentials = await this.getCredentials(merchantId);

      // Send message with quick replies
      const response = await client.sendMessage(credentials, merchantId, {
        recipientId,
        messageType: 'text',
        content: message,
        quickReplies
      });

      const result: SendResult = {
        success: response.success,
        messageId: response.messageId,
        deliveryStatus: response.success ? 'sent' : 'failed',
        timestamp: new Date(),
        error: response.success ? undefined : (response.error ? JSON.stringify(response.error) : undefined)
      };

      // Log message with quick replies
      await this.logMessageSent(
        merchantId, 
        recipientId, 
        message, 
        result, 
        conversationId,
        { quickReplies }
      );

      // Update message window
      if (conversationId && response.success) {
        await this.messageWindowService.recordMerchantResponse(
          merchantId,
          { instagram: recipientId, platform: 'instagram' },
          conversationId
        );
      }

      return result;

    } catch (error) {
      console.error('❌ Instagram quick replies sending failed:', error);
      
      // Try reloading merchant credentials on auth errors
      if (error instanceof Error && 
          (error.message.includes('Invalid') || 
           error.message.includes('Expired') ||
           error.message.includes('Authentication'))) {
        try {
          await this.reloadMerchant(merchantId);
        } catch (reloadError) {
          console.error('❌ Failed to reload merchant credentials:', reloadError);
        }
      }
      
      const result: SendResult = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        deliveryStatus: 'failed',
        timestamp: new Date()
      };

      await this.logMessageSent(merchantId, recipientId, message, result, conversationId);
      return result;
    }
  }

  /**
   * Bulk send messages (for broadcasts/campaigns)
   */
  public async sendBulkMessages(
    merchantId: string,
    recipients: string[],
    message: string,
    options?: {
      mediaUrl?: string;
      mediaType?: 'image' | 'video';
      delayBetweenMessages?: number; // ms between batches
      maxPerHour?: number;
    }
  ): Promise<{
    sent: number;
    failed: number;
    results: SendResult[];
    errors: string[];
  }> {
    const results: SendResult[] = [];
    const errors: string[] = [];
    let sent = 0;
    let failed = 0;

    const delay = options?.delayBetweenMessages || 1000; // 1 second default
    const maxPerHour = options?.maxPerHour || 100; // Rate limit

    try {
      console.log(`📢 Sending bulk Instagram messages to ${recipients.length} recipients`);

      // Rate limiting check
      if (recipients.length > maxPerHour) {
        errors.push(`Bulk send exceeds rate limit: ${recipients.length} > ${maxPerHour}`);
        return { sent: 0, failed: recipients.length, results: [], errors };
      }

      // If local media is provided, upload once and reuse attachment
      let sharedAttachmentId: string | undefined;
      if (options?.mediaUrl && options.mediaType && !options.mediaUrl.startsWith('http')) {
        const uploadResult = await this.uploadMedia(merchantId, options.mediaUrl, options.mediaType);
        if (!uploadResult.success || !uploadResult.mediaId) {
          const err = `Media upload failed: ${uploadResult.error}`;
          errors.push(err);
          return { sent: 0, failed: recipients.length, results: [], errors };
        }
        sharedAttachmentId = uploadResult.mediaId;
      }

      // Send to each recipient
      for (const recipientId of recipients) {
        try {
          let result: SendResult;

          if (options?.mediaUrl && options?.mediaType) {
            result = await this.sendMediaMessage(
              merchantId,
              recipientId,
              options.mediaUrl,
              options.mediaType,
              message,
              undefined,
              sharedAttachmentId
            );
          } else {
            result = await this.sendTextMessage(
              merchantId,
              recipientId,
              message
            );
          }

          results.push(result);

          if (result.success) {
            sent++;
          } else {
            failed++;
            if (result.error) {
              errors.push(`${recipientId}: ${result.error}`);
            }
          }

          // Delay between messages to avoid rate limiting
          if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
          }

        } catch (error) {
          failed++;
          const errorMsg = `${recipientId}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          errors.push(errorMsg);
          
          results.push({
            success: false,
            error: errorMsg,
            deliveryStatus: 'failed',
            timestamp: new Date()
          });
        }
      }

      // Log bulk send operation
      await this.logBulkSend(
        merchantId,
        recipients.length,
        sent,
        failed,
        message,
        sharedAttachmentId
          ? { attachmentId: sharedAttachmentId, mediaUrl: options?.mediaUrl, mediaType: options?.mediaType }
          : undefined
      );

      console.log(`✅ Bulk send completed: ${sent} sent, ${failed} failed`);

      return { sent, failed, results, errors };

    } catch (error) {
      console.error('❌ Bulk send failed:', error);
      errors.push(error instanceof Error ? error.message : 'Unknown bulk send error');
      
      return { 
        sent, 
        failed: recipients.length - sent, 
        results, 
        errors 
      };
    }
  }

  

  /**
   * Private: Convert template to Instagram format
   */
  private convertToInstagramTemplate(template: MessageTemplate): any {
    // Convert our template format to Instagram's expected format
    return {
      template_type: template.type,
      elements: template.elements.map(element => ({
        title: element.title,
        subtitle: element.subtitle,
        image_url: element.image_url,
        default_action: element.default_action,
        buttons: element.buttons?.map(button => ({
          type: button.type,
          title: button.title,
          url: button.url,
          payload: button.payload,
          phone_number: button.phone_number
        }))
      }))
    };
  }

  /**
   * Private: Check if merchant can send message (24-hour window)
   */
  private async checkMessageWindow(
    merchantId: string,
    recipientId: string
  ): Promise<boolean> {
    try {
      const windowStatus = await this.messageWindowService.getWindowStatus(
        merchantId, 
        { instagram: recipientId, platform: 'instagram' }
      );

      return windowStatus.canSend;
    } catch (error) {
      console.error('❌ Message window check failed:', error);
      return false; // Err on the side of caution
    }
  }

  /**
   * Private: Log message sending activity
   */
  private async logMessageSent(
    merchantId: string,
    recipientId: string,
    message: string,
    result: SendResult,
    conversationId?: string,
    metadata?: any
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();

      // Log to message_logs if conversation exists
      if (conversationId) {
        await sql`
          INSERT INTO message_logs (
            conversation_id,
            direction,
            platform,
            message_type,
            content,
            platform_message_id,
            delivery_status,
            ai_processed,
            metadata
          ) VALUES (
            ${conversationId}::uuid,
            'OUTGOING',
            'instagram',
            ${metadata?.mediaType ? metadata.mediaType.toUpperCase() : 'TEXT'},
            ${message},
            ${result.messageId || 'unknown'},
            ${result.deliveryStatus.toUpperCase()},
            false,
            ${metadata ? JSON.stringify(metadata) : null}
          )
        `;
      }

      // Log to audit_logs for tracking
      await sql`
        INSERT INTO audit_logs (
          merchant_id,
          action,
          entity_type,
          details,
          success,
          error_message
        ) VALUES (
          ${merchantId}::uuid,
          'INSTAGRAM_MESSAGE_SENT',
          'MESSAGE',
          ${JSON.stringify({
            recipientId,
            messageLength: message.length,
            messageType: metadata?.mediaType || 'text',
            deliveryStatus: result.deliveryStatus,
            conversationId: conversationId || null,
            timestamp: result.timestamp.toISOString()
          })},
          ${result.success},
          ${result.error || null}
        )
      `;

    } catch (error) {
      console.error('❌ Message logging failed:', error);
    }
  }

  /**
   * Private: Log comment reply activity
   */
  private async logCommentReply(
    merchantId: string,
    commentId: string,
    replyText: string,
    result: SendResult
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();

      await sql`
        INSERT INTO audit_logs (
          merchant_id,
          action,
          entity_type,
          details,
          success,
          error_message
        ) VALUES (
          ${merchantId}::uuid,
          'INSTAGRAM_COMMENT_REPLY',
          'COMMENT',
          ${JSON.stringify({
            commentId,
            replyText,
            deliveryStatus: result.deliveryStatus,
            timestamp: result.timestamp.toISOString()
          })},
          ${result.success},
          ${result.error || null}
        )
      `;

    } catch (error) {
      console.error('❌ Comment reply logging failed:', error);
    }
  }

  /**
   * Private: Log bulk send operation
   */
  private async logBulkSend(
    merchantId: string,
    totalRecipients: number,
    sent: number,
    failed: number,
    message: string,
    metadata?: any
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();

      await sql`
        INSERT INTO audit_logs (
          merchant_id,
          action,
          entity_type,
          details,
          success
        ) VALUES (
          ${merchantId}::uuid,
          'INSTAGRAM_BULK_SEND',
          'CAMPAIGN',
          ${JSON.stringify({
            totalRecipients,
            sent,
            failed,
            successRate: (sent / totalRecipients) * 100,
            messagePreview: message.substring(0, 100),
            timestamp: new Date().toISOString(),
            ...(metadata || {})
          })},
          ${sent > failed}
        )
      `;

    } catch (error) {
      console.error('❌ Bulk send logging failed:', error);
    }
  }
}

// Singleton instance
let messageSenderInstance: InstagramMessageSender | null = null;

/**
 * Get Instagram message sender instance
 */
export function getInstagramMessageSender(): InstagramMessageSender {
  if (!messageSenderInstance) {
    messageSenderInstance = new InstagramMessageSender();
  }
  return messageSenderInstance;
}

export default InstagramMessageSender;