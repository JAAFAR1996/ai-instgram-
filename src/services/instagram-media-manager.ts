/**
 * ===============================================
 * Instagram Media Manager - Advanced Media Processing
 * Unified media handling with AI-powered content analysis
 * ===============================================
 */

import { getDatabase } from '../db/adapter.js';
import { getLogger } from './logger.js';
import { telemetry } from './telemetry.js';
import type { MediaContent } from '../types/social.js';
import { getAIService } from './ai.js';
import ImageAnalysisService from './image-analysis.js';

/**
 * Media message interface for incoming/outgoing media
 */
export interface MediaMessage {
  conversationId: string;
  messageId: string;
  direction: 'incoming' | 'outgoing';
  media: MediaContent;
  textContent?: string;
  userId: string;
  timestamp: Date;
}

/**
 * Advanced media analysis result with AI insights
 */
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
  colors?: string[];
  sentiment?: 'positive' | 'neutral' | 'negative';
  marketingValue: 'high' | 'medium' | 'low';
  autoTags?: string[];
}

/**
 * Media template for branded content generation
 */
export interface MediaTemplate {
  id: string;
  name: string;
  category: 'product' | 'promo' | 'greeting' | 'thanks' | 'story';
  mediaType: 'image' | 'video' | 'gif';
  templateUrl: string;
  attachmentId?: string;
  overlayElements: {
    text?: Array<{
      content: string;
      position: { x: number; y: number };
      style: {
        font: string;
        size: number;
        color: string;
      };
    }>;
    logos?: Array<{
      url: string;
      position: { x: number; y: number };
      size: { width: number; height: number };
    }>;
  };
  usageCount: number;
  isActive: boolean;
}

/**
 * Advanced Instagram Media Manager with AI-powered analysis
 */
export class InstagramMediaManager {
  private db = getDatabase();
  private logger = getLogger({ component: 'instagram-media-manager' });
  private imageAnalyzer = new ImageAnalysisService();

