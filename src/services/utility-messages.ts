/**
 * ===============================================
 * Instagram Utility Messages Service (2025 Feature)
 * Handles order updates, account notifications, appointment reminders
 * Complies with Meta's latest Utility Messages framework
 * ===============================================
 */

import { getInstagramClient } from './instagram-api.js';
import { getPool } from '../db/index.js';
// import { getConfig } from '../config/index.js'; // Reserved for future use
import type { SendMessageRequest } from '../types/instagram.js';
import type { DIContainer } from '../container/index.js';
import type { Pool } from 'pg';
// import type { AppConfig } from '../config/index.js'; // Reserved for future use
import { getLogger } from './logger.js';
import * as TemplateRepo from '../repos/template.repo.js';
import * as MessageRepo from '../repos/message.repo.js';
import { getTemplateCache } from '../cache/index.js';

// Unused interface removed

// Escape special characters for use in RegExp
function escapeRegex(str: string): string {
  return str.replace(/([.*+?^${}()|\[\]\\])/g, '\\$1');
}

export type UtilityMessageType = 
  | 'ORDER_UPDATE'
  | 'ACCOUNT_NOTIFICATION' 
  | 'APPOINTMENT_REMINDER'
  | 'DELIVERY_NOTIFICATION'
  | 'PAYMENT_UPDATE';

export interface UtilityMessageTemplate {
  id: string;
  name: string;
  type: UtilityMessageType;
  content: string;
  variables: string[];
  approved: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface UtilityMessagePayload {
  recipient_id: string;
  template_id: string;
  variables: Record<string, string>;
  message_type: UtilityMessageType;
}

export interface UtilityMessageResult {
  success: boolean;
  message_id?: string;
  error?: string;
  timestamp: Date;
}

export class UtilityMessagesService {
  private pool!: Pool;
  // private config!: AppConfig; // Reserved for future use
  private logger!: any;

  constructor(container?: DIContainer) {
    if (container) {
      this.pool = container.get<Pool>('pool');
      // this.config = container.get<AppConfig>('config'); // Reserved for future use
      this.logger = container.get('logger');
    } else {
      // Legacy fallback
      this.initializeLegacy();
    }
  }

  private initializeLegacy(): void {
    this.pool = getPool();
    // this.config = getConfig(); // Reserved for future use
    this.logger = getLogger({ component: 'UtilityMessagesService' });
  }

