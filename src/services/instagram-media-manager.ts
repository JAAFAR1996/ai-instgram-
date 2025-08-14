/**
 * ===============================================
 * Instagram Media Manager
 * Advanced media handling for Instagram conversations
 * ===============================================
 */

import { getInstagramClient } from './instagram-api';
import { getDatabase } from '@/database/connection';
import { getConversationAIOrchestrator } from './conversation-ai-orchestrator';
import type { InstagramContext } from './instagram-ai';

export interface MediaContent {
  id: string;
  type: 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'gif';
  url: string;
  thumbnailUrl?: string;
  caption?: string;
  metadata?: {
    duration?: number; // for video/audio
    fileSize?: number;
    dimensions?: { width: number; height: number };
    format?: string;
    originalFileName?: string;
    aiAnalysis?: {
      description?: string;
      objects?: string[];
      colors?: string[];
      text?: string; // OCR extracted text
      sentiment?: 'positive' | 'neutral' | 'negative';
      isProductImage?: boolean;
      suggestedTags?: string[];
    };
  };
  uploadStatus: 'pending' | 'uploading' | 'uploaded' | 'failed';
  createdAt: Date;
}

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
  private db = getDatabase();
  private aiOrchestrator = getConversationAIOrchestrator();

  /**
   * Process incoming media message
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
      console.log(`📸 Processing incoming ${media.type}: ${media.id}`);

      // Store media in database
      await this.storeMedia(media, conversationId, 'incoming', userId, merchantId);

      // Analyze media content
      const analysis = await this.analyzeMedia(media, textContent, merchantId);

      // Store analysis results
      await this.storeMediaAnalysis(media.id, analysis, merchantId);

      // Generate AI response based on media analysis
      const responseGenerated = await this.generateMediaResponse(
        media,
        analysis,
        conversationId,
        merchantId,
        userId,
        textContent
      );

      // Update media analytics
      await this.updateMediaAnalytics(merchantId, media.type, analysis);

      // Check for product inquiry
      if (analysis.isProductInquiry) {
        await this.handleProductInquiry(media, analysis, conversationId, merchantId);
      }

      console.log(`✅ Media processed: ${media.type} (confidence: ${analysis.confidence}%)`);

      return {
        success: true,
        analysis,
        responseGenerated
      };
    } catch (error) {
      console.error('❌ Media processing failed:', error);
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
    mediaType: 'image' | 'video' | 'gif',
    templateId?: string,
    customText?: string,
    merchantId?: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      if (!merchantId) {
        throw new Error('Merchant ID required for media message');
      }

      let mediaUrl: string;
      let caption: string;

      if (templateId) {
        // Use media template
        const template = await this.getMediaTemplate(templateId, merchantId);
        if (!template) {
          throw new Error('Media template not found');
        }

        mediaUrl = template.templateUrl;
        caption = customText || this.generateTemplateCaption(template);
        
        // Increment usage count
        await this.incrementTemplateUsage(templateId);
      } else {
        throw new Error('Either template ID or media URL required');
      }

      // Send via Instagram API
      const instagramClient = getInstagramClient();
      await instagramClient.initialize(merchantId);

      const result = await instagramClient.sendImageMessage(recipientId, mediaUrl, caption);

      if (result.success) {
        console.log(`✅ Media message sent: ${mediaType} to ${recipientId}`);
        return {
          success: true,
          messageId: result.messageId
        };
      } else {
        return {
          success: false,
          error: result.error?.message || 'Failed to send media'
        };
      }
    } catch (error) {
      console.error('❌ Send media message failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Analyze media content using AI
   */
  public async analyzeMedia(
    media: MediaContent,
    textContent?: string,
    merchantId?: string
  ): Promise<MediaAnalysisResult> {
    try {
      // Basic analysis based on type and context
      let analysis: MediaAnalysisResult = {
        description: '',
        isProductInquiry: false,
        suggestedResponse: {
          type: 'text',
          content: 'شكراً لإرسال الصورة! 📸 كيف أقدر أساعدك؟'
        },
        confidence: 50,
        detectedObjects: [],
        marketingValue: 'medium'
      };

      // Enhanced analysis based on media type
      switch (media.type) {
        case 'image':
          analysis = await this.analyzeImage(media, textContent);
          break;
        case 'video':
          analysis = await this.analyzeVideo(media, textContent);
          break;
        case 'document':
          analysis = await this.analyzeDocument(media, textContent);
          break;
        default:
          analysis.description = `Received ${media.type} content`;
      }

      // Check for product inquiry patterns
      if (textContent) {
        const productKeywords = [
          'سعر', 'price', 'كم', 'how much', 'متوفر', 'available',
          'أريد نفس', 'want same', 'مثل هذا', 'like this'
        ];
        
        const text = textContent.toLowerCase();
        analysis.isProductInquiry = productKeywords.some(keyword => text.includes(keyword));
      }

      // Enhance response based on analysis
      if (analysis.isProductInquiry) {
        analysis.suggestedResponse = {
          type: 'product_catalog',
          content: 'شايف حاجة عجبتك؟ 😍 ده كتالوج منتجاتنا مع الأسعار ✨',
          productIds: ['featured'] // Could be enhanced with product matching
        };
        analysis.confidence = Math.min(analysis.confidence + 30, 95);
      }

      return analysis;
    } catch (error) {
      console.error('❌ Media analysis failed:', error);
      // Return basic fallback analysis
      return {
        description: `Received ${media.type} content`,
        isProductInquiry: false,
        suggestedResponse: {
          type: 'text',
          content: 'شكراً لإرسال الملف! 📎 كيف أقدر أساعدك؟'
        },
        confidence: 30,
        detectedObjects: [],
        marketingValue: 'low'
      };
    }
  }

  /**
   * Create media template for reusable content
   */
  public async createMediaTemplate(
    merchantId: string,
    template: Omit<MediaTemplate, 'id' | 'usageCount'>
  ): Promise<string> {
    try {
      const sql = this.db.getSQL();

      const result = await sql`
        INSERT INTO media_templates (
          merchant_id,
          name,
          category,
          media_type,
          template_url,
          overlay_elements,
          is_active,
          created_at
        ) VALUES (
          ${merchantId}::uuid,
          ${template.name},
          ${template.category},
          ${template.mediaType},
          ${template.templateUrl},
          ${JSON.stringify(template.overlayElements)},
          ${template.isActive},
          NOW()
        )
        RETURNING id
      `;

      const templateId = result[0].id;
      console.log(`✅ Media template created: ${template.name} (${templateId})`);
      return templateId;
    } catch (error) {
      console.error('❌ Media template creation failed:', error);
      throw error;
    }
  }

  /**
   * Get media analytics for merchant
   */
  public async getMediaAnalytics(
    merchantId: string,
    dateRange?: { from: Date; to: Date }
  ): Promise<{
    totalMediaMessages: number;
    mediaBreakdown: { [key: string]: number };
    mediaResponseRate: number;
    productInquiries: number;
    averageEngagement: number;
    topMediaTemplates: Array<{
      name: string;
      usageCount: number;
      category: string;
    }>;
  }> {
    try {
      const sql = this.db.getSQL();

      const dateFilter = dateRange 
        ? sql`AND created_at BETWEEN ${dateRange.from} AND ${dateRange.to}`
        : sql`AND created_at >= NOW() - INTERVAL '30 days'`;

      // Get media message stats
      const mediaStats = await sql`
        SELECT 
          COUNT(*) as total_media,
          COUNT(CASE WHEN direction = 'outgoing' THEN 1 END) as responses,
          mm.media_type,
          COUNT(*) as type_count
        FROM media_messages mm
        WHERE mm.merchant_id = ${merchantId}::uuid
        ${dateFilter}
        GROUP BY mm.media_type
      `;

      // Get product inquiry stats
      const inquiryStats = await sql`
        SELECT COUNT(*) as product_inquiries
        FROM media_analysis ma
        JOIN media_messages mm ON ma.media_id = mm.media_id
        WHERE mm.merchant_id = ${merchantId}::uuid
        AND ma.is_product_inquiry = true
        ${dateFilter}
      `;

      // Get template usage
      const templateStats = await sql`
        SELECT name, usage_count, category
        FROM media_templates
        WHERE merchant_id = ${merchantId}::uuid
        AND is_active = true
        ORDER BY usage_count DESC
        LIMIT 5
      `;

      const totalMedia = mediaStats.reduce((sum, stat) => sum + Number(stat.type_count), 0);
      const totalResponses = mediaStats.reduce((sum, stat) => sum + Number(stat.responses || 0), 0);

      return {
        totalMediaMessages: totalMedia,
        mediaBreakdown: mediaStats.reduce((acc, stat) => {
          acc[stat.media_type] = Number(stat.type_count);
          return acc;
        }, {} as any),
        mediaResponseRate: totalMedia > 0 ? (totalResponses / totalMedia) * 100 : 0,
        productInquiries: Number(inquiryStats[0]?.product_inquiries || 0),
        averageEngagement: 75, // Could be calculated from detailed engagement metrics
        topMediaTemplates: templateStats.map(template => ({
          name: template.name,
          usageCount: Number(template.usage_count),
          category: template.category
        }))
      };
    } catch (error) {
      console.error('❌ Media analytics failed:', error);
      throw error;
    }
  }

  /**
   * Private: Analyze image content
   */
  private async analyzeImage(media: MediaContent, textContent?: string): Promise<MediaAnalysisResult> {
    // Enhanced image analysis could use AI vision APIs here
    const analysis: MediaAnalysisResult = {
      description: 'Image received - product or general inquiry',
      isProductInquiry: false,
      suggestedResponse: {
        type: 'text',
        content: 'صورة حلوة! 📸 عايزة معلومات أكتر عن إيه؟'
      },
      confidence: 60,
      detectedObjects: ['image_content'],
      marketingValue: 'medium'
    };

    // Check if image looks like product inquiry
    if (textContent) {
      const productPatterns = [
        'عايزة زي دي', 'أريد مثل هذه', 'want like this',
        'متوفر', 'available', 'سعر', 'price'
      ];
      
      const hasProductPattern = productPatterns.some(pattern => 
        textContent.toLowerCase().includes(pattern)
      );
      
      if (hasProductPattern) {
        analysis.isProductInquiry = true;
        analysis.suggestedResponse = {
          type: 'product_catalog',
          content: 'شفت حاجة عجبتك في الصورة؟ 😍 تعالي أوريكي المنتجات المشابهة!',
          productIds: ['similar']
        };
        analysis.confidence = 80;
        analysis.marketingValue = 'high';
      }
    }

    return analysis;
  }

  /**
   * Private: Analyze video content
   */
  private async analyzeVideo(media: MediaContent, textContent?: string): Promise<MediaAnalysisResult> {
    return {
      description: 'Video content received',
      isProductInquiry: textContent?.toLowerCase().includes('سعر') || false,
      suggestedResponse: {
        type: 'text',
        content: 'شفت الفيديو! 🎥 إيه رأيك نتكلم عن المنتجات؟'
      },
      confidence: 55,
      detectedObjects: ['video_content'],
      marketingValue: 'high' // Videos typically have high engagement
    };
  }

  /**
   * Private: Analyze document content
   */
  private async analyzeDocument(media: MediaContent, textContent?: string): Promise<MediaAnalysisResult> {
    return {
      description: 'Document or file received',
      isProductInquiry: false,
      suggestedResponse: {
        type: 'text',
        content: 'وصل الملف! 📄 كيف أقدر أساعدك؟'
      },
      confidence: 40,
      detectedObjects: ['document'],
      marketingValue: 'low'
    };
  }

  /**
   * Private: Generate AI response to media
   */
  private async generateMediaResponse(
    media: MediaContent,
    analysis: MediaAnalysisResult,
    conversationId: string,
    merchantId: string,
    userId: string,
    textContent?: string
  ): Promise<boolean> {
    try {
      // Build context for AI response
      const context = await this.buildMediaContext(conversationId, merchantId, userId, media);

      let prompt = '';
      if (analysis.isProductInquiry) {
        prompt = `العميل أرسل ${media.type} ${textContent ? `مع النص: "${textContent}"` : ''}.
        التحليل يشير أنه استفسار عن منتج. اكتب رد مشجع ومفيد للعميل.`;
      } else {
        prompt = `العميل أرسل ${media.type} ${textContent ? `مع النص: "${textContent}"` : ''}.
        اكتب رد ودود ومناسب للمحتوى.`;
      }

      const aiResult = await this.aiOrchestrator.generatePlatformResponse(
        prompt,
        context,
        'INSTAGRAM'
      );

      // Send response via Instagram API
      const instagramClient = getInstagramClient();
      await instagramClient.initialize(merchantId);

      let responseContent = aiResult.response.message;

      // Enhance response based on analysis
      if (analysis.suggestedResponse.type === 'product_catalog') {
        responseContent = analysis.suggestedResponse.content;
      }

      const sendResult = await instagramClient.sendMessage({
        recipientId: userId,
        messageType: 'text',
        content: responseContent
      });

      if (sendResult.success) {
        // Store the response
        await this.storeMediaResponse(conversationId, responseContent, sendResult.messageId, merchantId);
        console.log(`✅ Media response sent: ${responseContent.substring(0, 50)}...`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('❌ Generate media response failed:', error);
      return false;
    }
  }

  /**
   * Private: Store media in database
   */
  private async storeMedia(
    media: MediaContent,
    conversationId: string,
    direction: 'incoming' | 'outgoing',
    userId: string,
    merchantId: string
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();

      await sql`
        INSERT INTO media_messages (
          media_id,
          conversation_id,
          merchant_id,
          direction,
          media_type,
          media_url,
          thumbnail_url,
          caption,
          metadata,
          upload_status,
          user_id,
          created_at
        ) VALUES (
          ${media.id},
          ${conversationId}::uuid,
          ${merchantId}::uuid,
          ${direction},
          ${media.type},
          ${media.url},
          ${media.thumbnailUrl || null},
          ${media.caption || null},
          ${media.metadata ? JSON.stringify(media.metadata) : null},
          ${media.uploadStatus},
          ${userId},
          NOW()
        )
        ON CONFLICT (media_id) DO UPDATE SET
          upload_status = EXCLUDED.upload_status,
          updated_at = NOW()
      `;
    } catch (error) {
      console.error('❌ Store media failed:', error);
      throw error;
    }
  }

  /**
   * Private: Store media analysis
   */
  private async storeMediaAnalysis(
    mediaId: string,
    analysis: MediaAnalysisResult,
    merchantId: string
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();

      await sql`
        INSERT INTO media_analysis (
          media_id,
          merchant_id,
          description,
          is_product_inquiry,
          suggested_response,
          confidence,
          extracted_text,
          detected_objects,
          marketing_value,
          analysis_data,
          created_at
        ) VALUES (
          ${mediaId},
          ${merchantId}::uuid,
          ${analysis.description},
          ${analysis.isProductInquiry},
          ${JSON.stringify(analysis.suggestedResponse)},
          ${analysis.confidence},
          ${analysis.extractedText || null},
          ${JSON.stringify(analysis.detectedObjects)},
          ${analysis.marketingValue},
          ${JSON.stringify(analysis)},
          NOW()
        )
        ON CONFLICT (media_id) DO UPDATE SET
          description = EXCLUDED.description,
          confidence = EXCLUDED.confidence,
          updated_at = NOW()
      `;
    } catch (error) {
      console.error('❌ Store media analysis failed:', error);
    }
  }

  /**
   * Private: Build media context for AI
   */
  private async buildMediaContext(
    conversationId: string,
    merchantId: string,
    userId: string,
    media: MediaContent
  ): Promise<InstagramContext> {
    try {
      const sql = this.db.getSQL();

      const data = await sql`
        SELECT 
          c.*,
          m.business_name,
          m.business_category
        FROM conversations c
        JOIN merchants m ON c.merchant_id = m.id
        WHERE c.id = ${conversationId}::uuid
      `;

      const conversation = data[0];

      return {
        merchantId,
        customerId: userId,
        platform: 'INSTAGRAM',
        stage: conversation.conversation_stage,
        cart: JSON.parse(conversation.session_data || '{}').cart || [],
        preferences: JSON.parse(conversation.session_data || '{}').preferences || {},
        conversationHistory: [],
        interactionType: 'media',
        mediaContext: {
          mediaType: media.type,
          mediaUrl: media.url,
          hasMedia: true
        },
        merchantSettings: {
          businessName: conversation.business_name,
          businessCategory: conversation.business_category,
          workingHours: {},
          paymentMethods: [],
          deliveryFees: {},
          autoResponses: {}
        }
      };
    } catch (error) {
      console.error('❌ Build media context failed:', error);
      throw error;
    }
  }

  /**
   * Private: Store media response
   */
  private async storeMediaResponse(
    conversationId: string,
    content: string,
    messageId?: string,
    merchantId?: string
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();

      await sql`
        INSERT INTO message_logs (
          conversation_id,
          direction,
          platform,
          message_type,
          content,
          platform_message_id,
          ai_processed,
          delivery_status
        ) VALUES (
          ${conversationId}::uuid,
          'OUTGOING',
          'INSTAGRAM',
          'MEDIA_RESPONSE',
          ${content},
          ${messageId || null},
          true,
          'SENT'
        )
      `;
    } catch (error) {
      console.error('❌ Store media response failed:', error);
    }
  }

  /**
   * Private: Get media template
   */
  private async getMediaTemplate(templateId: string, merchantId: string): Promise<MediaTemplate | null> {
    try {
      const sql = this.db.getSQL();

      const templates = await sql`
        SELECT *
        FROM media_templates
        WHERE id = ${templateId}::uuid
        AND merchant_id = ${merchantId}::uuid
        AND is_active = true
      `;

      if (templates.length === 0) {
        return null;
      }

      const template = templates[0];
      return {
        id: template.id,
        name: template.name,
        category: template.category,
        mediaType: template.media_type,
        templateUrl: template.template_url,
        overlayElements: JSON.parse(template.overlay_elements || '{}'),
        usageCount: template.usage_count,
        isActive: template.is_active
      };
    } catch (error) {
      console.error('❌ Get media template failed:', error);
      return null;
    }
  }

  /**
   * Private: Generate template caption
   */
  private generateTemplateCaption(template: MediaTemplate): string {
    const captions = {
      product: 'شوفي منتجاتنا الجديدة! 🛍️✨',
      promo: 'عرض خاص لفترة محدودة! 🔥💥',
      greeting: 'أهلاً وسهلاً! مرحباً بكِ في متجرنا 🌹',
      thanks: 'شكراً لثقتك فينا! 💕🙏',
      story: 'شاركونا رأيكم! 📸💬'
    };

    return captions[template.category] || 'محتوى جديد من متجرنا! ✨';
  }

  /**
   * Private: Increment template usage
   */
  private async incrementTemplateUsage(templateId: string): Promise<void> {
    try {
      const sql = this.db.getSQL();

      await sql`
        UPDATE media_templates
        SET 
          usage_count = usage_count + 1,
          updated_at = NOW()
        WHERE id = ${templateId}::uuid
      `;
    } catch (error) {
      console.error('❌ Increment template usage failed:', error);
    }
  }

  /**
   * Private: Update media analytics
   */
  private async updateMediaAnalytics(
    merchantId: string,
    mediaType: string,
    analysis: MediaAnalysisResult
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();

      await sql`
        INSERT INTO daily_analytics (
          merchant_id,
          date,
          platform,
          media_messages_received,
          product_inquiries_from_media
        ) VALUES (
          ${merchantId}::uuid,
          CURRENT_DATE,
          'INSTAGRAM',
          1,
          ${analysis.isProductInquiry ? 1 : 0}
        )
        ON CONFLICT (merchant_id, date, platform)
        DO UPDATE SET
          media_messages_received = daily_analytics.media_messages_received + 1,
          product_inquiries_from_media = daily_analytics.product_inquiries_from_media + ${analysis.isProductInquiry ? 1 : 0},
          updated_at = NOW()
      `;
    } catch (error) {
      console.error('❌ Update media analytics failed:', error);
    }
  }

  /**
   * Private: Handle product inquiry from media
   */
  private async handleProductInquiry(
    media: MediaContent,
    analysis: MediaAnalysisResult,
    conversationId: string,
    merchantId: string
  ): Promise<void> {
    try {
      // Tag as product inquiry opportunity
      const sql = this.db.getSQL();

      await sql`
        INSERT INTO sales_opportunities (
          merchant_id,
          customer_id,
          source_platform,
          opportunity_type,
          status,
          metadata,
          created_at
        ) VALUES (
          ${merchantId}::uuid,
          (SELECT customer_instagram FROM conversations WHERE id = ${conversationId}::uuid),
          'INSTAGRAM',
          'MEDIA_INQUIRY',
          'NEW',
          ${JSON.stringify({ 
            mediaId: media.id,
            mediaType: media.type,
            mediaUrl: media.url,
            analysisConfidence: analysis.confidence,
            source: 'media_inquiry'
          })},
          NOW()
        )
        ON CONFLICT (merchant_id, customer_id, source_platform)
        DO UPDATE SET
          status = 'ACTIVE',
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `;

      console.log(`💰 Product inquiry detected from ${media.type} - sales opportunity created`);
    } catch (error) {
      console.error('❌ Handle product inquiry failed:', error);
    }
  }
}

// Singleton instance
let mediaManagerInstance: InstagramMediaManager | null = null;

/**
 * Get Instagram Media Manager instance
 */
export function getInstagramMediaManager(): InstagramMediaManager {
  if (!mediaManagerInstance) {
    mediaManagerInstance = new InstagramMediaManager();
  }
  return mediaManagerInstance;
}

export default InstagramMediaManager;