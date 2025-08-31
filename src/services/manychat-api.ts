/**
 * ===============================================
 * ManyChat API Service
 * Handles all ManyChat API operations with rate limiting and error handling
 * ===============================================
 */

import { getLogger } from './logger.js';
import { getEnv } from '../config/env.js';
import { CircuitBreaker } from './CircuitBreaker.js';
import { ExpiringMap } from '../utils/expiring-map.js';

// Types
export interface ManyChatOptions {
  messageTag?: string;
  priority?: 'low' | 'normal' | 'high';
}

export interface ManyChatResponse {
  success: boolean;
  messageId?: string;
  error?: string;
  timestamp: Date;
  platform?: string;
}

export interface ManyChatSubscriber {
  id: string;
  firstName?: string;
  lastName?: string;
  language?: string;
  timezone?: string;
  tags: string[];
  customFields: Record<string, unknown>;
}

export interface ManyChatSubscriberUpdate {
  first_name?: string;
  last_name?: string;
  language?: string;
  timezone?: string;
  custom_fields?: Record<string, unknown>;
}

export interface ManyChatConfig {
  defaultFlowId?: string;
  welcomeFlowId?: string;
  apiKey?: string;
  webhookSecret?: string;
}

export interface ManyChatSendContentPayload {
  subscriber_id: string;
  content: Array<{
    type: 'text' | 'image' | 'video' | 'audio' | 'file';
    text?: string;
    url?: string;
    caption?: string;
  }>;
  message_tag?: string;
}

export interface ManyChatAPIErrorResponse {
  status: string;
  message?: string;
  error?: string;
  details?: {
    messages?: Array<{ message: string }>;
    [key: string]: unknown;
  };
}

export class ManyChatAPIError extends Error {
  constructor(
    message: string,
    public status: number,
    public apiError?: ManyChatAPIErrorResponse
  ) {
    // Create detailed error message
    let detailedMessage = message;
    if (apiError) {
      detailedMessage = `${message} | API Status: ${apiError.status}`;
      if (apiError.message) {
        detailedMessage += ` | API Message: ${apiError.message}`;
      }
      if (apiError.details?.messages && apiError.details.messages.length > 0) {
        const detailMessages = apiError.details.messages.map((m: any) => m.message).join(', ');
        detailedMessage += ` | Details: ${detailMessages}`;
      }
    }
    
    super(detailedMessage);
    this.name = 'ManyChatAPIError';
  }
}

export class ManyChatService {
  private apiKey: string;
  private baseUrl: string;
  private logger = getLogger({ component: 'ManyChatService' });
  private circuitBreaker: CircuitBreaker;
  private credentialsCache = new ExpiringMap<string, string>();
  private rateLimiter = new Map<string, { count: number; resetTime: number }>();

  // Rate limiting: 10 requests per second
  private readonly RATE_LIMIT_RPS = 10;
  private readonly RATE_LIMIT_WINDOW_MS = 1000;

  constructor() {
    this.apiKey = getEnv('MANYCHAT_API_KEY', { required: true }); // Make required
    this.baseUrl = getEnv('MANYCHAT_BASE_URL') || 'https://api.manychat.com';
    this.circuitBreaker = new CircuitBreaker(
      15, // failureThreshold: زيادة من 5 إلى 15 لتجنب فتح الدائرة بسرعة
      20000, // recoveryTimeout: تقليل من 30 ثانية إلى 20 ثانية
      {
        serviceName: 'ManyChatAPI',
        timeout: 15000, // زيادة timeout من 10 إلى 15 ثانية
        monitoringPeriod: 300000,
        expectedErrorThreshold: 80, // زيادة من 50% إلى 80%
        halfOpenMaxCalls: 8 // زيادة من 3 إلى 8 محاولات
      }
    );

    this.logger.info('✅ ManyChat Service initialized', {
      baseUrl: this.baseUrl,
      hasApiKey: !!this.apiKey,
      serviceName: 'ManyChatAPI'
    });
  }