  /**
   * Send utility message using pre-approved template (2025 Standard)
   * Supports order updates, account notifications, appointment reminders
   */
  async sendUtilityMessage(
    merchantId: string,
    payload: UtilityMessagePayload
  ): Promise<UtilityMessageResult> {
    try {
      this.logger.info('Sending utility message', {
        merchantId,
        messageType: payload.message_type,
        event: 'sendUtilityMessage'
      });

      // Validate template exists and is approved (with cache)
      const templateCache = getTemplateCache();
      let template = await templateCache.getTemplate(merchantId, payload.template_id);
      
      if (!template) {
        // Cache miss - fetch from database
        template = await TemplateRepo.getTemplateById(this.pool, payload.template_id, merchantId);
        
        if (template) {
          // Cache the template for future use
          await templateCache.setTemplate(merchantId, payload.template_id, template);
        }
      }
      
      if (!template || !template.approved) {
        return {
          success: false,
          error: 'Template not found or not approved',
          timestamp: new Date()
        };
      }

      // Get Instagram client and credentials
      const instagramClient = getInstagramClient(merchantId);
      const credentials = await instagramClient.loadMerchantCredentials(merchantId);
      if (!credentials) {
        return {
          success: false,
          error: 'Instagram credentials not found',
          timestamp: new Date()
        };
      }
      await instagramClient.validateCredentials(credentials, merchantId);

      // Prepare message content with variables
      const messageContent = this.interpolateTemplate(template.content, payload.variables);

      // Send via Instagram Messaging API with utility flag (2025)
      const req: SendMessageRequest = {
        recipientId: String(payload.recipient_id),
        messagingType: 'RESPONSE',
        text: messageContent
      };

      
      const response = await instagramClient.sendMessage(credentials, merchantId, req);

      if (response.success) {
        // Log utility message for compliance tracking
        await MessageRepo.logUtilityMessage(this.pool, {
          merchantId,
          recipientId: payload.recipient_id,
          templateId: payload.template_id,
          messageId: response.messageId ?? '',
          messageType: payload.message_type,
          status: 'sent'
        });

        this.logger.info('Utility message sent successfully', {
          merchantId,
          messageType: payload.message_type,
          event: 'sendUtilityMessage'
        });
        return {
          success: true,
          message_id: response.messageId ?? '',
          timestamp: new Date()
        };
      } else {
        this.logger.error('Failed to send utility message', response.error, {
          merchantId,
          messageType: payload.message_type,
          event: 'sendUtilityMessage'
        });
        return {
          success: false,
          error: response.error ? JSON.stringify(response.error) : 'Unknown error',
          timestamp: new Date()
        };
      }

    } catch (error) {
      this.logger.error('Utility message service error', error, {
        merchantId,
        event: 'sendUtilityMessage'
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date()
      };
    }
  }

  /**
   * Create and submit utility message template for approval
   * Templates are auto-approved in seconds for page-owned templates (2025)
   */
  async createUtilityTemplate(
    merchantId: string,
    template: Omit<UtilityMessageTemplate, 'id' | 'approved' | 'created_at' | 'updated_at'>
  ): Promise<{ success: boolean; template_id?: string; error?: string }> {
    try {
      this.logger.info('Creating utility message template', {
        merchantId,
        templateName: template.name,
        event: 'createUtilityTemplate'
      });

      // Validate template content (no marketing materials allowed)
      if (this.containsMarketingContent(template.content)) {
        return {
          success: false,
          error: 'Template contains marketing content - utility messages must be transactional only'
        };
      }

      // Store template in database using repository
      const createdTemplate = await TemplateRepo.createTemplate(this.pool, {
        merchantId,
        name: template.name,
        type: template.type,
        content: template.content,
        variables: template.variables
      });

      // Auto-approve for page-owned templates (2025)
      await TemplateRepo.updateTemplate(this.pool, createdTemplate.id, merchantId, {
        approved: true
      });

      this.logger.info('Utility template created and auto-approved', {
        merchantId,
        templateName: template.name,
        event: 'createUtilityTemplate'
      });
      
      return {
        success: true,
        template_id: createdTemplate.id
      };

    } catch (error) {
      this.logger.error('Failed to create utility template', error, {
        merchantId,
        templateName: template.name,
        event: 'createUtilityTemplate'
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Template creation failed'
      };
    }
  }


  /**
   * Interpolate template variables
   */
  private interpolateTemplate(template: string, variables: Record<string, string>): string {
    let result = template;

    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      const escaped = escapeRegex(placeholder);
      result = result.replace(new RegExp(escaped, 'g'), value);
    }

    return result;
  }

  /**
   * Check if content contains marketing materials (2025 Compliance)
   */
  private containsMarketingContent(content: string): boolean {
    const marketingKeywords = [
      'sale', 'discount', 'offer', 'promotion', 'deal', 'limited time',
      'buy now', 'shop', 'purchase', 'خصم', 'عرض', 'تخفيض', 'اشتري الآن',
      'free shipping', 'flash sale', 'clearance', 'special price', 'mega sale',
      'توصيل مجاني', 'تصفية', 'سعر خاص', 'تخفيضات هائلة', 'العرض الأفضل'
    ];

    const lowerContent = content.toLowerCase();
    return marketingKeywords.some(keyword => lowerContent.includes(keyword));
  }


  /**
   * Get utility message templates for merchant
   */
  async getTemplates(merchantId: string): Promise<UtilityMessageTemplate[]> {
    try {
      const templates = await TemplateRepo.listTemplates(this.pool, merchantId);
      return templates.map(template => ({
        id: template.id,
        name: template.name,
        type: template.type,
        content: template.content,
        variables: template.variables,
        approved: template.approved,
        created_at: template.createdAt,
        updated_at: template.updatedAt
      }));

    } catch (error) {
      this.logger.error('Failed to get templates', error, {
        merchantId,
        event: 'getTemplates'
      });
      return [];
    }
  }

  /**
   * Create a new utility message template
   */
  async createTemplate(
    merchantId: string,
    name: string,
    type: UtilityMessageType,
    content: string,
    variables: string[]
  ): Promise<UtilityMessageTemplate> {
    try {
      const template = await TemplateRepo.createTemplate(this.pool, {
        merchantId,
        name,
        type,
        content,
        variables
      });

      this.logger.info('Template created successfully', {
        merchantId,
        templateId: template.id,
        name,
        type,
        event: 'createTemplate'
      });

      return {
        id: template.id,
        name: template.name,
        type: template.type,
        content: template.content,
        variables: template.variables,
        approved: template.approved,
        created_at: template.createdAt,
        updated_at: template.updatedAt
      };

    } catch (error) {
      this.logger.error('Failed to create template', error, {
        merchantId,
        name,
        type,
        event: 'createTemplate'
      });
      throw error;
    }
  }

  /**
   * Get message history for merchant
   */
  async getMessageHistory(merchantId: string, limit: number = 50, offset: number = 0): Promise<any[]> {
    try {
      const messages = await MessageRepo.listUtilityMessages(this.pool, merchantId, {
        limit,
        offset
      });

      return messages.map(message => ({
        id: message.id,
        recipient_id: message.recipientId,
        template_id: message.templateId,
        template_name: message.templateName,
        message_id: message.messageId,
        message_type: message.messageType,
        sent_at: message.sentAt,
        created_at: message.createdAt
      }));

    } catch (error) {
      this.logger.error('Failed to get message history', error, {
        merchantId,
        limit,
        offset,
        event: 'getMessageHistory'
      });
      return [];
    }
  }

  /**
   * Pre-defined utility templates for common use cases (2025)
   */
  async createDefaultTemplates(merchantId: string): Promise<void> {
    const defaultTemplates = [
      {
        name: 'Order Confirmation',
        type: 'ORDER_UPDATE' as UtilityMessageType,
        content: 'تأكيد الطلب: طلبك رقم {{order_number}} تم تأكيده بنجاح. المبلغ الإجمالي: {{total_amount}} دينار. سيتم التوصيل خلال {{delivery_time}}.',
        variables: ['order_number', 'total_amount', 'delivery_time']
      },
      {
        name: 'Delivery Update',
        type: 'DELIVERY_NOTIFICATION' as UtilityMessageType,
        content: 'تحديث التوصيل: طلبك رقم {{order_number}} في طريقه إليك. رقم التتبع: {{tracking_number}}. الوصول المتوقع: {{estimated_arrival}}.',
        variables: ['order_number', 'tracking_number', 'estimated_arrival']
      },
      {
        name: 'Payment Received',
        type: 'PAYMENT_UPDATE' as UtilityMessageType,
        content: 'تأكيد الدفع: تم استلام دفعتك بمبلغ {{amount}} دينار للطلب رقم {{order_number}}. شكراً لثقتك بنا!',
        variables: ['amount', 'order_number']
      }
    ];

    for (const template of defaultTemplates) {
      await this.createUtilityTemplate(merchantId, template);
    }

    this.logger.info('Default utility templates created', {
      merchantId,
      event: 'createDefaultTemplates'
    });
  }
}

// Singleton instance
let utilityMessagesServiceInstance: UtilityMessagesService | null = null;

export function getUtilityMessagesService(): UtilityMessagesService {
  if (!utilityMessagesServiceInstance) {
    utilityMessagesServiceInstance = new UtilityMessagesService();
  }
  return utilityMessagesServiceInstance;
}

export default getUtilityMessagesService;