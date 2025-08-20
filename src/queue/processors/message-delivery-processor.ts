/**
 * ===============================================
 * Message Delivery Processor
 * Handles sending queued messages via platform APIs
 * ===============================================
 */

import type { QueueJob, JobProcessor } from '../message-queue.js';
import { getInstagramMessageSender, type SendResult } from '../../services/instagram-message-sender.js';
import { getRepositories, type RepositoryManager } from '../../repositories/index.js';

export interface MessageDeliveryJobPayload {
  messageId: string;
  conversationId: string;
  merchantId: string;
  customerId: string;
  content: string;
  platform: 'instagram' | 'whatsapp';
}

export class MessageDeliveryProcessor implements JobProcessor {
  constructor(
    private messageSender = getInstagramMessageSender(),
    private repositories: RepositoryManager = getRepositories()
  ) {}

  async process(job: QueueJob): Promise<{ success: boolean; result?: any; error?: string }> {
    const payload = job.payload as MessageDeliveryJobPayload;

    try {
      console.log(`📤 Delivering message ${payload.messageId} via ${payload.platform}`);

      let sendResult: SendResult | undefined;

      switch (payload.platform) {
        case 'instagram':
          sendResult = await this.messageSender.sendTextMessage(
            payload.merchantId,
            payload.customerId,
            payload.content,
            payload.conversationId
          );
          break;

        case 'whatsapp':
          return { success: false, error: 'WhatsApp delivery not supported' };

        default:
          return { success: false, error: `Unsupported platform: ${payload.platform}` };
      }

      if (sendResult.success) {
        await this.repositories.message.markAsDelivered(
          payload.messageId,
          sendResult.messageId
        );
        return {
          success: true,
          result: { delivered: true, platformMessageId: sendResult.messageId }
        };
      }

      await this.repositories.message.markAsFailed(payload.messageId);
      return {
        success: false,
        error: sendResult.error || 'Message delivery failed'
      };
    } catch (error) {
      try {
        await this.repositories.message.markAsFailed(payload.messageId);
      } catch {
        // ignore repository errors during failure marking
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown message delivery error'
      };
    }
  }
}

// Export processor instance
export const messageDeliveryProcessor = new MessageDeliveryProcessor();