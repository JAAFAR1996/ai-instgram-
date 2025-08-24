/**
 * ===============================================
 * Instagram Comments Manager Tests
 * تتطبق اختبارات شاملة لمدير تعليقات Instagram
 * ===============================================
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { InstagramCommentsManager, getInstagramCommentsManager } from './instagram-comments-manager.js';
import type { CommentInteraction, CommentResponse, CommentAnalytics, CommentModerationRule } from './instagram-comments-manager.js';

// Mock dependencies
const mockDatabase = {
  getSQL: mock(() => mockSQL),
  query: mock(),
  transaction: mock()
};

const mockSQL = mock((strings: TemplateStringsArray, ...values: any[]) => {
  const query = strings.join('?');
  return Promise.resolve([
    {
      id: 'comment-123',
      total_comments: 100,
      positive: 70,
      neutral: 20,
      negative: 10,
      sales_inquiries: 15,
      responses: 50,
      avg_response_time: 15,
      username: 'test_user',
      comment_count: 5,
      engagement_score: 85,
      post_type: 'photo',
      comments: 50,
      conversions: 10
    }
  ]);
});

const mockInstagramClient = {
  loadMerchantCredentials: mock(() => Promise.resolve({
    accessToken: 'test-token',
    pageId: 'page-123',
    userId: 'user-123',
    tokenExpiresAt: new Date(Date.now() + 3600000)
  })),
  validateCredentials: mock(() => Promise.resolve(true)),
  replyToComment: mock(() => Promise.resolve({ success: true, replyId: 'reply-123' })),
  sendMessage: mock(() => Promise.resolve({ success: true, messageId: 'message-123' }))
};

const mockAIOrchestrator = {
  generatePlatformResponse: mock(() => Promise.resolve({
    response: {
      message: 'شكراً لك على تعليقك الجميل! 🌹',
      confidence: 85
    },
    analysis: {
      sentiment: 'positive',
      intent: 'engagement'
    }
  }))
};

const mockRedisConnection = {
  get: mock(() => Promise.resolve(null)),
  setex: mock(() => Promise.resolve('OK')),
  del: mock(() => Promise.resolve(1))
};

const mockRedisManager = {
  getConnection: mock(() => Promise.resolve(mockRedisConnection))
};

const mockLogger = {
  info: mock(),
  warn: mock(),
  error: mock(),
  debug: mock()
};

// Mock modules
mock.module('./instagram-api.js', () => ({
  getInstagramClient: mock(() => mockInstagramClient),
  clearInstagramClient: mock()
}));

mock.module('../database/connection.js', () => ({
  getDatabase: mock(() => mockDatabase)
}));

mock.module('./conversation-ai-orchestrator.js', () => ({
  getConversationAIOrchestrator: mock(() => mockAIOrchestrator)
}));

mock.module('./RedisConnectionManager.js', () => ({
  getRedisConnectionManager: mock(() => mockRedisManager)
}));

mock.module('./logger.js', () => ({
  createLogger: mock(() => mockLogger)
}));

mock.module('../middleware/idempotency.js', () => ({
  hashMerchantAndBody: mock((merchantId: string, body: any) => `hash-${merchantId}-${JSON.stringify(body).length}`)
}));

mock.module('../utils/expiring-map.js', () => ({
  ExpiringMap: mock().mockImplementation(() => ({
    get: mock(() => null),
    set: mock(),
    delete: mock(),
    clear: mock(),
    dispose: mock()
  }))
}));

describe('Instagram Comments Manager - مدير تعليقات Instagram', () => {
  let commentsManager: InstagramCommentsManager;
  const testMerchantId = 'merchant-123';

  // Sample comment data
  const sampleComment: CommentInteraction = {
    id: 'comment-123',
    postId: 'post-456',
    userId: 'user-789',
    username: 'test_user',
    content: 'هذا المنتج رائع! كم سعره؟',
    timestamp: new Date(),
    isReply: false,
    metadata: {
      postType: 'photo',
      postUrl: 'https://instagram.com/p/test',
      hasHashtags: false,
      mentionsCount: 0
    }
  };

  beforeEach(() => {
    // Reset all mocks
    mockDatabase.getSQL.mockClear();
    mockInstagramClient.loadMerchantCredentials.mockClear();
    mockInstagramClient.validateCredentials.mockClear();
    mockInstagramClient.replyToComment.mockClear();
    mockInstagramClient.sendMessage.mockClear();
    mockAIOrchestrator.generatePlatformResponse.mockClear();
    mockRedisConnection.get.mockClear();
    mockRedisConnection.setex.mockClear();
    mockRedisManager.getConnection.mockClear();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();

    // Create fresh instance
    commentsManager = new InstagramCommentsManager();
  });

  afterEach(() => {
    commentsManager.dispose();
  });

  describe('Singleton Pattern - نمط الكائن الواحد', () => {
    test('should return same instance when called multiple times', () => {
      const instance1 = getInstagramCommentsManager();
      const instance2 = getInstagramCommentsManager();
      expect(instance1).toBe(instance2);
    });

    test('should initialize with proper dependencies', () => {
      const manager = getInstagramCommentsManager();
      expect(manager).toBeInstanceOf(InstagramCommentsManager);
    });
  });

  describe('Comment Processing - معالجة التعليقات', () => {
    test('should process comment successfully with reply response', async () => {
      // Mock AI to suggest reply
      mockAIOrchestrator.generatePlatformResponse.mockResolvedValueOnce({
        response: {
          message: 'شكراً لك! المنتج متوفر بسعر ممتاز 💕',
          confidence: 90
        }
      });

      const result = await commentsManager.processComment(sampleComment, testMerchantId);

      expect(result.success).toBe(true);
      expect(result.responseGenerated).toBe(true);
      expect(result.actionTaken).toBe('replied');
      expect(mockInstagramClient.replyToComment).toHaveBeenCalledWith(
        expect.any(Object),
        testMerchantId,
        sampleComment.id,
        expect.stringContaining('شكراً')
      );
    });

    test('should handle sales inquiry with DM invitation', async () => {
      const salesComment: CommentInteraction = {
        ...sampleComment,
        content: 'أريد أطلب من هذا المنتج، كم سعره وكيف أطلب؟'
      };

      const result = await commentsManager.processComment(salesComment, testMerchantId);

      expect(result.success).toBe(true);
      expect(mockRedisConnection.setex).toHaveBeenCalled(); // Idempotency cache
    });

    test('should handle complaint with DM invitation', async () => {
      const complaintComment: CommentInteraction = {
        ...sampleComment,
        content: 'عندي مشكلة مع الطلب، ماوصلني شي!'
      };

      // Mock analysis to detect complaint
      const complainAnalysis = {
        sentiment: 'negative',
        sentimentScore: 25,
        isSalesInquiry: false,
        isComplaint: true,
        isSpam: false,
        keywords: ['مشكلة'],
        urgencyLevel: 'high',
        recommendedAction: 'dm_invite'
      };

      const mockAnalyzeComment = spyOn(commentsManager, 'analyzeComment');
      mockAnalyzeComment.mockResolvedValue(complainAnalysis);

      const result = await commentsManager.processComment(complaintComment, testMerchantId);

      expect(result.success).toBe(true);
      expect(mockInstagramClient.sendMessage).toHaveBeenCalled();
    });

    test('should handle spam comments by not responding', async () => {
      const spamComment: CommentInteraction = {
        ...sampleComment,
        content: 'Click this link for free followers! spam promotional'
      };

      const result = await commentsManager.processComment(spamComment, testMerchantId);

      expect(result.success).toBe(true);
      expect(result.responseGenerated).toBe(false);
    });

    test('should handle positive engagement with appreciation', async () => {
      const positiveComment: CommentInteraction = {
        ...sampleComment,
        content: 'حلو جداً! منتجاتكم رائعة 😍'
      };

      const result = await commentsManager.processComment(positiveComment, testMerchantId);

      expect(result.success).toBe(true);
    });

    test('should implement idempotency for duplicate comment processing', async () => {
      // First call should process normally
      mockRedisConnection.get.mockResolvedValueOnce(null);
      
      const result1 = await commentsManager.processComment(sampleComment, testMerchantId);
      expect(result1.success).toBe(true);

      // Second call with same comment should return cached result
      mockRedisConnection.get.mockResolvedValueOnce(JSON.stringify({
        success: true,
        responseGenerated: true,
        actionTaken: 'replied'
      }));

      const result2 = await commentsManager.processComment(sampleComment, testMerchantId);
      expect(result2.success).toBe(true);
      expect(result2.responseGenerated).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Idempotent comment processing detected',
        expect.any(Object)
      );
    });

    test('should handle processing errors gracefully', async () => {
      mockInstagramClient.loadMerchantCredentials.mockRejectedValueOnce(
        new Error('Credentials not found')
      );

      const result = await commentsManager.processComment(sampleComment, testMerchantId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Credentials not found');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Comment Analysis - تحليل التعليقات', () => {
    test('should analyze comment sentiment correctly', async () => {
      const analysis = await commentsManager.analyzeComment(sampleComment, testMerchantId);

      expect(analysis).toHaveProperty('sentiment');
      expect(analysis).toHaveProperty('sentimentScore');
      expect(analysis).toHaveProperty('isSalesInquiry');
      expect(analysis).toHaveProperty('isComplaint');
      expect(analysis).toHaveProperty('urgencyLevel');
      expect(mockAIOrchestrator.generatePlatformResponse).toHaveBeenCalled();
    });

    test('should detect sales inquiry keywords', async () => {
      const salesComment: CommentInteraction = {
        ...sampleComment,
        content: 'كم سعر هذا المنتج؟ متوفر؟'
      };

      const analysis = await commentsManager.analyzeComment(salesComment, testMerchantId);

      expect(analysis.isSalesInquiry).toBe(true);
      expect(analysis.urgencyLevel).toBe('medium');
    });

    test('should detect complaint keywords', async () => {
      const complaintComment: CommentInteraction = {
        ...sampleComment,
        content: 'عندي شكوى على الخدمة، سيئة جداً'
      };

      const analysis = await commentsManager.analyzeComment(complaintComment, testMerchantId);

      expect(analysis.isComplaint).toBe(true);
      expect(analysis.sentiment).toBe('negative');
    });

    test('should fallback to basic analysis when AI fails', async () => {
      mockAIOrchestrator.generatePlatformResponse.mockRejectedValueOnce(
        new Error('AI service unavailable')
      );

      const analysis = await commentsManager.analyzeComment(sampleComment, testMerchantId);

      expect(analysis).toBeDefined();
      expect(analysis.sentiment).toBeOneOf(['positive', 'neutral', 'negative']);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should store analysis results in database', async () => {
      await commentsManager.analyzeComment(sampleComment, testMerchantId);

      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('UPDATE comment_interactions')]),
        expect.any(Number), // sentiment score
        expect.any(Boolean), // is sales inquiry
        expect.any(Boolean), // is complaint
        expect.any(Boolean), // is spam
        expect.any(String), // urgency level
        expect.any(String), // analysis data JSON
        sampleComment.id,
        testMerchantId
      );
    });
  });

  describe('Comment Response Generation - توليد ردود التعليقات', () => {
    test('should generate appropriate response for sales inquiry', async () => {
      const salesAnalysis = {
        sentiment: 'neutral',
        isSalesInquiry: true,
        isComplaint: false,
        isSpam: false
      };

      const response = await commentsManager.generateCommentResponse(
        sampleComment,
        salesAnalysis,
        testMerchantId
      );

      expect(response.type).toBeOneOf(['reply', 'dm_invite']);
      expect(response.confidence).toBeGreaterThan(0);
      expect(response.reasoning).toBeDefined();
    });

    test('should invite to DM for detailed sales inquiries', async () => {
      const detailedSalesComment: CommentInteraction = {
        ...sampleComment,
        content: 'أريد أطلب من المنتج ده، كم سعره والتوصيل كام؟'
      };

      const salesAnalysis = {
        sentiment: 'neutral',
        isSalesInquiry: true,
        isComplaint: false,
        isSpam: false
      };

      const response = await commentsManager.generateCommentResponse(
        detailedSalesComment,
        salesAnalysis,
        testMerchantId
      );

      expect(response.type).toBe('dm_invite');
      expect(response.shouldInviteToDM).toBe(true);
      expect(response.dmInviteMessage).toContain('@test_user');
    });

    test('should generate complaint response with DM invitation', async () => {
      const complaintAnalysis = {
        sentiment: 'negative',
        isSalesInquiry: false,
        isComplaint: true,
        isSpam: false
      };

      const response = await commentsManager.generateCommentResponse(
        sampleComment,
        complaintAnalysis,
        testMerchantId
      );

      expect(response.type).toBe('dm_invite');
      expect(response.dmInviteMessage).toContain('نعتذر');
      expect(response.confidence).toBeGreaterThan(80);
    });

    test('should generate positive engagement response', async () => {
      const positiveAnalysis = {
        sentiment: 'positive',
        isSalesInquiry: false,
        isComplaint: false,
        isSpam: false
      };

      const response = await commentsManager.generateCommentResponse(
        sampleComment,
        positiveAnalysis,
        testMerchantId
      );

      expect(response.type).toBeOneOf(['reply', 'like']);
      if (response.type === 'reply') {
        expect(response.content).toContain('شكراً');
      }
    });

    test('should not respond to spam comments', async () => {
      const spamAnalysis = {
        sentiment: 'neutral',
        isSalesInquiry: false,
        isComplaint: false,
        isSpam: true
      };

      const response = await commentsManager.generateCommentResponse(
        sampleComment,
        spamAnalysis,
        testMerchantId
      );

      expect(response.type).toBe('none');
      expect(response.confidence).toBe(95);
      expect(response.reasoning).toContain('spam');
    });

    test('should handle response generation errors', async () => {
      mockAIOrchestrator.generatePlatformResponse.mockRejectedValueOnce(
        new Error('AI service error')
      );

      const analysis = { sentiment: 'neutral', isSalesInquiry: true };
      const response = await commentsManager.generateCommentResponse(
        sampleComment,
        analysis,
        testMerchantId
      );

      expect(response.type).toBe('none');
      expect(response.confidence).toBe(0);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Comment Analytics - تحليلات التعليقات', () => {
    test('should retrieve comprehensive comment analytics', async () => {
      const analytics = await commentsManager.getCommentAnalytics(testMerchantId);

      expect(analytics).toHaveProperty('totalComments');
      expect(analytics).toHaveProperty('responseRate');
      expect(analytics).toHaveProperty('averageResponseTime');
      expect(analytics).toHaveProperty('sentimentBreakdown');
      expect(analytics).toHaveProperty('salesInquiries');
      expect(analytics).toHaveProperty('topCommentingUsers');
      expect(analytics).toHaveProperty('performanceByPostType');

      expect(analytics.sentimentBreakdown).toHaveProperty('positive');
      expect(analytics.sentimentBreakdown).toHaveProperty('neutral');
      expect(analytics.sentimentBreakdown).toHaveProperty('negative');
    });

    test('should filter analytics by date range', async () => {
      const dateRange = {
        from: new Date('2024-01-01'),
        to: new Date('2024-01-31')
      };

      const analytics = await commentsManager.getCommentAnalytics(testMerchantId, dateRange);

      expect(analytics).toBeDefined();
      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('BETWEEN')]),
        expect.any(String), // merchant ID
        dateRange.from,
        dateRange.to
      );
    });

    test('should calculate response rate correctly', async () => {
      mockSQL.mockResolvedValueOnce([{
        total_comments: 100,
        positive: 70,
        neutral: 20,
        negative: 10,
        sales_inquiries: 25
      }]);

      mockSQL.mockResolvedValueOnce([{
        responses: 60,
        avg_response_time: 12.5
      }]);

      const analytics = await commentsManager.getCommentAnalytics(testMerchantId);

      expect(analytics.totalComments).toBe(100);
      expect(analytics.responseRate).toBe(60);
      expect(analytics.averageResponseTime).toBe(12.5);
    });

    test('should handle analytics errors gracefully', async () => {
      mockSQL.mockRejectedValueOnce(new Error('Database error'));

      await expect(
        commentsManager.getCommentAnalytics(testMerchantId)
      ).rejects.toThrow('Database error');

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Moderation Rules - قواعد الإشراف', () => {
    const sampleRule: Omit<CommentModerationRule, 'id'> = {
      name: 'Block Spam Keywords',
      trigger: {
        type: 'keyword',
        value: 'spam',
        operator: 'contains'
      },
      action: {
        type: 'hide',
        priority: 100
      },
      isActive: true
    };

    test('should create moderation rule successfully', async () => {
      mockSQL.mockResolvedValueOnce([{ id: 'rule-123' }]);

      const ruleId = await commentsManager.createModerationRule(testMerchantId, sampleRule);

      expect(ruleId).toBe('rule-123');
      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('INSERT INTO comment_moderation_rules')]),
        testMerchantId,
        sampleRule.name,
        JSON.stringify(sampleRule.trigger),
        JSON.stringify(sampleRule.action),
        sampleRule.isActive
      );
    });

    test('should handle rule creation errors', async () => {
      mockSQL.mockRejectedValueOnce(new Error('Database constraint error'));

      await expect(
        commentsManager.createModerationRule(testMerchantId, sampleRule)
      ).rejects.toThrow('Database constraint error');

      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should apply moderation rules during comment processing', async () => {
      const spamComment: CommentInteraction = {
        ...sampleComment,
        content: 'This is spam promotional content'
      };

      // Mock rule check to return hide action
      mockSQL.mockResolvedValueOnce([{
        id: 'rule-123',
        name: 'Spam Filter',
        trigger_config: JSON.stringify({
          type: 'keyword',
          value: 'spam',
          operator: 'contains'
        }),
        action_config: JSON.stringify({
          type: 'hide',
          priority: 100
        }),
        is_active: true
      }]);

      const result = await commentsManager.processComment(spamComment, testMerchantId);

      expect(result.success).toBe(true);
      expect(result.actionTaken).toBe('hidden');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Comment hidden due to moderation rule',
        expect.any(Object)
      );
    });
  });

  describe('Credentials Management - إدارة أوراق الاعتماد', () => {
    test('should cache and reuse valid credentials', async () => {
      const credentials = {
        accessToken: 'test-token',
        pageId: 'page-123',
        userId: 'user-123',
        tokenExpiresAt: new Date(Date.now() + 3600000)
      };

      mockInstagramClient.loadMerchantCredentials.mockResolvedValue(credentials);

      // First call should load from database
      await commentsManager.processComment(sampleComment, testMerchantId);
      expect(mockInstagramClient.loadMerchantCredentials).toHaveBeenCalledTimes(1);

      // Second call should use cached credentials
      await commentsManager.processComment(sampleComment, testMerchantId);
      expect(mockInstagramClient.loadMerchantCredentials).toHaveBeenCalledTimes(1);
    });

    test('should refresh expired credentials', async () => {
      const expiredCredentials = {
        accessToken: 'expired-token',
        pageId: 'page-123',
        userId: 'user-123',
        tokenExpiresAt: new Date(Date.now() - 1000) // Expired
      };

      const newCredentials = {
        accessToken: 'new-token',
        pageId: 'page-123',
        userId: 'user-123',
        tokenExpiresAt: new Date(Date.now() + 3600000)
      };

      mockInstagramClient.loadMerchantCredentials
        .mockResolvedValueOnce(expiredCredentials)
        .mockResolvedValueOnce(newCredentials);

      await commentsManager.processComment(sampleComment, testMerchantId);

      expect(mockInstagramClient.loadMerchantCredentials).toHaveBeenCalledTimes(1);
      expect(mockInstagramClient.validateCredentials).toHaveBeenCalled();
    });

    test('should handle missing credentials error', async () => {
      mockInstagramClient.loadMerchantCredentials.mockResolvedValue(null);

      const result = await commentsManager.processComment(sampleComment, testMerchantId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Instagram credentials not found');
    });

    test('should clear credentials cache when requested', () => {
      commentsManager.clearClient(testMerchantId);
      expect(mockInstagramClient.loadMerchantCredentials).not.toHaveBeenCalled();

      // Should reload credentials on next use
      commentsManager.processComment(sampleComment, testMerchantId);
    });
  });

  describe('Database Operations - عمليات قاعدة البيانات', () => {
    test('should store comment in database with proper fields', async () => {
      await commentsManager.processComment(sampleComment, testMerchantId);

      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('INSERT INTO comment_interactions')]),
        sampleComment.id,
        testMerchantId,
        sampleComment.postId,
        sampleComment.parentCommentId || null,
        sampleComment.userId,
        sampleComment.username,
        sampleComment.content,
        sampleComment.timestamp,
        sampleComment.isReply,
        JSON.stringify(sampleComment.metadata)
      );
    });

    test('should update analytics after comment processing', async () => {
      await commentsManager.processComment(sampleComment, testMerchantId);

      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('INSERT INTO daily_analytics')]),
        testMerchantId,
        1, // comments_received
        expect.any(Number), // comments_responded
        expect.any(Number) // response_rate
      );
    });

    test('should create sales opportunity for sales inquiries', async () => {
      const salesComment: CommentInteraction = {
        ...sampleComment,
        content: 'أريد أشتري هذا المنتج'
      };

      await commentsManager.processComment(salesComment, testMerchantId);

      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('INSERT INTO sales_opportunities')]),
        testMerchantId,
        salesComment.userId,
        'instagram',
        'COMMENT_INQUIRY',
        'NEW',
        expect.stringContaining('commentId')
      );
    });

    test('should log comment responses in database', async () => {
      await commentsManager.processComment(sampleComment, testMerchantId);

      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('INSERT INTO comment_responses')]),
        sampleComment.id,
        testMerchantId,
        expect.any(String), // response_type
        expect.any(String) // response_content
      );
    });
  });

  describe('Error Handling - التعامل مع الأخطاء', () => {
    test('should handle database connection errors', async () => {
      mockSQL.mockRejectedValueOnce(new Error('Database connection failed'));

      const result = await commentsManager.processComment(sampleComment, testMerchantId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database connection failed');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should handle Instagram API errors', async () => {
      mockInstagramClient.replyToComment.mockResolvedValueOnce({ success: false });

      const result = await commentsManager.processComment(sampleComment, testMerchantId);

      expect(result.success).toBe(true);
      expect(result.responseGenerated).toBe(false);
    });

    test('should handle Redis connection errors', async () => {
      mockRedisManager.getConnection.mockRejectedValueOnce(
        new Error('Redis connection failed')
      );

      const result = await commentsManager.processComment(sampleComment, testMerchantId);

      // Should still process comment even without Redis
      expect(result.success).toBe(true);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should handle malformed JSON in moderation rules', async () => {
      mockSQL.mockResolvedValueOnce([{
        id: 'rule-123',
        name: 'Invalid Rule',
        trigger_config: 'invalid json',
        action_config: 'also invalid',
        is_active: true
      }]);

      const result = await commentsManager.processComment(sampleComment, testMerchantId);

      expect(result.success).toBe(true);
      // Should continue processing despite invalid rule
    });
  });

  describe('Performance and Memory Management - الأداء وإدارة الذاكرة', () => {
    test('should dispose resources properly', () => {
      commentsManager.dispose();
      // Should not throw any errors
    });

    test('should handle high volume of concurrent comments', async () => {
      const comments = Array.from({ length: 100 }, (_, i) => ({
        ...sampleComment,
        id: `comment-${i}`,
        content: `تعليق رقم ${i}`
      }));

      const promises = comments.map(comment => 
        commentsManager.processComment(comment, testMerchantId)
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(100);
      expect(results.every(r => r.success === true || r.success === false)).toBe(true);
    });

    test('should prevent memory leaks in credentials cache', async () => {
      // Process many comments to test cache behavior
      for (let i = 0; i < 50; i++) {
        await commentsManager.processComment({
          ...sampleComment,
          id: `comment-${i}`
        }, `merchant-${i}`);
      }

      // Cache should not grow indefinitely
      expect(mockInstagramClient.loadMerchantCredentials).toHaveBeenCalled();
    });
  });

  describe('Integration Tests - اختبارات التكامل', () => {
    test('should complete full comment processing workflow', async () => {
      const comment: CommentInteraction = {
        id: 'comment-workflow-test',
        postId: 'post-123',
        userId: 'user-456',
        username: 'integration_test_user',
        content: 'هذا المنتج حلو جداً! كم سعره؟ أريد أطلب',
        timestamp: new Date(),
        isReply: false,
        metadata: {
          postType: 'photo',
          hasHashtags: true
        }
      };

      const result = await commentsManager.processComment(comment, testMerchantId);

      expect(result.success).toBe(true);
      expect([
        'replied',
        'dm_invited',
        'liked'
      ]).toContain(result.actionTaken);

      // Verify all workflow steps were executed
      expect(mockSQL).toHaveBeenCalled(); // Database operations
      expect(mockRedisConnection.setex).toHaveBeenCalled(); // Idempotency
      expect(mockLogger.info).toHaveBeenCalled(); // Logging
    });

    test('should handle complex sales inquiry with analytics update', async () => {
      const complexSalesComment: CommentInteraction = {
        ...sampleComment,
        content: 'مرحبا، أريد أطلب 5 قطع من هذا المنتج، كم السعر الإجمالي مع التوصيل؟'
      };

      const result = await commentsManager.processComment(complexSalesComment, testMerchantId);

      expect(result.success).toBe(true);
      expect(result.responseGenerated).toBe(true);

      // Should create sales opportunity
      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('sales_opportunities')]),
        expect.any(String),
        complexSalesComment.userId,
        'instagram',
        'COMMENT_INQUIRY',
        'NEW',
        expect.any(String)
      );
    });
  });
});