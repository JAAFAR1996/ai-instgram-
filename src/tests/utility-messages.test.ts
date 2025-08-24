/**
 * ===============================================
 * Utility Messages Service Tests
 * اختبارات شاملة لخدمة الرسائل المساعدة
 * ===============================================
 */

import { describe, test, expect, beforeEach, afterEach, jest } from 'bun:test';
import crypto from 'crypto';

import {
  UtilityMessagesService,
  getUtilityMessagesService,
  type UtilityMessageTemplate,
  type UtilityMessagePayload,
  type UtilityMessageType
} from './utility-messages.js';

// Mock dependencies
jest.mock('./instagram-api.js', () => ({
  getInstagramClient: jest.fn(() => ({
    loadMerchantCredentials: jest.fn(),
    validateCredentials: jest.fn(),
    sendMessage: jest.fn()
  }))
}));

jest.mock('../database/connection.js', () => ({
  getDatabase: jest.fn(() => ({
    getSQL: jest.fn(() => jest.fn())
  }))
}));

jest.mock('../config/environment.js', () => ({
  getConfig: jest.fn(() => ({
    instagram: {
      metaAppId: 'test-app-id',
      metaAppSecret: 'test-app-secret'
    }
  }))
}));

jest.mock('./logger.js', () => ({
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }))
}));