  /**
   * Send message via ManyChat API
   */
  public async sendMessage(
    merchantId: string,
    subscriberId: string,
    message: string,
    options?: ManyChatOptions
  ): Promise<ManyChatResponse> {
    const result = await this.circuitBreaker.execute(async () => {
      try {
        this.logger.info('📤 Sending ManyChat message', {
          merchantId,
          subscriberId,
          messageLength: message.length
        });

        const payload: ManyChatSendContentPayload = {
          subscriber_id: subscriberId,
          content: [{
            type: 'text',
            text: message
          }],
          message_tag: options?.messageTag || 'CUSTOMER_FEEDBACK',
        };

        const response = await this.makeAPIRequest('/fb/sending/sendContent', {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        if (response.status === 'success') {
          this.logger.info('✅ ManyChat message sent successfully', {
            merchantId,
            subscriberId,
            messageId: response.message_id
          });

          return {
            success: true,
            messageId: response.message_id,
            timestamp: new Date(),
            platform: 'instagram'
          };
        } else {
          throw new ManyChatAPIError(
            `ManyChat API error: ${response.error}`,
            400,
            response
          );
        }

      } catch (error) {
        this.logger.error('❌ ManyChat message sending failed', {
          merchantId,
          subscriberId,
          error: error instanceof Error ? error.message : String(error),
          errorDetails: error instanceof ManyChatAPIError ? error.apiError : null,
          payload: {
            subscriber_id: subscriberId,
            content: [{ type: 'text', text: message }],
            message_tag: options?.messageTag || 'CUSTOMER_FEEDBACK'
          }
        });

        // Retry with exponential backoff
        return await this.retryMessage(merchantId, subscriberId, message, options);
      }
    });

    if (!result.success) {
      // Preserve original error if it's a ManyChatAPIError
      if (result.originalError && result.originalError instanceof ManyChatAPIError) {
        throw result.originalError;
      }
      throw new Error(result.error || 'Circuit breaker failed');
    }

    return result.result as ManyChatResponse;
  }

  /**
   * Get subscriber information from ManyChat
   */
  public async getSubscriberInfo(
    merchantId: string,
    subscriberId: string
  ): Promise<ManyChatSubscriber> {
    const result = await this.circuitBreaker.execute(async () => {
      try {
        const response = await this.makeAPIRequest(
          `/fb/subscriber/getInfo?subscriber_id=${subscriberId}`,
          { method: 'GET' }
        );

        if (response.status === 'success' && response.data) {
          return {
            id: response.data.id,
            firstName: response.data.first_name,
            lastName: response.data.last_name,
            language: response.data.language,
            timezone: response.data.timezone,
            tags: response.data.tags || [],
            customFields: response.data.custom_fields || {}
          };
        } else {
          throw new ManyChatAPIError(
            `Failed to get subscriber info: ${response.error}`,
            400,
            response
          );
        }

      } catch (error) {
        this.logger.error('Failed to get subscriber info', error, {
          merchantId,
          subscriberId
        });
        throw error;
      }
    });

    if (!result.success) {
      throw new Error(result.error || 'Circuit breaker failed');
    }

    return result.result as ManyChatSubscriber;
  }

  /**
   * Update subscriber information in ManyChat
   */
  public async updateSubscriber(
    merchantId: string,
    subscriberId: string,
    updates: ManyChatSubscriberUpdate
  ): Promise<boolean> {
    const result = await this.circuitBreaker.execute(async () => {
      try {
        const response = await this.makeAPIRequest('/fb/subscriber/updateInfo', {
          method: 'POST',
          body: JSON.stringify({
            subscriber_id: subscriberId,
            ...updates
          })
        });

        if (response.status === 'success') {
          this.logger.info('✅ Subscriber updated successfully', {
            merchantId,
            subscriberId
          });
          return true;
        } else {
          throw new ManyChatAPIError(
            `Failed to update subscriber: ${response.error}`,
            400,
            response
          );
        }

      } catch (error) {
        this.logger.error('Failed to update subscriber', error, {
          merchantId,
          subscriberId
        });
        return false;
      }
    });

    if (!result.success) {
      return false;
    }

    return result.result as boolean;
  }

  /**
   * Add tags to subscriber
   */
  public async addTags(
    merchantId: string,
    subscriberId: string,
    tags: string[]
  ): Promise<boolean> {
    const result = await this.circuitBreaker.execute(async () => {
      try {
        const response = await this.makeAPIRequest('/fb/subscriber/addTag', {
          method: 'POST',
          body: JSON.stringify({
            subscriber_id: subscriberId,
            tag_name: tags.join(',')
          })
        });

        if (response.status === 'success') {
          this.logger.info('✅ Tags added successfully', {
            merchantId,
            subscriberId,
            tags
          });
          return true;
        } else {
          throw new ManyChatAPIError(
            `Failed to add tags: ${response.error}`,
            400,
            response
          );
        }

      } catch (error) {
        this.logger.error('Failed to add tags', error, {
          merchantId,
          subscriberId,
          tags
        });
        return false;
      }
    });

    if (!result.success) {
      return false;
    }

    return result.result as boolean;
  }

  /**
   * Remove tags from subscriber
   */
  public async removeTags(
    merchantId: string,
    subscriberId: string,
    tags: string[]
  ): Promise<boolean> {
    const result = await this.circuitBreaker.execute(async () => {
      try {
        const response = await this.makeAPIRequest('/fb/subscriber/removeTag', {
          method: 'POST',
          body: JSON.stringify({
            subscriber_id: subscriberId,
            tag_name: tags.join(',')
          })
        });

        if (response.status === 'success') {
          this.logger.info('✅ Tags removed successfully', {
            merchantId,
            subscriberId,
            tags
          });
          return true;
        } else {
          throw new ManyChatAPIError(
            `Failed to remove tags: ${response.error}`,
            400,
            response
          );
        }

      } catch (error) {
        this.logger.error('Failed to remove tags', error, {
          merchantId,
          subscriberId,
          tags
        });
        return false;
      }
    });

    if (!result.success) {
      return false;
    }

    return result.result as boolean;
  }

  /**
   * Get subscriber by phone number
   */
  public async getSubscriberByPhone(
    merchantId: string,
    phoneNumber: string
  ): Promise<ManyChatSubscriber | null> {
    const result = await this.circuitBreaker.execute(async () => {
      try {
        const response = await this.makeAPIRequest(
          `/fb/subscriber/getByPhone?phone=${encodeURIComponent(phoneNumber)}`,
          { method: 'GET' }
        );

        if (response.status === 'success' && response.data) {
          return {
            id: response.data.id,
            firstName: response.data.first_name,
            lastName: response.data.last_name,
            language: response.data.language,
            timezone: response.data.timezone,
            tags: response.data.tags || [],
            customFields: response.data.custom_fields || {}
          };
        } else if (response.status === 'error' && response.error?.includes('not found')) {
          return null;
        } else {
          throw new ManyChatAPIError(
            `Failed to get subscriber by phone: ${response.error}`,
            400,
            response
          );
        }

      } catch (error) {
        this.logger.error('Failed to get subscriber by phone', error, {
          merchantId,
          phoneNumber
        });
        throw error;
      }
    });

    if (!result.success) {
      throw new Error(result.error || 'Circuit breaker failed');
    }

    return result.result as ManyChatSubscriber | null;
  }

  /**
   * Create new subscriber
   */
  public async createSubscriber(
    merchantId: string,
    subscriberData: {
      phone?: string;
      email?: string;
      first_name?: string;
      last_name?: string;
      language?: string;
      timezone?: string;
      custom_fields?: Record<string, unknown>;
      has_opt_in_sms?: boolean;
    }
  ): Promise<ManyChatSubscriber> {
    const result = await this.circuitBreaker.execute(async () => {
      try {
        // Validate has_opt_in_sms requirement if phone is provided
        const payload = { ...subscriberData };
        if (payload.phone && !payload.has_opt_in_sms) {
          payload.has_opt_in_sms = true; // Default to true for phone subscribers
        }

        const response = await this.makeAPIRequest('/fb/subscriber/createSubscriber', {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        if (response.status === 'success' && response.data) {
          this.logger.info('✅ Subscriber created successfully', {
            merchantId,
            subscriberId: response.data.id
          });

          return {
            id: response.data.id,
            firstName: response.data.first_name,
            lastName: response.data.last_name,
            language: response.data.language,
            timezone: response.data.timezone,
            tags: response.data.tags || [],
            customFields: response.data.custom_fields || {}
          };
        } else {
          throw new ManyChatAPIError(
            `Failed to create subscriber: ${response.error}`,
            400,
            response
          );
        }

      } catch (error) {
        this.logger.error('Failed to create subscriber', error, {
          merchantId,
          subscriberData
        });
        throw error;
      }
    });

    if (!result.success) {
      throw new Error(result.error || 'Circuit breaker failed');
    }

    return result.result as ManyChatSubscriber;
  }

  /**
   * Make API request with rate limiting and error handling
   */
  private async makeAPIRequest(
    endpoint: string,
    options: {
      method: 'GET' | 'POST' | 'PUT' | 'DELETE';
      body?: string;
      headers?: Record<string, string>;
    }
  ): Promise<any> {
    // Rate limiting check
    await this.checkRateLimit();

    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'AI-Sales-Platform/1.0.0',
      ...options.headers
    };

    const fetchOptions: RequestInit = {
      method: options.method,
      headers,
      ...(options.body && { body: options.body })
    };

    try {
      const response = await fetch(url, fetchOptions);
      const data = await response.json();

      if (!response.ok) {
        const errorData = data as any;
        throw new ManyChatAPIError(
          `HTTP ${response.status}: ${errorData.error || 'Unknown error'}`,
          response.status,
          errorData
        );
      }

      return data;

    } catch (error) {
      if (error instanceof ManyChatAPIError) {
        throw error;
      }

      throw new ManyChatAPIError(
        `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        0
      );
    }
  }

  /**
   * Check and enforce rate limiting
   */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const windowKey = Math.floor(now / this.RATE_LIMIT_WINDOW_MS).toString();
    
    const current = this.rateLimiter.get(windowKey) || { count: 0, resetTime: now + this.RATE_LIMIT_WINDOW_MS };
    
    if (current.count >= this.RATE_LIMIT_RPS) {
      const waitTime = current.resetTime - now;
      if (waitTime > 0) {
        this.logger.warn('Rate limit exceeded, waiting', { waitTime });
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }

    current.count++;
    this.rateLimiter.set(windowKey, current);

    // Clean up old entries
    for (const [key] of this.rateLimiter) {
      if (parseInt(key) < Math.floor(now / this.RATE_LIMIT_WINDOW_MS) - 1) {
        this.rateLimiter.delete(key);
      }
    }
  }

  /**
   * Retry message with exponential backoff
   */
  private async retryMessage(
    merchantId: string,
    subscriberId: string,
    message: string,
    options?: ManyChatOptions,
    retryCount = 0
  ): Promise<ManyChatResponse> {
    const maxRetries = 3;
    const retryDelay = Math.pow(2, retryCount) * 1000; // Exponential backoff

    if (retryCount >= maxRetries) {
      this.logger.error('❌ Max retries exceeded for ManyChat message', {
        merchantId,
        subscriberId,
        retryCount
      });

      return {
        success: false,
        error: 'Max retries exceeded',
        timestamp: new Date()
      };
    }

    // Wait before retry
    await new Promise(resolve => setTimeout(resolve, retryDelay));

    this.logger.info(`🔄 Retrying ManyChat message (attempt ${retryCount + 1})`, {
      merchantId,
      subscriberId
    });

    return this.sendMessage(merchantId, subscriberId, message, options);
  }


  /**
   * Get service health status
   */
  public async getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    circuitBreaker: any;
    rateLimit: { current: number; limit: number };
  }> {
    const circuitBreakerStats = this.circuitBreaker.getStats();
    const now = Date.now();
    const windowKey = Math.floor(now / this.RATE_LIMIT_WINDOW_MS).toString();
    const rateLimit = this.rateLimiter.get(windowKey) || { count: 0, resetTime: now };

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    if (circuitBreakerStats.state === 'OPEN') {
      status = 'unhealthy';
    } else if (circuitBreakerStats.failureCount > 2) {
      status = 'degraded';
    }

    return {
      status,
      circuitBreaker: circuitBreakerStats,
      rateLimit: {
        current: rateLimit.count,
        limit: this.RATE_LIMIT_RPS
      }
    };
  }

  /**
   * Reset circuit breaker (for debugging/recovery)
   */
  public resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
    this.logger.info('🔄 Circuit Breaker reset manually', {
      serviceName: 'ManyChatAPI'
    });
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.credentialsCache.dispose();
    this.rateLimiter.clear();
  }

  /**
   * Send text message using ManyChat subscriber ID
   */
  public async sendText(
    merchantId: string,
    subscriberId: string,
    message: string,
    options?: { tag?: string }
  ): Promise<ManyChatResponse> {
    return this.sendMessage(merchantId, subscriberId, message, {
      messageTag: options?.tag || 'CUSTOMER_FEEDBACK'
    });
  }

  /**
   * Find existing subscriber by Instagram ID (no creation attempt)
   */
  public async findSubscriberByInstagram(
    merchantId: string,
    igUserId: string
  ): Promise<{ subscriber_id: string } | null> {
    const fieldId = getEnv('MANYCHAT_IG_FIELD_ID');
    if (!fieldId) {
      this.logger.error('❌ MANYCHAT_IG_FIELD_ID not configured', { merchantId, igUserId });
      throw new Error('MANYCHAT_IG_FIELD_ID environment variable required');
    }

    try {
      // Search for subscriber using proper field_id
      const response = await this.makeAPIRequest(
        `/fb/subscriber/findByCustomField?field_id=${fieldId}&field_value=${igUserId}`,
        { method: 'GET' }
      );

      if (response.status === 'success' && response.data?.id) {
        this.logger.info('✅ Found existing ManyChat subscriber', {
          merchantId,
          igUserId,
          fieldId,
          subscriberId: response.data.id
        });
        return { subscriber_id: response.data.id };
      }

      // No subscriber found - this is normal for new IG users
      this.logger.info('🔍 No ManyChat subscriber found for IG user', {
        merchantId,
        igUserId,
        fieldId
      });
      return null;

    } catch (error) {
      this.logger.warn('❌ ManyChat subscriber lookup failed', {
        merchantId,
        igUserId,
        fieldId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * @deprecated Use findSubscriberByInstagram instead - IG subscribers cannot be created via API
   */
  public async createOrLookupSubscriberByInstagram(
    merchantId: string,
    igUserId: string
  ): Promise<{ subscriber_id: string }> {
    const existing = await this.findSubscriberByInstagram(merchantId, igUserId);
    if (existing) {
      return existing;
    }

    // Cannot create IG subscribers via API - they must opt-in through Instagram first
    const error = new Error('Instagram subscribers cannot be created via API - user must message first');
    this.logger.error('❌ Cannot create IG subscriber via API', {
      merchantId,
      igUserId,
      error: error.message
    });
    throw error;
  }
}

// Singleton instance
let manyChatServiceInstance: ManyChatService | null = null;

export function getManyChatService(): ManyChatService {
  if (!manyChatServiceInstance) {
    manyChatServiceInstance = new ManyChatService();
  }
  return manyChatServiceInstance;
}

export function clearManyChatService(): void {
  if (manyChatServiceInstance) {
    manyChatServiceInstance.dispose();
    manyChatServiceInstance = null;
  }
}
