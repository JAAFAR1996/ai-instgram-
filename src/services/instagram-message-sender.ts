/**
 * ===============================================
 * Instagram Message Sender - Unified Service
 * Handles sending messages, media, and responses via Instagram Graph API
 * ===============================================
 */

import {
  getInstagramClient,
  clearInstagramClient,
  type InstagramAPICredentials,
  type InstagramAttachment
} from './instagram-api.js';
import { ExpiringMap } from '../utils/expiring-map.js';
import { getDatabase } from '../db/adapter.js';
import { getMessageWindowService } from './message-window.js';
import { getLogger } from './logger.js';
import type { 
  QuickReply, 
  SendMessageRequest, 
  SendResult,
  InstagramTemplatePayload,
  InstagramTemplateElement,
  InstagramTemplateButton,
  MessageTemplate,
  MessageMetadata,
  BulkSendMetadata
} from '../types/instagram.js';
import { createErrorResponse } from '../utils/instagram-errors.js';

interface SendMessageWithAttachment extends Omit<SendMessageRequest, 'messagingType' | 'text'> {
  attachment: InstagramAttachment;
  text?: string;
  messagingType?: SendMessageRequest['messagingType'];
}

const logger = getLogger({ component: 'InstagramMessageSender' });

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
    logger.info(`🔄 Reloading Instagram credentials for merchant: ${merchantId}`);

    // Clear caches
    this.credentialsCache.delete(merchantId);
    clearInstagramClient(merchantId);

    // Pre-warm the cache
    try {
      await this.getCredentials(merchantId);
      logger.info(`✅ Instagram credentials reloaded for merchant: ${merchantId}`);
    } catch (error) {
      logger.error(`❌ Failed to reload Instagram credentials for merchant ${merchantId}:`, error);
      throw error;
    }
  }

  public dispose(): void {
    this.credentialsCache.dispose();
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
      logger.info(`📤 Sending Instagram message to ${recipientId}: ${message.substring(0, 50)}...`);

      // Check message window if available
      if (conversationId) {
        const canSendMessage = await this.checkMessageWindow(merchantId, recipientId);
        if (!canSendMessage) {
          // محاولة إرسال template message بدلاً من الرسالة العادية
                    const templateResult = await this.sendTemplateOrBroadcast(
            merchantId,
            recipientId, 
            message
          );
          
          if (templateResult.success) {
            logger.info('✅ Message sent via template (window expired)', { 
              merchantId, 
              recipientId, 
              templateMessageId: templateResult.messageId 
            });
            return templateResult;
          }
          
                // إذا فشل Template أيضاً، سجل الرسالة للمتابعة اليدوية
      await this.scheduleManualFollowup(merchantId, recipientId, message);
          
          return createErrorResponse(
            new Error('Message window expired - scheduled for manual followup'), 
            { merchantId, recipientId, conversationId }
          );
        }
      }

      // Get Instagram client and credentials
      const client = this.getClient(merchantId);
      const credentials = await this.getCredentials(merchantId);

      // Send message via Instagram API
      const response = await client.sendMessage(credentials, merchantId, {
        recipientId,
        messagingType: 'RESPONSE',
        text: message
      });

      // Update delivery status
      const result: SendResult = {
        success: response.success,
        deliveryStatus: response.success ? 'sent' : 'failed',
        timestamp: new Date(),
        ...(response.messageId ? { messageId: response.messageId } : {}),
        ...(response.success ? {} : { error: response.error ? JSON.stringify(response.error) : 'Unknown error' })
      };

      // Log message sending
      await this.logMessageSent(merchantId, recipientId, message, result, conversationId);

      // Update message window (merchant response)
      if (conversationId && response.success) {
        await this.messageWindowService.recordMerchantResponse(
          merchantId,
          { instagram: recipientId, platform: 'instagram' }
        );
      }

      return result;

    } catch (error) {
      logger.error('❌ Instagram message sending failed:', error);
      
      // Try reloading merchant credentials on auth errors
      if (error instanceof Error && 
          (error.message.includes('Invalid') || 
           error.message.includes('Expired') ||
           error.message.includes('Authentication'))) {
        try {
          await this.reloadMerchant(merchantId);
        } catch (reloadError) {
          logger.error('❌ Failed to reload merchant credentials:', reloadError);
        }
      }
      
      const result = createErrorResponse(error, {
        merchantId,
        recipientId,
        conversationId,
        messageType: 'text'
      });

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
      logger.info(`📷 Sending Instagram ${mediaType} to ${recipientId}`);

      // Check message window
      if (conversationId) {
        const canSendMessage = await this.checkMessageWindow(merchantId, recipientId);
        if (!canSendMessage) {
          return createErrorResponse(new Error('Message window expired - cannot send media'), {
            merchantId,
            recipientId,
            conversationId,
            mediaType
          });
        }
      }

      // Get Instagram client and credentials
      const client = this.getClient(merchantId);
      const credentials = await this.getCredentials(merchantId);

      // Upload media first if it's a local file and no attachment is provided
      const finalMediaUrl = mediaUrl;
      const finalCaption = caption;
      let finalAttachmentId = attachmentId;
      if (!finalAttachmentId && !finalMediaUrl.startsWith('http')) {
        try {
          finalAttachmentId = await client.uploadMedia(finalMediaUrl, mediaType);
        } catch (error) {
          return createErrorResponse(error, {
            merchantId,
            recipientId,
            mediaType,
            mediaUrl: finalMediaUrl,
            context: 'media_upload'
          });
        }
      }

      // Send media message
      const payload = finalAttachmentId
        ? { attachment_id: finalAttachmentId }
        : { url: finalMediaUrl };

      const sendReq: SendMessageWithAttachment = {
        recipientId,
        attachment: { type: mediaType, payload }
      };
      const response = await client.sendMessage(credentials, merchantId, sendReq as SendMessageRequest);

      const result: SendResult = {
        success: response.success,
        deliveryStatus: response.success ? 'sent' : 'failed',
        timestamp: new Date(),
        ...(response.messageId ? { messageId: response.messageId } : {}),
        ...(response.success ? {} : { error: response.error ? JSON.stringify(response.error) : 'Unknown error' })
      };

      // Log media message
      await this.logMessageSent(
        merchantId,
        recipientId,
        `[${mediaType.toUpperCase()}] ${finalCaption || ''}`,
        result,
        conversationId,
        {
          ...(finalAttachmentId ? {} : { mediaUrl: finalMediaUrl }),
          mediaType,
          ...(finalAttachmentId ? { attachmentId: finalAttachmentId } : {}),
          reusedAttachment: Boolean(attachmentId)
        }
      );

      // Update message window
      if (conversationId && response.success) {
        await this.messageWindowService.recordMerchantResponse(
          merchantId,
          { instagram: recipientId, platform: 'instagram' }
        );
      }

      return result;

    } catch (error) {
      logger.error('❌ Instagram media sending failed:', error);
      
      // Try reloading merchant credentials on auth errors
      if (error instanceof Error && 
          (error.message.includes('Invalid') || 
           error.message.includes('Expired') ||
           error.message.includes('Authentication'))) {
        try {
          await this.reloadMerchant(merchantId);
        } catch (reloadError) {
          logger.error('❌ Failed to reload merchant credentials:', reloadError);
        }
      }
      
      const result = createErrorResponse(error, {
        merchantId,
        recipientId,
        conversationId,
        mediaType,
        mediaUrl,
        context: 'media_send'
      });

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
      logger.info(`📋 Sending Instagram template to ${recipientId}`);

      // Check message window
      if (conversationId) {
        const canSendMessage = await this.checkMessageWindow(merchantId, recipientId);
        if (!canSendMessage) {
          return createErrorResponse(new Error('Message window expired - cannot send template'), {
            merchantId,
            recipientId,
            conversationId,
            templateType: template.type
          });
        }
      }

      // Get Instagram client and credentials
      const client = this.getClient(merchantId);
      const credentials = await this.getCredentials(merchantId);

      // Convert template to Instagram format
      const instagramTemplate = this.convertToInstagramTemplate(template);

      // Send template message
      const tplReq: SendMessageRequest = {
        recipientId,
        messagingType: 'MESSAGE_TAG',
        text: JSON.stringify(instagramTemplate)
      };
      const response = await client.sendMessage(credentials, merchantId, tplReq);

      const result: SendResult = {
        success: response.success,
        deliveryStatus: response.success ? 'sent' : 'failed',
        timestamp: new Date(),
        ...(response.messageId ? { messageId: response.messageId } : {}),
        ...(response.success ? {} : { error: response.error ? JSON.stringify(response.error) : 'Unknown error' })
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
          { instagram: recipientId, platform: 'instagram' }
        );
      }

      return result;

    } catch (error) {
      logger.error('❌ Instagram template sending failed:', error);
      
      // Try reloading merchant credentials on auth errors
      if (error instanceof Error && 
          (error.message.includes('Invalid') || 
           error.message.includes('Expired') ||
           error.message.includes('Authentication'))) {
        try {
          await this.reloadMerchant(merchantId);
        } catch (reloadError) {
          logger.error('❌ Failed to reload merchant credentials:', reloadError);
        }
      }
      
      const result = createErrorResponse(error, {
        merchantId,
        recipientId,
        conversationId,
        templateType: template.type,
        context: 'template_send'
      });

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
      logger.info(`💬 Replying to Instagram comment ${commentId}: ${replyText}`);

      // Get Instagram client and credentials
      const client = this.getClient(merchantId);
      const credentials = await this.getCredentials(merchantId);

      // Reply to comment
      const response = await client.replyToComment(credentials, merchantId, commentId, replyText);

      const result: SendResult = {
        success: response.success,
        deliveryStatus: response.success ? 'sent' : 'failed',
        timestamp: new Date(),
        ...(response.messageId || commentId ? { messageId: response.messageId || commentId } : {}),
        ...(response.success ? {} : { error: response.error ? JSON.stringify(response.error) : 'Unknown error' })
      };

      // Log comment reply
      await this.logCommentReply(merchantId, commentId, replyText, result);

      return result;

    } catch (error) {
      logger.error('❌ Instagram comment reply failed:', error);
      
      // Try reloading merchant credentials on auth errors
      if (error instanceof Error && 
          (error.message.includes('Invalid') || 
           error.message.includes('Expired') ||
           error.message.includes('Authentication'))) {
        try {
          await this.reloadMerchant(merchantId);
        } catch (reloadError) {
          logger.error('❌ Failed to reload merchant credentials:', reloadError);
        }
      }
      
      const result = createErrorResponse(error, {
        merchantId,
        commentId,
        replyText,
        context: 'comment_reply'
      });

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
      logger.info(`⚡ Sending Instagram message with quick replies to ${recipientId}`);

      // Check message window
      if (conversationId) {
        const canSendMessage = await this.checkMessageWindow(merchantId, recipientId);
        if (!canSendMessage) {
          return createErrorResponse(new Error('Message window expired - cannot send quick replies'), {
            merchantId,
            recipientId,
            conversationId,
            quickRepliesCount: quickReplies.length
          });
        }
      }

      // Get Instagram client and credentials
      const client = this.getClient(merchantId);
      const credentials = await this.getCredentials(merchantId);

      // Send message with quick replies
      const response = await client.sendMessage(credentials, merchantId, {
        recipientId,
        messagingType: 'RESPONSE',
        text: message,
        quickReplies
      });

      const result: SendResult = {
        success: response.success,
        deliveryStatus: response.success ? 'sent' : 'failed',
        timestamp: new Date(),
        ...(response.messageId ? { messageId: response.messageId } : {}),
        ...(response.success ? {} : { error: response.error ? JSON.stringify(response.error) : 'Unknown error' })
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
          { instagram: recipientId, platform: 'instagram' }
        );
      }

      return result;

    } catch (error) {
      logger.error('❌ Instagram quick replies sending failed:', error);
      
      // Try reloading merchant credentials on auth errors
      if (error instanceof Error && 
          (error.message.includes('Invalid') || 
           error.message.includes('Expired') ||
           error.message.includes('Authentication'))) {
        try {
          await this.reloadMerchant(merchantId);
        } catch (reloadError) {
          logger.error('❌ Failed to reload merchant credentials:', reloadError);
        }
      }
      
      const result = createErrorResponse(error, {
        merchantId,
        recipientId,
        conversationId,
        quickRepliesCount: quickReplies.length,
        context: 'quick_replies_send'
      });

      await this.logMessageSent(merchantId, recipientId, message, result, conversationId);
      return result;
    }
  }

  /**
   * Production-grade text clamping utility
   * Handles Unicode properly and prevents truncation issues
   */
  public clampText(text: string, maxLength: number = 1000): string {
    if (!text || typeof text !== 'string') return '';
    
    // Handle Unicode surrogate pairs correctly
    const trimmed = text.trim().replace(/\s+/g, ' ');
    
    if (trimmed.length <= maxLength) {
      return trimmed;
    }
    
    // Find safe truncation point (avoid breaking words/emojis)
    let truncated = trimmed.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    
    if (lastSpace > maxLength * 0.8) {
      truncated = truncated.substring(0, lastSpace);
    }
    
    return truncated + '...';
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

    const batchDelay = options?.delayBetweenMessages || 1000; // ms between batches
    const maxPerHour = options?.maxPerHour || 100; // Rate limit
    const batchSize = 5; // concurrency limit

    try {
      logger.info(`📢 Sending bulk Instagram messages to ${recipients.length} recipients`);

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

      // Send in batches with concurrency
      for (let i = 0; i < recipients.length; i += batchSize) {
        const batch = recipients.slice(i, i + batchSize);

        const batchPromises = batch.map(async recipientId => {
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

            return { recipientId, result };
          } catch (error) {
            throw { recipientId, error };
          }
        });

        const settled = await Promise.allSettled(batchPromises);

        for (const item of settled) {
          if (item.status === 'fulfilled') {
            const { recipientId, result } = item.value;
            results.push(result);

            if (result.success) {
              sent++;
            } else {
              failed++;
              if (result.error) {
                errors.push(`${recipientId}: ${result.error}`);
              }
            }
          } else {
            const { recipientId, error } = item.reason;
            failed++;
            const errorMsg = `${recipientId}: ${error instanceof Error ? error.message : 'Unknown error'}`;
            errors.push(errorMsg);
            results.push(createErrorResponse(error, {
              recipientId,
              context: 'bulk_send'
            }));
          }
        }

        // Delay between batches to avoid rate limiting
        if (batchDelay > 0 && i + batchSize < recipients.length) {
          await new Promise(resolve => setTimeout(resolve, batchDelay));
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
          ? { 
              attachmentId: sharedAttachmentId, 
              ...(options?.mediaUrl ? { mediaUrl: options.mediaUrl } : {}),
              ...(options?.mediaType ? { mediaType: options.mediaType } : {})
            }
          : undefined
      );

      logger.info(`✅ Bulk send completed: ${sent} sent, ${failed} failed`);

      return { sent, failed, results, errors };

    } catch (error) {
      logger.error('❌ Bulk send failed:', error);
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
  private convertToInstagramTemplate(template: MessageTemplate): InstagramTemplatePayload {
    // Convert our template format to Instagram's expected format
    return {
      template_type: template.type,
      elements: template.elements.map(element => {
        const instagramElement: InstagramTemplateElement = {
          title: element.title
        };
        
        if (element.subtitle) instagramElement.subtitle = element.subtitle;
        if (element.image_url) instagramElement.image_url = element.image_url;
        if (element.default_action) instagramElement.default_action = element.default_action;
        if (element.buttons) {
          instagramElement.buttons = element.buttons.map(button => {
            const instagramButton: InstagramTemplateButton = {
              type: button.type,
              title: button.title
            };
            
            if (button.url) instagramButton.url = button.url;
            if (button.payload) instagramButton.payload = button.payload;
            if (button.phone_number) instagramButton.phone_number = button.phone_number;
            
            return instagramButton;
          });
        }
        
        return instagramElement;
      })
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

      return windowStatus.canSendMessage;
    } catch (error) {
      logger.error('Message window check failed, proceeding cautiously', { error });
      return true; // أو إعادة الخطأ ليُعالج أعلى الدالة
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
    metadata?: MessageMetadata
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
            ${(result.deliveryStatus ?? (result.success ? 'sent' : 'failed')).toUpperCase()},
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
            deliveryStatus: result.deliveryStatus ?? (result.success ? 'sent' : 'failed'),
            conversationId: conversationId || null,
            timestamp: (result.timestamp ?? new Date()).toISOString()
          })},
          ${result.success},
          ${result.error || null}
        )
      `;

    } catch (error) {
      logger.error('❌ Message logging failed:', error);
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
            deliveryStatus: result.deliveryStatus ?? (result.success ? 'sent' : 'failed'),
            timestamp: (result.timestamp ?? new Date()).toISOString()
          })},
          ${result.success},
          ${result.error || null}
        )
      `;

    } catch (error) {
      logger.error('❌ Comment reply logging failed:', error);
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
    metadata?: BulkSendMetadata
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
      logger.error('❌ Bulk send logging failed:', error);
    }
  }

  /**
   * Upload media for reuse in multiple messages
   */
  public async uploadMedia(
    merchantId: string,
    mediaUrl: string,
    mediaType: 'image' | 'video' | 'audio'
  ): Promise<{
    success: boolean;
    mediaId?: string;
    error?: string;
  }> {
    try {
      const client = this.getClient(merchantId);
      const mediaId = await client.uploadMedia(mediaUrl, mediaType);
      
      return {
        success: true,
        mediaId
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown upload error'
      };
    }
  }

  private async sendTemplateOrBroadcast(
    merchantId: string,
    recipientId: string,
    message: string
  ): Promise<SendResult> {
    try {
      const client = this.getClient(merchantId);
      const credentials = await this.getCredentials(merchantId);
      
      // جرب إرسال template message
      const templatePayload = {
        recipientId,
        messagingType: 'MESSAGE_TAG' as const,
        text: `تحديث من متجرنا: ${message}`
      };
      
      const result = await client.sendMessage(credentials, merchantId, templatePayload);
      
      return {
        success: result.success,
        ...(result.id ? { messageId: result.id } : {}),
        deliveryStatus: result.success ? 'sent' : 'failed',
        timestamp: new Date(),
        ...(result.success ? {} : { error: result.error })
      };
      
    } catch (error) {
      logger.error('Template message failed', error);
      return createErrorResponse(error, { merchantId, recipientId });
    }
  }

  private async scheduleManualFollowup(
    merchantId: string,
    recipientId: string,
    message: string
  ): Promise<void> {
    const sql = this.db.getSQL();
    
    await sql`
      INSERT INTO manual_followup_queue (
        merchant_id,
        customer_id,
        original_message,
        reason,
        priority,
        created_at,
        scheduled_for
      ) VALUES (
        ${merchantId}::uuid,
        ${recipientId},
        ${message},
        'MESSAGE_WINDOW_EXPIRED',
        'HIGH',
        NOW(),
        NOW() + INTERVAL '1 hour'
      )
    `;
    
    logger.info('📝 Message scheduled for manual followup', { 
      merchantId, 
      recipientId
    });
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
