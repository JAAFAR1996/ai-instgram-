/**
 * ===============================================
 * Instagram API Service Tests
 * اختبارات شاملة لخدمة Instagram API
 * ===============================================
 */

import { describe, test, expect, beforeEach, afterEach, jest } from 'bun:test';

import {
  InstagramAPIClient,
  getInstagramClient,
  type InstagramOAuthConfig,
  type InstagramMessage,
  type InstagramProfile
} from './instagram-api.js';

// Mock dependencies
jest.mock('./encryption.js', () => ({
  getEncryptionService: jest.fn(() => ({
    encrypt: jest.fn((data) => `encrypted_${data}`),
    decrypt: jest.fn((data) => data.replace('encrypted_', ''))
  }))
}));

jest.mock('../database/connection.js', () => ({
  getDatabase: jest.fn(() => ({
    getSQL: jest.fn(() => jest.fn())
  }))
}));

jest.mock('./telemetry.js', () => ({
  telemetry: {
    trackEvent: jest.fn(),
    recordMetric: jest.fn()
  }
}));

jest.mock('./meta-rate-limiter.js', () => ({
  getMetaRateLimiter: jest.fn(() => ({
    checkRateLimit: jest.fn(() => ({ allowed: true, remaining: 100 })),
    recordAPICall: jest.fn()
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

jest.mock('../config/graph-api.js', () => ({
  GRAPH_API_BASE_URL: 'https://graph.facebook.com/v18.0'
}));

// Mock fetch globally
global.fetch = jest.fn();

describe('📱 Instagram API Service Tests', () => {
  let instagramClient: InstagramAPIClient;
  let mockSQL: jest.Mock;
  let mockLogger: any;
  let mockFetch: jest.Mock;

  const sampleCredentials = {
    page_id: 'page-123',
    access_token: 'token-abc123',
    business_account_id: 'business-456',
    scopes: ['instagram_basic', 'instagram_manage_messages']
  };

  const sampleMerchantId = 'merchant-123';

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock database
    mockSQL = jest.fn();
    const { getDatabase } = require('../database/connection.js');
    getDatabase.mockReturnValue({
      getSQL: () => mockSQL
    });

    // Mock logger
    const { getLogger } = require('./logger.js');
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    };
    getLogger.mockReturnValue(mockLogger);

    // Mock fetch
    mockFetch = global.fetch as jest.Mock;

    instagramClient = new InstagramAPIClient();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Credential Management', () => {
    test('✅ should load merchant credentials successfully', async () => {
      const encryptedCredentials = {
        page_id: 'page-123',
        access_token: 'encrypted_token-abc123',
        business_account_id: 'business-456',
        scopes: JSON.stringify(['instagram_basic'])
      };

      mockSQL.mockResolvedValue([encryptedCredentials]);

      const credentials = await instagramClient.loadMerchantCredentials(sampleMerchantId);

      expect(credentials).toEqual({
        page_id: 'page-123',
        access_token: 'token-abc123', // Decrypted
        business_account_id: 'business-456',
        scopes: ['instagram_basic']
      });

      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([sampleMerchantId])
      );
    });

    test('❌ should return null when credentials not found', async () => {
      mockSQL.mockResolvedValue([]);

      const credentials = await instagramClient.loadMerchantCredentials(sampleMerchantId);

      expect(credentials).toBeNull();
    });

    test('❌ should handle database errors', async () => {
      mockSQL.mockRejectedValue(new Error('Database connection failed'));

      const credentials = await instagramClient.loadMerchantCredentials(sampleMerchantId);

      expect(credentials).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to load Instagram credentials',
        expect.any(Error),
        expect.objectContaining({ merchantId: sampleMerchantId })
      );
    });

    test('✅ should save credentials successfully', async () => {
      mockSQL.mockResolvedValue([]);

      await instagramClient.saveMerchantCredentials(sampleMerchantId, sampleCredentials);

      expect(mockSQL).toHaveBeenCalledWith(
        expect.arrayContaining([
          sampleMerchantId,
          'page-123',
          'encrypted_token-abc123', // Encrypted
          'business-456',
          JSON.stringify(['instagram_basic', 'instagram_manage_messages'])
        ])
      );
    });

    test('✅ should update existing credentials', async () => {
      // Mock existing credentials
      mockSQL.mockResolvedValueOnce([{ id: 'existing-id' }]);
      // Mock update
      mockSQL.mockResolvedValueOnce([]);

      await instagramClient.saveMerchantCredentials(sampleMerchantId, sampleCredentials);

      // Should call update instead of insert
      expect(mockSQL).toHaveBeenCalledTimes(2);
    });
  });

  describe('Credential Validation', () => {
    test('✅ should validate credentials successfully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 'page-123',
          name: 'Test Page',
          access_token: 'token-abc123'
        })
      });

      const isValid = await instagramClient.validateCredentials(
        sampleCredentials,
        sampleMerchantId
      );

      expect(isValid).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://graph.facebook.com/v18.0/page-123'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer token-abc123'
          })
        })
      );
    });

    test('❌ should handle invalid credentials', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({
          error: {
            code: 190,
            message: 'Invalid OAuth access token'
          }
        })
      });

      const isValid = await instagramClient.validateCredentials(
        sampleCredentials,
        sampleMerchantId
      );

      expect(isValid).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Instagram credentials validation failed',
        expect.any(Object),
        expect.objectContaining({ merchantId: sampleMerchantId })
      );
    });

    test('❌ should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const isValid = await instagramClient.validateCredentials(
        sampleCredentials,
        sampleMerchantId
      );

      expect(isValid).toBe(false);
    });
  });

  describe('Message Sending', () => {
    const sendMessageRequest = {
      recipientId: 'user-789',
      messageType: 'text' as const,
      content: 'Hello from our store!'
    };

    test('✅ should send text message successfully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          message_id: 'msg-123'
        })
      });

      const response = await instagramClient.sendMessage(
        sampleCredentials,
        sampleMerchantId,
        sendMessageRequest
      );

      expect(response.success).toBe(true);
      expect(response.messageId).toBe('msg-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('messages'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer token-abc123',
            'Content-Type': 'application/json'
          }),
          body: expect.stringContaining('"recipient":{"id":"user-789"}')
        })
      );
    });

    test('✅ should send image message', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message_id: 'msg-456' })
      });

      const imageRequest = {
        recipientId: 'user-789',
        messageType: 'image' as const,
        content: 'https://example.com/image.jpg'
      };

      const response = await instagramClient.sendMessage(
        sampleCredentials,
        sampleMerchantId,
        imageRequest
      );

      expect(response.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          body: expect.stringContaining('"attachment"')
        })
      );
    });

    test('❌ should handle API errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: {
            code: 100,
            message: 'Invalid parameter',
            type: 'OAuthException'
          }
        })
      });

      const response = await instagramClient.sendMessage(
        sampleCredentials,
        sampleMerchantId,
        sendMessageRequest
      );

      expect(response.success).toBe(false);
      expect(response.error).toEqual({
        code: 100,
        message: 'Invalid parameter',
        type: 'OAuthException'
      });
    });

    test('❌ should handle rate limiting', async () => {
      const { getMetaRateLimiter } = require('./meta-rate-limiter.js');
      const mockRateLimiter = getMetaRateLimiter();
      mockRateLimiter.checkRateLimit.mockReturnValue({
        allowed: false,
        remaining: 0,
        resetTime: Date.now() + 3600000
      });

      const response = await instagramClient.sendMessage(
        sampleCredentials,
        sampleMerchantId,
        sendMessageRequest
      );

      expect(response.success).toBe(false);
      expect(response.error?.message).toContain('rate limit');
    });

    test('❌ should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network timeout'));

      const response = await instagramClient.sendMessage(
        sampleCredentials,
        sampleMerchantId,
        sendMessageRequest
      );

      expect(response.success).toBe(false);
      expect(response.error?.message).toContain('Network timeout');
    });
  });

  describe('Profile Information', () => {
    test('✅ should get user profile successfully', async () => {
      const mockProfile = {
        id: 'user-123',
        username: 'testuser',
        name: 'Test User',
        profile_picture_url: 'https://example.com/profile.jpg',
        followers_count: 1000
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockProfile)
      });

      const profile = await instagramClient.getUserProfile(
        sampleCredentials,
        'user-123'
      );

      expect(profile).toEqual(mockProfile);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('user-123'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer token-abc123'
          })
        })
      );
    });

    test('❌ should handle profile fetch errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({
          error: { message: 'User not found' }
        })
      });

      const profile = await instagramClient.getUserProfile(
        sampleCredentials,
        'nonexistent-user'
      );

      expect(profile).toBeNull();
    });
  });

  describe('Webhook Validation', () => {
    test('✅ should validate webhook signature correctly', () => {
      const payload = JSON.stringify({ test: 'webhook' });
      const secret = 'webhook-secret';
      
      // Create valid signature
      const crypto = require('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      const isValid = instagramClient.validateWebhookSignature(
        payload,
        `sha256=${expectedSignature}`,
        secret
      );

      expect(isValid).toBe(true);
    });

    test('❌ should reject invalid webhook signature', () => {
      const payload = JSON.stringify({ test: 'webhook' });
      const secret = 'webhook-secret';
      const invalidSignature = 'sha256=invalid-signature';

      const isValid = instagramClient.validateWebhookSignature(
        payload,
        invalidSignature,
        secret
      );

      expect(isValid).toBe(false);
    });

    test('❌ should handle malformed signature header', () => {
      const payload = JSON.stringify({ test: 'webhook' });
      const secret = 'webhook-secret';
      const malformedSignature = 'invalid-format';

      const isValid = instagramClient.validateWebhookSignature(
        payload,
        malformedSignature,
        secret
      );

      expect(isValid).toBe(false);
    });
  });

  describe('OAuth Flow', () => {
    const oauthConfig: InstagramOAuthConfig = {
      appId: 'app-123',
      appSecret: 'app-secret',
      redirectUri: 'https://example.com/callback',
      requiredScopes: ['instagram_basic', 'instagram_manage_messages']
    };

    test('✅ should generate OAuth URL correctly', () => {
      const url = instagramClient.getOAuthURL(oauthConfig, 'state-123');

      expect(url).toContain('https://api.instagram.com/oauth/authorize');
      expect(url).toContain('client_id=app-123');
      expect(url).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fcallback');
      expect(url).toContain('scope=instagram_basic%2Cinstagram_manage_messages');
      expect(url).toContain('state=state-123');
    });

    test('✅ should exchange code for access token', async () => {
      const mockTokenResponse = {
        access_token: 'long-lived-token',
        user_id: 'user-123'
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse)
      });

      const token = await instagramClient.exchangeCodeForToken(
        oauthConfig,
        'auth-code-123'
      );

      expect(token).toEqual(mockTokenResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('access_token'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('code=auth-code-123')
        })
      );
    });

    test('❌ should handle OAuth errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({
          error: 'invalid_grant',
          error_description: 'The provided authorization grant is invalid'
        })
      });

      const token = await instagramClient.exchangeCodeForToken(
        oauthConfig,
        'invalid-code'
      );

      expect(token).toBeNull();
    });
  });

  describe('Media Handling', () => {
    test('✅ should get media information', async () => {
      const mockMedia = {
        id: 'media-123',
        media_type: 'IMAGE',
        media_url: 'https://example.com/image.jpg',
        caption: 'Test image',
        timestamp: '2024-01-01T10:00:00Z'
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockMedia)
      });

      const media = await instagramClient.getMedia(sampleCredentials, 'media-123');

      expect(media).toEqual(mockMedia);
    });

    test('✅ should get media comments', async () => {
      const mockComments = {
        data: [
          {
            id: 'comment-1',
            text: 'Great post!',
            timestamp: '2024-01-01T10:00:00Z',
            from: { id: 'user-1', username: 'user1' }
          }
        ]
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockComments)
      });

      const comments = await instagramClient.getMediaComments(
        sampleCredentials,
        'media-123'
      );

      expect(comments).toEqual(mockComments.data);
    });
  });

  describe('Error Handling', () => {
    test('✅ should track API errors in telemetry', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({
          error: { message: 'Internal server error' }
        })
      });

      const { telemetry } = require('./telemetry.js');

      await instagramClient.sendMessage(
        sampleCredentials,
        sampleMerchantId,
        {
          recipientId: 'user-789',
          messageType: 'text',
          content: 'Test'
        }
      );

      expect(telemetry.trackEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'instagram_api_error',
          properties: expect.objectContaining({
            statusCode: 500
          })
        })
      );
    });

    test('✅ should handle malformed JSON responses', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON'))
      });

      const profile = await instagramClient.getUserProfile(
        sampleCredentials,
        'user-123'
      );

      expect(profile).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse'),
        expect.any(Error)
      );
    });

    test('✅ should retry failed requests', async () => {
      // First call fails, second succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: { message: 'Server error' } })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 'user-123', username: 'test' })
        });

      const profile = await instagramClient.getUserProfile(
        sampleCredentials,
        'user-123'
      );

      expect(profile).toEqual({ id: 'user-123', username: 'test' });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Rate Limiting Integration', () => {
    test('✅ should respect rate limits', async () => {
      const { getMetaRateLimiter } = require('./meta-rate-limiter.js');
      const mockRateLimiter = getMetaRateLimiter();

      mockRateLimiter.checkRateLimit.mockReturnValue({
        allowed: true,
        remaining: 50
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ message_id: 'msg-123' })
      });

      const response = await instagramClient.sendMessage(
        sampleCredentials,
        sampleMerchantId,
        {
          recipientId: 'user-789',
          messageType: 'text',
          content: 'Test'
        }
      );

      expect(response.success).toBe(true);
      expect(mockRateLimiter.checkRateLimit).toHaveBeenCalled();
      expect(mockRateLimiter.recordAPICall).toHaveBeenCalled();
    });

    test('❌ should handle rate limit exceeded', async () => {
      const { getMetaRateLimiter } = require('./meta-rate-limiter.js');
      const mockRateLimiter = getMetaRateLimiter();

      mockRateLimiter.checkRateLimit.mockReturnValue({
        allowed: false,
        remaining: 0,
        resetTime: Date.now() + 3600000
      });

      const response = await instagramClient.sendMessage(
        sampleCredentials,
        sampleMerchantId,
        {
          recipientId: 'user-789',
          messageType: 'text',
          content: 'Test'
        }
      );

      expect(response.success).toBe(false);
      expect(response.error?.message).toContain('rate limit');
    });
  });

  describe('Singleton Pattern', () => {
    test('✅ should return same instance', () => {
      const instance1 = getInstagramClient('merchant-1');
      const instance2 = getInstagramClient('merchant-1');

      expect(instance1).toBe(instance2);
    });

    test('✅ should create different instances for different merchants', () => {
      const instance1 = getInstagramClient('merchant-1');
      const instance2 = getInstagramClient('merchant-2');

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('Security', () => {
    test('✅ should encrypt sensitive data before storage', async () => {
      const { getEncryptionService } = require('./encryption.js');
      const mockEncryption = getEncryptionService();

      mockSQL.mockResolvedValue([]);

      await instagramClient.saveMerchantCredentials(sampleMerchantId, sampleCredentials);

      expect(mockEncryption.encrypt).toHaveBeenCalledWith('token-abc123');
    });

    test('✅ should sanitize logged data', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await instagramClient.sendMessage(
        sampleCredentials,
        sampleMerchantId,
        {
          recipientId: 'user-789',
          messageType: 'text',
          content: 'Test'
        }
      );

      // Verify that sensitive data is not logged
      const logCalls = mockLogger.error.mock.calls;
      logCalls.forEach(call => {
        const logData = JSON.stringify(call);
        expect(logData).not.toContain('token-abc123');
      });
    });
  });
});