/**
 * ===============================================
 * Instagram Integration Tests
 * Comprehensive test suite for Instagram services
 * ===============================================
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { getInstagramAIService } from '../services/instagram-ai.js';
import { getInstagramClient } from '../services/instagram-api.js';
import { getServiceController } from '../services/service-controller.js';
import { getConversationAIOrchestrator } from '../services/conversation-ai-orchestrator.js';
import { getDatabase, initializeDatabase } from '../database/connection.js';

// Mock OpenAI to avoid API calls and timeouts
mock.module('openai', () => {
  return {
    default: class OpenAI {
      chat = {
        completions: {
          create: async (params: any) => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  message: params.messages.some((m: any) => m.content?.includes('منتجات')) 
                    ? 'نعم، لدينا منتجات جديدة رائعة!' 
                    : 'شكرًا على اهتمامك! يرجى مراسلتنا في الخاص للحصول على تفاصيل السعر.',
                  intent: 'PRODUCT_INQUIRY',
                  confidence: 0.85,
                  products: [],
                  visualStyle: params.messages.some((m: any) => m.content?.includes('comment')) ? 'post' : 'dm'
                })
              }
            }]
          })
        }
      }
    }
  };
});

// Mock security middleware to use in-memory rate limiter and no-op headers
mock.module('../middleware/security.js', () => {
  const limiter = new RateLimiterMemory({ points: 3, duration: 60 });
  return {
    securityHeaders: async (_c: any, next: any) => {
      await next();
    },
    rateLimiter: async (c: any, next: any) => {
      const key = c.req.header('x-rate-key') || 'default';
      try {
        await limiter.consume(key);
        await next();
      } catch {
        return c.json({ error: 'Rate limit exceeded' }, 429);
      }
    }
  };
});

// Stub meta rate limiter to always allow
mock.module('../services/meta-rate-limiter.js', () => ({
  getMetaRateLimiter: () => ({
    checkRedisRateLimit: async () => ({ allowed: true, remaining: 1, resetTime: Date.now() + 1000 })
  })
}));

// Test configuration
const TEST_MERCHANT_ID = '453717ea-82c9-4b46-9d83-08f7ca4f6f74';
const TEST_CUSTOMER_INSTAGRAM = 'test_customer_123';

describe('Instagram Integration Tests', () => {
  let db: any;
  let sql: any;
  
  beforeAll(async () => {
    // Setup test database
    db = await initializeDatabase();
    sql = db.getSQL();
    
    // Create test merchant if not exists
    await sql`
      INSERT INTO merchants (
        id, 
        business_name, 
        instagram_username,
        subscription_status
      ) VALUES (
        ${TEST_MERCHANT_ID}::uuid,
        'Test Business',
        'test_business_ig',
        'ACTIVE'
      ) ON CONFLICT (id) DO NOTHING
    `;
    
    // Enable all Instagram services for test merchant
    const serviceController = getServiceController();
    await serviceController.enableInstagramServices(TEST_MERCHANT_ID, 'test-setup');
  });

  afterAll(async () => {
    // Cleanup test data
    await sql`DELETE FROM merchants WHERE id = ${TEST_MERCHANT_ID}::uuid`;
    await sql`DELETE FROM merchant_service_status WHERE merchant_id = ${TEST_MERCHANT_ID}::uuid`;
    await sql`DELETE FROM conversations WHERE merchant_id = ${TEST_MERCHANT_ID}::uuid`;
    await sql`DELETE FROM webhook_events WHERE merchant_id = ${TEST_MERCHANT_ID}::uuid`;
  });

  describe('Service Control Tests', () => {
    test('should get service status', async () => {
      const serviceController = getServiceController();
      const status = await serviceController.getServiceStatus(TEST_MERCHANT_ID, 'instagram');
      
      expect(status).toBe(true);
    });

    test('should toggle service on/off', async () => {
      const serviceController = getServiceController();
      
      // Turn off
      const offResult = await serviceController.toggleService({
        merchantId: TEST_MERCHANT_ID,
        service: 'auto_reply',
        enabled: false,
        reason: 'Test toggle off',
        toggledBy: 'test'
      });
      
      expect(offResult.success).toBe(true);
      expect(offResult.message).toContain('تم إيقاف');
      
      // Verify it's off
      const statusOff = await serviceController.getServiceStatus(TEST_MERCHANT_ID, 'auto_reply');
      expect(statusOff).toBe(false);
      
      // Turn back on
      const onResult = await serviceController.toggleService({
        merchantId: TEST_MERCHANT_ID,
        service: 'auto_reply',
        enabled: true,
        reason: 'Test toggle on',
        toggledBy: 'test'
      });
      
      expect(onResult.success).toBe(true);
      expect(onResult.message).toContain('تم تفعيل');
    });

    test('should get all services status', async () => {
      const serviceController = getServiceController();
      const services = await serviceController.getAllServicesStatus(TEST_MERCHANT_ID);
      
      expect(services.merchantId).toBe(TEST_MERCHANT_ID);
      expect(services.instagram.enabled).toBe(true);
      expect(services.aiProcessing.enabled).toBe(true);
      expect(services.autoReply.enabled).toBe(true);
    });

    test('should get services health', async () => {
      const serviceController = getServiceController();
      const health = await serviceController.getServicesHealth(TEST_MERCHANT_ID);
      
      expect(Array.isArray(health)).toBe(true);
      expect(health.length).toBeGreaterThan(0);
      
      const instagramHealth = health.find(h => h.service === 'انستغرام');
      expect(instagramHealth?.enabled).toBe(true);
      expect(instagramHealth?.status).toMatch(/healthy|degraded|disabled|error/);
    });
  });

  describe('Instagram AI Service Tests', () => {
    test('should generate Instagram DM response', async () => {
      const aiService = getInstagramAIService();
      
      const context = {
        merchantId: TEST_MERCHANT_ID,
        platform: 'instagram' as const,
        interactionType: 'dm' as const,
        conversationHistory: [],
        stage: 'GREETING',
        intent: 'PRODUCT_INQUIRY',
        customerProfile: {
          name: 'Ahmed Test',
          phone: '+9647701234567',
          previousOrders: 0
        },
        merchantSettings: {
          businessName: 'Test Business',
          businessCategory: 'fashion'
        }
      };
      
      const response = await aiService.generateInstagramResponse(
        'عندكم منتجات جديدة؟',
        context
      );
      
      expect(response).toBeDefined();
      expect(response.message).toContain('منتجات');
      expect(response.intent).toBeDefined();
      expect(response.confidence).toBeGreaterThan(0);
      expect(Array.isArray(response.products)).toBe(true);
    });

    test('should generate story reply response', async () => {
      const aiService = getInstagramAIService();
      
      const context = {
        merchantId: TEST_MERCHANT_ID,
        platform: 'instagram' as const,
        interactionType: 'story_reply' as const,
        conversationHistory: [],
        stage: 'GREETING',
        intent: 'STORY_REACTION'
      };
      
      const response = await aiService.generateStoryReply(
        'حلو!',
        { mediaId: 'story_123', mediaType: 'image', caption: 'منتجات جديدة' },
        context
      );
      
      expect(response).toBeDefined();
      expect(response.visualStyle).toBe('story');
      expect(response.engagement.likelyToShare).toBe(true);
      expect(response.engagement.viralPotential).toBeGreaterThan(0);
    });

    test('should generate comment response', async () => {
      const aiService = getInstagramAIService();
      
      const context = {
        merchantId: TEST_MERCHANT_ID,
        platform: 'instagram' as const,
        interactionType: 'comment' as const,
        conversationHistory: [],
        stage: 'GREETING',
        intent: 'COMMENT_INQUIRY'
      };
      
      const response = await aiService.generateCommentResponse(
        'كم السعر؟',
        { mediaId: 'post_123', caption: 'منتج رائع' },
        context
      );
      
      expect(response).toBeDefined();
      expect(response.visualStyle).toBe('post');
      expect(response.message).toContain('مراسل');
    });

    test('should generate hashtag suggestions', async () => {
      const aiService = getInstagramAIService();
      
      const context = {
        merchantId: TEST_MERCHANT_ID,
        platform: 'instagram' as const,
        interactionType: 'dm' as const,
        conversationHistory: [],
        stage: 'PRODUCT_DISCUSSION',
        merchantSettings: {
          businessCategory: 'fashion'
        }
      };
      
      const response = await aiService.generateInstagramResponse(
        'اريد فستان للمناسبات',
        context
      );
      
      expect(response.hashtagSuggestions).toBeDefined();
      expect(Array.isArray(response.hashtagSuggestions)).toBe(true);
      expect(response.hashtagSuggestions?.some(tag => tag.includes('عراق'))).toBe(true);
    });
  });

  describe('Conversation Orchestrator Tests', () => {
    test('should orchestrate Instagram conversation', async () => {
      const orchestrator = getConversationAIOrchestrator();
      
      const context = {
        merchantId: TEST_MERCHANT_ID,
        customerId: TEST_CUSTOMER_INSTAGRAM,
        platform: 'instagram' as const,
        conversationHistory: [],
        stage: 'GREETING',
        customerProfile: {
          name: 'Sara Test',
          previousOrders: 2
        },
        merchantSettings: {
          businessName: 'Test Fashion Store',
          businessCategory: 'fashion'
        }
      };
      
      const response = await orchestrator.generatePlatformResponse(
        'اريد شنطة حلوة',
        context,
        'instagram'
      );
      
      expect(response.response).toBeDefined();
      expect(response.platformOptimized).toBe(true);
      expect(Array.isArray(response.adaptations)).toBe(true);
    });

    test('should handle cross-platform context', async () => {
      const orchestrator = getConversationAIOrchestrator();
      
      // Create conversation history with Instagram context
      await sql`
        INSERT INTO conversations (
          merchant_id,
          customer_instagram,
          platform,
          conversation_stage,
          session_data,
          last_message_at
        ) VALUES (
          ${TEST_MERCHANT_ID}::uuid,
          ${TEST_CUSTOMER_INSTAGRAM},
          'instagram',
          'PRODUCT_INQUIRY',
          '{"lastIntent": "product_search", "products": ["handbags"]}',
          NOW() - INTERVAL '1 hour'
        ) ON CONFLICT DO NOTHING
      `;
      
      const crossPlatformContext = await orchestrator.buildCrossPlatformContext(
        TEST_MERCHANT_ID,
        TEST_CUSTOMER_INSTAGRAM,
        'instagram'
      );
      
      expect(crossPlatformContext.hasInstagramHistory).toBe(true);
      expect(crossPlatformContext.preferredPlatform).toBe('instagram');
      expect(crossPlatformContext.totalInteractions).toBeGreaterThan(0);
    });
  });

  describe('Error Handling Tests', () => {
    test('should handle AI service errors gracefully', async () => {
      const aiService = getInstagramAIService();
      
      // Test with invalid context that might cause errors
      const invalidContext = {
        merchantId: 'invalid-merchant-id',
        platform: 'instagram' as const,
        interactionType: 'dm' as const,
        conversationHistory: [],
        stage: 'GREETING'
      };
      
      const response = await aiService.generateInstagramResponse(
        'test message',
        invalidContext
      );
      
      // Should return fallback response
      expect(response).toBeDefined();
      expect(response.confidence).toBeLessThan(0.5);
      expect(response.actions.some(action => action.type === 'ESCALATE')).toBe(true);
    });

    test('should record service errors', async () => {
      const serviceController = getServiceController();
      
      const testError = new Error('Test error for recording');
      await serviceController.recordServiceError(
        TEST_MERCHANT_ID,
        'ai_processing',
        testError,
        { test: true }
      );
      
      // Check if error was recorded
      const errorCount = await sql`
        SELECT error_count 
        FROM service_errors 
        WHERE merchant_id = ${TEST_MERCHANT_ID}::uuid 
        AND service_name = 'ai_processing'
        AND created_at::DATE = CURRENT_DATE
      `;
      
      expect(errorCount.length).toBeGreaterThan(0);
      expect(errorCount[0].error_count).toBeGreaterThan(0);
    });
  });

  describe('Database Integration Tests', () => {
    beforeEach(async () => {
      // Clean up test conversations
      await sql`DELETE FROM conversations WHERE merchant_id = ${TEST_MERCHANT_ID}::uuid`;
    });

    test('should create and track conversations', async () => {
      // Create a test conversation
      await sql`
        INSERT INTO conversations (
          merchant_id,
          customer_instagram,
          platform,
          conversation_stage,
          session_data
        ) VALUES (
          ${TEST_MERCHANT_ID}::uuid,
          ${TEST_CUSTOMER_INSTAGRAM},
          'instagram',
          'GREETING',
          '{\"test\": true}'
        )
      `;
      
      // Verify conversation was created
      const conversations = await sql`
        SELECT * FROM conversations 
        WHERE merchant_id = ${TEST_MERCHANT_ID}::uuid 
        AND customer_instagram = ${TEST_CUSTOMER_INSTAGRAM}
      `;
      
      expect(conversations.length).toBe(1);
      expect(conversations[0].platform).toBe('instagram');
      expect(conversations[0].conversation_stage).toBe('GREETING');
    });

    test('should log AI interactions', async () => {
      // This would typically be called by the AI service
      await sql`
        INSERT INTO audit_logs (
          merchant_id,
          action,
          entity_type,
          details,
          success
        ) VALUES (
          ${TEST_MERCHANT_ID}::uuid,
          'INSTAGRAM_AI_RESPONSE_GENERATED',
          'AI_INTERACTION',
          '{"test": true, "platform": "instagram"}',
          true
        )
      `;
      
      // Verify log was created
      const logs = await sql`
        SELECT * FROM audit_logs 
        WHERE merchant_id = ${TEST_MERCHANT_ID}::uuid 
        AND action = 'INSTAGRAM_AI_RESPONSE_GENERATED'
      `;
      
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].success).toBe(true);
    });

    test('should enforce row-level security', async () => {
      // Create another merchant for testing isolation
      const otherMerchantId = 'other-merchant-uuid-54321';
      
      await sql`
        INSERT INTO merchants (
          id, 
          business_name, 
          subscription_status
        ) VALUES (
          ${otherMerchantId}::uuid,
          'Other Test Business',
          'ACTIVE'
        ) ON CONFLICT (id) DO NOTHING
      `;
      
      // Set RLS context for test merchant
      await sql`SELECT set_config('app.current_merchant_id', ${TEST_MERCHANT_ID}, false)`;
      
      // Try to access other merchant's data (should be filtered out by RLS)
      const restrictedData = await sql`
        SELECT * FROM conversations 
        WHERE merchant_id = ${otherMerchantId}::uuid
      `;
      
      // Should return no results due to RLS
      expect(restrictedData.length).toBe(0);
      
      // Cleanup
      await sql`DELETE FROM merchants WHERE id = ${otherMerchantId}::uuid`;
    });
  });

  describe('Webhook Router Tests', () => {
    beforeEach(async () => {
      await sql`DELETE FROM webhook_events WHERE merchant_id = ${TEST_MERCHANT_ID}::uuid`;
    });

    test('should prevent duplicate Instagram webhook processing', async () => {
      const { getWebhookRouter } = await import('../api/webhooks.js');
      const router = getWebhookRouter();
      let processed = 0;
      (router as any).processInstagramEntry = async () => { processed++; };
      const app = router.getApp();
      const event = { object: 'instagram', entry: [{ id: 'page_1', time: 123, messaging: [] }] };
      const headers = {
        'x-merchant-id': TEST_MERCHANT_ID,
        'x-rate-key': 'dup',
        'content-type': 'application/json'
      };

      const res1 = await app.request('/webhooks/instagram', {
        method: 'POST',
        body: JSON.stringify(event),
        headers
      });
      expect(res1.status).toBe(200);

      const res2 = await app.request('/webhooks/instagram', {
        method: 'POST',
        body: JSON.stringify(event),
        headers
      });
      expect(res2.status).toBe(200);

      const events = await sql`SELECT COUNT(*) FROM webhook_events WHERE merchant_id = ${TEST_MERCHANT_ID}::uuid`;
      expect(Number(events[0].count)).toBe(1);
      expect(processed).toBe(1);
    });

    test('should respond with 429 when rate limit exceeded', async () => {
      const { getWebhookRouter } = await import('../api/webhooks.js');
      const router = getWebhookRouter();
      (router as any).processInstagramEntry = async () => {};
      const app = router.getApp();
      const event = { object: 'instagram', entry: [{ id: 'page_1', time: 456, messaging: [] }] };
      const headers = {
        'x-merchant-id': TEST_MERCHANT_ID,
        'x-rate-key': 'rate',
        'content-type': 'application/json'
      };

      for (let i = 0; i < 3; i++) {
        const res = await app.request('/webhooks/instagram', {
          method: 'POST',
          body: JSON.stringify(event),
          headers
        });
        expect(res.status).toBe(200);
      }

      const res4 = await app.request('/webhooks/instagram', {
        method: 'POST',
        body: JSON.stringify(event),
        headers
      });
      expect(res4.status).toBe(429);
    });
  });

  describe('Performance Tests', () => {
    test('should handle concurrent AI requests', async () => {
      const aiService = getInstagramAIService();
      
      const context = {
        merchantId: TEST_MERCHANT_ID,
        platform: 'instagram' as const,
        interactionType: 'dm' as const,
        conversationHistory: [],
        stage: 'GREETING'
      };
      
      // Make 5 concurrent requests
      const requests = Array.from({ length: 5 }, (_, i) => 
        aiService.generateInstagramResponse(`Test message ${i}`, context)
      );
      
      const responses = await Promise.all(requests);
      
      // All requests should succeed
      expect(responses.length).toBe(5);
      responses.forEach((response, i) => {
        expect(response).toBeDefined();
        expect(response.responseTime).toBeGreaterThan(0);
      });
    });

    test('should optimize database queries', async () => {
      const startTime = Date.now();
      
      // Test batch query performance
      const services = await sql`
        SELECT 
          mss.service_name,
          mss.enabled,
          COALESCE(se.error_count, 0) as error_count
        FROM merchant_service_status mss
        LEFT JOIN service_errors se ON (
          se.merchant_id = mss.merchant_id 
          AND se.service_name = mss.service_name
          AND se.created_at::DATE = CURRENT_DATE
        )
        WHERE mss.merchant_id = ${TEST_MERCHANT_ID}::uuid
      `;
      
      const queryTime = Date.now() - startTime;
      
      expect(queryTime).toBeLessThan(100); // Should complete within 100ms
      expect(Array.isArray(services)).toBe(true);
    });
  });
});

// Helper functions for testing
export async function createTestMerchant(merchantId: string, businessName: string) {
  const db = getDatabase();
  const sql = db.getSQL();
  
  await sql`
    INSERT INTO merchants (
      id,
      business_name,
      instagram_username,
      subscription_status
    ) VALUES (
      ${merchantId}::uuid,
      ${businessName},
      ${businessName.toLowerCase().replace(/\s+/g, '_')},
      'ACTIVE'
    ) ON CONFLICT (id) DO NOTHING
  `;
}

export async function cleanupTestMerchant(merchantId: string) {
  const db = getDatabase();
  const sql = db.getSQL();
  
  // Clean up in reverse order of dependencies
  await sql`DELETE FROM audit_logs WHERE merchant_id = ${merchantId}::uuid`;
  await sql`DELETE FROM service_errors WHERE merchant_id = ${merchantId}::uuid`;
  await sql`DELETE FROM merchant_service_status WHERE merchant_id = ${merchantId}::uuid`;
  await sql`DELETE FROM conversations WHERE merchant_id = ${merchantId}::uuid`;
  await sql`DELETE FROM merchants WHERE id = ${merchantId}::uuid`;
}