/**
 * ===============================================
 * Instagram ManyChat Bridge Service
 * Bridges Instagram webhooks with ManyChat API
 * Handles DMs, Comments, Story Mentions with fallback to local AI
 * ===============================================
 */

import { getLogger } from './logger.js';
import { getManyChatService, type ManyChatResponse } from './manychat-api.js';
import { getConversationAIOrchestrator } from './conversation-ai-orchestrator.js';
import { getInstagramMessageSender } from './instagram-message-sender.js';
import { getDatabase } from '../db/adapter.js';

import type { InstagramContext } from './instagram-ai.js';
import type { Platform } from '../types/database.js';

// Types
export interface BridgeProcessingResult {
  success: boolean;
  platform: 'manychat' | 'local_ai' | 'fallback';
  messageId?: string | undefined;
  error?: string | undefined;
  timestamp: Date;
  processingTime: number;
  metadata?: Record<string, unknown>;
}

export interface BridgeMessageData {
  merchantId: string;
  customerId: string;
  message: string;
  conversationId?: string;
  interactionType: 'dm' | 'comment' | 'story_reply' | 'story_mention';
  mediaContext?: {
    mediaId?: string;
    mediaType?: string;
    caption?: string;
  };
  platform: Platform;
}

export interface BridgeProcessingOptions {
  useManyChat: boolean;
  fallbackToLocalAI: boolean;
  priority: 'low' | 'normal' | 'high';
  tags?: string[];
  customFields?: Record<string, unknown>;
}

export class InstagramManyChatBridge {
  private logger = getLogger({ component: 'InstagramManyChatBridge' });
  private manyChatService = getManyChatService();
  private aiOrchestrator = getConversationAIOrchestrator();
  private instagramSender = getInstagramMessageSender();
  private db = getDatabase();


