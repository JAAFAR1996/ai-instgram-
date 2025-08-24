/**
 * ===============================================
 * Utility Messages Routes Module
 * Handles Instagram utility messages endpoints
 * ===============================================
 */

import { Hono } from 'hono';
// Removed unused import: Pool
import { getLogger } from '../services/logger.js';
import { UtilityMessagesService, type UtilityMessageType } from '../services/utility-messages.js';
import { z } from 'zod';
// Removed unused import: crypto

const log = getLogger({ component: 'utility-messages-routes' });

// Validation schemas
const SendUtilityMessageSchema = z.object({
  recipient_id: z.string().min(1, 'معرف المستلم مطلوب'),
  template_id: z.string().uuid('معرف القالب يجب أن يكون UUID صالح'),
  variables: z.record(z.string()).default({}),
  message_type: z.enum([
    'ORDER_UPDATE',
    'ACCOUNT_NOTIFICATION', 
    'APPOINTMENT_REMINDER',
    'DELIVERY_NOTIFICATION',
    'PAYMENT_UPDATE'
  ])
});

const CreateTemplateSchema = z.object({
  name: z.string().min(1, 'اسم القالب مطلوب'),
  type: z.enum([
    'ORDER_UPDATE',
    'ACCOUNT_NOTIFICATION', 
    'APPOINTMENT_REMINDER',
    'DELIVERY_NOTIFICATION',
    'PAYMENT_UPDATE'
  ]),
  content: z.string().min(10, 'محتوى القالب يجب أن يكون 10 أحرف على الأقل'),
  variables: z.array(z.string()).default([])
});

const MerchantIdSchema = z.object({
  merchantId: z.string().uuid('معرف التاجر يجب أن يكون UUID صالح')
});

/**
 * Register utility messages routes on the app
 */
export function registerUtilityMessageRoutes(app: Hono): void {
  // Utility service will be instantiated per request

  // Send utility message
  app.post('/api/utility-messages/:merchantId/send', async (c) => {
    try {
      // Validate merchant ID
      const merchantIdValidation = MerchantIdSchema.safeParse({ 
        merchantId: c.req.param('merchantId') 
      });
      
      if (!merchantIdValidation.success) {
        return c.json({
          success: false,
          error: 'معرف التاجر غير صالح',
          details: merchantIdValidation.error.errors
        }, 400);
      }

      // Validate request body
      const body = await c.req.json();
      const validation = SendUtilityMessageSchema.safeParse(body);
      
      if (!validation.success) {
        return c.json({
          success: false,
          error: 'بيانات الطلب غير صالحة',
          details: validation.error.errors
        }, 400);
      }

      const { merchantId } = merchantIdValidation.data;
      const messageData = validation.data;

      // Send utility message using the real service
      const utilityService = new UtilityMessagesService();
      const result = await utilityService.sendUtilityMessage(merchantId, {
        recipient_id: messageData.recipient_id,
        template_id: messageData.template_id,
        variables: messageData.variables,
        message_type: messageData.message_type as UtilityMessageType
      });

      if (result.success) {
        return c.json({
          success: true,
          message_id: result.message_id,
          timestamp: result.timestamp.toISOString()
        });
      } else {
        return c.json({
          success: false,
          error: result.error,
          timestamp: result.timestamp.toISOString()
        }, 400);
      }
    } catch (error: any) {
      log.error('Send utility message error:', error);
      return c.json({
        success: false,
        error: 'خطأ في إرسال الرسالة',
        details: error.message
      }, 500);
    }
  });

  // Create message template
  app.post('/api/utility-messages/:merchantId/templates', async (c) => {
    try {
      // Validate merchant ID
      const merchantIdValidation = MerchantIdSchema.safeParse({ 
        merchantId: c.req.param('merchantId') 
      });
      
      if (!merchantIdValidation.success) {
        return c.json({
          success: false,
          error: 'معرف التاجر غير صالح'
        }, 400);
      }

      // Validate request body
      const body = await c.req.json();
      const validation = CreateTemplateSchema.safeParse(body);
      
      if (!validation.success) {
        return c.json({
          success: false,
          error: 'بيانات القالب غير صالحة',
          details: validation.error.errors
        }, 400);
      }

      const { merchantId } = merchantIdValidation.data;
      const templateData = validation.data;

      // Create template using real service
      const utilityService = new UtilityMessagesService();
      const template = await utilityService.createTemplate(
        merchantId,
        templateData.name,
        templateData.type as UtilityMessageType,
        templateData.content,
        templateData.variables
      );

      return c.json({
        success: true,
        template_id: template.id,
        status: 'created',
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      log.error('Create template error:', error);
      return c.json({
        success: false,
        error: 'خطأ في إنشاء القالب',
        details: error.message
      }, 500);
    }
  });

  // Get templates for merchant
  app.get('/api/utility-messages/:merchantId/templates', async (c) => {
    try {
      // Validate merchant ID
      const merchantIdValidation = MerchantIdSchema.safeParse({ 
        merchantId: c.req.param('merchantId') 
      });
      
      if (!merchantIdValidation.success) {
        return c.json({
          success: false,
          error: 'معرف التاجر غير صالح'
        }, 400);
      }

      const { merchantId } = merchantIdValidation.data;

      // Get templates using real service
      const utilityService = new UtilityMessagesService();
      const templates = await utilityService.getTemplates(merchantId);

      return c.json({
        success: true,
        templates: templates,
        count: templates.length,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      log.error('Get templates error:', error);
      return c.json({
        success: false,
        error: 'خطأ في جلب القوالب',
        details: error.message
      }, 500);
    }
  });

  // Get message history
  app.get('/api/utility-messages/:merchantId/history', async (c) => {
    try {
      // Validate merchant ID
      const merchantIdValidation = MerchantIdSchema.safeParse({ 
        merchantId: c.req.param('merchantId') 
      });
      
      if (!merchantIdValidation.success) {
        return c.json({
          success: false,
          error: 'معرف التاجر غير صالح'
        }, 400);
      }

      const { merchantId } = merchantIdValidation.data;
      const limit = parseInt(c.req.query('limit') || '50');
      const offset = parseInt(c.req.query('offset') || '0');

      // Get message history using real service  
      const utilityService = new UtilityMessagesService();
      const messages = await utilityService.getMessageHistory(merchantId, limit, offset);

      return c.json({
        success: true,
        messages: messages,
        count: messages.length,
        hasMore: messages.length === limit,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      log.error('Get message history error:', error);
      return c.json({
        success: false,
        error: 'خطأ في جلب تاريخ الرسائل',
        details: error.message
      }, 500);
    }
  });

  // Health check for utility messages
  app.get('/api/utility-messages/health', async (c) => {
    try {
      // const utilityService = new UtilityMessagesService(); // unused
      
      return c.json({
        status: 'healthy',
        service: 'utility-messages',
        features: {
          templates: true,
          messaging: true,
          history: true
        },
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      log.error('Utility messages health check error:', error);
      return c.json({
        status: 'degraded',
        service: 'utility-messages',
        error: error.message,
        timestamp: new Date().toISOString()
      }, 503);
    }
  });

  log.info('Utility messages routes registered successfully');
}