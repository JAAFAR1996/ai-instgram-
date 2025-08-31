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
import { getManychatIdByInstagramUsername, upsertManychatMapping } from '../repositories/manychat.repo.js';
import { guardManyChatOperation } from '../utils/architecture-guard.js';

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
  customerId: string; // This should contain username, not ID
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

    // Step 2: Try to send through ManyChat first
    try {
      const manyChatResult = await this.sendToManyChat(
        data.merchantId,
        data.customerId,
        aiResponse,
        {
          messageTag: this.getMessageTag(data.interactionType),
          priority: options.priority
        }
      );

      // Success - add tags and log
      await this.addRelevantTags(data, manyChatResult.mcId || data.customerId, aiResponse, options);
      await this.logManyChatInteraction(data, manyChatResult, aiResponse);
      
      return manyChatResult;
      
    } catch (error) {
      // Check if subscriber not found - fallback to local AI
      if (error && typeof error === 'object' && (error as any).code === 'SUBSCRIBER_NOT_FOUND') {
        this.logger.info('🔄 ManyChat subscriber not found, falling back to local AI', {
          merchantId: data.merchantId,
          customerId: data.customerId
        });
        
        // Fallback to local AI processing
        const localResult = await this.processWithLocalAI(data, {
          ...options,
          useManyChat: false,
          fallbackToLocalAI: true
        });
        
        // Convert to ManyChatResponse format
        const response: ManyChatResponse = {
          success: localResult.success,
          timestamp: new Date(),
          platform: 'instagram'
        };
        
        if (localResult.messageId) {
          response.messageId = localResult.messageId;
        }
        
        if (!localResult.success) {
          response.error = 'Fallback to local AI';
        }
        
        return response;
      }
      
      // Other errors - propagate up
      throw error;
    }
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
      // Check if Instagram message window is still valid
      const isWindowValid = await this.checkMessageWindow(data.merchantId, data.customerId);
      
      if (!isWindowValid) {
        this.logger.warn('📅 Instagram message window expired, scheduling for follow-up', {
          merchantId: data.merchantId,
          customerId: data.customerId,
          interactionType: data.interactionType
        });

        // Schedule for manual follow-up or future delivery
        await this.scheduleForFollowUp(data);
        
        return {
          success: false,
          error: 'Message window expired - scheduled for follow-up'
        };
      }

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

      // Check if error is due to message window expiration
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('message window') || errorMessage.includes('24 hours')) {
        this.logger.warn('📅 Message window expired during fallback, scheduling for follow-up');
        await this.scheduleForFollowUp(data);
        
        return {
          success: false,
          error: 'Message window expired - scheduled for follow-up'
        };
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Fallback failed'
      };
    }
  }

  // ensureSubscriberExists removed - now handled by sendToManyChat

  /**
   * إرسال رسالة: Instagram → Server → AI → ManyChat → Instagram
   * Updated to use username instead of user ID
   */
  private async sendToManyChat(
    merchantId: string, 
    username: string, 
    message: string, 
    options?: any
  ): Promise<ManyChatResponse & { mcId?: string }> {
    // 🛡️ ARCHITECTURE GUARD: Validate username-only operation
    guardManyChatOperation(merchantId, username, 'sendToManyChat');
    
    // Step 1: Get ManyChat subscriber ID mapping from database using username
    let mcId = await getManychatIdByInstagramUsername(merchantId, username);
    
    if (!mcId) {
      this.logger.info('🔍 No local mapping found, checking ManyChat directly', { merchantId, username });
      
      // Step 2: Try to find subscriber directly in ManyChat by username
      const found = await this.manyChatService.findSubscriberByInstagram(merchantId, username);
      
      if (found) {
        // Found in ManyChat but not in our DB - update our mapping
        mcId = found.subscriber_id;
        await upsertManychatMapping(merchantId, username, mcId);
        this.logger.info('✅ Found subscriber in ManyChat, updated local mapping', { 
          merchantId, 
          username, 
          mcId 
        });
      } else {
        // No subscriber found - Instagram user hasn't opted into ManyChat yet
        this.logger.info('❌ No ManyChat subscriber found for username - user must message first', { 
          merchantId, 
          username 
        });
        
        // Cannot proceed with ManyChat - throw error to trigger fallback
        const error = new Error('Instagram subscriber not found in ManyChat - user must opt-in first');
        (error as any).code = 'SUBSCRIBER_NOT_FOUND';
        throw error;
      }
    }
    
    try {
      // Send using the ManyChat subscriber ID, not the Instagram ID
      const result = await this.manyChatService.sendText(merchantId, mcId, message, { tag: options?.messageTag });
      return { ...result, mcId };
      
    } catch (error) {
      // Enhanced error handling with resync capability
      this.logger.error('❌ ManyChat sendText failed', {
        username,
        mcId,
        merchantId,
        errorType: error?.constructor?.name,
        errorMessage: error instanceof Error ? error.message : String(error)
      });

      // Check if it's a "Subscriber does not exist" error
      if (this.isSubscriberDoesNotExist(error)) {
        this.logger.warn('🔄 ManyChat says subscriber missing. Resyncing...', { 
          merchantId, 
          username, 
          mcId 
        });
        
        try {
          // Try to find subscriber again in ManyChat directly
          const found = await this.manyChatService.findSubscriberByInstagram(merchantId, username);
          
          if (found) {
            // Update our mapping and retry
            await upsertManychatMapping(merchantId, username, found.subscriber_id);
            return await this.manyChatService.sendText(merchantId, found.subscriber_id, message, { tag: options?.messageTag });
          } else {
            // Still no subscriber - throw error to trigger fallback
            const fallbackError = new Error('Instagram subscriber still not found in ManyChat after resync');
            (fallbackError as any).code = 'SUBSCRIBER_NOT_FOUND';
            throw fallbackError;
          }
            
        } catch (resyncError) {
          this.logger.error('❌ Subscriber resync failed', {
            username,
            merchantId,
            resyncError: resyncError instanceof Error ? resyncError.message : String(resyncError),
            originalSendError: error instanceof Error ? error.message : String(error)
          });
          
          // Throw original error to trigger fallback
          throw error;
        }
      }
      
      // If not subscriber error, throw original error
      throw error;
    }
  }

  /**
   * Check if error indicates "Subscriber does not exist"
   */
  private isSubscriberDoesNotExist(error: any): boolean {
    if (!error || !(error instanceof Error)) return false;
    
    const errorMsg = error.message.toLowerCase();
    return errorMsg.includes('subscriber does not exist') || 
           errorMsg.includes('subscriber not found') ||
           (errorMsg.includes('validation error') && errorMsg.includes('subscriber'));
  }


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
   * Check if Instagram message window is still valid (24 hours)
   */
  private async checkMessageWindow(merchantId: string, customerId: string): Promise<boolean> {
    try {
      // Get last interaction time from database
      const lastInteraction = await this.db.query(
        `SELECT created_at FROM messages 
         WHERE merchant_id = $1 AND sender_id = $2 AND platform = 'instagram'
         ORDER BY created_at DESC LIMIT 1`,
        [merchantId, customerId]
      );

      if (!lastInteraction?.length) {
        return false; // No previous interactions
      }

      const lastInteractionTime = new Date((lastInteraction[0] as any).created_at);
      const now = new Date();
      const hoursDiff = (now.getTime() - lastInteractionTime.getTime()) / (1000 * 60 * 60);

      return hoursDiff <= 24; // Instagram allows 24 hours
    } catch (error) {
      this.logger.warn('Failed to check message window', {
        error: error instanceof Error ? error.message : String(error),
        merchantId,
        customerId
      });
      return false; // Assume expired on error
    }
  }

  /**
   * Schedule message for follow-up delivery
   */
  private async scheduleForFollowUp(data: BridgeMessageData): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO message_followups (
          merchant_id, customer_id, message, interaction_type, platform, 
          scheduled_for, created_at, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
        [
          data.merchantId,
          data.customerId,
          data.message,
          data.interactionType,
          data.platform,
          new Date(Date.now() + 24 * 60 * 60 * 1000), // Schedule for 24 hours later
          new Date(),
        ]
      );

      this.logger.info('📅 Message scheduled for follow-up', {
        merchantId: data.merchantId,
        customerId: data.customerId,
        interactionType: data.interactionType
      });
    } catch (error) {
      this.logger.error('Failed to schedule follow-up', {
        error: error instanceof Error ? error.message : String(error),
        merchantId: data.merchantId,
        customerId: data.customerId
      });
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
          (manyChatResult as any).mcId || data.customerId,
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
