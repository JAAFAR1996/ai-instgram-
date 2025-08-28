/**
 * ===============================================
 * ManyChat API Service Tests
 * ===============================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ManyChatService, ManyChatAPIError } from '../manychat-api.js';
import { CircuitBreaker } from '../CircuitBreaker.js';

// Mock dependencies
vi.mock('../logger.js', () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  })
}));

// Mock environment variables
process.env.MANYCHAT_API_KEY = 'test_api_key';
process.env.MANYCHAT_BASE_URL = 'https://api.manychat.com';
process.env.MANYCHAT_DEFAULT_FLOW_ID = 'test_flow_id';

vi.mock('../config/env.js', () => ({
  getEnv: vi.fn((name: string) => {
    const envVars: Record<string, string> = {
      MANYCHAT_API_KEY: 'test_api_key',
      MANYCHAT_BASE_URL: 'https://api.manychat.com',
      MANYCHAT_DEFAULT_FLOW_ID: 'test_flow_id'
    };
    return envVars[name] || '';
  })
}));

vi.mock('../CircuitBreaker.js', () => ({
  CircuitBreaker: vi.fn().mockImplementation(() => ({
    execute: vi.fn(async (fn) => {
      try {
        const result = await fn();
        return {
          success: true,
          result,
          fallbackUsed: false,
          state: 'CLOSED' as const,
          executionTime: 100
        };
      } catch (error) {
        return {
          success: false,
          fallbackUsed: false,
          state: 'CLOSED' as const,
          executionTime: 100,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }),
    getStats: vi.fn(() => ({
      state: 'CLOSED' as const,
      failureCount: 0,
      successCount: 0,
      totalExecutions: 0,
      averageExecutionTime: 0,
      errorRate: 0,
      uptimePercentage: 100,
      circuitOpenCount: 0,
      lastStateChange: new Date()
    })),
    on: vi.fn(),
    off: vi.fn()
  }))
}));

vi.mock('../../utils/expiring-map.js', () => ({
  ExpiringMap: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    dispose: vi.fn()
  }))
}));

// Mock fetch
global.fetch = vi.fn();

describe('ManyChatService', () => {
  let manyChatService: ManyChatService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock CircuitBreaker before creating the service
    const mockCircuitBreaker = {
      execute: vi.fn(async (fn) => {
        try {
          const result = await fn();
          return {
            success: true,
            result,
            fallbackUsed: false,
            state: 'CLOSED' as const,
            executionTime: 100
          };
        } catch (error) {
          return {
            success: false,
            fallbackUsed: false,
            state: 'CLOSED' as const,
            executionTime: 100,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      }),
      getStats: vi.fn(() => ({
        state: 'CLOSED' as const,
        failureCount: 0,
        successCount: 0,
        totalExecutions: 0,
        averageExecutionTime: 0,
        errorRate: 0,
        uptimePercentage: 100,
        circuitOpenCount: 0,
        lastStateChange: new Date()
      })),
      on: vi.fn(),
      off: vi.fn()
    };

    vi.mocked(CircuitBreaker).mockImplementation(() => mockCircuitBreaker as any);
    manyChatService = new ManyChatService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('sendMessage', () => {
    it('should send message successfully', async () => {
      const mockResponse = {
        status: 'success',
        message_id: 'test_message_id'
      };

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await manyChatService.sendMessage(
        'merchant_123',
        'subscriber_456',
        'Hello from test!'
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('test_message_id');
      expect(result.platform).toBe('instagram');
      expect(fetch).toHaveBeenCalledWith(
        'https://api.manychat.com/fb/sending/sendContent',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test_api_key',
            'Content-Type': 'application/json'
          }),
          body: expect.stringContaining('Hello from test!')
        })
      );
    });

    it('should handle API errors', async () => {
      const mockResponse = {
        status: 'error',
        error: 'Invalid subscriber ID'
      };

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await manyChatService.sendMessage(
        'merchant_123',
        'invalid_subscriber',
        'Test message'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid subscriber ID');
    });

    it('should handle network errors', async () => {
      (fetch as any).mockRejectedValueOnce(new Error('Network error'));

      const result = await manyChatService.sendMessage(
        'merchant_123',
        'subscriber_456',
        'Test message'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });
  });

  describe('getSubscriberInfo', () => {
    it('should get subscriber info successfully', async () => {
      const mockResponse = {
        status: 'success',
        data: {
          id: 'subscriber_123',
          first_name: 'John',
          last_name: 'Doe',
          language: 'ar',
          timezone: 'Asia/Baghdad',
          tags: ['vip', 'active'],
          custom_fields: {
            instagram_id: 'ig_123'
          }
        }
      };

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const subscriber = await manyChatService.getSubscriberInfo(
        'merchant_123',
        'subscriber_123'
      );

      expect(subscriber.id).toBe('subscriber_123');
      expect(subscriber.firstName).toBe('John');
      expect(subscriber.lastName).toBe('Doe');
      expect(subscriber.language).toBe('ar');
      expect(subscriber.timezone).toBe('Asia/Baghdad');
      expect(subscriber.tags).toEqual(['vip', 'active']);
      expect(subscriber.customFields).toEqual({
        instagram_id: 'ig_123'
      });
    });

    it('should throw error for invalid subscriber', async () => {
      const mockResponse = {
        status: 'error',
        error: 'Subscriber not found'
      };

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      await expect(
        manyChatService.getSubscriberInfo('merchant_123', 'invalid_id')
      ).rejects.toThrow('Failed to get subscriber info');
    });
  });

  describe('updateSubscriber', () => {
    it('should update subscriber successfully', async () => {
      const mockResponse = {
        status: 'success'
      };

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await manyChatService.updateSubscriber(
        'merchant_123',
        'subscriber_123',
        {
          first_name: 'Jane',
          last_name: 'Smith',
          language: 'en'
        }
      );

      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.manychat.com/fb/subscriber/updateInfo',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Jane')
        })
      );
    });

    it('should return false on update failure', async () => {
      const mockResponse = {
        status: 'error',
        error: 'Update failed'
      };

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await manyChatService.updateSubscriber(
        'merchant_123',
        'subscriber_123',
        { first_name: 'Jane' }
      );

      expect(result).toBe(false);
    });
  });

  describe('addTags', () => {
    it('should add tags successfully', async () => {
      const mockResponse = {
        status: 'success'
      };

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await manyChatService.addTags(
        'merchant_123',
        'subscriber_123',
        ['vip', 'premium']
      );

      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.manychat.com/fb/subscriber/addTag',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('vip,premium')
        })
      );
    });
  });

  describe('removeTags', () => {
    it('should remove tags successfully', async () => {
      const mockResponse = {
        status: 'success'
      };

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const result = await manyChatService.removeTags(
        'merchant_123',
        'subscriber_123',
        ['old_tag']
      );

      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.manychat.com/fb/subscriber/removeTag',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('old_tag')
        })
      );
    });
  });

  describe('createSubscriber', () => {
    it('should create subscriber successfully', async () => {
      const mockResponse = {
        status: 'success',
        data: {
          id: 'new_subscriber_123',
          first_name: 'New',
          last_name: 'User',
          language: 'ar',
          timezone: 'Asia/Baghdad',
          tags: [],
          custom_fields: {}
        }
      };

      (fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      const subscriber = await manyChatService.createSubscriber(
        'merchant_123',
        {
          phone: '+1234567890',
          first_name: 'New',
          last_name: 'User',
          language: 'ar',
          timezone: 'Asia/Baghdad'
        }
      );

      expect(subscriber.id).toBe('new_subscriber_123');
      expect(subscriber.firstName).toBe('New');
      expect(subscriber.lastName).toBe('User');
    });
  });

  describe('getHealthStatus', () => {
    it('should return health status', async () => {
      const health = await manyChatService.getHealthStatus();

      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('circuitBreaker');
      expect(health).toHaveProperty('rateLimit');
      expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
    });
  });

  describe('rate limiting', () => {
    it('should respect rate limits', async () => {
      const mockResponse = {
        status: 'success',
        message_id: 'test_message_id'
      };

      (fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockResponse
      });

      // Send multiple messages quickly
      const promises = Array.from({ length: 15 }, (_, i) =>
        manyChatService.sendMessage(
          'merchant_123',
          'subscriber_456',
          `Message ${i}`
        )
      );

      const results = await Promise.all(promises);

      // All should succeed (rate limiting should handle this)
      expect(results.every(r => r.success)).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle HTTP errors', async () => {
      (fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ error: 'Rate limit exceeded' })
      });

      const result = await manyChatService.sendMessage(
        'merchant_123',
        'subscriber_456',
        'Test message'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('HTTP 429');
    });

    it('should handle ManyChatAPIError', () => {
      const error = new ManyChatAPIError(
        'Test error',
        400
      );

      expect(error.message).toBe('Test error');
      expect(error.status).toBe(400);
      expect(error.name).toBe('ManyChatAPIError');
    });
  });
});
