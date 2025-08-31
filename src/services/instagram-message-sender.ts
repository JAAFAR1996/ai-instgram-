/**
 * ===============================================
 * Instagram Message Sender - ManyChat-Only Architecture
 * All direct Instagram sending disabled - use ManyChat Bridge
 * ===============================================
 */

import { getLogger } from './logger.js';
import type { SendResult } from '../types/instagram.js';

const logger = getLogger({ component: 'InstagramMessageSender' });

export class InstagramMessageSender {
  /**
   * Send text message to Instagram user
   * DISABLED: System now uses ManyChat-only architecture
   */
  public async sendTextMessage(
    merchantId: string,
    recipientUsername: string,
    _messageText: string,
    conversationId?: string
  ): Promise<SendResult> {
    // ARCHITECTURE ENFORCEMENT: Only ManyChat is allowed
    const error = new Error('Instagram direct sending disabled - use ManyChat-only architecture');
    
    logger.error('❌ Direct Instagram sending attempted but system is ManyChat-only', {
      merchantId,
      recipientUsername,
      conversationId,
      message: 'Use ManyChat Bridge instead'
    });
    
    return {
      success: false,
      deliveryStatus: 'failed',
      timestamp: new Date(),
      error: error.message,
      platform: 'disabled'
    };
  }

  /**
   * Send media message (image, video, audio)
   * DISABLED: System now uses ManyChat-only architecture
   */
  public async sendMediaMessage(
    merchantId: string,
    recipientUsername: string,
    _mediaUrl: string,
    _mediaType: 'image' | 'video' | 'audio',
    _caption?: string,
    conversationId?: string,
    _attachmentId?: string
  ): Promise<SendResult> {
    // ARCHITECTURE ENFORCEMENT: Only ManyChat is allowed
    const error = new Error('Instagram direct media sending disabled - use ManyChat-only architecture');
    
    logger.error('❌ Direct Instagram media sending attempted but system is ManyChat-only', {
      merchantId,
      recipientUsername,
      conversationId,
      message: 'Use ManyChat Bridge instead'
    });
    
    return {
      success: false,
      deliveryStatus: 'failed',
      timestamp: new Date(),
      error: error.message,
      platform: 'disabled'
    };
  }

  /**
   * Send template message
   * DISABLED: System now uses ManyChat-only architecture
   */
  public async sendTemplateMessage(
    merchantId: string,
    recipientUsername: string,
    _template: any,
    conversationId?: string
  ): Promise<SendResult> {
    // ARCHITECTURE ENFORCEMENT: Only ManyChat is allowed
    const error = new Error('Instagram template sending disabled - use ManyChat-only architecture');
    
    logger.error('❌ Direct Instagram template sending attempted but system is ManyChat-only', {
      merchantId,
      recipientUsername,
      conversationId,
      message: 'Use ManyChat Bridge instead'
    });
    
    return {
      success: false,
      deliveryStatus: 'failed',
      timestamp: new Date(),
      error: error.message,
      platform: 'disabled'
    };
  }

  /**
   * Reload merchant (disabled - for compatibility only)
   */
  public async reloadMerchant(_merchantId: string): Promise<void> {
    // No-op for ManyChat-only architecture
  }

  /**
   * Dispose resources (disabled - for compatibility only)  
   */
  public dispose(): void {
    // No-op for ManyChat-only architecture
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