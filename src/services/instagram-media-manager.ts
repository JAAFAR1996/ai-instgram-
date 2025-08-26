/**
 * ===============================================
 * Instagram Media Manager - Unified Implementation
 * Advanced media handling for Instagram conversations
 * ===============================================
 */

import { getInstagramMessageSender } from './instagram-message-sender.js';
import { createLogger } from './logger.js';
import type { MediaContent } from '../types/social.js';

export interface MediaMessage {
  conversationId: string;
  messageId: string;
  direction: 'incoming' | 'outgoing';
  media: MediaContent;
  textContent?: string;
  userId: string;
  timestamp: Date;
}

export interface MediaAnalysisResult {
  description: string;
  isProductInquiry: boolean;
  suggestedResponse: {
    type: 'text' | 'media' | 'product_catalog';
    content: string;
    mediaUrl?: string;
    productIds?: string[];
  };
  confidence: number;
  extractedText?: string;
  detectedObjects: string[];
  marketingValue: 'high' | 'medium' | 'low';
}

export interface MediaTemplate {
  id: string;
  name: string;
  category: 'product' | 'promo' | 'greeting' | 'thanks' | 'story';
  mediaType: 'image' | 'video' | 'gif';
  templateUrl: string;
  attachmentId?: string;
  overlayElements: {
    text?: {
      content: string;
      position: { x: number; y: number };
      style: { font: string; size: number; color: string };
    }[];
    logos?: {
      url: string;
      position: { x: number; y: number };
      size: { width: number; height: number };
    }[];
  };
  usageCount: number;
  isActive: boolean;
}

export class InstagramMediaManager {
  private logger = createLogger({ component: 'InstagramMediaManager' });
  private messageSender = getInstagramMessageSender();

  /**
   * Process incoming media and generate AI response
   */
  public async processIncomingMedia(
    media: MediaContent,
    conversationId: string,
    merchantId: string,
    userId: string,
    textContent?: string
  ): Promise<{
    success: boolean;
    analysis?: MediaAnalysisResult;
    responseGenerated?: boolean;
    error?: string
  }> {
    try {
      this.logger.info('Processing incoming media', {
        mediaId: media.id,
        mediaType: media.type,
        conversationId,
        merchantId
      });

      // Analyze media using AI
      const analysis = await this.analyzeMedia(media, textContent);

      // Send response if analysis suggests it
      let responseGenerated = false;
      if (analysis.confidence > 0.7) {
        const result = await this.messageSender.sendTextMessage(
          merchantId,
          userId,
          analysis.suggestedResponse.content,
          conversationId
        );
        responseGenerated = result.success;
      }

      return {
        success: true,
        analysis,
        responseGenerated
      };

    } catch (error) {
      this.logger.error('Media processing failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Send media message with AI-generated content
   */
  public async sendMediaMessage(
    recipientId: string,
    mediaType: 'image' | 'video' | 'audio',
    merchantId: string,
    templateId?: string,
    mediaUrl?: string,
    customText?: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      if (!merchantId) {
        throw new Error('Merchant ID required for media message');
      }

      let finalMediaUrl: string;
      let caption: string;

      if (templateId) {
        // Use media template
        const template = await this.getMediaTemplate(templateId);
        if (!template) {
          throw new Error('Media template not found');
        }

        finalMediaUrl = template.templateUrl;
        caption = customText || this.generateTemplateCaption(template);

        // Increment usage count
        await this.incrementTemplateUsage(templateId);
      } else if (mediaUrl) {
        finalMediaUrl = mediaUrl;
        caption = customText || '';
      } else {
        throw new Error('Either template ID or media URL required');
      }

      // Send via unified Instagram Message Sender
      const result = await this.messageSender.sendMediaMessage(
        merchantId,
        recipientId,
        finalMediaUrl,
        mediaType,
        caption
      );

      if (result.success) {
        this.logger.info('Media message sent', { mediaType, recipientId });
        return {
          success: true,
          ...(result.messageId ? { messageId: result.messageId } : {})
        };
      } else {
        return {
          success: false,
          error: result.error || 'Failed to send media'
        };
      }
    } catch (error) {
      this.logger.error('Send media message failed', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Analyze media content using AI
   */
  private async analyzeMedia(media: MediaContent, textContent?: string): Promise<MediaAnalysisResult> {
    try {
      // Simplified AI analysis - in real implementation, you'd use actual AI service
      const analysis: MediaAnalysisResult = {
        description: `Media content of type ${media.type}`,
        isProductInquiry: textContent?.toLowerCase().includes('product') || false,
        suggestedResponse: {
          type: 'text',
          content: 'شكراً لك على مشاركة هذا المحتوى! كيف يمكنني مساعدتك؟'
        },
        confidence: 0.8,
        detectedObjects: [],
        marketingValue: 'medium'
      };

      return analysis;
    } catch (error) {
      this.logger.error('Media analysis failed', error);
      throw error;
    }
  }

  /**
   * Get media template (simplified implementation)
   */
  private async getMediaTemplate(templateId: string): Promise<MediaTemplate | null> {
    // Simplified implementation - in real scenario, fetch from database
    const templates: Record<string, MediaTemplate> = {
      'greeting-template': {
        id: 'greeting-template',
        name: 'Greeting Template',
        category: 'greeting',
        mediaType: 'image',
        templateUrl: 'https://example.com/greeting.jpg',
        overlayElements: {
          text: [{
            content: 'مرحباً بك!',
            position: { x: 50, y: 50 },
            style: { font: 'Arial', size: 24, color: '#000000' }
          }]
        },
        usageCount: 0,
        isActive: true
      }
    };

    return templates[templateId] || null;
  }

  /**
   * Generate caption from template
   */
  private generateTemplateCaption(template: MediaTemplate): string {
    const textElements = template.overlayElements.text || [];
    return textElements.map(element => element.content).join(' ');
  }

  /**
   * Increment template usage count
   */
  private async incrementTemplateUsage(templateId: string): Promise<void> {
    try {
      // Simplified implementation - in real scenario, update database
      this.logger.info('Template usage incremented', { templateId });
    } catch (error) {
      this.logger.error('Failed to increment template usage', error);
    }
  }
}

// Singleton instance
let mediaManagerInstance: InstagramMediaManager | null = null;

/**
 * Get Instagram media manager instance
 */
export function getInstagramMediaManager(): InstagramMediaManager {
  if (!mediaManagerInstance) {
    mediaManagerInstance = new InstagramMediaManager();
  }
  return mediaManagerInstance;
}

export default InstagramMediaManager;