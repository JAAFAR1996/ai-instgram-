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
  flowId?: string;
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
  flow_id?: string;
}

export interface ManyChatAPIErrorResponse {
  status: string;
  error: string;
  details?: Record<string, unknown>;
}

export class ManyChatAPIError extends Error {
  constructor(
    message: string,
    public status: number,
    public apiError?: ManyChatAPIErrorResponse
  ) {
    super(message);
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
    this.apiKey = getEnv('MANYCHAT_API_KEY', { required: true });
    this.baseUrl = getEnv('MANYCHAT_BASE_URL') || 'https://api.manychat.com';
    this.circuitBreaker = new CircuitBreaker(
      5, // failureThreshold
      30000, // recoveryTimeout
      {
        serviceName: 'ManyChatAPI',
        timeout: 10000,
        monitoringPeriod: 300000,
        expectedErrorThreshold: 50,
        halfOpenMaxCalls: 3
      }
    );

    this.logger.info('✅ ManyChat Service initialized', {
      baseUrl: this.baseUrl,
      hasApiKey: !!this.apiKey
    });
  }

  /**
   * Send message via ManyChat API
   */
  public async sendMessage(
    merchantId: string,
    recipientId: string,
    message: string,
    options?: ManyChatOptions
  ): Promise<ManyChatResponse> {
    const result = await this.circuitBreaker.execute(async () => {
      try {
        this.logger.info('📤 Sending ManyChat message', {
          merchantId,
          recipientId,
          messageLength: message.length
        });

        const payload: ManyChatSendContentPayload = {
          subscriber_id: recipientId,
          content: [{
            type: 'text',
            text: message
          }],
          message_tag: options?.messageTag || 'CUSTOMER_FEEDBACK',
          flow_id: options?.flowId || await this.getDefaultFlowId(merchantId)
        };

        const response = await this.makeAPIRequest('/fb/sending/sendContent', {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        if (response.status === 'success') {
          this.logger.info('✅ ManyChat message sent successfully', {
            merchantId,
            recipientId,
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
        this.logger.error('❌ ManyChat message sending failed', error, {
          merchantId,
          recipientId
        });

        // Retry with exponential backoff
        return await this.retryMessage(merchantId, recipientId, message, options);
      }
    });

    if (!result.success) {
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
    }
  ): Promise<ManyChatSubscriber> {
    const result = await this.circuitBreaker.execute(async () => {
      try {
        const response = await this.makeAPIRequest('/fb/subscriber/create', {
          method: 'POST',
          body: JSON.stringify(subscriberData)
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
    recipientId: string,
    message: string,
    options?: ManyChatOptions,
    retryCount = 0
  ): Promise<ManyChatResponse> {
    const maxRetries = 3;
    const retryDelay = Math.pow(2, retryCount) * 1000; // Exponential backoff

    if (retryCount >= maxRetries) {
      this.logger.error('❌ Max retries exceeded for ManyChat message', {
        merchantId,
        recipientId,
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
      recipientId
    });

    return this.sendMessage(merchantId, recipientId, message, options);
  }

  /**
   * Get default flow ID for merchant
   */
  private async getDefaultFlowId(merchantId: string): Promise<string> {
    // Check cache first
    const cached = this.credentialsCache.get(merchantId);
    if (cached) {
      return cached;
    }

    // Get from database (simplified for now)
    const defaultFlowId = getEnv('MANYCHAT_DEFAULT_FLOW_ID');
    
    if (defaultFlowId) {
      // Cache for 1 hour
      this.credentialsCache.set(merchantId, defaultFlowId, 60 * 60 * 1000);
      return defaultFlowId;
    }

    return '';
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
   * Dispose resources
   */
  public dispose(): void {
    this.credentialsCache.dispose();
    this.rateLimiter.clear();
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
