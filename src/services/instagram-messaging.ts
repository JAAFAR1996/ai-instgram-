/**
 * ===============================================
 * Instagram Messaging Service - Legacy Compatibility Layer
 * This service now delegates to the unified InstagramMessageSender
 * ===============================================
 */

import { getLogger } from './logger.js';
import { getInstagramMessageSender } from './instagram-message-sender.js';
import type { SendResult } from '../types/instagram.js';

const logger = getLogger({ component: 'InstagramMessagingService' });

// Legacy response type for backward compatibility
export interface InstagramMessageResponse {
  messageId: string;
  recipientId: string;
  success: boolean;
  error?: string | undefined;
}

export interface InstagramMessage {
  id: string;
  recipientId: string;
  messageType: 'text' | 'image' | 'generic';
  content: string;
  mediaUrl?: string;
  timestamp: Date;
}

export interface MessageContext {
  conversationId: string;
  lastMessageTime?: Date;
  withinWindow: boolean;
  windowExpiresAt?: Date;
}

export class InstagramMessagingService {
  private messageSender = getInstagramMessageSender();

  /**
   * Convert SendResult to legacy InstagramMessageResponse format
   */
  private convertToLegacyResponse(
    result: SendResult, 
    recipientId: string
  ): InstagramMessageResponse {
    return {
      messageId: result.messageId || '',
      recipientId,
      success: result.success,
      error: result.error
    };
  }

  /**
   * Handle errors and return legacy response format
   */
  private handleError(
    error: unknown, 
    recipientId: string
  ): InstagramMessageResponse {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('❌ Instagram messaging failed:', errorMessage);
    
    return {
      messageId: '',
      recipientId,
      success: false,
      error: errorMessage
    };
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

      // Delegate to unified message sender
      const result = await this.messageSender.sendTextMessage(
        merchantId,
        recipientId,
        messageText,
        options.conversationId
      );

      // Convert to legacy response format
      return this.convertToLegacyResponse(result, recipientId);

    } catch (error) {
      return this.handleError(error, recipientId);
    }
  }

  /**
   * Get message context for conversation
   */
  async getMessageContext(
    merchantId: string,
    recipientId: string
  ): Promise<MessageContext> {
    // This is a simplified implementation
    // In a real scenario, you'd check the actual message window
    return {
      conversationId: `conv_${merchantId}_${recipientId}`,
      withinWindow: true,
      windowExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours from now
    };
  }

  /**
   * Legacy method - now delegates to unified sender
   */
  async sendMediaMessage(
    merchantId: string,
    recipientId: string,
    mediaUrl: string,
    mediaType: 'image' | 'video' | 'audio',
    caption?: string,
    conversationId?: string
  ): Promise<InstagramMessageResponse> {
    try {
      const result = await this.messageSender.sendMediaMessage(
        merchantId,
        recipientId,
        mediaUrl,
        mediaType,
        caption,
        conversationId
      );

      return this.convertToLegacyResponse(result, recipientId);

    } catch (error) {
      return this.handleError(error, recipientId);
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