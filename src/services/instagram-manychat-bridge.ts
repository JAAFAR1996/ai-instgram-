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
// import { getInstagramMessageSender } from './instagram-message-sender.js'; // Disabled for ManyChat-only architecture
import { createHash } from 'node:crypto';
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
  // private instagramSender = getInstagramMessageSender(); // Disabled for ManyChat-only architecture
  private db = getDatabase();


  /**
   * Process Instagram message through ManyChat with fallback
   */
  public async processMessage(
    data: BridgeMessageData,
    options: BridgeProcessingOptions = {
      useManyChat: false, // تعطيل ManyChat مؤقتاً لاختبار النظام الجديد
      fallbackToLocalAI: true,
      priority: 'normal'
    }
  ): Promise<BridgeProcessingResult> {
    const startTime = Date.now();
    
    try {
      // Step 0.3: Hashtag tracking + sentiment + opportunity (best-effort)
      try {
        const { getInstagramHashtagMonitor } = await import('./instagram-hashtag-monitor.js');
        const monitor = getInstagramHashtagMonitor();
        const mid = 'mc:' + data.merchantId + ':' + data.customerId + ':' + createHash('sha1').update(String(data.message ?? '') + ':' + data.interactionType).digest('hex').slice(0, 16);
        const src = (data.interactionType === 'comment' ? 'comment' : (data.interactionType.startsWith('story') ? 'story' : 'dm')) as 'dm'|'comment'|'story';
        monitor.processInboundText({
          merchantId: data.merchantId,
          messageId: mid,
          userId: data.customerId,
          source: src,
          content: data.message ?? ''
        }).then(r => {
          this.logger.debug('Hashtag monitor snapshot', { h: r.hashtags.length, m: r.mentions.length, s: r.sentiment, opp: r.opportunitiesCreated });
        }).catch((e) => { console.error('[hardening:no-silent-catch]', e); throw e instanceof Error ? e : new Error(String(e)); });
      } catch (e) {
        this.logger.debug('Hashtag monitor skipped', { error: String(e) });
      }
      this.logger.info('🔄 Processing Instagram message through bridge', {
        merchantId: data.merchantId,
        customerId: data.customerId,
        interactionType: data.interactionType,
        useManyChat: options.useManyChat
      });

      // Step 0.5: Analyze interaction for insights (best-effort, non-blocking)
      try {
        const { InstagramInteractionAnalyzer } = await import('./instagram-interaction-analyzer.js');
        const analyzer = new InstagramInteractionAnalyzer();
        if ((data.interactionType === 'story_reply' || data.interactionType === 'story_mention')) {
          if (data.mediaContext?.mediaId) {
            await analyzer.analyzeStoryReply({
              merchantId: data.merchantId,
              customerId: data.customerId,
              storyId: data.mediaContext.mediaId,
              content: data.message
            });
          }
          // Update engagement + behavior
          analyzer.updateSubscriberEngagementForUsername(data.merchantId, data.customerId).catch((e) => { console.error('[hardening:no-silent-catch]', e); throw e instanceof Error ? e : new Error(String(e)); });
          analyzer.trackUserBehavior(data.merchantId, data.customerId, 'story').catch((e) => { console.error('[hardening:no-silent-catch]', e); throw e instanceof Error ? e : new Error(String(e)); });
        } else if (data.interactionType === 'dm') {
          await analyzer.categorizeDMIntent(data.message).catch((e) => { console.error('[hardening:no-silent-catch]', e); throw e instanceof Error ? e : new Error(String(e)); });
          analyzer.updateSubscriberEngagementForUsername(data.merchantId, data.customerId).catch((e) => { console.error('[hardening:no-silent-catch]', e); throw e instanceof Error ? e : new Error(String(e)); });
          analyzer.trackUserBehavior(data.merchantId, data.customerId, 'dm').catch((e) => { console.error('[hardening:no-silent-catch]', e); throw e instanceof Error ? e : new Error(String(e)); });
        } else if (data.interactionType === 'comment') {
          analyzer.analyzeCommentSentiment(data.merchantId, data.customerId, data.message).catch((e) => { console.error('[hardening:no-silent-catch]', e); throw e instanceof Error ? e : new Error(String(e)); });
          analyzer.updateSubscriberEngagementForUsername(data.merchantId, data.customerId).catch((e) => { console.error('[hardening:no-silent-catch]', e); throw e instanceof Error ? e : new Error(String(e)); });
          analyzer.trackUserBehavior(data.merchantId, data.customerId, 'comment').catch((e) => { console.error('[hardening:no-silent-catch]', e); throw e instanceof Error ? e : new Error(String(e)); });
        }
      } catch (e) {
        this.logger.debug('Interaction analysis skipped', { error: String(e) });
      }

      // Step 1: Try ManyChat first if enabled
      if (options.useManyChat) {
        try {
          const manyChatResult = await this.processWithManyChat(data, options);
          if (manyChatResult.success) {
            return {
              success: true,
              platform: 'manychat',
              messageId: manyChatResult.messageId ?? undefined,
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
          this.logger.info('🤖 Using Local AI (ManyChat disabled)', {
            merchantId: data.merchantId,
            customerId: data.customerId,
            message: data.message?.substring(0, 50)
          });
          
          const localAIResult = await this.processWithLocalAI(data, options);
          if (localAIResult.success) {
            this.logger.info('✅ Local AI response generated successfully', {
              merchantId: data.merchantId,
              customerId: data.customerId,
              responseLength: localAIResult.aiResponse?.length || 0
            });
            
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
          this.logger.error('❌ Local AI processing failed', {
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
      // Determine 24-hour window
      await this.checkMessageWindow(data.merchantId, data.customerId);

      const manyChatResult = await this.sendToManyChat(
        data.merchantId,
        data.customerId,
        aiResponse,
        {
          priority: options.priority
        }
      );

      // Success - add tags and log (skip updateSubscriber to avoid HTML 403/404)
      await this.addRelevantTags(data, manyChatResult.mcId || data.customerId, aiResponse, options);
      await this.logManyChatInteraction(data, manyChatResult, aiResponse);
      
      return manyChatResult;
      
    } catch (error) {
      // Check if subscriber not found - fallback to local AI
      if (error && typeof error === 'object' && 'code' in error && error.code === 'SUBSCRIBER_NOT_FOUND') {
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

    // For ManyChat-only architecture, we return the AI response
    // The webhook will handle sending it back to ManyChat
    const messageId = `local_ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Log the interaction
    await this.logLocalAIInteraction(data, { success: true, messageId }, aiResponse);

    return {
      success: true,
      messageId,
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
      const messageId = `fallback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      
      // For ManyChat-only architecture, we return the fallback response
      // The webhook will handle sending it back to ManyChat
      const sendResult = { success: true, messageId };

      await this.logFallbackInteraction(data, sendResult, fallbackResponse);

      return {
        success: true,
        messageId,
        error: undefined
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
    _options?: unknown
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
        const error = new Error('Instagram subscriber not found in ManyChat - user must opt-in first') as Error & { code: string };
        error.code = 'SUBSCRIBER_NOT_FOUND';
        throw error;
      }
    }
    
    try {
      // Send using the ManyChat subscriber ID, not the Instagram ID
      const lastInboundAt = await this.getLastInboundAt(merchantId, username);
      const inboundHours = lastInboundAt ? ((Date.now() - new Date(lastInboundAt).getTime()) / 3_600_000) : Number.POSITIVE_INFINITY;
      const outside24h = !(Number.isFinite(inboundHours) && inboundHours <= 24);
      const tag = outside24h ? 'HUMAN_AGENT' as const : undefined;

      const result = await this.manyChatService.sendText(merchantId, mcId, message, {
        isResponseToNewMessage: !outside24h,
        tag,
        outside24h
      });
      
      // إذا كانت الرسالة محجوبة بسياسة 24 ساعة، نُشعِر المستخدم الطريقة الصحيحة ونسجل متابعة
      if (!result.success && (result.error === 'blocked_24h_no_tag' || result.error === 'outside_24h_policy')) {
        const nudge = 'حسب سياسة إنستغرام، لازم تراسلنا برسالة قصيرة حتى نكمل ❤️ اكتب "مرحبا" حتى نكمل وياك.';
        try { await this.manyChatService.sendText(merchantId, mcId, nudge, { tag, outside24h }); } catch {}
        await this.scheduleForFollowUp({ merchantId, customerId: username, message, interactionType: 'dm', platform: 'instagram' } as any);
      }
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
            return await this.manyChatService.sendText(merchantId, found.subscriber_id, message, { isResponseToNewMessage: true });
          } else {
            // Still no subscriber - throw error to trigger fallback
            const fallbackError = new Error('Instagram subscriber still not found in ManyChat after resync') as Error & { code: string };
            fallbackError.code = 'SUBSCRIBER_NOT_FOUND';
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
   * آخر رسالة واردة من العميل لاحتساب نافذة الـ 24 ساعة
   */
  private async getLastInboundAt(merchantId: string, username: string): Promise<Date | null> {
    try {
      const sql = this.db.getSQL();
      const rows = await sql<{ created_at: string | Date }>`
        SELECT ml.created_at
        FROM message_logs ml
        JOIN conversations c ON c.id = ml.conversation_id
        WHERE c.merchant_id = ${merchantId}::uuid
          AND lower(c.customer_instagram) = lower(${username})
          AND ml.platform = 'instagram'
          AND ml.direction = 'INCOMING'
        ORDER BY ml.created_at DESC
        LIMIT 1
      `;
      return rows?.[0]?.created_at ? new Date(rows[0].created_at) : null;
    } catch (e) {
      this.logger.warn('getLastInboundAt failed', { error: String(e), merchantId, username });
      return null;
    }
  }

  /**
   * Check if error indicates "Subscriber does not exist"
   */
  private isSubscriberDoesNotExist(error: unknown): boolean {
    if (!error || !(error instanceof Error)) return false;
    
    const errorMsg = error.message.toLowerCase();
    return errorMsg.includes('subscriber does not exist') || 
           errorMsg.includes('subscriber not found') ||
           (errorMsg.includes('validation error') && errorMsg.includes('subscriber'));
  }


  /**
   * جلب تاريخ المحادثة من قاعدة البيانات
   */
  private async getConversationHistory(merchantId: string, customerId: string): Promise<Array<{ role: 'user' | 'assistant'; content: string; timestamp: Date }>> {
    try {
      const sql = this.db.getSQL();
      
      // البحث عن المحادثة النشطة
      const conversation = await sql<{ id: string }>`
        SELECT id FROM conversations 
        WHERE merchant_id = ${merchantId}::uuid 
          AND customer_instagram = ${customerId}
          AND is_active = true
        ORDER BY created_at DESC 
        LIMIT 1
      `;
      
      if (conversation.length === 0) {
        return []; // لا توجد محادثة نشطة
      }
      
      // جلب آخر 10 رسائل من المحادثة
      const messages = await sql<{ direction: string; content: string; created_at: string }>`
        SELECT direction, content, created_at
        FROM message_logs
        WHERE conversation_id = ${conversation[0].id}
        ORDER BY created_at DESC
        LIMIT 10
      `;
      
      // تحويل إلى تنسيق OpenAI مع timestamp
      return messages.reverse().map(msg => ({
        role: msg.direction === 'INCOMING' ? 'user' as const : 'assistant' as const,
        content: msg.content || '',
        timestamp: new Date(msg.created_at)
      }));
      
    } catch (error) {
      this.logger.warn('Failed to get conversation history', { 
        error: String(error),
        merchantId,
        customerId 
      });
      return [];
    }
  }

  /**
   * Generate AI response
   */
  private async generateAIResponse(data: BridgeMessageData): Promise<string> {
    try {
      // جلب تاريخ المحادثة من قاعدة البيانات - هذا هو الحل!
      const conversationHistory = await this.getConversationHistory(data.merchantId, data.customerId);
      
      const context: InstagramContext = {
        merchantId: data.merchantId,
        customerId: data.customerId,
        platform: data.platform,
        stage: 'GREETING',
        cart: [],
        preferences: {},
        conversationHistory: conversationHistory, // استخدام التاريخ الحقيقي!
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
  // removed getMessageTag: message tags are no longer used


  /**
   * Check if Instagram message window is still valid (24 hours)
   */
  private async checkMessageWindow(merchantId: string, customerId: string): Promise<boolean> {
    try {
      // Get last interaction time from message_logs table
      const sql = this.db.getSQL();
      const lastInteraction = await sql<{ created_at: string | Date }>`
        SELECT ml.created_at 
        FROM message_logs ml
        JOIN conversations c ON c.id = ml.conversation_id
        WHERE c.merchant_id = ${merchantId}::uuid 
          AND c.customer_instagram = ${customerId}
          AND ml.platform = 'instagram'
          AND ml.direction = 'INCOMING'
        ORDER BY ml.created_at DESC LIMIT 1
      `;

      if (!lastInteraction?.length) {
        return true; // No previous interactions - allow first message
      }

      const lastInteractionTime = new Date((lastInteraction[0] as { created_at: string | Date }).created_at);
      const now = new Date();
      const hoursDiff = (now.getTime() - lastInteractionTime.getTime()) / (1000 * 60 * 60);

      return hoursDiff <= 24; // Instagram allows 24 hours
    } catch (error) {
      this.logger.warn('Failed to check message window', {
        error: error instanceof Error ? error.message : String(error),
        merchantId,
        customerId
      });
      return true; // Allow message on error to avoid blocking
    }
  }

  /**
   * Schedule message for follow-up delivery
   */
  private async scheduleForFollowUp(data: BridgeMessageData): Promise<void> {
    try {
      const sql = this.db.getSQL();
      await sql`
        INSERT INTO message_followups (
          merchant_id, customer_id, message, interaction_type, platform, 
          scheduled_for, created_at, status
        ) VALUES (
          ${data.merchantId}::uuid, ${data.customerId}, ${data.message}, ${data.interactionType}, ${data.platform},
          ${new Date(Date.now() + 24 * 60 * 60 * 1000)}, ${new Date()}, 'pending'
        )
      `;

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
      const sql = this.db.getSQL();
      await sql`
        INSERT INTO manychat_logs (
          merchant_id, subscriber_id, message_id, action, status, response_data, created_at
        ) VALUES (
          ${data.merchantId}::uuid,
          ${((manyChatResult as { mcId?: string }).mcId) || data.customerId},
          ${manyChatResult.messageId},
          ${'send_message'},
          ${manyChatResult.success ? 'success' : 'failed'},
          ${JSON.stringify({ aiResponse, manyChatResult, interactionType: data.interactionType })}::jsonb,
          ${new Date()}
        )
      `;
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
    sendResult: unknown,
    aiResponse: string
  ): Promise<void> {
    try {
      const sr = (sendResult as { messageId?: string; success?: boolean });
      const sql = this.db.getSQL();
      await sql`
        INSERT INTO manychat_logs (
          merchant_id, subscriber_id, message_id, action, status, response_data, created_at
        ) VALUES (
          ${data.merchantId}::uuid,
          ${data.customerId},
          ${sr.messageId},
          ${'local_ai_response'},
          ${sr.success ? 'success' : 'failed'},
          ${JSON.stringify({ aiResponse, sendResult, interactionType: data.interactionType, fallbackUsed: true })}::jsonb,
          ${new Date()}
        )
      `;
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
    sendResult: unknown,
    fallbackResponse: string
  ): Promise<void> {
    try {
      const sr = (sendResult as { messageId?: string; success?: boolean });
      const sql = this.db.getSQL();
      await sql`
        INSERT INTO manychat_logs (
          merchant_id, subscriber_id, message_id, action, status, response_data, created_at
        ) VALUES (
          ${data.merchantId}::uuid,
          ${data.customerId},
          ${sr.messageId},
          ${'fallback_response'},
          ${sr.success ? 'success' : 'failed'},
          ${JSON.stringify({ fallbackResponse, sendResult, interactionType: data.interactionType, fallbackUsed: true })}::jsonb,
          ${new Date()}
        )
      `;
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
    manyChat: unknown;
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
