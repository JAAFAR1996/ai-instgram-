/**
 * ===============================================
 * Instagram Webhook Handler
 * Processes Instagram Graph API webhook events
 * ===============================================
 */

import * as crypto from 'crypto';
// import { getInstagramClient } from './instagram-api.js'; // DISABLED: Direct Instagram API removed
import { getMessageWindowService } from './message-window.js';
import { getDatabase } from '../db/adapter.js';
import { getConversationAIOrchestrator } from './conversation-ai-orchestrator.js';
import { getRepositories } from '../repositories/index.js';
import { getInstagramStoriesManager } from './instagram-stories-manager.js';
import { getInstagramCommentsManager } from './instagram-comments-manager.js';
import { getInstagramMediaManager } from './instagram-media-manager.js';
import { getInstagramManyChatBridge } from './instagram-manychat-bridge.js';
// import { getServiceController } from './service-controller.js';
import { verifyHMACRaw } from './encryption.js';
import { createLogger } from './logger.js';
import type { ConversationRow, MessageHistoryRow as DBMessageHistoryRow } from '../types/database-rows.js';
import type { ConversationStage } from '../types/database.js';
import type { Sql } from '../types/sql.js';
// import type { InstagramMessage, InstagramComment, InstagramStoryMention } from './instagram-api.js';
import type { InstagramContext } from './instagram-ai.js';
import type { StoryInteraction, CommentInteraction, MediaContent } from '../types/social.js';

// Type definitions for session data
interface SessionData {
  cart?: Record<string, unknown>[];
  preferences?: Record<string, unknown>;
}

export function verifySignature(
  signature: string,
  rawBody: Buffer,
  appSecret: string
): void {
  const result = verifyHMACRaw(rawBody, signature, appSecret);
  if (!result.ok) {
    throw new Error(`Invalid signature: ${result.reason}`);
  }
}

export interface InstagramWebhookEvent {
  object: 'instagram';
  entry: InstagramWebhookEntry[];
}

export interface InstagramWebhookEntry {
  id: string; // Instagram Business Account ID
  time: number;
  messaging?: InstagramMessagingEvent[];
  comments?: InstagramCommentEvent[];
  mentions?: InstagramMentionEvent[];
}

export interface InstagramMessagingEvent {
  sender: {
    id: string;
  };
  recipient: {
    id: string;
  };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    attachments?: Array<{
      type: string;
      payload: {
        url: string;
      };
    }>;
  };
  postback?: {
    title: string;
    payload: string;
    mid: string;
  };
}

export interface InstagramCommentEvent {
  field: 'comments';
  value: {
    from: {
      id: string;
      username: string;
    };
    media: {
      id: string;
      media_product_type: string;
    };
    text: string;
    id: string;
    created_time: string;
  };
}

export interface InstagramMentionEvent {
  field: 'mentions';
  value: {
    from: {
      id: string;
      username: string;
    };
    media: {
      id: string;
      media_url?: string;
    };
    comment_id: string;
    created_time: string;
  };
}

export interface ProcessedWebhookResult {
  success: boolean;
  eventsProcessed: number;
  conversationsCreated: number;
  messagesProcessed: number;
  errors: string[];
}



interface Logger {
  info: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, error?: Error | unknown, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
}

export class InstagramWebhookHandler {
  private logger!: Logger;
  private db!: { getSQL: () => Sql };
  private repositories!: ReturnType<typeof getRepositories>;
  private messageWindowService!: ReturnType<typeof getMessageWindowService>;
  private aiOrchestrator!: ReturnType<typeof getConversationAIOrchestrator>;
  private storiesManager!: ReturnType<typeof getInstagramStoriesManager>;
  private commentsManager!: ReturnType<typeof getInstagramCommentsManager>;
  private mediaManager!: ReturnType<typeof getInstagramMediaManager>;

  constructor() {
    this.initializeLegacy();
  }



  private initializeLegacy(): void {
    this.logger = createLogger({ component: 'InstagramWebhook' });
    this.db = getDatabase();
    this.repositories = getRepositories();
    this.messageWindowService = getMessageWindowService();
    this.aiOrchestrator = getConversationAIOrchestrator();
    this.storiesManager = getInstagramStoriesManager();
    this.commentsManager = getInstagramCommentsManager();
    this.mediaManager = getInstagramMediaManager();
  }