  /**
   * Process Instagram message through ManyChat with fallback
   */
  public async processMessage(
    data: BridgeMessageData,
    options: BridgeProcessingOptions = {
      useManyChat: true,
      fallbackToLocalAI: true,
      priority: 'normal'
    }
  ): Promise<BridgeProcessingResult> {
    const startTime = Date.now();
    
    try {
      this.logger.info('🔄 Processing Instagram message through bridge', {
        merchantId: data.merchantId,
        customerId: data.customerId,
        interactionType: data.interactionType,
        useManyChat: options.useManyChat
      });

      // Step 1: Try ManyChat first if enabled
      if (options.useManyChat) {
        try {
          const manyChatResult = await this.processWithManyChat(data, options);
          if (manyChatResult.success) {
            return {
              success: true,
              platform: 'manychat',
              messageId: manyChatResult.messageId || undefined,
              timestamp: new Date(),
              processingTime: Date.now() - startTime,
              metadata: {
                manyChatMessageId: manyChatResult.messageId,
                flowUsed: 'manychat'
              }
            };
          }
        } catch (error) {
          this.logger.warn('ManyChat processing failed, trying fallback', {
            merchantId: data.merchantId,
            customerId: data.customerId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      // Step 2: Fallback to local AI if enabled
      if (options.fallbackToLocalAI) {
        try {
          const localAIResult = await this.processWithLocalAI(data, options);
          if (localAIResult.success) {
            return {
              success: true,
              platform: 'local_ai',
              messageId: localAIResult.messageId,
              timestamp: new Date(),
              processingTime: Date.now() - startTime,
              metadata: {
                aiResponse: localAIResult.aiResponse,
                fallbackUsed: true
              }
            };
          }
        } catch (error) {
          this.logger.error('Local AI processing failed', {
            merchantId: data.merchantId,
            customerId: data.customerId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      // Step 3: Final fallback - direct Instagram response
      const fallbackResult = await this.processWithFallback(data);
      
      return {
        success: fallbackResult.success,
        platform: 'fallback',
        messageId: fallbackResult.messageId,
        error: fallbackResult.error,
        timestamp: new Date(),
        processingTime: Date.now() - startTime,
        metadata: {
          fallbackUsed: true,
          directResponse: true
        }
      };

    } catch (error) {
      this.logger.error('Bridge processing completely failed', {
        merchantId: data.merchantId,
        customerId: data.customerId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        platform: 'fallback',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date(),
        processingTime: Date.now() - startTime
      };
    }
  }

  /**
   * Process message through ManyChat
   */
  private async processWithManyChat(
    data: BridgeMessageData,
    options: BridgeProcessingOptions
  ): Promise<ManyChatResponse> {
    // Step 0: Try to reset circuit breaker if it's open
    try {
      const healthStatus = await this.manyChatService.getHealthStatus();
      if (healthStatus.status === 'unhealthy') {
        this.logger.warn('🔄 ManyChat circuit breaker is open, attempting reset', {
          merchantId: data.merchantId,
          customerId: data.customerId
        });
        this.manyChatService.resetCircuitBreaker();
      }
    } catch (error) {
      this.logger.warn('Failed to check/reset ManyChat circuit breaker', {
        error: error instanceof Error ? error.message : String(error),
        merchantId: data.merchantId,
        customerId: data.customerId
      });
    }

    // Step 1: Generate AI response
    const aiResponse = await this.generateAIResponse(data);

    // Step 2: Send through ManyChat with auto subscriber creation
    const manyChatResult = await this.sendToManyChat(
      data.merchantId,
      data.customerId,
      aiResponse,
      {
        messageTag: this.getMessageTag(data.interactionType),
        priority: options.priority
      }
    );

    // Step 3: Add relevant tags (use customerId directly)
    await this.addRelevantTags(data, data.customerId, aiResponse, options);

    // Step 6: Log the interaction
    await this.logManyChatInteraction(data, manyChatResult, aiResponse);

    return manyChatResult;
  }

  /**
   * Process message with local AI
   */
  private async processWithLocalAI(
    data: BridgeMessageData,
    _options: BridgeProcessingOptions
  ): Promise<{ success: boolean; messageId?: string; aiResponse: string }> {
    // Generate AI response
    const aiResponse = await this.generateAIResponse(data);

    // Send directly via Instagram API
    const sendResult = await this.instagramSender.sendTextMessage(
      data.merchantId,
      data.customerId,
      aiResponse,
      data.conversationId
    );

    // Log the interaction
    await this.logLocalAIInteraction(data, sendResult, aiResponse);

    return {
      success: sendResult.success,
      ...(sendResult.messageId ? { messageId: sendResult.messageId } : {}),
      aiResponse
    };
  }

  /**
   * Process message with fallback (simple response)
   */
  private async processWithFallback(
    data: BridgeMessageData
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // Simple fallback response
      const fallbackResponse = this.getFallbackResponse(data.interactionType);
      
      const sendResult = await this.instagramSender.sendTextMessage(
        data.merchantId,
        data.customerId,
        fallbackResponse,
        data.conversationId
      );

      await this.logFallbackInteraction(data, sendResult, fallbackResponse);

      return {
        success: sendResult.success,
        ...(sendResult.messageId ? { messageId: sendResult.messageId } : {}),
        ...(sendResult.error ? { error: sendResult.error } : {})
      };

    } catch (error) {
      this.logger.error('Fallback processing failed', error, {
        merchantId: data.merchantId,
        customerId: data.customerId
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Fallback failed'
      };
    }
  }

  // ensureSubscriberExists removed - now handled by sendToManyChat

  /**
   * إرسال رسالة: Instagram → Server → AI → ManyChat → Instagram
   * مع فحص وجود subscriber أولاً
   */
  private async sendToManyChat(
    merchantId: string, 
    customerId: string, 
    message: string, 
    options?: any
  ): Promise<ManyChatResponse> {
    
    try {
      // محاولة إرسال الرسالة مباشرة
      return await this.manyChatService.sendMessage(
        merchantId, 
        customerId, 
        message, 
        options
      );
      
    } catch (error) {
      // إذا كان الخطأ "Subscriber does not exist"
      if (error instanceof Error) {
        const errorMsg = error.message.toLowerCase();
        if (errorMsg.includes('subscriber does not exist') || 
            errorMsg.includes('validation error')) {
          
          this.logger.info('🔄 Subscriber not found, creating and retrying...', { 
            customerId, 
            merchantId 
          });
          
          // محاولة إنشاء subscriber
          try {
            await this.manyChatService.createSubscriber(merchantId, {
              phone: `+964${customerId.slice(-10)}`,
              has_opt_in_sms: true,
              first_name: 'Instagram',
              last_name: 'User',
              language: 'ar'
            });
            
            // إعادة محاولة الإرسال بعد الإنشاء
            return await this.manyChatService.sendMessage(
              merchantId, 
              customerId, 
              message, 
              options
            );
            
          } catch (createError) {
            this.logger.warn('⚠️ Could not create subscriber, will use fallback', {
              customerId,
              createError: createError instanceof Error ? createError.message : String(createError)
            });
            throw error; // throw original error to trigger fallback
          }
        }
      }
      
      // إذا لم يكن الخطأ متعلق بـ subscriber، throw الخطأ الأصلي
      throw error;
    }
  }

  // updateSubscriberInfo removed - simplified in sendToManyChat

  /**
   * Generate AI response
   */
  private async generateAIResponse(data: BridgeMessageData): Promise<string> {
    try {
      const context: InstagramContext = {
        merchantId: data.merchantId,
        customerId: data.customerId,
        platform: data.platform,
        stage: 'GREETING',
        cart: [],
        preferences: {},
        conversationHistory: [],
        interactionType: data.interactionType,
        ...(data.mediaContext ? { 
          mediaContext: {
            ...data.mediaContext,
            mediaType: (data.mediaContext.mediaType as 'video' | 'carousel' | 'photo') || 'photo'
          }
        } : {})
      };

      const aiResponse = await this.aiOrchestrator.generatePlatformResponse(
        data.message,
        context,
        'instagram'
      );

      return aiResponse.response.message || this.getFallbackResponse(data.interactionType);

    } catch (error) {
      this.logger.error('AI response generation failed', error, {
        merchantId: data.merchantId,
        customerId: data.customerId
      });

      // Return simple fallback response
      return this.getFallbackResponse(data.interactionType);
    }
  }

  /**
   * Add relevant tags based on AI response
   */
  private async addRelevantTags(
    data: BridgeMessageData,
    subscriberId: string,
    aiResponse: string,
    options: BridgeProcessingOptions
  ): Promise<void> {
    try {
      const tags: string[] = [];

      // Add interaction type tag
      tags.push(`interaction_${data.interactionType}`);

      // Add platform tag
      tags.push(`platform_${data.platform}`);

      // Add priority tag
      tags.push(`priority_${options.priority}`);

      // Analyze AI response for intent
      if (aiResponse.includes('سعر') || aiResponse.includes('تكلفة')) {
        tags.push('price_inquiry');
      }

      if (aiResponse.includes('طلب') || aiResponse.includes('شراء')) {
        tags.push('purchase_intent');
      }

      if (aiResponse.includes('شكراً') || aiResponse.includes('ممتاز')) {
        tags.push('positive_feedback');
      }

      // Add custom tags
      if (options.tags) {
        tags.push(...options.tags);
      }

      if (tags.length > 0) {
        await this.manyChatService.addTags(
          data.merchantId,
          subscriberId,
          tags
        );
      }

    } catch (error) {
      this.logger.warn('Failed to add tags', {
        merchantId: data.merchantId,
        subscriberId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Get message tag for ManyChat
   */
  private getMessageTag(interactionType: string): string {
    switch (interactionType) {
      case 'dm':
        return 'CUSTOMER_FEEDBACK';
      case 'comment':
        return 'COMMENT_RESPONSE';
      case 'story_reply':
        return 'STORY_INTERACTION';
      case 'story_mention':
        return 'STORY_MENTION';
      default:
        return 'CUSTOMER_FEEDBACK';
    }
  }


  /**
   * Get fallback response
   */
  private getFallbackResponse(interactionType: string): string {
    switch (interactionType) {
      case 'dm':
        return 'شكراً لك على رسالتك! سنقوم بالرد عليك قريباً.';
      case 'comment':
        return 'شكراً على تعليقك! سنتواصل معك قريباً.';
      case 'story_reply':
        return 'شكراً على تفاعلك! سنرد عليك قريباً.';
      case 'story_mention':
        return 'شكراً على ذكرنا! سنتواصل معك قريباً.';
      default:
        return 'شكراً لك! سنقوم بالرد عليك قريباً.';
    }
  }



  /**
   * Log ManyChat interaction
   */
  private async logManyChatInteraction(
    data: BridgeMessageData,
    manyChatResult: ManyChatResponse,
    aiResponse: string
  ): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO manychat_logs (
          merchant_id, subscriber_id, message_id, action, status, response_data, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          data.merchantId,
          data.customerId,
          manyChatResult.messageId,
          'send_message',
          manyChatResult.success ? 'success' : 'failed',
          JSON.stringify({
            aiResponse,
            manyChatResult,
            interactionType: data.interactionType
          }),
          new Date()
        ]
      );
    } catch (error) {
      this.logger.warn('Failed to log ManyChat interaction', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Log local AI interaction
   */
  private async logLocalAIInteraction(
    data: BridgeMessageData,
    sendResult: any,
    aiResponse: string
  ): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO manychat_logs (
          merchant_id, subscriber_id, message_id, action, status, response_data, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          data.merchantId,
          data.customerId,
          sendResult.messageId,
          'local_ai_response',
          sendResult.success ? 'success' : 'failed',
          JSON.stringify({
            aiResponse,
            sendResult,
            interactionType: data.interactionType,
            fallbackUsed: true
          }),
          new Date()
        ]
      );
    } catch (error) {
      this.logger.warn('Failed to log local AI interaction', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Log fallback interaction
   */
  private async logFallbackInteraction(
    data: BridgeMessageData,
    sendResult: any,
    fallbackResponse: string
  ): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO manychat_logs (
          merchant_id, subscriber_id, message_id, action, status, response_data, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          data.merchantId,
          data.customerId,
          sendResult.messageId,
          'fallback_response',
          sendResult.success ? 'success' : 'failed',
          JSON.stringify({
            fallbackResponse,
            sendResult,
            interactionType: data.interactionType,
            fallbackUsed: true
          }),
          new Date()
        ]
      );
    } catch (error) {
      this.logger.warn('Failed to log fallback interaction', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Add tags to subscriber (helper method)
   */
  // addTagsToSubscriber removed - tags handled in sendToManyChat if needed

  /**
   * Get bridge health status
   */
  public async getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    manyChat: any;
    localAI: boolean;
    instagram: boolean;
  }> {
    const manyChatHealth = await this.manyChatService.getHealthStatus();
    
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    if (manyChatHealth.status === 'unhealthy') {
      status = 'degraded';
    }

    return {
      status,
      manyChat: manyChatHealth,
      localAI: true, // Assume local AI is always available
      instagram: true // Assume Instagram sender is always available
    };
  }
}

// Singleton instance
let bridgeInstance: InstagramManyChatBridge | null = null;

export function getInstagramManyChatBridge(): InstagramManyChatBridge {
  if (!bridgeInstance) {
    bridgeInstance = new InstagramManyChatBridge();
  }
  return bridgeInstance;
}

export function clearInstagramManyChatBridge(): void {
  bridgeInstance = null;
}
