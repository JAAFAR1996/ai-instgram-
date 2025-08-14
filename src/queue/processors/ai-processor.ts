/**
 * ===============================================
 * AI Job Processor
 * Async processing for AI response generation
 * ===============================================
 */

import type { QueueJob, JobProcessor } from '../message-queue';
import { getConversationAIOrchestrator } from '@/services/conversation-ai-orchestrator';
import { getRepositories } from '@/repositories';
import { getInstagramClient } from '@/services/instagram-api';

export interface AIJobPayload {
  conversationId: string;
  merchantId: string;
  customerId: string;
  messageContent: string;
  platform: 'INSTAGRAM' | 'WHATSAPP';
  interactionType: 'dm' | 'comment' | 'story_reply' | 'story_mention';
  messageId?: string;
  mediaContext?: {
    mediaId?: string;
    isPublic?: boolean;
  };
  retryCount?: number;
}

export class AIProcessor implements JobProcessor {
  private repositories = getRepositories();
  private aiOrchestrator = getConversationAIOrchestrator();

  async process(job: QueueJob): Promise<{ success: boolean; result?: any; error?: string }> {
    const payload = job.payload as AIJobPayload;
    const startTime = Date.now();
    
    try {
      console.log(`🤖 Processing AI job: ${payload.interactionType} for conversation ${payload.conversationId}`);
      
      // Get conversation context
      const conversation = await this.repositories.conversation.findById(payload.conversationId);
      if (!conversation) {
        return { success: false, error: `Conversation not found: ${payload.conversationId}` };
      }

      // Get merchant info
      const merchant = await this.repositories.merchant.findById(payload.merchantId);
      if (!merchant || !merchant.isActive) {
        return { success: false, error: `Merchant not found or inactive: ${payload.merchantId}` };
      }

      // Get recent conversation history
      const messageHistory = await this.repositories.message.getRecentMessagesForContext(
        payload.conversationId,
        10
      );

      // Build AI context based on platform
      const aiContext = await this.buildAIContext(
        payload,
        conversation,
        merchant,
        messageHistory
      );

      // Generate AI response
      const aiResult = await this.aiOrchestrator.generatePlatformResponse(
        payload.messageContent,
        aiContext,
        payload.platform
      );

      const processingTime = Date.now() - startTime;

      // Store AI response as outgoing message
      const outgoingMessage = await this.repositories.message.create({
        conversationId: payload.conversationId,
        direction: 'OUTGOING',
        platform: payload.platform,
        messageType: 'TEXT',
        content: aiResult.response.message,
        platformMessageId: `ai_generated_${Date.now()}`,
        aiProcessed: true,
        deliveryStatus: 'PENDING',
        aiConfidence: aiResult.response.confidence,
        aiIntent: aiResult.response.intent,
        processingTimeMs: processingTime
      });

      // Update conversation stage if changed
      if (aiResult.response.stage !== conversation.conversationStage) {
        await this.repositories.conversation.update(payload.conversationId, {
          conversationStage: aiResult.response.stage
        });
      }

      // Send the message via platform API
      const deliveryResult = await this.deliverMessage(payload, aiResult.response.message);

      // Update message delivery status
      if (deliveryResult.success) {
        await this.repositories.message.markAsDelivered(
          outgoingMessage.id,
          deliveryResult.platformMessageId
        );
      } else {
        await this.repositories.message.markAsFailed(outgoingMessage.id);
      }

      return {
        success: true,
        result: {
          messageId: outgoingMessage.id,
          aiResponse: aiResult.response.message,
          confidence: aiResult.response.confidence,
          intent: aiResult.response.intent,
          stage: aiResult.response.stage,
          processingTime,
          delivered: deliveryResult.success,
          platformMessageId: deliveryResult.platformMessageId
        }
      };

    } catch (error) {
      console.error('❌ AI processing error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown AI processing error'
      };
    }
  }

  /**
   * Build AI context based on platform and conversation data
   */
  private async buildAIContext(
    payload: AIJobPayload,
    conversation: any,
    merchant: any,
    messageHistory: any[]
  ): Promise<any> {
    const baseContext = {
      merchantId: payload.merchantId,
      customerId: payload.customerId,
      platform: payload.platform,
      stage: conversation.conversationStage,
      cart: conversation.sessionData?.cart || [],
      preferences: conversation.sessionData?.preferences || {},
      conversationHistory: messageHistory.map(msg => ({
        role: msg.direction === 'INCOMING' ? 'user' : 'assistant',
        content: msg.content,
        timestamp: msg.createdAt
      })),
      interactionType: payload.interactionType,
      mediaContext: payload.mediaContext,
      merchantSettings: {
        businessName: merchant.businessName,
        businessCategory: merchant.businessCategory,
        workingHours: merchant.settings?.workingHours || {},
        paymentMethods: merchant.settings?.paymentMethods || [],
        deliveryFees: merchant.settings?.deliveryFees || {},
        autoResponses: merchant.settings?.autoResponses || {}
      }
    };

    // Platform-specific context enhancements
    if (payload.platform === 'INSTAGRAM') {
      return {
        ...baseContext,
        // Instagram-specific context
        hashtagSuggestions: merchant.settings?.instagramHashtags || [],
        storyFeatures: merchant.settings?.storyFeatures || false,
        commerceEnabled: merchant.settings?.instagramCommerce || false
      };
    } else if (payload.platform === 'WHATSAPP') {
      return {
        ...baseContext,
        // WhatsApp-specific context
        businessPhone: merchant.contactPhone,
        catalogEnabled: merchant.settings?.whatsappCatalog || false,
        paymentEnabled: merchant.settings?.whatsappPayments || false
      };
    }

    return baseContext;
  }

  /**
   * Deliver message via platform API
   */
  private async deliverMessage(
    payload: AIJobPayload,
    message: string
  ): Promise<{ success: boolean; platformMessageId?: string; error?: string }> {
    try {
      switch (payload.platform) {
        case 'INSTAGRAM':
          return await this.deliverInstagramMessage(payload, message);
          
        case 'WHATSAPP':
          return await this.deliverWhatsAppMessage(payload, message);
          
        default:
          return { success: false, error: `Unsupported platform: ${payload.platform}` };
      }
    } catch (error) {
      console.error('❌ Message delivery error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown delivery error'
      };
    }
  }

  /**
   * Deliver Instagram message
   */
  private async deliverInstagramMessage(
    payload: AIJobPayload,
    message: string
  ): Promise<{ success: boolean; platformMessageId?: string; error?: string }> {
    try {
      const instagramClient = getInstagramClient();
      await instagramClient.initialize(payload.merchantId);

      const result = await instagramClient.sendMessage({
        recipientId: payload.customerId,
        messageType: 'text',
        content: message
      });

      return {
        success: result.success,
        platformMessageId: result.messageId,
        error: result.error?.message
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Instagram delivery failed'
      };
    }
  }

  /**
   * Deliver WhatsApp message (placeholder)
   */
  private async deliverWhatsAppMessage(
    payload: AIJobPayload,
    message: string
  ): Promise<{ success: boolean; platformMessageId?: string; error?: string }> {
    // TODO: Implement WhatsApp message delivery
    console.log('📱 WhatsApp message delivery not yet implemented');
    
    return {
      success: false,
      error: 'WhatsApp delivery not implemented'
    };
  }
}

// Export processor instance
export const aiProcessor = new AIProcessor();