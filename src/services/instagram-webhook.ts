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
    // 🚫 DISABLED: Instagram direct webhook completely disabled - use ManyChat only
    this.logger.info('🚫 Instagram direct webhook disabled - use ManyChat only', {
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

    // Return immediately - Instagram direct processing disabled
    return result;
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