describe('📱 Utility Messages Service Tests', () => {
  let utilityMessagesService: UtilityMessagesService;
  let mockSQL: jest.Mock;
  let mockInstagramClient: any;
  let mockLogger: any;

  const sampleMerchantId = 'merchant-123';
  const sampleTemplateId = 'template-456';
  const sampleRecipientId = 'recipient-789';

  const sampleTemplate: UtilityMessageTemplate = {
    id: sampleTemplateId,
    name: 'Order Confirmation',
    type: 'ORDER_UPDATE',
    content: 'تأكيد الطلب: طلبك رقم {{order_number}} تم تأكيده بنجاح. المبلغ: {{total_amount}} دينار.',
    variables: ['order_number', 'total_amount'],
    approved: true,
    created_at: new Date(),
    updated_at: new Date()
  };

  const samplePayload: UtilityMessagePayload = {
    recipient_id: sampleRecipientId,
    template_id: sampleTemplateId,
    variables: {
      order_number: 'ORD-123',
      total_amount: '50000'
    },
    message_type: 'ORDER_UPDATE'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock database
    mockSQL = jest.fn();
    const { getDatabase } = require('../database/connection.js');
    getDatabase.mockReturnValue({
      getSQL: () => mockSQL
    });

    // Mock Instagram client
    const { getInstagramClient } = require('./instagram-api.js');
    mockInstagramClient = {
      loadMerchantCredentials: jest.fn(),
      validateCredentials: jest.fn(),
      sendMessage: jest.fn()
    };
    getInstagramClient.mockReturnValue(mockInstagramClient);

    // Mock logger
    const { getLogger } = require('./logger.js');
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    };
    getLogger.mockReturnValue(mockLogger);

    utilityMessagesService = new UtilityMessagesService();
  });

  describe('sendUtilityMessage', () => {
    beforeEach(() => {
      // Mock template query - return sample template
      mockSQL.mockResolvedValueOnce([{
        id: sampleTemplate.id,
        name: sampleTemplate.name,
        type: sampleTemplate.type,
        content: sampleTemplate.content,
        variables: JSON.stringify(sampleTemplate.variables),
        approved: sampleTemplate.approved,
        created_at: sampleTemplate.created_at.toISOString(),
        updated_at: sampleTemplate.updated_at.toISOString()
      }]);

      // Mock Instagram credentials
      mockInstagramClient.loadMerchantCredentials.mockResolvedValue({
        page_id: 'page-123',
        access_token: 'token-123'
      });
      mockInstagramClient.validateCredentials.mockResolvedValue(true);
      
      // Mock logging query
      mockSQL.mockResolvedValue([]);
    });

    test('✅ should send utility message successfully', async () => {
      mockInstagramClient.sendMessage.mockResolvedValue({
        success: true,
        messageId: 'msg-456'
      });

      const result = await utilityMessagesService.sendUtilityMessage(
        sampleMerchantId,
        samplePayload
      );

      expect(result.success).toBe(true);
      expect(result.message_id).toBe('msg-456');
      expect(result.timestamp).toBeInstanceOf(Date);

      // Verify template lookup
      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([sampleTemplateId, sampleMerchantId])
      );

      // Verify message sending
      expect(mockInstagramClient.sendMessage).toHaveBeenCalledWith(
        expect.any(Object),
        sampleMerchantId,
        expect.objectContaining({
          recipientId: sampleRecipientId,
          messageType: 'text',
          content: expect.stringContaining('ORD-123')
        })
      );
    });

    test('✅ should interpolate template variables correctly', async () => {
      mockInstagramClient.sendMessage.mockResolvedValue({
        success: true,
        messageId: 'msg-456'
      });

      await utilityMessagesService.sendUtilityMessage(
        sampleMerchantId,
        samplePayload
      );

      const sentMessage = mockInstagramClient.sendMessage.mock.calls[0][2];
      expect(sentMessage.content).toContain('ORD-123');
      expect(sentMessage.content).toContain('50000');
      expect(sentMessage.content).not.toContain('{{order_number}}');
      expect(sentMessage.content).not.toContain('{{total_amount}}');
    });

    test('❌ should fail when template not found', async () => {
      mockSQL.mockResolvedValueOnce([]); // No template found

      const result = await utilityMessagesService.sendUtilityMessage(
        sampleMerchantId,
        samplePayload
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Template not found or not approved');
      expect(mockInstagramClient.sendMessage).not.toHaveBeenCalled();
    });

    test('❌ should fail when Instagram credentials not found', async () => {
      mockInstagramClient.loadMerchantCredentials.mockResolvedValue(null);

      const result = await utilityMessagesService.sendUtilityMessage(
        sampleMerchantId,
        samplePayload
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Instagram credentials not found');
    });

    test('❌ should handle Instagram API errors', async () => {
      mockInstagramClient.sendMessage.mockResolvedValue({
        success: false,
        error: { code: 'RATE_LIMIT', message: 'Rate limit exceeded' }
      });

      const result = await utilityMessagesService.sendUtilityMessage(
        sampleMerchantId,
        samplePayload
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('RATE_LIMIT');
    });

    test('❌ should handle service exceptions', async () => {
      mockSQL.mockRejectedValue(new Error('Database error'));

      const result = await utilityMessagesService.sendUtilityMessage(
        sampleMerchantId,
        samplePayload
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });

    test('✅ should log utility message after successful send', async () => {
      mockInstagramClient.sendMessage.mockResolvedValue({
        success: true,
        messageId: 'msg-789'
      });

      await utilityMessagesService.sendUtilityMessage(
        sampleMerchantId,
        samplePayload
      );

      // Should call database twice: template lookup + logging
      expect(mockSQL).toHaveBeenCalledTimes(2);
      
      // Check logging call
      const loggingCall = mockSQL.mock.calls[1][0];
      expect(loggingCall).toEqual(
        expect.arrayContaining([
          expect.any(String), // UUID
          sampleMerchantId,
          sampleRecipientId,
          sampleTemplateId,
          'msg-789',
          'ORDER_UPDATE'
        ])
      );
    });

    test('✅ should handle multiple variables in template', async () => {
      const complexTemplate = {
        ...sampleTemplate,
        content: 'طلب {{order_number}} بقيمة {{total_amount}} للعميل {{customer_name}} في {{date}}',
        variables: ['order_number', 'total_amount', 'customer_name', 'date']
      };

      mockSQL.mockResolvedValueOnce([{
        ...complexTemplate,
        variables: JSON.stringify(complexTemplate.variables),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }]);

      const complexPayload = {
        ...samplePayload,
        variables: {
          order_number: 'ORD-456',
          total_amount: '75000',
          customer_name: 'أحمد محمد',
          date: '2024-01-15'
        }
      };

      mockInstagramClient.sendMessage.mockResolvedValue({
        success: true,
        messageId: 'msg-complex'
      });

      await utilityMessagesService.sendUtilityMessage(
        sampleMerchantId,
        complexPayload
      );

      const sentMessage = mockInstagramClient.sendMessage.mock.calls[0][2];
      expect(sentMessage.content).toContain('ORD-456');
      expect(sentMessage.content).toContain('75000');
      expect(sentMessage.content).toContain('أحمد محمد');
      expect(sentMessage.content).toContain('2024-01-15');
    });
  });

  describe('createUtilityTemplate', () => {
    const newTemplate = {
      name: 'Payment Confirmation',
      type: 'PAYMENT_UPDATE' as UtilityMessageType,
      content: 'تم استلام دفعة بمبلغ {{amount}} دينار للطلب {{order_id}}',
      variables: ['amount', 'order_id']
    };

    test('✅ should create utility template successfully', async () => {
      mockSQL.mockResolvedValue([]);

      const result = await utilityMessagesService.createUtilityTemplate(
        sampleMerchantId,
        newTemplate
      );

      expect(result.success).toBe(true);
      expect(result.template_id).toBeDefined();
      expect(typeof result.template_id).toBe('string');

      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.any(String), // template ID
          sampleMerchantId,
          newTemplate.name,
          newTemplate.type,
          newTemplate.content,
          JSON.stringify(newTemplate.variables),
          true // auto-approved
        ])
      );
    });

    test('❌ should reject templates with marketing content', async () => {
      const marketingTemplate = {
        ...newTemplate,
        content: 'خصم خاص! اشتري الآن واحصل على تخفيض 50%'
      };

      const result = await utilityMessagesService.createUtilityTemplate(
        sampleMerchantId,
        marketingTemplate
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('marketing content');
      expect(mockSQL).not.toHaveBeenCalled();
    });

    test('❌ should detect various marketing keywords', async () => {
      const marketingKeywords = [
        'sale', 'discount', 'offer', 'promotion', 'deal', 'limited time',
        'buy now', 'shop', 'purchase', 'خصم', 'عرض', 'تخفيض', 'اشتري الآن'
      ];

      for (const keyword of marketingKeywords) {
        const marketingTemplate = {
          ...newTemplate,
          content: `Template with ${keyword} keyword`
        };

        const result = await utilityMessagesService.createUtilityTemplate(
          sampleMerchantId,
          marketingTemplate
        );

        expect(result.success).toBe(false);
        expect(result.error).toContain('marketing content');
      }
    });

    test('✅ should allow non-marketing transactional content', async () => {
      const transactionalTemplate = {
        ...newTemplate,
        content: 'تأكيد طلبك رقم {{order_number}} تم بنجاح'
      };

      mockSQL.mockResolvedValue([]);

      const result = await utilityMessagesService.createUtilityTemplate(
        sampleMerchantId,
        transactionalTemplate
      );

      expect(result.success).toBe(true);
    });

    test('❌ should handle database errors', async () => {
      mockSQL.mockRejectedValue(new Error('Database connection failed'));

      const result = await utilityMessagesService.createUtilityTemplate(
        sampleMerchantId,
        newTemplate
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection failed');
    });
  });

  describe('getTemplates', () => {
    const sampleTemplates = [
      {
        id: 'template-1',
        name: 'Order Confirmation',
        type: 'ORDER_UPDATE',
        content: 'تأكيد طلب {{order_number}}',
        variables: '["order_number"]',
        approved: true,
        created_at: '2024-01-01T10:00:00Z',
        updated_at: '2024-01-01T10:00:00Z'
      },
      {
        id: 'template-2',
        name: 'Delivery Update',
        type: 'DELIVERY_NOTIFICATION',
        content: 'تحديث توصيل {{tracking_id}}',
        variables: '["tracking_id"]',
        approved: true,
        created_at: '2024-01-02T11:00:00Z',
        updated_at: '2024-01-02T11:00:00Z'
      }
    ];

    test('✅ should get merchant templates', async () => {
      mockSQL.mockResolvedValue(sampleTemplates);

      const templates = await utilityMessagesService.getTemplates(sampleMerchantId);

      expect(templates).toHaveLength(2);
      expect(templates[0]).toMatchObject({
        id: 'template-1',
        name: 'Order Confirmation',
        type: 'ORDER_UPDATE',
        variables: ['order_number'],
        approved: true
      });

      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([sampleMerchantId])
      );
    });

    test('✅ should return empty array when no templates found', async () => {
      mockSQL.mockResolvedValue([]);

      const templates = await utilityMessagesService.getTemplates(sampleMerchantId);

      expect(templates).toHaveLength(0);
    });

    test('❌ should handle database errors gracefully', async () => {
      mockSQL.mockRejectedValue(new Error('Database error'));

      const templates = await utilityMessagesService.getTemplates(sampleMerchantId);

      expect(templates).toHaveLength(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to get templates',
        expect.any(Error),
        expect.objectContaining({ merchantId: sampleMerchantId })
      );
    });

    test('✅ should parse variables JSON correctly', async () => {
      const templateWithComplexVariables = {
        ...sampleTemplates[0],
        variables: '["order_number", "customer_name", "total_amount", "delivery_date"]'
      };

      mockSQL.mockResolvedValue([templateWithComplexVariables]);

      const templates = await utilityMessagesService.getTemplates(sampleMerchantId);

      expect(templates[0].variables).toEqual([
        'order_number', 'customer_name', 'total_amount', 'delivery_date'
      ]);
    });

    test('✅ should handle invalid JSON in variables', async () => {
      const templateWithInvalidVariables = {
        ...sampleTemplates[0],
        variables: 'invalid json'
      };

      mockSQL.mockResolvedValue([templateWithInvalidVariables]);

      const templates = await utilityMessagesService.getTemplates(sampleMerchantId);

      expect(templates[0].variables).toEqual([]);
    });
  });

  describe('createDefaultTemplates', () => {
    test('✅ should create default templates for new merchant', async () => {
      mockSQL.mockResolvedValue([]);

      await utilityMessagesService.createDefaultTemplates(sampleMerchantId);

      // Should create 3 default templates
      expect(mockSQL).toHaveBeenCalledTimes(3);

      // Check that each template type is created
      const calls = mockSQL.mock.calls;
      const templateTypes = calls.map(call => call[0][3]); // type is the 4th parameter
      
      expect(templateTypes).toContain('ORDER_UPDATE');
      expect(templateTypes).toContain('DELIVERY_NOTIFICATION');
      expect(templateTypes).toContain('PAYMENT_UPDATE');
    });

    test('✅ should create templates with Arabic content', async () => {
      mockSQL.mockResolvedValue([]);

      await utilityMessagesService.createDefaultTemplates(sampleMerchantId);

      const calls = mockSQL.mock.calls;
      calls.forEach(call => {
        const content = call[0][4]; // content is the 5th parameter
        expect(content).toMatch(/[\u0600-\u06FF]/); // Contains Arabic characters
      });
    });

    test('❌ should handle errors during default template creation', async () => {
      mockSQL.mockRejectedValue(new Error('Database error'));

      // Should not throw
      await expect(
        utilityMessagesService.createDefaultTemplates(sampleMerchantId)
      ).resolves.toBeUndefined();

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Template Interpolation', () => {
    test('✅ should interpolate simple variables', () => {
      const service = utilityMessagesService as any;
      const result = service.interpolateTemplate(
        'Hello {{name}}, your order {{id}} is ready',
        { name: 'Ahmed', id: '123' }
      );

      expect(result).toBe('Hello Ahmed, your order 123 is ready');
    });

    test('✅ should handle multiple occurrences of same variable', () => {
      const service = utilityMessagesService as any;
      const result = service.interpolateTemplate(
        '{{name}} ordered {{item}}, {{name}} paid {{amount}}',
        { name: 'Sara', item: 'phone', amount: '500' }
      );

      expect(result).toBe('Sara ordered phone, Sara paid 500');
    });

    test('✅ should handle special characters in variables', () => {
      const service = utilityMessagesService as any;
      const result = service.interpolateTemplate(
        'Order {{order_id}} total: {{amount}}',
        { order_id: 'ORD-2024/01/15-001', amount: '$100.50' }
      );

      expect(result).toBe('Order ORD-2024/01/15-001 total: $100.50');
    });

    test('✅ should handle Arabic content and variables', () => {
      const service = utilityMessagesService as any;
      const result = service.interpolateTemplate(
        'مرحباً {{اسم_العميل}}، طلبك رقم {{رقم_الطلب}} جاهز',
        { 'اسم_العميل': 'أحمد', 'رقم_الطلب': '٧٨٩' }
      );

      expect(result).toBe('مرحباً أحمد، طلبك رقم ٧٨٩ جاهز');
    });

    test('✅ should leave unmatched variables unchanged', () => {
      const service = utilityMessagesService as any;
      const result = service.interpolateTemplate(
        'Hello {{name}}, order {{id}}, reference {{ref}}',
        { name: 'Ahmed', id: '123' }
      );

      expect(result).toBe('Hello Ahmed, order 123, reference {{ref}}');
    });

    test('✅ should handle empty variables object', () => {
      const service = utilityMessagesService as any;
      const result = service.interpolateTemplate(
        'Template with {{variables}}',
        {}
      );

      expect(result).toBe('Template with {{variables}}');
    });
  });

  describe('Marketing Content Detection', () => {
    test('❌ should detect English marketing keywords', () => {
      const service = utilityMessagesService as any;
      
      const marketingPhrases = [
        'Special sale this weekend!',
        'Get 50% discount now',
        'Limited time offer',
        'Buy now and save',
        'Shop our promotion'
      ];

      marketingPhrases.forEach(phrase => {
        expect(service.containsMarketingContent(phrase)).toBe(true);
      });
    });

    test('❌ should detect Arabic marketing keywords', () => {
      const service = utilityMessagesService as any;
      
      const marketingPhrases = [
        'خصم كبير اليوم!',
        'عرض خاص لوقت محدود',
        'تخفيض 50% على جميع المنتجات',
        'اشتري الآن واستفد'
      ];

      marketingPhrases.forEach(phrase => {
        expect(service.containsMarketingContent(phrase)).toBe(true);
      });
    });

    test('✅ should allow transactional content', () => {
      const service = utilityMessagesService as any;
      
      const transactionalPhrases = [
        'تأكيد طلبك رقم 123',
        'Your order has been shipped',
        'Payment received successfully',
        'Delivery scheduled for tomorrow',
        'تم استلام دفعتك بنجاح'
      ];

      transactionalPhrases.forEach(phrase => {
        expect(service.containsMarketingContent(phrase)).toBe(false);
      });
    });

    test('✅ should be case insensitive', () => {
      const service = utilityMessagesService as any;
      
      expect(service.containsMarketingContent('SALE TODAY')).toBe(true);
      expect(service.containsMarketingContent('Sale Today')).toBe(true);
      expect(service.containsMarketingContent('sale today')).toBe(true);
    });
  });

  describe('Singleton Pattern', () => {
    test('✅ should return same instance', () => {
      const instance1 = getUtilityMessagesService();
      const instance2 = getUtilityMessagesService();

      expect(instance1).toBe(instance2);
    });

    test('✅ should create instance if not exists', () => {
      // Reset singleton
      (require('./utility-messages.js') as any).utilityMessagesServiceInstance = null;

      const instance = getUtilityMessagesService();
      expect(instance).toBeInstanceOf(UtilityMessagesService);
    });
  });

  describe('Error Logging', () => {
    test('✅ should log errors with proper context', async () => {
      mockSQL.mockRejectedValue(new Error('Database connection failed'));

      await utilityMessagesService.sendUtilityMessage(
        sampleMerchantId,
        samplePayload
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Utility message service error',
        expect.any(Error),
        expect.objectContaining({
          merchantId: sampleMerchantId,
          event: 'sendUtilityMessage'
        })
      );
    });

    test('✅ should log successful operations', async () => {
      // Mock successful flow
      mockSQL.mockResolvedValueOnce([{
        id: sampleTemplate.id,
        name: sampleTemplate.name,
        type: sampleTemplate.type,
        content: sampleTemplate.content,
        variables: JSON.stringify(sampleTemplate.variables),
        approved: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }]);

      mockInstagramClient.loadMerchantCredentials.mockResolvedValue({
        page_id: 'page-123',
        access_token: 'token-123'
      });

      mockInstagramClient.sendMessage.mockResolvedValue({
        success: true,
        messageId: 'msg-success'
      });

      mockSQL.mockResolvedValue([]); // For logging

      await utilityMessagesService.sendUtilityMessage(
        sampleMerchantId,
        samplePayload
      );

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Utility message sent successfully',
        expect.objectContaining({
          merchantId: sampleMerchantId,
          messageType: 'ORDER_UPDATE',
          event: 'sendUtilityMessage'
        })
      );
    });
  });

  describe('Edge Cases', () => {
    test('✅ should handle null/undefined variables', () => {
      const service = utilityMessagesService as any;
      const result = service.interpolateTemplate(
        'Hello {{name}}',
        { name: null }
      );

      expect(result).toBe('Hello null');
    });

    test('✅ should handle empty template content', () => {
      const service = utilityMessagesService as any;
      const result = service.interpolateTemplate('', { any: 'value' });

      expect(result).toBe('');
    });

    test('✅ should handle templates with no variables', () => {
      const service = utilityMessagesService as any;
      const result = service.interpolateTemplate(
        'Static message content',
        { unused: 'variable' }
      );

      expect(result).toBe('Static message content');
    });

    test('✅ should handle malformed template variables', () => {
      const service = utilityMessagesService as any;
      const result = service.interpolateTemplate(
        'Bad format {name} and {{incomplete',
        { name: 'Ahmed' }
      );

      expect(result).toBe('Bad format {name} and {{incomplete');
    });
  });
});