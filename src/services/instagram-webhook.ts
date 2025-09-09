/**
 * ===============================================
 * Instagram Webhook Handler
 * Processes Instagram Graph API webhook events
 * DISABLED: Use ManyChat flow only
 * ===============================================
 */

import * as crypto from 'crypto';
import { createLogger } from './logger.js';
import { verifyHMACRaw } from './encryption.js';


export function verifySignature(
  signature: string,
  rawBody: Buffer,
  appSecret: string
): void {
  const result = verifyHMACRaw(rawBody, signature, appSecret);
  if (!result.ok) {
    throw new Error(`Invalid signature: ${result.reason}`);
  }
}

export interface InstagramWebhookEvent {
  object: 'instagram';
  entry: InstagramWebhookEntry[];
}

export interface InstagramWebhookEntry {
  id: string; // Instagram Business Account ID
  time: number;
  messaging?: InstagramMessagingEvent[];
  comments?: InstagramCommentEvent[];
  mentions?: InstagramMentionEvent[];
}

export interface InstagramMessagingEvent {
  sender: {
    id: string;
    username?: string; // May not always be present
  };
  recipient: {
    id: string;
  };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    attachments?: Array<{
      type: string;
      payload: {
        url: string;
      };
    }>;
  };
  postback?: {
    title: string;
    payload: string;
    mid: string;
  };
}

export interface InstagramCommentEvent {
  field: 'comments';
  value: {
    from: {
      id: string;
      username: string;
    };
    media: {
      id: string;
      media_product_type: string;
    };
    text: string;
    id: string;
    created_time: string;
  };
}

export interface InstagramMentionEvent {
  field: 'mentions';
  value: {
    from: {
      id: string;
      username: string;
    };
    media: {
      id: string;
      media_url?: string;
    };
    comment_id: string;
    created_time: string;
  };
}

export interface ProcessedWebhookResult {
  success: boolean;
  eventsProcessed: number;
  conversationsCreated: number;
  messagesProcessed: number;
  errors: string[];
}

interface Logger {
  info: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, error?: Error | unknown, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
}

export class InstagramWebhookHandler {
  private logger!: Logger;

  constructor() {
    this.initializeLegacy();
  }

  private initializeLegacy(): void {
    this.logger = createLogger({ component: 'InstagramWebhook' });
  }

  /**
   * Verify signature and process raw webhook payload
   */
  public async processRawWebhook(
    headers: Record<string, string | undefined>,
    rawBody: Buffer,
    merchantId: string,
    appSecret: string
  ): Promise<ProcessedWebhookResult> {
    const signature = headers['x-hub-signature-256'] ?? '';
    verifySignature(signature, rawBody, appSecret);
    let payload: InstagramWebhookEvent;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as InstagramWebhookEvent;
    } catch (error) {
      this.logger.error('Failed to parse Instagram webhook payload', error, { merchantId });
      return {
        success: false,
        eventsProcessed: 0,
        conversationsCreated: 0,
        messagesProcessed: 0,
        errors: ['Invalid JSON payload']
      };
    }
    return this.processWebhook(payload, merchantId);
  }

  /**
   * Process Instagram webhook payload
   */
  public async processWebhook(
    payload: InstagramWebhookEvent,
    merchantId: string
  ): Promise<ProcessedWebhookResult> {
    this.logger.info('📷 Processing Instagram webhook', {
      merchantId,
      entriesCount: payload.entry?.length || 0,
      object: payload.object
    });
    
    const result: ProcessedWebhookResult = {
      success: true,
      eventsProcessed: 0,
      conversationsCreated: 0,
      messagesProcessed: 0,
      errors: []
    };

    // معالجة حقيقية للـ webhook
    if (!payload.entry || !Array.isArray(payload.entry)) {
      this.logger.warn('Invalid webhook payload structure', { merchantId });
      return result;
    }

    for (const entry of payload.entry) {
      try {
        // معالجة الرسائل
        if (entry.messaging) {
          for (const event of entry.messaging) {
            if (event.message) {
              await this.processMessage(event, merchantId);
              result.messagesProcessed++;
            }
          }
        }
        
        // معالجة التعليقات (إذا كانت متوفرة)
        if ((entry as any).changes) {
          for (const change of (entry as any).changes) {
            if (change.field === 'comments') {
              await this.processComment(change, merchantId);
              result.eventsProcessed++;
            }
          }
        }
        
        result.eventsProcessed++;
      } catch (error) {
        this.logger.error('Error processing webhook entry', { 
          error: String(error),
          merchantId 
        });
        result.errors.push(String(error));
      }
    }

    return result;
  }

  /**
   * معالجة رسالة Instagram
   */
  private async processMessage(event: any, merchantId: string): Promise<void> {
    try {
      // استخدام ManyChat Bridge لمعالجة الرسالة
      const { InstagramManyChatBridge } = await import('./instagram-manychat-bridge.js');
      const bridge = new InstagramManyChatBridge();
      
      await bridge.processMessage({
        merchantId,
        customerId: event.sender.id,
        message: event.message.text || '',
        platform: 'instagram',
        interactionType: 'dm',
        conversationId: undefined
      }, {
        useManyChat: false, // تعطيل ManyChat لاستخدام Local AI
        fallbackToLocalAI: true,
        priority: 'normal'
      });
      
    } catch (error) {
      this.logger.error('Error processing Instagram message', { 
        error: String(error),
        merchantId,
        senderId: event.sender?.id 
      });
    }
  }

  /**
   * معالجة تعليق Instagram
   */
  private async processComment(change: any, merchantId: string): Promise<void> {
    try {
      // استخدام ManyChat Bridge لمعالجة التعليق
      const { InstagramManyChatBridge } = await import('./instagram-manychat-bridge.js');
      const bridge = new InstagramManyChatBridge();
      
      await bridge.processMessage({
        merchantId,
        customerId: change.value.from.username || change.value.from.id,
        message: change.value.text || '',
        platform: 'instagram',
        interactionType: 'comment',
        conversationId: undefined
      }, {
        useManyChat: false, // تعطيل ManyChat لاستخدام Local AI
        fallbackToLocalAI: true,
        priority: 'normal'
      });
      
    } catch (error) {
      this.logger.error('Error processing Instagram comment', { 
        error: String(error),
        merchantId,
        commentId: change.value?.id 
      });
    }
  }

  /**
   * Verify webhook challenge (for initial setup)
   */
  public verifyWebhookChallenge(
    mode: string,
    token: string,
    challenge: string,
    expectedVerifyToken: string
  ): string | null {
    if (mode === 'subscribe') {
      if (token.length !== expectedVerifyToken.length) {
        this.logger.error('Instagram webhook verification failed: token length mismatch');
        return null;
      }

      if (crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedVerifyToken))) {
        this.logger.info('Instagram webhook verification successful');
        return challenge;
      }
    }

    this.logger.error('Instagram webhook verification failed');
    return null;
  }
}

// Singleton instance
let webhookHandlerInstance: InstagramWebhookHandler | null = null;

export async function getInstagramWebhookHandler(): Promise<InstagramWebhookHandler> {
  if (!webhookHandlerInstance) {
    webhookHandlerInstance = new InstagramWebhookHandler();
  }
  return webhookHandlerInstance;
}

export default InstagramWebhookHandler;