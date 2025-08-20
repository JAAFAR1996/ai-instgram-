/**
 * ===============================================
 * Instagram Message Sender - STEP 4 Implementation
 * Handles sending messages, media, and responses via Instagram Graph API
 * ===============================================
 */

import { getInstagramClient, type InstagramAPIResponse } from './instagram-api.js';
import { getDatabase } from '../database/connection.js';
import { getMessageWindowService } from './message-window.js';
import { GRAPH_API_BASE_URL } from '../config/graph-api.js';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface SendMessageRequest {
  recipientId: string;
  message: string;
  messageType?: 'text' | 'media' | 'template';
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'audio';
  quickReplies?: QuickReply[];
  template?: MessageTemplate;
}

export interface QuickReply {
  content_type: 'text';
  title: string;
  payload: string;
}

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

export interface MediaUploadResult {
  success: boolean;
  mediaId?: string;
  error?: string;
  mediaType: string;
  size?: number;
}

export class InstagramMessageSender {
  private db = getDatabase();
  private messageWindowService = getMessageWindowService();

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

      // Get Instagram client
      const client = getInstagramClient();
      await client.initialize(merchantId);

      // Send message via Instagram API
      const response = await client.sendMessage({
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
    conversationId?: string
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

      // Get Instagram client
      const client = getInstagramClient();
      await client.initialize(merchantId);

      // Upload media first if it's a local file
      let finalMediaUrl = mediaUrl;
      if (!mediaUrl.startsWith('http')) {
        const uploadResult = await this.uploadMedia(merchantId, mediaUrl, mediaType);
        if (!uploadResult.success) {
          return {
            success: false,
            error: `Media upload failed: ${uploadResult.error}`,
            deliveryStatus: 'failed',
            timestamp: new Date()
          };
        }
        finalMediaUrl = uploadResult.mediaId!;
      }

      // Send media message
      const sendReq: SendMessageRequest & any = {
        recipientId,
        attachment: { type: mediaType, payload: { url: finalMediaUrl } }
      };
      const response = await client.sendMessage(sendReq);

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
        `[${mediaType.toUpperCase()}] ${caption || ''}`, 
        result, 
        conversationId,
        { mediaUrl: finalMediaUrl, mediaType }
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

      // Get Instagram client
      const client = getInstagramClient();
      await client.initialize(merchantId);

      // Convert template to Instagram format
      const instagramTemplate = this.convertToInstagramTemplate(template);

      // Send template message
      const tplReq: SendMessageRequest & any = {
        recipientId,
        template: instagramTemplate
      };
      const response = await client.sendMessage(tplReq);

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

      // Get Instagram client
      const client = getInstagramClient();
      await client.initialize(merchantId);

      // Reply to comment
      const response = await client.replyToComment(commentId, replyText);

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

      // Get Instagram client
      const client = getInstagramClient();
      await client.initialize(merchantId);

      // Send message with quick replies
      const response = await client.sendMessage({
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
      delayBetweenMessages?: number; // ms
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
              message
            );
          } else {
            result = await this.sendTextMessage(merchantId, recipientId, message);
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
      await this.logBulkSend(merchantId, recipients.length, sent, failed, message);

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
   * Private: Upload media to Instagram
   */
  private async uploadMedia(
    merchantId: string,
    mediaPath: string,
    mediaType: 'image' | 'video' | 'audio'
  ): Promise<MediaUploadResult> {
    try {
      const client = getInstagramClient();
      await client.initialize(merchantId);

      // Validate file exists and type
      const stats = await fs.stat(mediaPath);
      const ext = path.extname(mediaPath).toLowerCase();

      const typeConfig: Record<string, { exts: string[]; max: number }> = {
        image: { exts: ['.jpg', '.jpeg', '.png', '.gif'], max: 8 * 1024 * 1024 },
        video: { exts: ['.mp4', '.mov'], max: 50 * 1024 * 1024 },
        audio: { exts: ['.mp3', '.aac', '.wav'], max: 25 * 1024 * 1024 }
      };

      const config = typeConfig[mediaType];
      if (!config.exts.includes(ext)) {
        return { success: false, mediaType, error: `Unsupported ${mediaType} format: ${ext}` };
      }

      if (stats.size > config.max) {
        return {
          success: false,
          mediaType,
          size: stats.size,
          error: `${mediaType} exceeds ${(config.max / 1024 / 1024).toFixed(0)}MB limit`
        };
      }

      const creds = (client as any).credentials;
      if (!creds) {
        throw new Error('Instagram API not initialized');
      }

      const fileBuffer = await fs.readFile(mediaPath);
      const form = new FormData();
      form.append('file', new Blob([fileBuffer]), path.basename(mediaPath));
      form.append('media_type', mediaType);

      const uploadUrl = `${GRAPH_API_BASE_URL}/${creds.businessAccountId}/media?access_token=${encodeURIComponent(
        creds.pageAccessToken
      )}`;
      const response = await fetch(uploadUrl, {
        method: 'POST',
        body: form
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => response.statusText);
        return { success: false, mediaType, size: stats.size, error: errText };
      }

      const data = await response.json().catch(() => ({}));
      const mediaId = data.id || data.media_id || data.mediaId;

      return { success: true, mediaType, mediaId, size: stats.size };
    } catch (error) {
      console.error('❌ Media upload failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Media upload failed',
        mediaType
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
      const windowStatus = await (this.messageWindowService as any).checkWindow(
        merchantId, recipientId
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
    message: string
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
            timestamp: new Date().toISOString()
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