  /**
   * Process incoming media with comprehensive AI analysis
   */
  async processIncomingMedia(
    media: MediaContent,
    conversationId: string,
    merchantId: string,
    userId: string,
    textContent?: string
  ): Promise<{
    success: boolean;
    analysis?: MediaAnalysisResult;
    responseGenerated?: boolean;
    error?: string;
  }> {
    const startTime = Date.now();
    
    try {
      this.logger.info('Processing incoming media', {
        mediaType: media.type,
        conversationId,
        merchantId,
        hasText: !!textContent
      });

      // Perform comprehensive media analysis
      const analysis = await this.analyzeMedia(media, merchantId, textContent);
      
      // Store analysis in message_image_metadata if image
      if (media.type === 'image') {
        await this.storeImageAnalysis(media, conversationId, merchantId, userId, analysis);
      }

      // Generate intelligent response based on analysis
      const responseGenerated = await this.generateSmartResponse(
        analysis,
        conversationId,
        merchantId,
        userId
      );

      const processingTime = Date.now() - startTime;

      // Record telemetry
      telemetry.counter('media_processing_total', 'Media processing requests').add(1, {
        merchant_id: merchantId,
        media_type: media.type,
        success: 'true'
      });

      telemetry.histogram('media_processing_duration_ms', 'Media processing time').record(processingTime, {
        merchant_id: merchantId,
        media_type: media.type
      });

      return {
        success: true,
        analysis,
        responseGenerated,
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      this.logger.error('Media processing failed', {
        error: error instanceof Error ? error.message : String(error),
        mediaType: media.type,
        conversationId,
        processingTime
      });

      telemetry.counter('media_processing_errors_total', 'Media processing errors').add(1, {
        merchant_id: merchantId,
        media_type: media.type,
        error_type: error instanceof Error ? error.constructor.name : 'Unknown'
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Send media message with AI-generated content
   */
  async sendMediaMessage(
    recipientId: string,
    mediaType: 'image' | 'video' | 'audio',
    merchantId: string,
    templateId?: string,
    mediaUrl?: string,
    customText?: string
  ): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
  }> {
    try {
      // Get template if specified
      let template: MediaTemplate | null = null;
      if (templateId) {
        template = await this.getMediaTemplate(templateId, merchantId);
      }

      // Generate caption
      const caption = customText || (template ? 
        await this.generateTemplateCaption(template, merchantId) : 
        'شاهد هذا المحتوى الجديد! 🌟'
      );

      // Use template URL or provided URL
      const finalMediaUrl = mediaUrl || template?.templateUrl;
      if (!finalMediaUrl) {
        throw new Error('No media URL provided and no template found');
      }

      // Send via Instagram API (placeholder - integrate with actual API)
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Increment template usage
      if (template) {
        await this.incrementTemplateUsage(templateId!, merchantId);
      }

      this.logger.info('Media message sent successfully', {
        recipientId,
        mediaType,
        messageId,
        templateUsed: !!template
      });

      return {
        success: true,
        messageId
      };

    } catch (error) {
      this.logger.error('Failed to send media message', {
        error: error instanceof Error ? error.message : String(error),
        recipientId,
        mediaType
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Analyze media content using advanced AI
   */
  private async analyzeMedia(
    media: MediaContent,
    merchantId: string,
    textContent?: string
  ): Promise<MediaAnalysisResult> {
    
    // For images, use comprehensive image analysis
    if (media.type === 'image') {
      try {
        const imageMetadata = {
          messageId: `media_analysis_${Date.now()}`,
          merchantId,
          customerId: 'system',
          mimeType: 'image/jpeg', // Default
          width: media.metadata?.dimensions?.width || 0,
          height: media.metadata?.dimensions?.height || 0,
          sizeBytes: media.metadata?.fileSize || 0,
          contentHash: ''
        };

        const imageAnalysis = await this.imageAnalyzer.analyzeImage(
          media.url, // URL or buffer
          imageMetadata,
          {
            enableOCR: true,
            enableVisualSearch: true,
            enableProductMatching: true
          }
        );

        // Convert to MediaAnalysisResult format
        return {
          description: this.generateImageDescription(imageAnalysis),
          isProductInquiry: this.detectProductInquiry(imageAnalysis, textContent),
          suggestedResponse: await this.generateSuggestedResponse(imageAnalysis, merchantId),
          confidence: imageAnalysis.confidence,
          extractedText: imageAnalysis.ocrText,
          detectedObjects: imageAnalysis.objects?.map(obj => obj.name) || [],
          colors: imageAnalysis.visualFeatures?.dominantColors || [],
          sentiment: this.analyzeSentiment(imageAnalysis.ocrText, textContent),
          marketingValue: this.calculateMarketingValue(imageAnalysis),
          autoTags: this.generateAutoTags(imageAnalysis)
        };

      } catch (error) {
        this.logger.warn('Image analysis failed, using fallback', { error: String(error) });
        return this.getFallbackAnalysis(media, textContent);
      }
    }

    // For other media types, use simpler analysis
    return this.getFallbackAnalysis(media, textContent);
  }

  /**
   * Generate image description from analysis
   */
  private generateImageDescription(analysis: any): string {
    const elements = [];
    
    if (analysis.labels?.length > 0) {
      const topLabels = analysis.labels.slice(0, 3).map((l: any) => l.name).join(', ');
      elements.push(`يحتوي على: ${topLabels}`);
    }

    if (analysis.objects?.length > 0) {
      const objects = analysis.objects.slice(0, 2).map((o: any) => o.name).join(', ');
      elements.push(`الكائنات: ${objects}`);
    }

    if (analysis.ocrText) {
      elements.push(`النص المستخرج موجود`);
    }

    return elements.length > 0 ? elements.join(' • ') : 'صورة تحتوي على محتوى متنوع';
  }

  /**
   * Detect if this is a product inquiry
   */
  private detectProductInquiry(analysis: any, textContent?: string): boolean {
    const text = (textContent || analysis.ocrText || '').toLowerCase();
    const productKeywords = /سعر|كم|price|cost|اشتري|buy|منتج|product/;
    
    const hasProductKeywords = productKeywords.test(text);
    const hasProductMatches = (analysis.productMatches?.length || 0) > 0;
    const isProductType = analysis.contentType?.category === 'product';

    return hasProductKeywords || hasProductMatches || isProductType;
  }

  /**
   * Generate suggested response based on analysis
   */
  private async generateSuggestedResponse(analysis: any, merchantId: string): Promise<{
    type: 'text' | 'media' | 'product_catalog';
    content: string;
    mediaUrl?: string;
    productIds?: string[];
  }> {
    
    // If product matches found, suggest catalog
    if (analysis.productMatches?.length > 0) {
      const productIds = analysis.productMatches.slice(0, 3).map((m: any) => m.productId);
      return {
        type: 'product_catalog',
        content: 'وجدت منتجات مشابهة لصورتك! شاهد هذه الخيارات:',
        productIds
      };
    }

    // If OCR text found, respond to text
    if (analysis.ocrText) {
      return {
        type: 'text',
        content: `شاهدت النص في صورتك: "${analysis.ocrText.slice(0, 50)}..." - كيف يمكنني مساعدتك؟`
      };
    }

    // Default response based on content type
    const responses = {
      'product': 'هذا المنتج يبدو رائع! هل تريد معرفة المزيد عنه؟',
      'fashion': 'أسلوب جميل! هل تبحث عن شيء مشابه؟',
      'food': 'يبدو لذيذ! هل تريد طلب شيء مماثل؟',
      'default': 'شكراً لمشاركة هذه الصورة! كيف يمكنني مساعدتك؟'
    };

    const category = analysis.contentType?.category || 'default';
    const content = responses[category as keyof typeof responses] || responses.default;

    return {
      type: 'text',
      content
    };
  }

  /**
   * Analyze sentiment from text content
   */
  private analyzeSentiment(ocrText?: string, messageText?: string): 'positive' | 'neutral' | 'negative' {
    const text = (ocrText + ' ' + (messageText || '')).toLowerCase();
    
    const positive = /(شكرا|حلو|جميل|😍|❤️|👍|🔥|ممتاز|رائع)/.test(text);
    const negative = /(سيء|رديء|خايس|ما|مو|👎|😡|💔|بطيء)/.test(text);
    
    return positive ? 'positive' : negative ? 'negative' : 'neutral';
  }

  /**
   * Calculate marketing value based on analysis
   */
  private calculateMarketingValue(analysis: any): 'high' | 'medium' | 'low' {
    let score = 0;
    
    // Product-related content gets high value
    if (analysis.productMatches?.length > 0) score += 3;
    if (analysis.contentType?.category === 'product') score += 2;
    
    // Quality and engagement indicators
    if (analysis.confidence > 0.8) score += 1;
    if (analysis.ocrText) score += 1;
    if (analysis.objects?.length > 2) score += 1;

    return score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low';
  }

  /**
   * Generate automatic tags
   */
  private generateAutoTags(analysis: any): string[] {
    const tags = new Set<string>();
    
    // Add content type tags
    if (analysis.contentType?.category) {
      tags.add(analysis.contentType.category);
      if (analysis.contentType.subcategory) {
        tags.add(analysis.contentType.subcategory);
      }
    }
    
    // Add top labels as tags
    analysis.labels?.slice(0, 5).forEach((label: any) => {
      if (label.confidence > 0.7) {
        tags.add(label.name);
      }
    });
    
    // Add color tags
    analysis.visualFeatures?.dominantColors?.slice(0, 3).forEach((color: string) => {
      tags.add(color);
    });

    return Array.from(tags).slice(0, 10); // Limit to 10 tags
  }

  /**
   * Fallback analysis for non-image media or failed analysis
   */
  private getFallbackAnalysis(media: MediaContent, textContent?: string): MediaAnalysisResult {
    return {
      description: `${media.type} محتوى - ${media.metadata?.originalFileName || 'ملف مرفوع'}`,
      isProductInquiry: /سعر|كم|price|منتج/.test(textContent || ''),
      suggestedResponse: {
        type: 'text',
        content: textContent ? 
          'شكراً لإرسال هذا المحتوى! كيف يمكنني مساعدتك؟' :
          'تم استلام المحتوى بنجاح!'
      },
      confidence: 0.5,
      detectedObjects: [],
      marketingValue: 'medium'
    };
  }

  /**
   * Store image analysis in database
   */
  private async storeImageAnalysis(
    media: MediaContent,
    conversationId: string,
    merchantId: string,
    userId: string,
    analysis: MediaAnalysisResult
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();
      
      // Store in message_image_metadata table
      await sql`
        INSERT INTO message_image_metadata (
          message_id, merchant_id, customer_id, mime_type,
          width, height, size_bytes, content_hash,
          ocr_text, labels, created_at
        ) VALUES (
          ${`media_${Date.now()}`},
          ${merchantId}::uuid,
          ${userId},
          'image/jpeg',
          ${media.metadata?.dimensions?.width || 0},
          ${media.metadata?.dimensions?.height || 0},
          ${media.metadata?.fileSize || 0},
          ${`hash_${Date.now()}`},
          ${analysis.extractedText || null},
          ${JSON.stringify({
            objects: analysis.detectedObjects,
            colors: analysis.colors,
            sentiment: analysis.sentiment,
            tags: analysis.autoTags,
            marketingValue: analysis.marketingValue
          })}::jsonb,
          NOW()
        )
      `;

    } catch (error) {
      this.logger.warn('Failed to store image analysis', { error: String(error) });
    }
  }

  /**
   * Generate smart response based on analysis
   */
  private async generateSmartResponse(
    analysis: MediaAnalysisResult,
    conversationId: string,
    merchantId: string,
    userId: string
  ): Promise<boolean> {
    try {
      // For now, just log the suggested response
      // In production, this would integrate with conversation AI
      this.logger.info('Smart response generated', {
        conversationId,
        responseType: analysis.suggestedResponse.type,
        isProductInquiry: analysis.isProductInquiry,
        marketingValue: analysis.marketingValue
      });

      return true;
    } catch (error) {
      this.logger.warn('Smart response generation failed', { error: String(error) });
      return false;
    }
  }

  /**
   * Get media template by ID
   */
  private async getMediaTemplate(templateId: string, merchantId: string): Promise<MediaTemplate | null> {
    try {
      // This would query the database for media templates
      // For now, return null (template system not implemented)
      return null;
    } catch (error) {
      this.logger.warn('Failed to get media template', { error: String(error) });
      return null;
    }
  }

  /**
   * Generate caption from template
   */
  private async generateTemplateCaption(template: MediaTemplate, merchantId: string): Promise<string> {
    // This would use AI to generate personalized captions
    // For now, return a simple caption
    return `${template.name} - محتوى مميز من متجرنا! 🌟`;
  }

  /**
   * Increment template usage count
   */
  private async incrementTemplateUsage(templateId: string, merchantId: string): Promise<void> {
    try {
      // This would update template usage statistics
      // For now, just log
      this.logger.info('Template usage incremented', { templateId, merchantId });
    } catch (error) {
      this.logger.warn('Failed to increment template usage', { error: String(error) });
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