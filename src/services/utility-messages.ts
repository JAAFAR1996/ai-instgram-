/**
 * ===============================================
 * Utility Messages Service - Simplified Implementation
 * Handles pre-approved message templates for business communications
 * ===============================================
 */

import { getPool } from '../db/index.js';
import { getDatabase } from '../db/adapter.js';
import { getInstagramMessageSender } from './instagram-message-sender.js';
import { getLogger } from './logger.js';
import type { DIContainer } from '../container/index.js';
import type { Pool } from 'pg';

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
  message_id?: string | undefined;
  error?: string | undefined;
  timestamp: Date;
}

export class UtilityMessagesService {
  private pool!: Pool;
  private logger!: any;
  private messageSender = getInstagramMessageSender();

  constructor(container?: DIContainer) {
    if (container) {
      this.pool = container.get<Pool>('pool');
      this.logger = container.get('logger');
    } else {
      // Legacy fallback
      this.initializeLegacy();
    }
  }

  private initializeLegacy(): void {
    this.pool = getPool();
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

      // Validate template variables for security
      this.validateTemplate(payload.variables);

      // Try to get template from database first, fallback to default templates
      let template = await this.getTemplateFromDatabase(payload.template_id, merchantId);
      if (!template) {
        template = this.getDefaultTemplate(payload.template_id);
      }
      
      if (!template || !template.approved) {
        return {
          success: false,
          error: 'Template not found or not approved',
          timestamp: new Date()
        };
      }

      // Prepare message content with variables
      const messageContent = this.interpolateTemplate(template.content, payload.variables);

      // Send via unified Instagram Message Sender
      const result = await this.messageSender.sendTextMessage(
        merchantId,
        payload.recipient_id,
        messageContent
      );

      if (result.success) {
        // Log utility message for compliance tracking
        await this.logUtilityMessage(merchantId, payload.recipient_id, payload.template_id, result.messageId);

        return {
          success: true,
          message_id: result.messageId,
          timestamp: new Date()
        };
      } else {
        return {
          success: false,
          error: result.error || 'Failed to send utility message',
          timestamp: new Date()
        };
      }

    } catch (error) {
      this.logger.error('Utility message send failed', error, {
        merchantId,
        templateId: payload.template_id,
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
   * Validate template variables for security
   */
  private validateTemplate(variables: Record<string, string>): void {
    for (const [key, value] of Object.entries(variables)) {
      if (typeof value !== 'string') {
        throw new Error(`Invalid template variable type: ${key}`);
      }
      
      // Check for XSS attempts
      if (value.includes('<script>') || value.includes('javascript:') || value.includes('onerror=')) {
        throw new Error(`Invalid template variable content: ${key}`);
      }
      
      // Check for SQL injection attempts
      if (value.includes(';') || value.includes('--') || value.includes('/*')) {
        throw new Error(`Invalid template variable content: ${key}`);
      }
      
      // Check for excessive length
      if (value.length > 1000) {
        throw new Error(`Template variable too long: ${key}`);
      }
    }
  }

  /**
   * Validate template content for security
   */
  private validateTemplateContent(content: string): void {
    if (typeof content !== 'string') {
      throw new Error('Template content must be a string');
    }
    
    // Check for XSS attempts
    if (content.includes('<script>') || content.includes('javascript:') || content.includes('onerror=')) {
      throw new Error('Invalid template content: contains XSS attempt');
    }
    
    // Check for SQL injection attempts
    if (content.includes(';') || content.includes('--') || content.includes('/*')) {
      throw new Error('Invalid template content: contains SQL injection attempt');
    }
    
    // Check for excessive length
    if (content.length > 5000) {
      throw new Error('Template content too long');
    }
  }

  /**
   * Interpolate template variables
   */
  private interpolateTemplate(template: string, variables: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return variables[key] || match;
    });
  }

  /**
   * Get template from database using prepared statements
   */
  private async getTemplateFromDatabase(templateId: string, merchantId: string): Promise<UtilityMessageTemplate | null> {
    try {
      const db = getDatabase();
      const sql = db.getSQL();
      
      const result = await sql`
        SELECT * FROM utility_templates 
        WHERE id = ${templateId} AND merchant_id = ${merchantId}
      `;
      
      if (result.length === 0) {
        return null;
      }
      
      const row = result[0];
      if (!row) {
        return null;
      }
      
      return {
        id: String(row.id),
        name: String(row.name),
        type: String(row.type) as UtilityMessageType,
        content: String(row.content),
        variables: Array.isArray(row.variables) ? row.variables : [],
        approved: Boolean(row.approved),
        created_at: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
        updated_at: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at))
      };
    } catch (error) {
      this.logger.error('Failed to get template from database', error, {
        templateId,
        merchantId
      });
      return null;
    }
  }

  /**
   * Get default template (simplified implementation)
   */
  private getDefaultTemplate(templateId: string): UtilityMessageTemplate | null {
    const defaultTemplates: Record<string, UtilityMessageTemplate> = {
      'order-confirmation': {
        id: 'order-confirmation',
        name: 'Order Confirmation',
        type: 'ORDER_UPDATE',
        content: 'تأكيد الطلب: طلبك رقم {{order_number}} تم تأكيده بنجاح. المبلغ الإجمالي: {{total_amount}} دينار.',
        variables: ['order_number', 'total_amount'],
        approved: true,
        created_at: new Date(),
        updated_at: new Date()
      },
      'delivery-update': {
        id: 'delivery-update',
        name: 'Delivery Update',
        type: 'DELIVERY_NOTIFICATION',
        content: 'تحديث التوصيل: طلبك رقم {{order_number}} في طريقه إليك. رقم التتبع: {{tracking_number}}.',
        variables: ['order_number', 'tracking_number'],
        approved: true,
        created_at: new Date(),
        updated_at: new Date()
      }
    };

    return defaultTemplates[templateId] || null;
  }

  /**
   * Log utility message using prepared statements
   */
  private async logUtilityMessage(
    merchantId: string,
    recipientId: string,
    templateId: string,
    messageId?: string
  ): Promise<void> {
    try {
      const db = getDatabase();
      const sql = db.getSQL();
      
      // Log to database using prepared statement
      await sql`
        INSERT INTO utility_message_logs (
          merchant_id, recipient_id, template_id, message_id, sent_at, created_at
        ) VALUES (
          ${merchantId}, ${recipientId}, ${templateId}, ${messageId || null}, NOW(), NOW()
        )
      `;
      
      this.logger.info('Utility message logged to database', {
        merchantId,
        recipientId,
        templateId,
        messageId: messageId || '',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.logger.error('Failed to log utility message to database', error, {
        merchantId,
        recipientId,
        templateId,
        messageId
      });
      
      // Fallback to simple logging
      this.logger.info('Utility message logged (fallback)', {
        merchantId,
        recipientId,
        templateId,
        messageId: messageId || '',
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Get all templates for a merchant using prepared statements
   */
  async getTemplates(merchantId: string): Promise<UtilityMessageTemplate[]> {
    try {
      const db = getDatabase();
      const sql = db.getSQL();
      
      // Get templates from database using prepared statement
      const result = await sql`
        SELECT * FROM utility_templates 
        WHERE merchant_id = ${merchantId} AND approved = true
        ORDER BY created_at DESC
      `;
      
      const templates: UtilityMessageTemplate[] = result.map(row => ({
        id: String(row.id),
        name: String(row.name),
        type: String(row.type) as UtilityMessageType,
        content: String(row.content),
        variables: Array.isArray(row.variables) ? row.variables : [],
        approved: Boolean(row.approved),
        created_at: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
        updated_at: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at))
      }));
      
      // If no templates found in database, return default templates
      if (templates.length === 0) {
        return [
          {
            id: 'order-confirmation',
            name: 'Order Confirmation',
            type: 'ORDER_UPDATE',
            content: 'تأكيد الطلب: طلبك رقم {{order_number}} تم تأكيده بنجاح.',
            variables: ['order_number'],
            approved: true,
            created_at: new Date(),
            updated_at: new Date()
          },
          {
            id: 'delivery-update',
            name: 'Delivery Update',
            type: 'DELIVERY_NOTIFICATION',
            content: 'تحديث التوصيل: طلبك رقم {{order_number}} في طريقه إليك.',
            variables: ['order_number'],
            approved: true,
            created_at: new Date(),
            updated_at: new Date()
          }
        ];
      }
      
      return templates;
    } catch (error) {
      this.logger.error('Failed to get templates from database', error, { merchantId });
      
      // Fallback to default templates
      return [
        {
          id: 'order-confirmation',
          name: 'Order Confirmation',
          type: 'ORDER_UPDATE',
          content: 'تأكيد الطلب: طلبك رقم {{order_number}} تم تأكيده بنجاح.',
          variables: ['order_number'],
          approved: true,
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          id: 'delivery-update',
          name: 'Delivery Update',
          type: 'DELIVERY_NOTIFICATION',
          content: 'تحديث التوصيل: طلبك رقم {{order_number}} في طريقه إليك.',
          variables: ['order_number'],
          approved: true,
          created_at: new Date(),
          updated_at: new Date()
        }
      ];
    }
  }

  /**
   * Create new template using prepared statements
   */
  async createTemplate(
    merchantId: string,
    template: Omit<UtilityMessageTemplate, 'id' | 'approved' | 'created_at' | 'updated_at'>
  ): Promise<UtilityMessageTemplate> {
    try {
      const db = getDatabase();
      const sql = db.getSQL();
      
      // Validate template content for security
      this.validateTemplateContent(template.content);
      
      // Create template in database using prepared statement
      const result = await sql`
        INSERT INTO utility_templates (
          merchant_id, name, type, content, variables, approved, created_at, updated_at
        ) VALUES (
          ${merchantId}, ${template.name}, ${template.type}, ${template.content}, 
          ${JSON.stringify(template.variables)}, true, NOW(), NOW()
        ) RETURNING *
      `;
      
      if (result.length === 0) {
        throw new Error('Failed to create template in database');
      }
      
      const row = result[0];
      if (!row) {
        throw new Error('Failed to create template in database');
      }
      
      const newTemplate: UtilityMessageTemplate = {
        id: String(row.id),
        name: String(row.name),
        type: String(row.type) as UtilityMessageType,
        content: String(row.content),
        variables: Array.isArray(row.variables) ? row.variables : [],
        approved: Boolean(row.approved),
        created_at: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
        updated_at: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at))
      };

      this.logger.info('Template created in database', { merchantId, templateId: newTemplate.id });
      return newTemplate;
    } catch (error) {
      this.logger.error('Failed to create template in database', error, { merchantId });
      throw error;
    }
  }
}

// Singleton instance
let utilityMessagesInstance: UtilityMessagesService | null = null;

/**
 * Get utility messages service instance
 */
export function getUtilityMessagesService(): UtilityMessagesService {
  if (!utilityMessagesInstance) {
    utilityMessagesInstance = new UtilityMessagesService();
  }
  return utilityMessagesInstance;
}

export default UtilityMessagesService;