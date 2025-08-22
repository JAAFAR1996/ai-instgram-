/**
 * ===============================================
 * Webhook Job Processor
 * Async processing for webhook events
 * ===============================================
 */

import type { Job } from 'bull';
import type { JobProcessor } from '../message-queue.js';
import { getInstagramWebhookHandler } from '../../services/instagram-webhook.js';
import { getRepositories } from '../../repositories/index.js';
import { getLogger } from '../../services/logger.js';

export interface WebhookJobPayload {
  platform: 'instagram';
  merchantId: string;
  webhookData: any;
  signature?: string;
  retryCount?: number;
}

export class WebhookProcessor implements JobProcessor {
  private repositories = getRepositories();
  private logger = getLogger({ component: 'WebhookProcessor' });

  async process(job: Job): Promise<{ success: boolean; result?: any; error?: string }> {
    const payload = ((job as any).data ?? (job as any).payload) as WebhookJobPayload;

    try {
      this.logger.info('Processing webhook job', { platform: payload.platform, merchantId: payload.merchantId });
      
      // Validate merchant exists and is active
      const merchant = await this.repositories.merchant.findById(payload.merchantId);
      if (!merchant) {
        return { success: false, error: `Merchant not found: ${payload.merchantId}` };
      }
      
      if (!merchant.isActive) {
        return { success: false, error: `Merchant is inactive: ${payload.merchantId}` };
      }

      // Check message limits
      const messageLimit = await this.repositories.merchant.canSendMessage(payload.merchantId);
      if (!messageLimit.canSend) {
        return { 
          success: false, 
          error: `Merchant has reached message limit: ${messageLimit.remaining}/${messageLimit.limit}` 
        };
      }

      let result;
      
      switch (payload.platform) {
        case 'instagram':
          result = await this.processInstagramWebhook(payload);
          break;
          
          
        default:
          return { success: false, error: `Unsupported platform: ${payload.platform}` };
      }

      // Update merchant activity
      await this.repositories.merchant.updateLastActive(payload.merchantId);

      return { success: true, result };
      
    } catch (error) {
        this.logger.error('Webhook processing error', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown webhook processing error'
        };
      }
    }

    /**
     * Process Instagram webhook
     */
    private async processInstagramWebhook(payload: WebhookJobPayload): Promise<any> {
      const webhookHandler = getInstagramWebhookHandler();
      
      const result = await webhookHandler.processWebhook(
        payload.webhookData,
        payload.merchantId
      );

      if (!result.success) {
        throw new Error(`Instagram webhook processing failed: ${result.errors.join(', ')}`);
      }

      // Increment message usage for processed messages
      if (result.messagesProcessed > 0) {
        await this.repositories.merchant.incrementMessageUsage(
          payload.merchantId, 
          result.messagesProcessed
        );
      }

      return {
        platform: 'instagram',
        eventsProcessed: result.eventsProcessed,
        messagesProcessed: result.messagesProcessed,
        conversationsCreated: result.conversationsCreated,
        processingTime: Date.now()
      };
    }
  }

// Export processor instance
export const webhookProcessor = new WebhookProcessor();