/**
 * ===============================================
 * AI Service Tests
 * اختبارات شاملة لخدمة الذكاء الاصطناعي
 * ===============================================
 */

import { describe, test, expect, beforeEach, afterEach, jest } from 'vitest';
import OpenAI from 'openai';

import {
  AIService,
  getAIService,
  type AIResponse,
  type ConversationContext,
  type MessageHistory,
  type CustomerProfile,
  type MerchantSettings
} from './ai.js';

// Mock dependencies
jest.mock('openai');
jest.mock('./encryption.js', () => ({
  getEncryptionService: jest.fn(() => ({
    encrypt: jest.fn(),
    decrypt: jest.fn()
  }))
}));

jest.mock('../database/connection.js', () => ({
  getDatabase: jest.fn(() => ({
    getSQL: jest.fn(() => jest.fn())
  }))
}));

const mockOpenAI = {
  chat: {
    completions: {
      create: jest.fn()
    }
  }
};

describe('🤖 AI Service Tests', () => {
  let aiService: AIService;
  let mockSQL: jest.Mock;

  const sampleContext: ConversationContext = {
    merchantId: 'merchant-123',
    customerId: 'customer-456',
    platform: 'instagram' as const,
    stage: 'PRODUCT_INQUIRY' as const,
    cart: [],
    preferences: {},
    conversationHistory: [
      {
        role: 'user',
        content: 'مرحبا، أريد شراء هاتف جديد',
        timestamp: new Date()
      }
    ],
    customerProfile: {
      name: 'أحمد محمد',
      phone: '+964771234567',
      previousOrders: 2,
      averageOrderValue: 150,
      preferredCategories: ['electronics'],
      lastInteraction: new Date()
    } as CustomerProfile,
    merchantSettings: {
      businessName: 'متجر الإلكترونيات',
      businessCategory: 'الكترونيات',
      workingHours: { start: '09:00', end: '21:00' },
      paymentMethods: ['cash', 'bank_transfer'],
      deliveryFees: { default: 5000 },
      autoResponses: {}
    } as MerchantSettings
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup environment variables
    process.env.OPENAI_API_KEY = 'test-api-key';
    process.env.OPENAI_MODEL = 'gpt-4o-mini';
    process.env.OPENAI_TEMPERATURE = '0.7';
    process.env.OPENAI_MAX_TOKENS = '500';
    process.env.OPENAI_TIMEOUT = '30000';

    // Mock database
    mockSQL = jest.fn();
    const { getDatabase } = require('../database/connection.js');
    getDatabase.mockReturnValue({
      getSQL: () => mockSQL
    });

    // Mock OpenAI constructor and methods
    (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(() => mockOpenAI as any);

    aiService = new AIService();
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  describe('Constructor', () => {
    test('✅ should initialize with API key', () => {
      expect(OpenAI).toHaveBeenCalledWith({
        apiKey: 'test-api-key',
        timeout: 30000
      });
    });

    test('❌ should throw error without API key', () => {
      delete process.env.OPENAI_API_KEY;
      
      expect(() => new AIService()).toThrow('OPENAI_API_KEY environment variable is required');
    });
  });

  describe('generateResponse', () => {
    const mockAIResponse = {
      message: 'مرحباً! أستطيع مساعدتك في اختيار هاتف مناسب',
      messageAr: 'مرحباً! أستطيع مساعدتك في اختيار هاتف مناسب',
      intent: 'PRODUCT_INQUIRY',
      stage: 'PRODUCT_SELECTION',
      actions: [
        { type: 'SHOW_PRODUCT', data: { category: 'phones' }, priority: 1 }
      ],
      products: [
        {
          productId: 'phone-1',
          sku: 'PH001',
          name: 'آيفون 15',
          price: 1200,
          confidence: 0.9,
          reason: 'هاتف عالي الجودة'
        }
      ],
      confidence: 0.9
    };

    beforeEach(() => {
      // Mock products query
      mockSQL.mockResolvedValue([
        {
          category: 'phones',
          count: 5,
          avg_price: 800
        }
      ]);

      // Mock OpenAI response
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify(mockAIResponse)
          }
        }],
        usage: {
          prompt_tokens: 150,
          completion_tokens: 100,
          total_tokens: 250
        }
      });
    });

    test('✅ should generate AI response successfully', async () => {
      const response = await aiService.generateResponse(
        'أريد شراء هاتف جديد',
        sampleContext
      );

      expect(response).toMatchObject({
        message: mockAIResponse.message,
        intent: mockAIResponse.intent,
        stage: mockAIResponse.stage,
        confidence: mockAIResponse.confidence
      });

      expect(response.tokens).toEqual({
        prompt: 150,
        completion: 100,
        total: 250
      });

      expect(response.responseTime).toBeGreaterThan(0);
    });

    test('✅ should call OpenAI with correct parameters', async () => {
      await aiService.generateResponse('مرحبا', sampleContext);

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-4o-mini',
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user', content: 'مرحبا، أريد شراء هاتف جديد' }),
          expect.objectContaining({ role: 'user', content: 'مرحبا' })
        ]),
        temperature: 0.7,
        max_tokens: 500,
        top_p: 0.9,
        frequency_penalty: 0.1,
        presence_penalty: 0.1,
        response_format: { type: 'json_object' }
      });
    });

    test('✅ should include conversation history in prompt', async () => {
      const contextWithHistory = {
        ...sampleContext,
        conversationHistory: [
          { role: 'user' as const, content: 'مرحبا', timestamp: new Date() },
          { role: 'assistant' as const, content: 'أهلاً وسهلاً', timestamp: new Date() },
          { role: 'user' as const, content: 'أريد هاتف', timestamp: new Date() }
        ]
      };

      await aiService.generateResponse('ما الأسعار المتوفرة؟', contextWithHistory);

      const callArgs = mockOpenAI.chat.completions.create.mock.calls[0][0];
      expect(callArgs.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'مرحبا' }),
          expect.objectContaining({ role: 'assistant', content: 'أهلاً وسهلاً' }),
          expect.objectContaining({ role: 'user', content: 'أريد هاتف' }),
          expect.objectContaining({ role: 'user', content: 'ما الأسعار المتوفرة؟' })
        ])
      );
    });

    test('✅ should log AI interaction', async () => {
      await aiService.generateResponse('test message', sampleContext);

      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([
          sampleContext.merchantId,
          'AI_RESPONSE_GENERATED',
          'AI_INTERACTION',
          expect.stringContaining('test message'),
          expect.any(Number),
          true
        ])
      );
    });

    test('❌ should return fallback response on error', async () => {
      mockOpenAI.chat.completions.create.mockRejectedValue(new Error('API Error'));

      const response = await aiService.generateResponse('test message', sampleContext);

      expect(response.intent).toBe('SUPPORT');
      expect(response.actions[0].type).toBe('ESCALATE');
      expect(response.confidence).toBe(0.1);
      expect(response.message).toContain('عذراً');
    });

    test('❌ should handle empty OpenAI response', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: null } }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      });

      const response = await aiService.generateResponse('test', sampleContext);

      expect(response.intent).toBe('SUPPORT');
      expect(response.actions[0].type).toBe('ESCALATE');
    });

    test('❌ should handle invalid JSON response', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: 'invalid json' } }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      });

      const response = await aiService.generateResponse('test', sampleContext);

      expect(response.intent).toBe('SUPPORT');
    });
  });

  describe('analyzeIntent', () => {
    const mockIntentResponse = {
      intent: 'PRODUCT_INQUIRY',
      confidence: 0.9,
      entities: { product_type: 'phone' },
      stage: 'PRODUCT_SELECTION'
    };

    beforeEach(() => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify(mockIntentResponse)
          }
        }]
      });
    });

    test('✅ should analyze customer intent', async () => {
      const result = await aiService.analyzeIntent(
        'أريد شراء آيفون',
        sampleContext
      );

      expect(result).toEqual(mockIntentResponse);
    });

    test('✅ should use correct model parameters for intent analysis', async () => {
      await aiService.analyzeIntent('أريد المساعدة', sampleContext);

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-4o-mini',
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ 
            role: 'user',
            content: expect.stringContaining('أريد المساعدة')
          })
        ]),
        temperature: 0.3,
        max_tokens: 200,
        response_format: { type: 'json_object' }
      });
    });

    test('❌ should return fallback on error', async () => {
      mockOpenAI.chat.completions.create.mockRejectedValue(new Error('API Error'));

      const result = await aiService.analyzeIntent('test', sampleContext);

      expect(result).toEqual({
        intent: 'UNKNOWN',
        confidence: 0,
        entities: {},
        stage: sampleContext.stage
      });
    });
  });

  describe('generateProductRecommendations', () => {
    const mockProducts = [
      {
        id: 'prod-1',
        sku: 'PH001',
        name_ar: 'آيفون 15',
        price_usd: 1200,
        category: 'phones',
        stock_quantity: 5
      },
      {
        id: 'prod-2',
        sku: 'PH002',
        name_ar: 'سامسونغ S24',
        price_usd: 1000,
        category: 'phones',
        stock_quantity: 3
      }
    ];

    const mockRecommendations = {
      recommendations: [
        {
          productId: 'prod-1',
          sku: 'PH001',
          name: 'آيفون 15',
          price: 1200,
          confidence: 0.9,
          reason: 'هاتف عالي الجودة ومناسب لاحتياجاتك'
        }
      ]
    };

    beforeEach(() => {
      // Mock products query
      mockSQL.mockResolvedValue(mockProducts);

      // Mock OpenAI response
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify(mockRecommendations)
          }
        }]
      });
    });

    test('✅ should generate product recommendations', async () => {
      const recommendations = await aiService.generateProductRecommendations(
        'أريد هاتف بسعر جيد',
        sampleContext,
        3
      );

      expect(recommendations).toEqual(mockRecommendations.recommendations);
    });

    test('✅ should fetch merchant products', async () => {
      await aiService.generateProductRecommendations(
        'أريد هاتف',
        sampleContext
      );

      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([
          sampleContext.merchantId
        ])
      );
    });

    test('✅ should limit recommendations count', async () => {
      const manyRecommendations = {
        recommendations: Array.from({ length: 10 }, (_, i) => ({
          productId: `prod-${i}`,
          sku: `SKU${i}`,
          name: `Product ${i}`,
          price: 100 + i * 50,
          confidence: 0.8,
          reason: 'good product'
        }))
      };

      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify(manyRecommendations)
          }
        }]
      });

      const recommendations = await aiService.generateProductRecommendations(
        'أريد منتجات',
        sampleContext,
        3
      );

      expect(recommendations).toHaveLength(3);
    });

    test('❌ should return empty array on error', async () => {
      mockOpenAI.chat.completions.create.mockRejectedValue(new Error('API Error'));

      const recommendations = await aiService.generateProductRecommendations(
        'test',
        sampleContext
      );

      expect(recommendations).toEqual([]);
    });

    test('❌ should handle database error', async () => {
      mockSQL.mockRejectedValue(new Error('DB Error'));

      const recommendations = await aiService.generateProductRecommendations(
        'test',
        sampleContext
      );

      expect(recommendations).toEqual([]);
    });
  });

  describe('generateConversationSummary', () => {
    const conversationHistory: MessageHistory[] = [
      { role: 'user', content: 'مرحبا', timestamp: new Date() },
      { role: 'assistant', content: 'أهلاً وسهلاً', timestamp: new Date() },
      { role: 'user', content: 'أريد هاتف', timestamp: new Date() },
      { role: 'assistant', content: 'ما نوع الهاتف المطلوب؟', timestamp: new Date() }
    ];

    beforeEach(() => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{
          message: {
            content: 'العميل يبحث عن هاتف ذكي'
          }
        }]
      });
    });

    test('✅ should generate conversation summary', async () => {
      const summary = await aiService.generateConversationSummary(
        conversationHistory,
        sampleContext
      );

      expect(summary).toBe('العميل يبحث عن هاتف ذكي');
    });

    test('✅ should use correct parameters for summary', async () => {
      await aiService.generateConversationSummary(conversationHistory, sampleContext);

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-4o-mini',
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ 
            role: 'user',
            content: expect.stringContaining('user: مرحبا')
          })
        ]),
        temperature: 0.3,
        max_tokens: 200
      });
    });

    test('❌ should return fallback on error', async () => {
      mockOpenAI.chat.completions.create.mockRejectedValue(new Error('API Error'));

      const summary = await aiService.generateConversationSummary(
        conversationHistory,
        sampleContext
      );

      expect(summary).toBe('خطأ في إنتاج الملخص');
    });

    test('❌ should handle empty response', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: null } }]
      });

      const summary = await aiService.generateConversationSummary(
        conversationHistory,
        sampleContext
      );

      expect(summary).toBe('لا يوجد ملخص متاح');
    });
  });

  describe('Private Methods', () => {
    test('✅ should build system prompt with merchant info', async () => {
      mockSQL.mockResolvedValue([
        { category: 'phones', count: 5, avg_price: 800 }
      ]);

      await aiService.generateResponse('test', sampleContext);

      const systemMessage = mockOpenAI.chat.completions.create.mock.calls[0][0].messages[0];
      expect(systemMessage.role).toBe('system');
      expect(systemMessage.content).toContain('متجر الإلكترونيات');
      expect(systemMessage.content).toContain('الكترونيات');
      expect(systemMessage.content).toContain('phones: 5 منتج');
    });

    test('✅ should handle products summary error', async () => {
      mockSQL.mockRejectedValue(new Error('DB Error'));

      await aiService.generateResponse('test', sampleContext);

      const systemMessage = mockOpenAI.chat.completions.create.mock.calls[0][0].messages[0];
      expect(systemMessage.content).toContain('منتجات متنوعة');
    });

    test('✅ should limit conversation history', async () => {
      const longHistory = Array.from({ length: 20 }, (_, i) => ({
        role: 'user' as const,
        content: `message ${i}`,
        timestamp: new Date()
      }));

      const contextWithLongHistory = {
        ...sampleContext,
        conversationHistory: longHistory
      };

      await aiService.generateResponse('test', contextWithLongHistory);

      const messages = mockOpenAI.chat.completions.create.mock.calls[0][0].messages;
      // Should include system + last 10 history + current message
      expect(messages.length).toBeLessThanOrEqual(12);
    });

    test('✅ should log audit failures gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      // Make audit logging fail
      mockSQL.mockImplementation((sql) => {
        if (sql.toString().includes('audit_logs')) {
          return Promise.reject(new Error('DB Error'));
        }
        return Promise.resolve([]);
      });

      const response = await aiService.generateResponse('test', sampleContext);

      expect(response).toBeDefined();
      expect(consoleSpy).toHaveBeenCalledWith('❌ AI interaction logging failed:', expect.any(Error));
      
      consoleSpy.mockRestore();
    });
  });

  describe('Fallback Response', () => {
    test('✅ should provide different fallback messages', () => {
      const responses = new Set();
      
      for (let i = 0; i < 20; i++) {
        const response = (aiService as any).getFallbackResponse(sampleContext);
        responses.add(response.message);
      }

      // Should have at least 2 different messages
      expect(responses.size).toBeGreaterThanOrEqual(2);
    });

    test('✅ should maintain proper fallback structure', () => {
      const response = (aiService as any).getFallbackResponse(sampleContext);

      expect(response).toMatchObject({
        intent: 'SUPPORT',
        stage: sampleContext.stage,
        actions: [{ type: 'ESCALATE', data: { reason: 'AI_ERROR' }, priority: 1 }],
        products: [],
        confidence: 0.1,
        tokens: { prompt: 0, completion: 0, total: 0 },
        responseTime: 0
      });
    });
  });

  describe('Singleton Pattern', () => {
    test('✅ should return same instance', () => {
      const instance1 = getAIService();
      const instance2 = getAIService();

      expect(instance1).toBe(instance2);
    });

    test('✅ should create instance if not exists', () => {
      // Reset singleton
      (require('./ai.js') as any).aiServiceInstance = null;

      const instance = getAIService();
      expect(instance).toBeInstanceOf(AIService);
    });
  });

  describe('Error Handling', () => {
    test('❌ should handle timeout errors', async () => {
      mockOpenAI.chat.completions.create.mockRejectedValue(
        new Error('Request timeout')
      );

      const response = await aiService.generateResponse('test', sampleContext);

      expect(response.intent).toBe('SUPPORT');
      expect(response.actions[0].type).toBe('ESCALATE');
    });

    test('❌ should handle rate limit errors', async () => {
      mockOpenAI.chat.completions.create.mockRejectedValue(
        new Error('Rate limit exceeded')
      );

      const response = await aiService.generateResponse('test', sampleContext);

      expect(response.confidence).toBe(0.1);
    });

    test('❌ should handle network errors', async () => {
      mockOpenAI.chat.completions.create.mockRejectedValue(
        new Error('ECONNREFUSED')
      );

      const response = await aiService.generateResponse('test', sampleContext);

      expect(response.message).toContain('مشكلة تقنية');
    });
  });

  describe('Configuration', () => {
    test('✅ should use environment variables for model settings', async () => {
      process.env.OPENAI_MODEL = 'gpt-4';
      process.env.OPENAI_TEMPERATURE = '0.5';
      process.env.OPENAI_MAX_TOKENS = '1000';

      const newService = new AIService();
      await newService.generateResponse('test', sampleContext);

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4',
          temperature: 0.5,
          max_tokens: 1000
        })
      );
    });

    test('✅ should use default values when env vars missing', async () => {
      delete process.env.OPENAI_MODEL;
      delete process.env.OPENAI_TEMPERATURE;
      delete process.env.OPENAI_MAX_TOKENS;

      const newService = new AIService();
      await newService.generateResponse('test', sampleContext);

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o-mini',
          temperature: 0.7,
          max_tokens: 500
        })
      );
    });
  });

  describe('Performance', () => {
    test('✅ should track response time', async () => {
      // Add delay to OpenAI mock
      mockOpenAI.chat.completions.create.mockImplementation(() => 
        new Promise(resolve => 
          setTimeout(() => resolve({
            choices: [{ message: { content: JSON.stringify({
              message: 'test',
              messageAr: 'test',
              intent: 'TEST',
              stage: 'TEST',
              actions: [],
              products: [],
              confidence: 0.8
            }) } }],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
          }), 100)
        )
      );

      const response = await aiService.generateResponse('test', sampleContext);

      expect(response.responseTime).toBeGreaterThanOrEqual(100);
    });

    test('✅ should handle concurrent requests', async () => {
      const promises = Array.from({ length: 5 }, () =>
        aiService.generateResponse(`test message ${Math.random()}`, sampleContext)
      );

      const responses = await Promise.all(promises);

      expect(responses).toHaveLength(5);
      responses.forEach(response => {
        expect(response).toBeDefined();
        expect(response.message).toBeDefined();
      });
    });
  });
});