  /**
   * Verify signature and process raw webhook payload
   */
  public async processRawWebhook(
    headers: Record<string, string | undefined>,
    rawBody: Buffer,
    merchantId: string,
    appSecret: string
  ): Promise<ProcessedWebhookResult> {
    const signature = headers['x-hub-signature-256'] ?? '';
    verifySignature(signature, rawBody, appSecret);
    let payload: InstagramWebhookEvent;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as InstagramWebhookEvent;
    } catch (error) {
      this.logger.error('Failed to parse Instagram webhook payload', error, { merchantId });
      return {
        success: false,
        eventsProcessed: 0,
        conversationsCreated: 0,
        messagesProcessed: 0,
        errors: ['Invalid JSON payload']
      };
    }
    return this.processWebhook(payload, merchantId);
  }

  /**
   * Process Instagram webhook payload
   */
  public async processWebhook(
    payload: InstagramWebhookEvent,
    merchantId: string
  ): Promise<ProcessedWebhookResult> {
    const result: ProcessedWebhookResult = {
      success: true,
      eventsProcessed: 0,
      conversationsCreated: 0,
      messagesProcessed: 0,
      errors: []
    };

    try {
      this.logger.info('📥 Processing Instagram webhook', { merchantId });
      const entryPromises = payload.entry.map(entry =>
        this.processWebhookEntry(entry, merchantId)
      );

      const settledResults = await Promise.allSettled(entryPromises);

      for (const settled of settledResults) {
        if (settled.status === 'fulfilled') {
          const entryResult = settled.value;
          result.eventsProcessed += entryResult.eventsProcessed;
          result.conversationsCreated += entryResult.conversationsCreated;
          result.messagesProcessed += entryResult.messagesProcessed;
          if (entryResult.errors.length > 0) {
            result.errors.push(...entryResult.errors);
          }
        } else {
          const error = settled.reason;
          const errorMsg = `Entry processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
          result.errors.push(errorMsg);
          this.logger.error(errorMsg);
        }
      }

      result.success = result.errors.length === 0;

      // Log webhook processing result
      await this.logWebhookProcessing(merchantId, payload, result);

      this.logger.info('✅ Webhook processed', {
        eventsProcessed: result.eventsProcessed,
        messagesProcessed: result.messagesProcessed
      });

      return result;
    } catch (error) {
      this.logger.error('Webhook processing failed', error, { merchantId });
      result.success = false;
      result.errors.push(error instanceof Error ? error.message : 'Unknown webhook error');
      return result;
    }
  }

  /**
   * Verify webhook challenge (for initial setup)
   */
  public verifyWebhookChallenge(
    mode: string,
    token: string,
    challenge: string,
    expectedVerifyToken: string
  ): string | null {
    if (mode === 'subscribe') {
      if (token.length !== expectedVerifyToken.length) {
        this.logger.error('Instagram webhook verification failed: token length mismatch');
        return null;
      }

      if (crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedVerifyToken))) {
        this.logger.info('Instagram webhook verification successful');
        return challenge;
      }
    }

    this.logger.error('Instagram webhook verification failed');
    return null;
  }

  /**
   * Private: Process single webhook entry
   */
  private async processWebhookEntry(
    entry: InstagramWebhookEntry,
    merchantId: string
  ): Promise<ProcessedWebhookResult> {
    const result: ProcessedWebhookResult = {
      success: true,
      eventsProcessed: 0,
      conversationsCreated: 0,
      messagesProcessed: 0,
      errors: []
    };

    // Process messaging events (DMs and story replies)
    if (entry.messaging) {
      const messagingPromises = entry.messaging.map(event =>
        this.processMessagingEvent(event, merchantId, result)
      );
      const settled = await Promise.allSettled(messagingPromises);
      for (const s of settled) {
        result.eventsProcessed++;
        if (s.status === 'fulfilled') {
          result.messagesProcessed += s.value;
        } else {
          const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
          result.errors.push(msg);
          this.logger.error('Messaging event failed', undefined, { error: msg, merchantId });
        }
      }
    }

    // Process comment events
    if (entry.comments) {
      const commentPromises = entry.comments.map(event =>
        this.processCommentEvent(event, merchantId)
      );
      const settled = await Promise.allSettled(commentPromises);
      for (const s of settled) {
        result.eventsProcessed++;
        if (s.status === 'fulfilled') {
          result.messagesProcessed += s.value;
        } else {
          const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
          result.errors.push(msg);
          this.logger.error('Comment event failed', undefined, { error: msg, merchantId });
        }
      }
    }

    // Process mention events (story mentions)
    if (entry.mentions) {
      const mentionPromises = entry.mentions.map(event =>
        this.processMentionEvent(event, merchantId)
      );
      const settled = await Promise.allSettled(mentionPromises);
      for (const s of settled) {
        result.eventsProcessed++;
        if (s.status === 'fulfilled') {
          result.messagesProcessed += s.value;
        } else {
          const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
          result.errors.push(msg);
          this.logger.error('Mention event failed', undefined, { error: msg, merchantId });
        }
      }
    }

    return result;
  }

  /**
   * Private: Process messaging event (DM or story reply)
   */
  private async processMessagingEvent(
    event: InstagramMessagingEvent,
    merchantId: string,
    result: ProcessedWebhookResult
  ): Promise<number> {
    const customerId: string | undefined = event.sender?.id;
    try {
      if (!customerId) {
        throw new Error('Missing sender ID in messaging event');
      }
      const timestamp = new Date(event.timestamp);

      // Check if this is a message or postback (story reply)
      const isMessage = !!event.message;
      const isPostback = !!event.postback;

      if (!isMessage && !isPostback) {
        this.logger.warn('Skipping unknown messaging event type');
        return 0;
      }

      // Find or create conversation
      const conversation = await this.findOrCreateConversation(
        merchantId,
        customerId,
        'instagram'
      );

      if (!conversation) {
        throw new Error('Failed to create conversation');
      }

      if (conversation.isNew) {
        // count conversation creation separately
        result.conversationsCreated++;
      }

      // Update message window (customer initiated contact)
      await this.messageWindowService.updateCustomerMessageTime(
        merchantId,
        { instagram: customerId, platform: 'instagram' },
        conversation.id
      );

      // Process the message content
      let messageContent = '';
      let messageType = 'TEXT';
      let mediaUrl: string | undefined;

      if (isMessage && event.message) {
        messageContent = event.message.text || '';
        
        // Handle attachments with Media Manager
        if (event.message.attachments && event.message.attachments.length > 0) {
          let processed = 0;
          for (const attachment of event.message.attachments) {
            const attachmentType = attachment.type.toUpperCase();
            const content = messageContent || `[${attachmentType}]`;

            // Process media with Media Manager
            processed += await this.processMediaAttachment(
              attachment,
              conversation.id,
              merchantId,
              customerId,
              content,
              timestamp
            );
          }

          return processed; // Early return as Media Manager handles the full flow
        }
      } else if (isPostback && event.postback) {
        messageContent = event.postback.title || event.postback.payload;
        messageType = 'STORY_REPLY';
        
        // Handle story reply with Stories Manager
        return await this.processStoryReply(event, merchantId);
      }

      // Store the message
      await this.storeIncomingMessage(
        conversation.id,
        messageContent,
        messageType,
        mediaUrl,
        event.message?.mid || event.postback?.mid,
        timestamp
      );

      result.messagesProcessed++;

      // Generate AI response for the message
      if (messageContent.trim()) {
        try {
          await this.generateAIResponse(
            conversation.id,
            merchantId,
            customerId,
            messageContent,
            messageType === 'STORY_REPLY' ? 'story_reply' : 'dm',
            event.message?.mid
          );
        } catch (aiError) {
          this.logger.error('❌ AI Response Failed - sending fallback', { 
            error: aiError instanceof Error ? aiError.message : String(aiError),
            conversationId: conversation.id,
            merchantId,
            customerId
          });
          
          // إرسال رسالة fallback فورية
          await this.sendImmediateFallback(conversation.id, merchantId, customerId, 'dm');
        }
      }

      this.logger.info('Instagram message processed', {
        customerId,
        preview: messageContent.substring(0, 50)
      });

      return 1;
    } catch (error) {
      this.logger.error('Messaging event processing failed', error, {
        merchantId,
        ...(customerId ? { customerId } : {})
      });
      throw error;
    }
  }

  /**
   * Private: Process comment event
   */
  private async processCommentEvent(
    event: InstagramCommentEvent,
    merchantId: string
  ): Promise<number> {
    let commentId: string | undefined;
    try {
      const customerId = event.value.from.id;
      const customerUsername = event.value.from.username;
      const commentText = event.value.text;
      const mediaId = event.value.media.id;
      commentId = event.value.id;
      const timestamp = new Date(event.value.created_time);

      this.logger.info('Instagram comment received', {
        customerUsername,
        commentText
      });

      // Create comment interaction for Comments Manager
      const commentInteraction: CommentInteraction = {
        id: commentId!,
        postId: mediaId,
        userId: customerId,
        username: customerUsername,
        content: commentText,
        timestamp: timestamp,
        isReply: false, // Top-level comment
        metadata: {
          postType: event.value.media.media_product_type as 'photo' | 'video' | 'reel' | 'carousel',
          isInfluencerComment: false, // Could be enhanced with user analysis
          hasHashtags: commentText.includes('#'),
          mentionsCount: (commentText.match(/@\w+/g) || []).length
        }
      };

      // Process with Comments Manager
      const commentResult = await this.commentsManager.processComment(
        commentInteraction,
        merchantId
      );

      if (commentResult.success) {
        this.logger.info('Comment processed with advanced Comments Manager', {
          actionTaken: commentResult.actionTaken
        });
        return 1;
      } else {
        this.logger.error('Comments Manager failed', commentResult.error, {
          merchantId,
          commentId
        });
        // Fallback to legacy processing if needed
        return await this.legacyProcessCommentEvent(event, merchantId);
      }

    } catch (error) {
      this.logger.error('Comment event processing failed', error, {
        merchantId,
        commentId
      });
      throw error;
    }
  }

  /**
   * Private: Process mention event (story mention)
   */
  private async processMentionEvent(
    event: InstagramMentionEvent,
    merchantId: string
  ): Promise<number> {
    try {
      const customerId = event.value.from.id;
      const customerUsername = event.value.from.username;
      const mediaId = event.value.media.id;
      const mediaUrl = event.value.media.media_url;
      const timestamp = new Date(event.value.created_time);

      this.logger.info('Instagram story mention received', {
        customerUsername,
        mediaId
      });

      // Create story interaction for Stories Manager
      const storyInteraction: StoryInteraction = {
        id: `mention_${event.value.comment_id}_${Date.now()}`,
        type: 'story_mention',
        storyId: mediaId,
        userId: customerId,
        username: customerUsername,
        ...(mediaUrl ? { mediaUrl } : {}),
        timestamp: timestamp,
        metadata: {
          isPrivate: false,
          storyType: 'photo' // Default, could be enhanced with media analysis
        }
      };

      // Process with Stories Manager
      const storyResult = await this.storiesManager.processStoryInteraction(
        storyInteraction,
        merchantId
      );

      if (storyResult.success) {
        this.logger.info('Story mention processed with advanced Stories Manager');
        return 1;
      } else {
        this.logger.error('Stories Manager failed', storyResult.error, {
          merchantId,
          mediaId
        });
        // Fallback to legacy processing if needed
        return await this.legacyProcessMentionEvent(event, merchantId);
      }

    } catch (error) {
      this.logger.error('Mention event processing failed', error, {
        merchantId,
        mediaId: event.value.media.id
      });
      throw error;
    }
  }

  /**
   * Private: Find existing conversation or create new one
   */
  private async findOrCreateConversation(
    merchantId: string,
    customerId: string,
    platform: 'instagram',
    username?: string
  ): Promise<{ id: string; isNew: boolean } | null> {
    try {
      const { conversation, isNew } = await this.repositories.conversation.create({
        merchantId,
        customerInstagram: customerId,
        platform,
        conversationStage: 'GREETING',
        sessionData: {
          cart: [],
          preferences: {},
          context: {},
          interaction_count: 1
        },
        ...(username ? { customerName: username } : {})
      });

      return { id: conversation.id, isNew };
    } catch (error) {
      this.logger.error('Failed to find/create conversation', error, {
        merchantId,
        customerId
      });
      return null;
    }
  }

  /**
   * Private: Store incoming message in database
   */
  private async storeIncomingMessage(
    conversationId: string,
    content: string,
    messageType: string,
    mediaUrl?: string,
    platformMessageId?: string,
    timestamp?: Date,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      // Store message using repository
      await this.repositories.message.create({
        conversationId,
        direction: 'INCOMING' as const,
        platform: 'instagram' as const,
        messageType,
        content,
        aiProcessed: false as const,
        deliveryStatus: 'DELIVERED' as const,
        ...(mediaUrl ? { mediaUrl } : {}),
        ...(platformMessageId ? { platformMessageId } : {}),
        ...(metadata ? { mediaMetadata: metadata } : {})
      });

      // Update conversation's last message time using repository
      await this.repositories.conversation.updateLastMessage(conversationId, timestamp);

    } catch (error) {
      this.logger.error('Failed to store incoming message', error, {
        conversationId,
        messageType
      });
      throw error;
    }
  }

  /**
   * Private: Detect if comment is a sales inquiry
   */
  private detectSalesInquiry(commentText: string): boolean {
    const salesKeywords = [
      'سعر', 'كم', 'متوفر', 'عندكم', 'أريد', 'اشتري', 'طلب',
      'price', 'how much', 'available', 'want', 'buy', 'order'
    ];

    const text = commentText.toLowerCase();
    return salesKeywords.some(keyword => text.includes(keyword));
  }

  /**
   * Private: Invite commenter to DM
   */
  private async inviteCommentToDM(
    merchantId: string,
    commentId: string,
    username: string
  ): Promise<boolean> {
    // DISABLED: Instagram Direct API calls removed - using ManyChat Bridge only
    this.logger.info('DM invitation skipped - Instagram Direct API disabled', { 
      merchantId, 
      commentId, 
      username 
    });
    return false;
  }

  /**
   * Private: Generate AI response for Instagram message/comment
   */
  private async generateAIResponse(
    conversationId: string,
    merchantId: string,
    customerId: string,
    messageContent: string,
    interactionType: 'dm' | 'comment' | 'story_reply' | 'story_mention',
    _messageId?: string,
    mediaContext?: { mediaId?: string; isPublic?: boolean }
  ): Promise<void> {
    try {
      this.logger.info('Generating Instagram AI response', { interactionType });

      // Initialize ManyChat Bridge
      const manyChatBridge = getInstagramManyChatBridge();
      
      // Prepare bridge data
      const bridgeData = {
        merchantId,
        customerId,
        message: messageContent,
        conversationId,
        interactionType,
        ...(mediaContext && mediaContext.mediaId ? {
          mediaContext: {
            mediaId: mediaContext.mediaId,
            mediaType: 'photo', // Default type
            caption: ''
          }
        } : {}),
        platform: 'instagram' as const
      };

      // Process through ManyChat Bridge with Local AI only (ManyChat disabled temporarily)
      const bridgeResult = await manyChatBridge.processMessage(bridgeData, {
        useManyChat: false, // Temporarily disable ManyChat API
        fallbackToLocalAI: true,
        priority: 'normal',
        tags: [`interaction_${interactionType}`, 'platform_instagram', 'local_ai_only']
      });

      if (bridgeResult.success) {
        this.logger.info('✅ Message processed through ManyChat Bridge', {
          platform: bridgeResult.platform,
          processingTime: bridgeResult.processingTime,
          messageId: bridgeResult.messageId
        });
        return; // Bridge handled everything
      } else {
        this.logger.warn('ManyChat Bridge failed, falling back to local AI', {
          error: bridgeResult.error,
          platform: bridgeResult.platform
        });
        // Continue with local AI processing below
      }

      // Get conversation context
      const sql = this.db.getSQL();
      const conversationData = await sql`
        SELECT 
          c.*,
          m.business_name,
          m.business_category
        FROM conversations c
        JOIN merchants m ON c.merchant_id = m.id
        WHERE c.id = ${conversationId}::uuid
      `;

      if (conversationData.length === 0) {
        throw new Error('Conversation not found');
      }

      const [conversation] = (conversationData as unknown as ConversationRow[]) ?? [];
      
      // Get recent conversation history  
      const messageHistory = await sql<DBMessageHistoryRow>`
        SELECT 
          CASE 
            WHEN direction = 'INCOMING' THEN 'user'
            ELSE 'assistant'
          END as role,
          content,
          created_at as timestamp
        FROM message_logs
        WHERE conversation_id = ${conversationId}::uuid
        ORDER BY created_at DESC
        LIMIT 10
      `;

      // Build Instagram context
      let session: Record<string, unknown> = {};
      try {
        if (conversation) {
          session = typeof conversation.session_data === 'string'
            ? JSON.parse(conversation.session_data)
            : conversation.session_data || {};
        }
      } catch (error) {
        this.logger.error('Failed to parse session data for conversation', error, { conversationId });
      }

      const instagramContext: InstagramContext = {
        merchantId,
        customerId,
        platform: 'instagram',
        stage: (conversation?.conversation_stage as ConversationStage) || 'GREETING',
        cart: (session.cart as SessionData['cart']) || [],
        preferences: (session.preferences as SessionData['preferences']) ?? {},
        conversationHistory: messageHistory.reverse().map((msg: DBMessageHistoryRow) => ({
          role: msg.role as 'user' | 'assistant' | 'system',
          content: msg.content,
          timestamp: new Date(msg.timestamp)
        })),
        interactionType,
        ...(mediaContext ? { mediaContext } : {}),
        merchantSettings: {
          businessName: String(conversation?.business_name ?? ''),
          businessCategory: String(conversation?.business_category ?? ''),
          workingHours: {},
          paymentMethods: [],
          deliveryFees: {},
          autoResponses: {}
        }
      };

      // Generate AI response using orchestrator
      const aiResult = await this.aiOrchestrator.generatePlatformResponse(
        messageContent,
        instagramContext,
        'instagram'
      );

      const aiResponse = aiResult.response;

      // Try ManyChat Bridge as fallback after local AI
      try {
        const manyChatFallback = getInstagramManyChatBridge();
        const fallbackResult = await manyChatFallback.processMessage({
          merchantId,
          customerId,
          message: aiResponse.message,
          conversationId,
          interactionType,
          platform: 'instagram'
        }, {
          useManyChat: false, // Temporarily disable ManyChat API
          fallbackToLocalAI: false, // Already have local AI response
          priority: 'normal',
          tags: ['local_ai_fallback', `interaction_${interactionType}`]
        });

        if (fallbackResult.success) {
          this.logger.info('✅ Local AI response sent through ManyChat Bridge', {
            platform: fallbackResult.platform,
            processingTime: fallbackResult.processingTime
          });
          return; // Bridge handled the sending
        } else {
          this.logger.error('❌ ManyChat Bridge failed completely - no fallback available', {
            error: fallbackResult.error,
            conversationId,
            customerId
          });
          return; // No fallback to direct Instagram API
        }
      } catch (bridgeError) {
        this.logger.error('❌ ManyChat Bridge error in fallback - message not sent', {
          error: bridgeError instanceof Error ? bridgeError.message : String(bridgeError),
          conversationId,
          customerId
        });
        return; // No fallback to direct Instagram API
      }

      // Update conversation stage if changed and valid
      const validStages = ['GREETING', 'PRODUCT_INQUIRY', 'ORDER_PROCESSING', 'PAYMENT', 'SUPPORT', 
                          'COMPLETED', 'ABANDONED', 'ESCALATED', 'FOLLOW_UP', 'CLOSING',
                          'AI_RESPONSE', 'WAITING_RESPONSE', 'PROCESSING', 'PENDING', 'ACTIVE'];
      
      if (conversation && aiResponse.stage && aiResponse.stage !== conversation?.conversation_stage && validStages.includes(aiResponse.stage)) {
        await sql`
          UPDATE conversations
          SET conversation_stage = ${aiResponse.stage}
          WHERE id = ${conversationId}::uuid
        `;
      }

      this.logger.info('AI response generated', {
        interactionType,
        message: aiResponse.message
      });
      
      // Log Instagram-specific AI features (if available)
      const instagramAIResponse = aiResponse as any;
      if (instagramAIResponse.hashtagSuggestions) {
        this.logger.info('Hashtag suggestions', {
          suggestions: instagramAIResponse.hashtagSuggestions
        });
      }

      if (instagramAIResponse.engagement) {
        this.logger.info('Engagement prediction', {
          viralPotential: instagramAIResponse.engagement.viralPotential
        });
      }

    } catch (error) {
      this.logger.error('AI response generation failed', error, {
        conversationId,
        merchantId,
        customerId
      });
      
      // Store fallback response
      try {
        const sql = this.db.getSQL();
        const fallbackMessage = interactionType === 'comment' 
          ? 'شكراً للتعليق! راسلنا خاص للمزيد 📱💕'
          : 'اهلاً وسهلاً! كيف أقدر أساعدك؟ 😊';

        await sql`
          INSERT INTO message_logs (
            conversation_id,
            direction,
            platform,
            message_type,
            content,
            platform_message_id,
            ai_processed,
            delivery_status,
            ai_confidence
          ) VALUES (
            ${conversationId}::uuid,
            'OUTGOING',
            'instagram',
            'TEXT',
            ${fallbackMessage},
            ${'ai_fallback_' + Date.now()},
            false,
            'PENDING',
            0.1
          )
        `;

        this.logger.info('Fallback response sent', { fallbackMessage });
      } catch (fallbackError) {
        this.logger.error('Fallback response failed', fallbackError, { conversationId });
      }
    }
  }

  /**
   * Private: Log webhook processing for audit
   */
  private async logWebhookProcessing(
    merchantId: string,
    payload: InstagramWebhookEvent,
    result: ProcessedWebhookResult
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();

      await sql`
        INSERT INTO audit_logs (
          merchant_id,
          action,
          entity_type,
          details,
          success,
          error_message
        ) VALUES (
          ${merchantId}::uuid,
          'INSTAGRAM_WEBHOOK_PROCESSED',
          'WEBHOOK_EVENT',
          ${JSON.stringify({
            entriesCount: payload.entry.length,
            eventsProcessed: result.eventsProcessed,
            messagesProcessed: result.messagesProcessed,
            conversationsCreated: result.conversationsCreated,
            hasErrors: result.errors.length > 0
          })},
          ${result.success},
          ${result.errors.length > 0 ? result.errors.join('; ') : null}
        )
      `;
    } catch (error) {
      this.logger.error('Failed to log webhook processing', error, { merchantId });
    }
  }

  /**
   * Private: Process story reply with advanced Stories Manager
   */
  private async processStoryReply(
    event: InstagramMessagingEvent,
    merchantId: string
  ): Promise<number> {
    let customerId: string | undefined;
    try {
      customerId = event.sender.id;
      const timestamp = new Date(event.timestamp);
      const content = event.postback?.title || event.postback?.payload || '';

      this.logger.info('Instagram story reply received', { customerId, content });

      // Create story interaction for Stories Manager
      const storyInteraction: StoryInteraction = {
        id: `reply_${event.postback?.mid}_${Date.now()}`,
        type: 'story_reply',
        storyId: event.postback?.payload || 'unknown_story',
        userId: customerId,
        content: content,
        timestamp: timestamp,
        metadata: {
          isPrivate: true,
          storyType: 'photo' // Could be enhanced with media detection
        }
      };

      // Process with Stories Manager
      const storyResult = await this.storiesManager.processStoryInteraction(
        storyInteraction,
        merchantId
      );

      if (storyResult.success) {
        if (storyResult.responseGenerated) {
          this.logger.info('Story reply processed with AI response generated');
        }
        return 1;
      } else {
        this.logger.error('Stories Manager failed for story reply', storyResult.error, {
          merchantId,
          customerId
        });
        throw new Error(`Story reply processing failed: ${storyResult.error}`);
      }

    } catch (error) {
      this.logger.error('Story reply processing failed', error, { merchantId, customerId: event.sender.id });
      throw error;
    }
  }

  /**
   * Private: Legacy mention event processing (fallback)
   */
  private async legacyProcessMentionEvent(
    event: InstagramMentionEvent,
    merchantId: string
  ): Promise<number> {
    try {
      const customerId = event.value.from.id;
      const customerUsername = event.value.from.username;
      const mediaId = event.value.media.id;
      const mediaUrl = event.value.media.media_url;
      const timestamp = new Date(event.value.created_time);

      this.logger.info('Using legacy processing for story mention', { customerUsername });

      // Find or create conversation
      const conversation = await this.findOrCreateConversation(
        merchantId,
        customerId,
        'instagram',
        customerUsername
      );

      if (!conversation) {
        throw new Error('Failed to create conversation');
      }

      // Store the mention as a message
      await this.storeIncomingMessage(
        conversation.id,
        `تم ذكرنا في ستوري @${customerUsername}`,
        'STORY_MENTION',
        mediaUrl,
        event.value.comment_id,
        timestamp,
        { mediaId, isStoryMention: true }
      );

      return 1;

    } catch (error) {
      this.logger.error('Legacy mention event processing failed', error, {
        merchantId,
        customerId: event.value.from.id
      });
      throw error;
    }
  }

  /**
   * Private: Legacy comment event processing (fallback)
   */
  private async legacyProcessCommentEvent(
    event: InstagramCommentEvent,
    merchantId: string
  ): Promise<number> {
    let commentId: string | undefined;
    try {
      const customerId = event.value.from.id;
      const customerUsername = event.value.from.username;
      const commentText = event.value.text;
      const mediaId = event.value.media.id;
      commentId = event.value.id;
      const timestamp = new Date(event.value.created_time);

      this.logger.info('Using legacy processing for comment', {
        customerUsername,
        commentText
      });

      // Find or create conversation
      const conversation = await this.findOrCreateConversation(
        merchantId,
        customerId,
        'instagram',
        customerUsername
      );

      if (!conversation) {
        throw new Error('Failed to create conversation');
      }

      // Store the comment as a message
      await this.storeIncomingMessage(
        conversation.id,
        commentText,
        'COMMENT',
        undefined,
        commentId!,
        timestamp,
        { mediaId, isPublic: true }
      );

      // Generate AI response for the comment
      await this.generateAIResponse(
        conversation.id,
        merchantId,
        customerId,
        commentText,
        'comment',
        commentId,
        { mediaId, isPublic: true }
      );

      // Check if this comment looks like a sales inquiry
      const isSalesInquiry = this.detectSalesInquiry(commentText);
      
      if (isSalesInquiry) {
        // Auto-invite to DM for private conversation
        await this.inviteCommentToDM(merchantId, commentId, customerUsername);
      }

      return 1;

    } catch (error) {
      this.logger.error('Legacy comment event processing failed', error, {
        merchantId,
        commentId,
        customerId: event.value.from.id
      });
      throw error;
    }
  }

  /**
   * Private: Process media attachment with Media Manager
   */
  private async processMediaAttachment(
    attachment: { type: string; payload: { url: string } },
    conversationId: string,
    merchantId: string,
    userId: string,
    textContent: string,
    timestamp: Date
  ): Promise<number> {
    try {
      this.logger.info('Processing media attachment', { type: attachment.type });

      // Create media content object
      const mediaContent: MediaContent = {
        id: `media_${Date.now()}_${crypto.randomUUID()}`,
        type: this.mapInstagramMediaType(attachment.type),
        url: attachment.payload.url,
        ...(textContent ? { caption: textContent } : {}),
        uploadStatus: 'uploaded',
        createdAt: timestamp
      };

      // Process with Media Manager
      const mediaResult = await this.mediaManager.processIncomingMedia(
        mediaContent,
        conversationId,
        merchantId,
        userId,
        textContent
      );

      if (mediaResult.success) {
        this.logger.info('Media attachment processed successfully');
        if (mediaResult.analysis?.isProductInquiry) {
          this.logger.info('Product inquiry detected from media attachment');
        }
        return 1;
      } else {
        this.logger.error('Media Manager failed', mediaResult.error, {
          merchantId,
          conversationId
        });
        // Fallback to legacy processing
        await this.legacyProcessMediaAttachment(attachment, conversationId, textContent);
        return 1;
      }

    } catch (error) {
      this.logger.error('Media attachment processing failed', error, {
        merchantId,
        conversationId
      });
      throw error;
    }
  }

  /**
   * Private: Map Instagram media type to our media type
   */
  private mapInstagramMediaType(instagramType: string): 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'gif' {
    const typeMapping: Record<string, 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'gif'> = {
      'image': 'image',
      'photo': 'image',
      'video': 'video',
      'audio': 'audio',
      'file': 'document',
      'document': 'document',
      'sticker': 'sticker',
      'gif': 'image'
    };

    return typeMapping[instagramType.toLowerCase()] || 'document';
  }



  /**
   * Private: Legacy media attachment processing (fallback)
   */
  private async legacyProcessMediaAttachment(
    attachment: { type: string; payload: { url: string } },
    conversationId: string,
    textContent: string
  ): Promise<void> {
    try {
      this.logger.info('Using legacy processing for media attachment', {
        type: attachment.type
      });

      const sql = this.db.getSQL();

      // Store as basic message log
      await sql`
        INSERT INTO message_logs (
          conversation_id,
          direction,
          platform,
          message_type,
          content,
          media_url,
          ai_processed,
          delivery_status
        ) VALUES (
          ${conversationId}::uuid,
          'INCOMING',
          'instagram',
          'MEDIA',
          ${textContent || `[${attachment.type.toUpperCase()}]`},
          ${attachment.payload.url},
          false,
          'DELIVERED'
        )
      `;

      this.logger.info('Legacy media processing completed');
    } catch (error) {
      this.logger.error('Legacy media processing failed', error, { conversationId });
    }
  }

  private async sendImmediateFallback(
    conversationId: string,
    merchantId: string,
    customerId: string,
    interactionType: 'dm' | 'comment' | 'story_reply' | 'story_mention'
  ): Promise<void> {
    const fallbackMessage = interactionType === 'dm' 
      ? 'عذراً للانتظار! راح أرد عليك خلال دقائق ⏰'
      : 'شكراً لتفاعلك! راح نرد عليك قريباً 🙏';
      
    try {
      // Try ManyChat Bridge first for immediate fallback
      const manyChatBridge = getInstagramManyChatBridge();
      const bridgeResult = await manyChatBridge.processMessage({
        merchantId,
        customerId,
        message: fallbackMessage,
        conversationId,
        interactionType,
        platform: 'instagram'
      }, {
        useManyChat: false, // Temporarily disable ManyChat API
        fallbackToLocalAI: true, // Use local AI for fallback message
        priority: 'high', // Fallback messages are high priority
        tags: ['immediate_fallback', `interaction_${interactionType}`]
      });

      if (bridgeResult.success) {
        this.logger.info('✅ Fallback message sent through ManyChat Bridge', { conversationId, customerId });
        return;
      } else {
        this.logger.error('❌ ManyChat Bridge failed for fallback - no message sent', {
          error: bridgeResult.error,
          conversationId,
          customerId
        });
        return; // No fallback to direct Instagram API
      }
    } catch (fallbackError) {
      this.logger.error('❌ Even fallback failed', fallbackError);
    }
  }

}

// Singleton instance
let webhookHandlerInstance: InstagramWebhookHandler | null = null;

/**
 * Get Instagram webhook handler instance
 */
export async function getInstagramWebhookHandler(): Promise<InstagramWebhookHandler> {
  if (!webhookHandlerInstance) {
    webhookHandlerInstance = new InstagramWebhookHandler();
  }
  return webhookHandlerInstance;
}

export default InstagramWebhookHandler;