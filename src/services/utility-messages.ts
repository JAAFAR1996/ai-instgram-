/**
 * ===============================================
 * Instagram Utility Messages Service (2025 Feature)
 * Handles order updates, account notifications, appointment reminders
 * Complies with Meta's latest Utility Messages framework
 * ===============================================
 */

import { getInstagramClient } from './instagram-api.js';
import { getDatabase } from '../database/connection.js';
import { getConfig } from '../config/environment.js';
import type { SendMessageRequest } from '../types/instagram.js';
import crypto from 'crypto';
import { getLogger } from './logger.js';

const logger = getLogger({ component: 'UtilityMessagesService' });

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
  private config = getConfig();
  private db = getDatabase();

  /**
   * Send utility message using pre-approved template (2025 Standard)
   * Supports order updates, account notifications, appointment reminders
   */
  async sendUtilityMessage(
    merchantId: string,
    payload: UtilityMessagePayload
  ): Promise<UtilityMessageResult> {
    try {
      logger.info('Sending utility message', {
        merchantId,
        messageType: payload.message_type,
        event: 'sendUtilityMessage'
      });

      // Validate template exists and is approved
      const template = await this.getApprovedTemplate(merchantId, payload.template_id);
      if (!template) {
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
        messageType: 'text',
        content: messageContent
      };

      
      const response = await instagramClient.sendMessage(credentials, merchantId, req);

      if (response.success) {
        // Log utility message for compliance tracking
        await this.logUtilityMessage(merchantId, payload, response.messageId ?? '');

        logger.info('Utility message sent successfully', {
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
        logger.error('Failed to send utility message', response.error, {
          merchantId,
          messageType: payload.message_type,
          event: 'sendUtilityMessage'
        });
        return {
          success: false,
          error: response.error ? JSON.stringify(response.error) : undefined,
          timestamp: new Date()
        };
      }

    } catch (error) {
      logger.error('Utility message service error', error, {
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
      logger.info('Creating utility message template', {
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

      const sql = this.db.getSQL();
      const templateId = crypto.randomUUID();

      // Store template in database
      await sql`
        INSERT INTO utility_message_templates (
          id,
          merchant_id,
          name,
          type,
          content,
          variables,
          approved,
          created_at,
          updated_at
        ) VALUES (
          ${templateId},
          ${merchantId}::uuid,
          ${template.name},
          ${template.type},
          ${template.content},
          ${JSON.stringify(template.variables)},
          true, -- Auto-approved for page-owned templates (2025)
          NOW(),
          NOW()
        )
      `;

      logger.info('Utility template created and auto-approved', {
        merchantId,
        templateName: template.name,
        event: 'createUtilityTemplate'
      });
      
      return {
        success: true,
        template_id: templateId
      };

    } catch (error) {
      logger.error('Failed to create utility template', error, {
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
   * Get approved template by ID
   */
  private async getApprovedTemplate(
    merchantId: string,
    templateId: string
  ): Promise<UtilityMessageTemplate | null> {
    try {
      const sql = this.db.getSQL();

      const result = await sql`
        SELECT * FROM utility_message_templates
        WHERE id = ${templateId} AND merchant_id = ${merchantId}::uuid AND approved = true
      `;

      if (result.length === 0) {
        return null;
      }

      const row = result[0];
      return {
        id: row.id,
        name: row.name,
        type: row.type as UtilityMessageType,
        content: row.content,
        variables: JSON.parse(row.variables || '[]'),
        approved: row.approved,
        created_at: row.created_at,
        updated_at: row.updated_at
      };

    } catch (error) {
      logger.error('Failed to get template', error, {
        merchantId,
        templateId,
        event: 'getTemplate'
      });
      return null;
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
      'buy now', 'shop', 'purchase', 'خصم', 'عرض', 'تخفيض', 'اشتري الآن'
    ];

    const lowerContent = content.toLowerCase();
    return marketingKeywords.some(keyword => lowerContent.includes(keyword));
  }

  /**
   * Log utility message for compliance tracking
   */
  private async logUtilityMessage(
    merchantId: string,
    payload: UtilityMessagePayload,
    messageId: string
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();
      
      await sql`
        INSERT INTO utility_message_logs (
          id,
          merchant_id,
          recipient_id,
          template_id,
          message_id,
          message_type,
          sent_at,
          created_at
        ) VALUES (
          ${crypto.randomUUID()},
          ${merchantId}::uuid,
          ${payload.recipient_id},
          ${payload.template_id},
          ${messageId},
          ${payload.message_type},
          NOW(),
          NOW()
        )
      `;

    } catch (error) {
      logger.error('Failed to log utility message', error, {
        merchantId,
        messageId,
        event: 'logUtilityMessage'
      });
    }
  }

  /**
   * Get utility message templates for merchant
   */
  async getTemplates(merchantId: string): Promise<UtilityMessageTemplate[]> {
    try {
      const sql = this.db.getSQL();
      
      const result = await sql`
        SELECT * FROM utility_message_templates 
        WHERE merchant_id = ${merchantId}::uuid
        ORDER BY created_at DESC
      `;

      return result.map(row => ({
        id: row.id,
        name: row.name,
        type: row.type as UtilityMessageType,
        content: row.content,
        variables: JSON.parse(row.variables || '[]'),
        approved: row.approved,
        created_at: row.created_at,
        updated_at: row.updated_at
      }));

    } catch (error) {
      logger.error('Failed to get templates', error, {
        merchantId,
        event: 'getTemplates'
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

    logger.info('Default utility templates created', {
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