/**
 * ===============================================
 * Instagram AI Service Tests
 * اختبارات شاملة لخدمة الذكاء الاصطناعي لإنستقرام
 * ===============================================
 */

import { describe, test, expect, beforeEach, afterEach, jest } from 'bun:test';
import OpenAI from 'openai';

import {
  InstagramAIService,
  getInstagramAIService,
  type InstagramAIResponse,
  type InstagramContext,
  type MediaRecommendation
} from './instagram-ai.js';

// Mock dependencies
jest.mock('openai');
jest.mock('./logger.js', () => ({
  createLogger: jest.fn(() => ({
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
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

describe('📱 Instagram AI Service Tests', () => {
  let instagramAIService: InstagramAIService;
  let mockSQL: jest.Mock;

  const sampleInstagramContext: InstagramContext = {
    merchantId: 'merchant-123',
    customerId: 'customer-456',
    platform: 'instagram' as const,
    stage: 'PRODUCT_INQUIRY' as const,
    cart: [],
    preferences: {},
    conversationHistory: [
      {
        role: 'user',
        content: 'مرحبا 👋 شفت الستوري، المنتج حلو كثير',
        timestamp: new Date()
      }
    ],
    interactionType: 'story_reply',
    mediaContext: {
      mediaId: 'story-123',
      mediaType: 'photo',
      caption: 'منتجاتنا الجديدة 🔥',
      hashtags: ['#جديد', '#ترند']
    },
    customerProfile: {
      name: 'سارة أحمد',
      instagram: '@sara_ahmed',
      previousOrders: 1,
      averageOrderValue: 120,
      preferredCategories: ['fashion'],
      lastInteraction: new Date()
    },
    merchantSettings: {
      businessName: 'بوتيك العصرية',
      businessCategory: 'fashion',
      workingHours: { start: '10:00', end: '22:00' },
      paymentMethods: ['cash', 'zain_cash'],
      deliveryFees: { default: 3000 },
      autoResponses: {}
    },
    visualPreferences: {
      colorScheme: ['pink', 'gold'],
      aestheticStyle: 'minimalist',
      contentType: ['photos', 'reels']
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup environment variables
    process.env.OPENAI_API_KEY = 'test-api-key';
    process.env.OPENAI_MODEL = 'gpt-4o-mini';
    process.env.OPENAI_TIMEOUT = '30000';
    process.env.OPENAI_MAX_TOKENS = '600';

    // Mock database
    mockSQL = jest.fn();
    const { getDatabase } = require('../database/connection.js');
    getDatabase.mockReturnValue({
      getSQL: () => mockSQL
    });

    // Mock OpenAI constructor and methods
    (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(() => mockOpenAI as any);

    instagramAIService = new InstagramAIService();
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
  });

  describe('generateInstagramResponse', () => {
    const mockInstagramResponse: InstagramAIResponse = {
      message: 'أهلاً حبيبتي! 💕 حبيتي الستوري؟ عندنا موديلات جديدة حصرية 🔥✨',
      messageAr: 'أهلاً حبيبتي! 💕 حبيتي الستوري؟ عندنا موديلات جديدة حصرية 🔥✨',
      intent: 'PRODUCT_INQUIRY',
      stage: 'PRODUCT_SELECTION',
      actions: [
        { type: 'SHOW_PRODUCT', data: { category: 'fashion' }, priority: 1 }
      ],
      products: [
        {
          productId: 'dress-1',
          sku: 'DR001',
          name: 'فستان سهرة',
          price: 150,
          confidence: 0.9,
          reason: 'موديل ترندي ومناسب للسهرات'
        }
      ],
      confidence: 0.9,
      tokens: { prompt: 0, completion: 0, total: 0 },
      responseTime: 0,
      visualStyle: 'story',
      engagement: {
        likelyToShare: true,
        viralPotential: 0.8,
        userGeneratedContent: true
      },
      mediaRecommendations: [
        {
          type: 'story',
          content: 'صورة للفستان مع إضاءة ناعمة',
          caption: 'فساتين سهرة جديدة 💃✨',
          hashtags: ['#فساتين', '#سهرة', '#موضة'],
          callToAction: 'راسليني للطلب 📱'
        }
      ],
      hashtagSuggestions: ['#عراق', '#موضة', '#ترند']
    };

    beforeEach(() => {
      // Mock merchant config query
      mockSQL.mockResolvedValueOnce([
        {
          ai_config: {
            model: 'gpt-4o-mini',
            maxTokens: 600,
            temperature: 0.8,
            language: 'ar'
          }
        }
      ]);

      // Mock OpenAI response
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify(mockInstagramResponse)
          }
        }],
        usage: {
          prompt_tokens: 200,
          completion_tokens: 150,
          total_tokens: 350
        }
      });

      // Mock additional database calls for logging
      mockSQL.mockResolvedValue([]);
    });

    test('✅ should generate Instagram-optimized response', async () => {
      const response = await instagramAIService.generateInstagramResponse(
        'حبيت الستوري! وين أكدر أشتري هذا الفستان؟',
        sampleInstagramContext
      );

      expect(response).toMatchObject({
        message: expect.stringContaining('💕'),
        intent: 'PRODUCT_INQUIRY',
        visualStyle: 'story',
        engagement: {
          likelyToShare: true,
          viralPotential: expect.any(Number),
          userGeneratedContent: true
        }
      });

      expect(response.tokens).toEqual({
        prompt: 200,
        completion: 150,
        total: 350
      });

      expect(response.hashtagSuggestions).toContain('#عراق');
    });

    test('✅ should load merchant-specific AI configuration', async () => {
      await instagramAIService.generateInstagramResponse(
        'test message',
        sampleInstagramContext
      );

      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining(['merchant-123'])
      );

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-4o-mini',
        messages: expect.any(Array),
        temperature: 0.8,
        max_tokens: 600,
        top_p: 0.95,
        frequency_penalty: 0.2,
        presence_penalty: 0.3,
        response_format: { type: 'json_object' }
      });
    });

    test('✅ should use default config when merchant config unavailable', async () => {
      mockSQL.mockResolvedValueOnce([]); // No merchant config

      await instagramAIService.generateInstagramResponse(
        'test message',
        sampleInstagramContext
      );

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o-mini',
          temperature: 0.8,
          max_tokens: 600
        })
      );
    });

    test('✅ should include Instagram-specific context in prompt', async () => {
      await instagramAIService.generateInstagramResponse(
        'أريد هذا المنتج',
        sampleInstagramContext
      );

      const callArgs = mockOpenAI.chat.completions.create.mock.calls[0][0];
      const systemMessage = callArgs.messages[0];
      
      expect(systemMessage.content).toContain('Instagram');
      expect(systemMessage.content).toContain('story_reply');
      expect(systemMessage.content).toContain('بوتيك العصرية');
      expect(systemMessage.content).toContain('رموز تعبيرية');
    });

    test('✅ should add interaction type context to user message', async () => {
      await instagramAIService.generateInstagramResponse(
        'مرحبا',
        sampleInstagramContext
      );

      const callArgs = mockOpenAI.chat.completions.create.mock.calls[0][0];
      const userMessage = callArgs.messages[callArgs.messages.length - 1];
      
      expect(userMessage.content).toContain('[ردّ على ستوري]');
      expect(userMessage.content).toContain('مرحبا');
    });

    test('❌ should return contextual fallback on OpenAI error', async () => {
      mockOpenAI.chat.completions.create.mockRejectedValue(new Error('API Error'));

      const response = await instagramAIService.generateInstagramResponse(
        'test message',
        sampleInstagramContext
      );

      expect(response.intent).toBe('SUPPORT');
      expect(response.actions[0].type).toBe('ESCALATE');
      expect(response.message).toContain('شكراً لتفاعلك مع ستورينا');
      expect(response.visualStyle).toBe('story');
    });

    test('❌ should handle invalid JSON response', async () => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: 'invalid json' } }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      });

      const response = await instagramAIService.generateInstagramResponse(
        'test',
        sampleInstagramContext
      );

      expect(response.intent).toBe('SUPPORT');
      expect(response.message).toContain('ستورينا');
    });

    test('❌ should handle missing required fields in AI response', async () => {
      const incompleteResponse = {
        message: 'test message'
        // Missing messageAr, intent, actions
      };

      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(incompleteResponse) } }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
      });

      const response = await instagramAIService.generateInstagramResponse(
        'test',
        sampleInstagramContext
      );

      expect(response.intent).toBe('SUPPORT');
    });

    test('✅ should handle different interaction types', async () => {
      const commentContext = {
        ...sampleInstagramContext,
        interactionType: 'comment' as const
      };

      await instagramAIService.generateInstagramResponse(
        'منتج حلو',
        commentContext
      );

      const callArgs = mockOpenAI.chat.completions.create.mock.calls[0][0];
      const userMessage = callArgs.messages[callArgs.messages.length - 1];
      
      expect(userMessage.content).toContain('[تعليق على منشور]');
    });
  });

  describe('generateStoryReply', () => {
    const storyContext = {
      mediaId: 'story-456',
      mediaType: 'video',
      caption: 'مجموعتنا الجديدة 🔥'
    };

    const mockStoryResponse = {
      message: 'يا سلام على الذوق! 😍🔥 راسليني للطلب حبيبتي',
      messageAr: 'يا سلام على الذوق! 😍🔥 راسليني للطلب حبيبتي',
      intent: 'ENGAGEMENT',
      stage: 'INITIAL_CONTACT',
      actions: [{ type: 'COLLECT_INFO', data: {}, priority: 1 }],
      products: [],
      confidence: 0.9
    };

    beforeEach(() => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(mockStoryResponse) } }]
      });
    });

    test('✅ should generate story reply response', async () => {
      const response = await instagramAIService.generateStoryReply(
        'حلو كثير! 😍',
        storyContext,
        sampleInstagramContext
      );

      expect(response.visualStyle).toBe('story');
      expect(response.engagement.likelyToShare).toBe(true);
      expect(response.engagement.viralPotential).toBe(0.7);
      expect(response.engagement.userGeneratedContent).toBe(true);
    });

    test('✅ should use high temperature for creativity', async () => {
      await instagramAIService.generateStoryReply(
        'رائع',
        storyContext,
        sampleInstagramContext
      );

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-4o-mini',
        messages: expect.any(Array),
        temperature: 0.9,
        max_tokens: 200,
        response_format: { type: 'json_object' }
      });
    });

    test('✅ should include story context in prompt', async () => {
      await instagramAIService.generateStoryReply(
        'أعجبني',
        storyContext,
        sampleInstagramContext
      );

      const callArgs = mockOpenAI.chat.completions.create.mock.calls[0][0];
      const systemMessage = callArgs.messages[0];
      
      expect(systemMessage.content).toContain('video');
      expect(systemMessage.content).toContain('مجموعتنا الجديدة 🔥');
    });

    test('❌ should return fallback on error', async () => {
      mockOpenAI.chat.completions.create.mockRejectedValue(new Error('API Error'));

      const response = await instagramAIService.generateStoryReply(
        'test',
        storyContext,
        sampleInstagramContext
      );

      expect(response.intent).toBe('SUPPORT');
      expect(response.message).toContain('🙏');
    });
  });

  describe('generateCommentResponse', () => {
    const postContext = {
      mediaId: 'post-789',
      caption: 'منتجاتنا الجديدة متوفرة الآن'
    };

    const mockCommentResponse = {
      message: 'شكراً لتعليقك الجميل! 💙 راسلينا خاص للتفاصيل',
      messageAr: 'شكراً لتعليقك الجميل! 💙 راسلينا خاص للتفاصيل',
      intent: 'CUSTOMER_SERVICE',
      stage: 'INITIAL_CONTACT',
      actions: [{ type: 'COLLECT_INFO', data: {}, priority: 1 }],
      products: [],
      confidence: 0.8
    };

    beforeEach(() => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(mockCommentResponse) } }]
      });
    });

    test('✅ should generate comment response', async () => {
      const response = await instagramAIService.generateCommentResponse(
        'هل متوفر بالأزرق؟',
        postContext,
        sampleInstagramContext
      );

      expect(response.visualStyle).toBe('post');
      expect(response.engagement.likelyToShare).toBe(false);
      expect(response.engagement.viralPotential).toBe(0.4);
      expect(response.engagement.userGeneratedContent).toBe(false);
    });

    test('✅ should use moderate temperature for comments', async () => {
      await instagramAIService.generateCommentResponse(
        'سؤال',
        postContext,
        sampleInstagramContext
      );

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-4o-mini',
        messages: expect.any(Array),
        temperature: 0.7,
        max_tokens: 150,
        response_format: { type: 'json_object' }
      });
    });

    test('❌ should return fallback on error', async () => {
      mockOpenAI.chat.completions.create.mockRejectedValue(new Error('API Error'));

      const response = await instagramAIService.generateCommentResponse(
        'test',
        postContext,
        sampleInstagramContext
      );

      expect(response.intent).toBe('SUPPORT');
      expect(response.message).toContain('💙');
    });
  });

  describe('generateProductShowcase', () => {
    const mockProducts = [
      {
        id: 'prod-1',
        sku: 'DR001',
        name_ar: 'فستان سهرة',
        price_usd: 150,
        category: 'fashion',
        description_ar: 'فستان أنيق للسهرات',
        image_urls: ['image1.jpg']
      }
    ];

    const mockShowcase = {
      mediaRecommendations: [
        {
          type: 'carousel',
          content: 'صور متعددة للفستان',
          caption: 'فساتين سهرة جديدة 💃✨',
          hashtags: ['#فساتين', '#سهرة'],
          callToAction: 'راسليني للطلب'
        }
      ],
      caption: 'مجموعة فساتين السهرة الجديدة ✨',
      hashtags: ['#فساتين', '#موضة', '#عراق'],
      engagementBoosts: ['استخدم رموز تعبيرية', 'اطرح سؤال للمتابعين']
    };

    beforeEach(() => {
      // Mock products query
      mockSQL.mockResolvedValue(mockProducts);

      // Mock OpenAI response
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(mockShowcase) } }]
      });
    });

    test('✅ should generate product showcase', async () => {
      const showcase = await instagramAIService.generateProductShowcase(
        ['prod-1'],
        sampleInstagramContext
      );

      expect(showcase.mediaRecommendations).toHaveLength(1);
      expect(showcase.caption).toContain('فساتين');
      expect(showcase.hashtags).toContain('#فساتين');
      expect(showcase.engagementBoosts).toBeDefined();
    });

    test('✅ should fetch products for showcase', async () => {
      await instagramAIService.generateProductShowcase(
        ['prod-1', 'prod-2'],
        sampleInstagramContext
      );

      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining(['merchant-123'])
      );
    });

    test('✅ should handle large product batches', async () => {
      const manyProductIds = Array.from({ length: 100 }, (_, i) => `prod-${i}`);

      await instagramAIService.generateProductShowcase(
        manyProductIds,
        sampleInstagramContext
      );

      // Should batch requests (50 per batch = 2 batches)
      expect(mockSQL).toHaveBeenCalledTimes(2);
    });

    test('❌ should return empty showcase on error', async () => {
      mockOpenAI.chat.completions.create.mockRejectedValue(new Error('API Error'));

      const showcase = await instagramAIService.generateProductShowcase(
        ['prod-1'],
        sampleInstagramContext
      );

      expect(showcase).toEqual({
        mediaRecommendations: [],
        caption: '',
        hashtags: [],
        engagementBoosts: []
      });
    });
  });

  describe('analyzeContentPerformance', () => {
    const mockAnalysis = {
      viralScore: 8,
      engagementPrediction: 7,
      audienceMatch: 9,
      optimizationSuggestions: [
        'أضف المزيد من الرموز التعبيرية',
        'استخدم هاشتاجات ترندية أكثر'
      ]
    };

    beforeEach(() => {
      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(mockAnalysis) } }]
      });
    });

    test('✅ should analyze content performance', async () => {
      const analysis = await instagramAIService.analyzeContentPerformance(
        'فساتين جديدة 🔥 #موضة #عراق',
        'post',
        sampleInstagramContext
      );

      expect(analysis.viralScore).toBe(8);
      expect(analysis.engagementPrediction).toBe(7);
      expect(analysis.audienceMatch).toBe(9);
      expect(analysis.optimizationSuggestions).toHaveLength(2);
    });

    test('✅ should use appropriate parameters for analysis', async () => {
      await instagramAIService.analyzeContentPerformance(
        'test content',
        'reel',
        sampleInstagramContext
      );

      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-4o-mini',
        messages: expect.any(Array),
        temperature: 0.4,
        max_tokens: 400,
        response_format: { type: 'json_object' }
      });
    });

    test('❌ should return zero scores on error', async () => {
      mockOpenAI.chat.completions.create.mockRejectedValue(new Error('API Error'));

      const analysis = await instagramAIService.analyzeContentPerformance(
        'test',
        'story',
        sampleInstagramContext
      );

      expect(analysis).toEqual({
        viralScore: 0,
        engagementPrediction: 0,
        audienceMatch: 0,
        optimizationSuggestions: []
      });
    });
  });

  describe('Hashtag Generation', () => {
    test('✅ should generate relevant hashtags', async () => {
      const hashtags = await (instagramAIService as any).generateRelevantHashtags(
        'أريد فستان للزفاف',
        sampleInstagramContext
      );

      expect(hashtags).toContain('#عراق');
      expect(hashtags).toContain('#موضة');
      expect(hashtags).toContain('#ترند');
      expect(hashtags.length).toBeLessThanOrEqual(8);
    });

    test('✅ should include category-specific hashtags', async () => {
      const electronicsContext = {
        ...sampleInstagramContext,
        merchantSettings: {
          ...sampleInstagramContext.merchantSettings!,
          businessCategory: 'electronics'
        }
      };

      const hashtags = await (instagramAIService as any).generateRelevantHashtags(
        'أريد جوال جديد',
        electronicsContext
      );

      expect(hashtags).toContain('#جوالات');
      expect(hashtags).toContain('#تكنولوجيا');
    });

    test('❌ should return fallback hashtags on error', async () => {
      // Force error by passing invalid context
      const hashtags = await (instagramAIService as any).generateRelevantHashtags(
        'test',
        null
      );

      expect(hashtags).toEqual(['#عراق', '#تسوق', '#جديد']);
    });
  });

  describe('Contextual Fallbacks', () => {
    test('✅ should provide different fallbacks by interaction type', () => {
      const storyReplyFallback = (instagramAIService as any).getContextualFallback(
        { ...sampleInstagramContext, interactionType: 'story_reply' },
        'AI_API_ERROR'
      );

      const dmFallback = (instagramAIService as any).getContextualFallback(
        { ...sampleInstagramContext, interactionType: 'dm' },
        'AI_API_ERROR'
      );

      expect(storyReplyFallback.message).toContain('ستورينا');
      expect(dmFallback.message).toContain('النظام مشغول');
    });

    test('✅ should handle different error types', () => {
      const rateLimitFallback = (instagramAIService as any).getContextualFallback(
        sampleInstagramContext,
        'RATE_LIMIT'
      );

      const networkErrorFallback = (instagramAIService as any).getContextualFallback(
        sampleInstagramContext,
        'NETWORK_ERROR'
      );

      expect(rateLimitFallback.message).toContain('قريباً');
      expect(networkErrorFallback.message).toContain('خاص');
    });

    test('✅ should set appropriate engagement values for fallbacks', () => {
      const storyFallback = (instagramAIService as any).getContextualFallback(
        { ...sampleInstagramContext, interactionType: 'story_reply' },
        'AI_API_ERROR'
      );

      const dmFallback = (instagramAIService as any).getContextualFallback(
        { ...sampleInstagramContext, interactionType: 'dm' },
        'AI_API_ERROR'
      );

      expect(storyFallback.engagement.likelyToShare).toBe(true);
      expect(storyFallback.engagement.viralPotential).toBe(0.7);
      expect(dmFallback.engagement.likelyToShare).toBe(false);
    });
  });

  describe('Logging and Analytics', () => {
    beforeEach(() => {
      // Setup successful response
      mockSQL.mockResolvedValueOnce([{ ai_config: null }]); // Config query
      mockSQL.mockResolvedValue([]); // All other queries

      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [{
          message: {
            content: JSON.stringify({
              message: 'test',
              messageAr: 'test',
              intent: 'TEST',
              stage: 'TEST',
              actions: [],
              products: [],
              confidence: 0.8
            })
          }
        }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
      });
    });

    test('✅ should log Instagram AI interactions', async () => {
      await instagramAIService.generateInstagramResponse(
        'test message',
        sampleInstagramContext
      );

      // Should call audit_logs insert
      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([
          'merchant-123',
          'INSTAGRAM_AI_RESPONSE_GENERATED',
          'AI_INTERACTION'
        ])
      );

      // Should call instagram_analytics insert
      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([
          'merchant-123',
          'story_reply',
          150 // total tokens
        ])
      );
    });

    test('✅ should handle logging errors gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      // Make logging fail
      mockSQL.mockImplementation((sql) => {
        if (sql.toString().includes('audit_logs')) {
          return Promise.reject(new Error('DB Error'));
        }
        return Promise.resolve([]);
      });

      const response = await instagramAIService.generateInstagramResponse(
        'test',
        sampleInstagramContext
      );

      expect(response).toBeDefined();
      
      consoleSpy.mockRestore();
    });
  });

  describe('Performance Optimization', () => {
    test('✅ should batch database operations', async () => {
      const operations = [
        () => Promise.resolve('result1'),
        () => Promise.resolve('result2'),
        () => Promise.resolve('result3')
      ];

      const results = await (instagramAIService as any).processCommentBatch(operations);

      expect(results).toEqual(['result1', 'result2', 'result3']);
    });

    test('❌ should handle batch operation failures', async () => {
      const operations = [
        () => Promise.resolve('success'),
        () => Promise.reject(new Error('failure')),
        () => Promise.resolve('success2')
      ];

      const results = await (instagramAIService as any).processCommentBatch(operations);

      expect(results).toEqual([]);
    });

    test('✅ should handle large product batches efficiently', async () => {
      const manyProducts = Array.from({ length: 150 }, (_, i) => ({
        id: `prod-${i}`,
        sku: `SKU${i}`,
        name_ar: `منتج ${i}`,
        price_usd: 100,
        category: 'test'
      }));

      mockSQL.mockResolvedValue(manyProducts.slice(0, 50)); // Simulate batch response

      const productIds = manyProducts.map(p => p.id);
      const results = await (instagramAIService as any).getProductsForShowcase(
        productIds,
        'merchant-123'
      );

      // Should make 3 batch calls (150 products / 50 per batch)
      expect(mockSQL).toHaveBeenCalledTimes(3);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Singleton Pattern', () => {
    test('✅ should return same instance', () => {
      const instance1 = getInstagramAIService();
      const instance2 = getInstagramAIService();

      expect(instance1).toBe(instance2);
    });

    test('✅ should create instance if not exists', () => {
      // Reset singleton
      (require('./instagram-ai.js') as any).instagramAIServiceInstance = null;

      const instance = getInstagramAIService();
      expect(instance).toBeInstanceOf(InstagramAIService);
    });
  });

  describe('Edge Cases', () => {
    test('✅ should handle unknown interaction type', () => {
      const unknownContext = {
        ...sampleInstagramContext,
        interactionType: 'unknown_type' as any
      };

      const fallback = (instagramAIService as any).getContextualFallback(
        unknownContext,
        'AI_API_ERROR'
      );

      // Should default to 'dm' behavior
      expect(fallback.message).toContain('النظام مشغول');
    });

    test('✅ should handle missing media context', async () => {
      const contextWithoutMedia = {
        ...sampleInstagramContext,
        mediaContext: undefined
      };

      await instagramAIService.generateInstagramResponse(
        'test',
        contextWithoutMedia
      );

      const callArgs = mockOpenAI.chat.completions.create.mock.calls[0][0];
      const systemMessage = callArgs.messages[0];
      
      expect(systemMessage.content).toContain('لا يوجد محتوى بصري');
    });

    test('✅ should handle missing merchant settings', async () => {
      const contextWithoutSettings = {
        ...sampleInstagramContext,
        merchantSettings: undefined
      };

      await instagramAIService.generateInstagramResponse(
        'test',
        contextWithoutSettings
      );

      const callArgs = mockOpenAI.chat.completions.create.mock.calls[0][0];
      const systemMessage = callArgs.messages[0];
      
      expect(systemMessage.content).toContain('غير محدد');
    });

    test('✅ should handle empty product showcase', async () => {
      mockSQL.mockResolvedValue([]); // No products found

      const showcase = await instagramAIService.generateProductShowcase(
        ['nonexistent-product'],
        sampleInstagramContext
      );

      expect(showcase.mediaRecommendations).toEqual([]);
    });
  });
});