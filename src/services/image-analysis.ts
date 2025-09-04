/**
 * ===============================================
 * Image Analysis Service - Comprehensive Visual Content Processing
 * OCR, Object Detection, Content Labeling, Visual Search
 * ===============================================
 */

import { getDatabase } from '../db/adapter.js';
import { getLogger } from './logger.js';
import { telemetry } from './telemetry.js';
import OpenAI from 'openai';
import { getEnv } from '../config/env.js';
import crypto from 'crypto';

// Types for image analysis
export interface ImageMetadata {
  messageId: string;
  merchantId: string;
  customerId: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  contentHash: string;
  url?: string;
}

export interface ImageAnalysisResult {
  ocrText?: string;
  labels: ImageLabel[];
  objects: DetectedObject[];
  contentType: ContentType;
  visualFeatures: VisualFeatures;
  productMatches?: ProductMatch[];
  confidence: number;
  processingTimeMs: number;
}

export interface ImageLabel {
  name: string;
  confidence: number;
  category: 'product' | 'text' | 'scene' | 'emotion' | 'quality' | 'brand';
}

export interface DetectedObject {
  name: string;
  confidence: number;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface VisualFeatures {
  isProduct: boolean;
  isText: boolean;
  isScreenshot: boolean;
  isPhoto: boolean;
  dominantColors: string[];
  qualityScore: number; // 0-1
  sharpness: number; // 0-1
}

export interface ContentType {
  category: 'product' | 'catalog' | 'text' | 'receipt' | 'general' | 'meme' | 'unknown';
  subcategory?: string;
  confidence: number;
}

export interface ProductMatch {
  productId: string;
  sku: string;
  name: string;
  similarity: number;
  matchType: 'visual' | 'text' | 'combined';
}

export interface CachedImageAnalysis extends ImageAnalysisResult {
  contentHash: string;
  createdAt: Date;
  lastUsedAt: Date;
  usageCount: number;
}

export class ImageAnalysisService {
  private db = getDatabase();
  private logger = getLogger({ component: 'image-analysis' });
  private openai: OpenAI;
  
  constructor() {
    this.openai = new OpenAI({
      apiKey: getEnv('OPENAI_API_KEY'),
    });
  }

  /**
   * Main entry point: Analyze image content comprehensively
   */
  async analyzeImage(
    imageData: Buffer | string, 
    metadata: ImageMetadata,
    options: {
      enableOCR?: boolean;
      enableVisualSearch?: boolean;
      enableProductMatching?: boolean;
      forceReprocess?: boolean;
    } = {}
  ): Promise<ImageAnalysisResult> {
    const startTime = Date.now();
    
    try {
      // Record analysis request
      telemetry.counter('image_analysis_requests_total', 'Image analysis requests').add(1, {
        merchant_id: metadata.merchantId,
        content_type: metadata.mimeType,
        enable_ocr: String(options.enableOCR !== false),
        enable_visual_search: String(options.enableVisualSearch === true),
        enable_product_matching: String(options.enableProductMatching === true)
      });

      // Generate content hash for caching
      const contentHash = this.generateContentHash(imageData, metadata);
      metadata.contentHash = contentHash;

      // Check cache unless force reprocessing
      if (!options.forceReprocess) {
        const cachedResult = await this.getCachedAnalysis(contentHash);
        if (cachedResult) {
          await this.updateCacheUsage(contentHash);
          
          telemetry.counter('image_analysis_cache_hits_total', 'Image analysis cache hits').add(1, {
            merchant_id: metadata.merchantId
          });
          
          return cachedResult;
        }
      }

      // Perform comprehensive analysis
      const analysis = await this.performAnalysis(imageData, metadata, options);
      
      // Cache the result
      await this.cacheAnalysisResult(contentHash, analysis);
      
      // Store metadata in database
      await this.storeImageMetadata(metadata, analysis);
      
      const processingTime = Date.now() - startTime;
      analysis.processingTimeMs = processingTime;
      
      // Record success metrics
      telemetry.histogram('image_analysis_processing_time_ms', 'Image analysis processing time', 'ms').record(processingTime, {
        merchant_id: metadata.merchantId,
        content_type: analysis.contentType.category,
        confidence_range: analysis.confidence >= 0.8 ? 'high' : analysis.confidence >= 0.5 ? 'medium' : 'low',
        has_ocr: String(Boolean(analysis.ocrText)),
        objects_detected: String(analysis.objects.length)
      });
      
      telemetry.counter('image_analysis_completed_total', 'Completed image analyses').add(1, {
        merchant_id: metadata.merchantId,
        content_type: analysis.contentType.category,
        success: 'true'
      });
      
      this.logger.info('Image analysis completed', {
        contentHash,
        merchantId: metadata.merchantId,
        contentType: analysis.contentType.category,
        confidence: analysis.confidence,
        ocrLength: analysis.ocrText?.length || 0,
        objectsDetected: analysis.objects.length,
        processingTime
      });
      
      return analysis;
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      telemetry.counter('image_analysis_errors_total', 'Image analysis errors').add(1, {
        merchant_id: metadata.merchantId,
        error_type: error instanceof Error ? error.constructor.name : 'Unknown'
      });
      
      telemetry.histogram('image_analysis_processing_time_ms', 'Image analysis processing time', 'ms').record(processingTime, {
        merchant_id: metadata.merchantId,
        success: 'false'
      });
      
      this.logger.error('Image analysis failed', {
        merchantId: metadata.merchantId,
        error: error instanceof Error ? error.message : String(error),
        processingTime
      });
      
      throw error;
    }
  }

  /**
   * Core analysis logic using OpenAI Vision API
   */
  private async performAnalysis(
    imageData: Buffer | string, 
    metadata: ImageMetadata,
    options: {
      enableOCR?: boolean;
      enableVisualSearch?: boolean;
      enableProductMatching?: boolean;
      forceReprocess?: boolean;
    }
  ): Promise<ImageAnalysisResult> {
    
    const imageBase64 = Buffer.isBuffer(imageData) 
      ? imageData.toString('base64')
      : Buffer.from(imageData).toString('base64');
    
    // OpenAI Vision API analysis
    const visionAnalysis = await this.analyzeWithOpenAIVision(imageBase64, metadata, options);
    
    // Visual features detection
    const visualFeatures = await this.extractVisualFeatures(imageBase64, metadata);
    
    // Product matching if enabled
    let productMatches: ProductMatch[] = [];
    if (options.enableProductMatching) {
      productMatches = await this.findProductMatches(visionAnalysis, metadata.merchantId);
    }
    
    return {
      labels: visionAnalysis.labels ?? [],
      objects: visionAnalysis.objects ?? [],
      contentType: visionAnalysis.contentType ?? { category: 'unknown', confidence: 0.1 },
      confidence: visionAnalysis.confidence ?? 0.5,
      visualFeatures,
      productMatches,
      processingTimeMs: 0 // Will be set by caller
    };
  }

  /**
   * OpenAI Vision API analysis
   */
  private async analyzeWithOpenAIVision(
    imageBase64: string,
    metadata: ImageMetadata,
    options: {
      enableOCR?: boolean;
      enableVisualSearch?: boolean;
      enableProductMatching?: boolean;
    }
  ): Promise<Partial<ImageAnalysisResult>> {
    
    const systemPrompt = `You are an expert image analyst for an e-commerce platform. Analyze the image and provide detailed insights in JSON format.

Focus on:
1. OCR: Extract any readable text (Arabic and English)
2. Objects: Identify products, items, or important objects
3. Labels: Categorize content (product, scene, emotion, quality, brand)
4. Content type: Classify the overall image type
5. Quality assessment: Rate image quality and sharpness

Response must be valid JSON with this exact structure:
{
  "ocrText": "extracted text here",
  "labels": [{"name": "label", "confidence": 0.95, "category": "product"}],
  "objects": [{"name": "object", "confidence": 0.9}],
  "contentType": {"category": "product", "subcategory": "clothing", "confidence": 0.85},
  "confidence": 0.9
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: getEnv('OPENAI_VISION_MODEL', { defaultValue: 'gpt-4o-mini' }),
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: options.enableOCR !== false 
                  ? "Analyze this image comprehensively including OCR text extraction."
                  : "Analyze this image focusing on visual content (skip text extraction)."
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${metadata.mimeType};base64,${imageBase64}`,
                  detail: "high"
                }
              }
            ]
          }
        ],
        max_tokens: 1000,
        temperature: 0.1
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No analysis content received from OpenAI');
      }

      // Parse JSON response
      const analysisData = JSON.parse(content);
      
      // Validate and sanitize the response
      return {
        ocrText: analysisData.ocrText ?? undefined,
        labels: Array.isArray(analysisData.labels) ? analysisData.labels : [],
        objects: Array.isArray(analysisData.objects) ? analysisData.objects : [],
        contentType: analysisData.contentType || { category: 'unknown', confidence: 0.1 },
        confidence: Math.max(0, Math.min(1, analysisData.confidence || 0.5))
      };
      
    } catch (error) {
      this.logger.warn('OpenAI Vision analysis failed', {
        error: error instanceof Error ? error.message : String(error),
        merchantId: metadata.merchantId
      });
      
      // Return minimal fallback analysis
      return {
        labels: [],
        objects: [],
        contentType: { category: 'unknown', confidence: 0.1 },
        confidence: 0.1
      };
    }
  }

  /**
   * Extract technical visual features
   */
  private async extractVisualFeatures(
    imageBase64: string,
    metadata: ImageMetadata
  ): Promise<VisualFeatures> {
    
    // For now, derive features from metadata and basic analysis
    // In the future, this could use specialized computer vision libraries
    
    const isPhoto = metadata.mimeType.includes('jpeg') || metadata.mimeType.includes('jpg');
    const isLargeImage = metadata.width > 800 || metadata.height > 600;
    const aspectRatio = metadata.width / metadata.height;
    
    return {
      isProduct: false, // Will be updated based on content analysis
      isText: false,    // Will be updated based on OCR results
      isScreenshot: aspectRatio > 0.4 && aspectRatio < 2.5 && !isPhoto,
      isPhoto: isPhoto,
      dominantColors: [], // Would need color analysis library
      qualityScore: isLargeImage ? 0.8 : 0.6, // Basic quality scoring
      sharpness: 0.7 // Would need image processing library
    };
  }

  /**
   * Find matching products in merchant catalog
   */
  private async findProductMatches(
    analysis: Partial<ImageAnalysisResult>,
    merchantId: string
  ): Promise<ProductMatch[]> {
    
    if (!analysis.ocrText && (!analysis.labels || analysis.labels.length === 0)) {
      return [];
    }
    
    try {
      const sql = this.db.getSQL();
      
      // Search by text content and labels
      const searchTerms = [
        analysis.ocrText ?? '',
        ...(analysis.labels ?? []).map(l => l.name)
      ].filter(term => term.length > 2);
      
      if (searchTerms.length === 0) return [];
      
      const searchQuery = searchTerms.join(' | ');
      
      const products = await sql<{
        id: string;
        sku: string;
        name_ar: string;
        similarity: number;
      }>`
        SELECT 
          p.id,
          p.sku,
          p.name_ar,
          ts_rank(
            to_tsvector('arabic', p.name_ar || ' ' || p.description_ar || ' ' || p.sku),
            plainto_tsquery('arabic', ${searchQuery})
          ) as similarity
        FROM products p
        WHERE p.merchant_id = ${merchantId}::uuid
          AND (
            to_tsvector('arabic', p.name_ar || ' ' || p.description_ar || ' ' || p.sku) @@ 
            plainto_tsquery('arabic', ${searchQuery})
          )
        ORDER BY similarity DESC
        LIMIT 5
      `;
      
      return products.map(p => ({
        productId: p.id,
        sku: p.sku,
        name: p.name_ar,
        similarity: Number(p.similarity),
        matchType: analysis.ocrText ? 'text' : 'visual' as const
      }));
      
    } catch (error) {
      this.logger.warn('Product matching failed', {
        error: error instanceof Error ? error.message : String(error),
        merchantId
      });
      return [];
    }
  }

  /**
   * Generate content hash for deduplication
   */
  private generateContentHash(imageData: Buffer | string, metadata: ImageMetadata): string {
    const imageBuffer = Buffer.isBuffer(imageData) ? imageData : Buffer.from(imageData);
    const metadataString = `${metadata.width}x${metadata.height}-${metadata.sizeBytes}`;
    
    return crypto
      .createHash('sha256')
      .update(imageBuffer)
      .update(metadataString)
      .digest('hex')
      .substring(0, 16); // Use first 16 characters for efficiency
  }

  /**
   * Check for cached analysis result
   */
  private async getCachedAnalysis(contentHash: string): Promise<ImageAnalysisResult | null> {
    try {
      const sql = this.db.getSQL();
      
      const cached = await sql<{
        analysis_data: unknown;
        created_at: string;
        usage_count: number;
      }>`
        SELECT analysis_data, created_at, usage_count
        FROM image_analysis_cache
        WHERE content_hash = ${contentHash}
          AND created_at > NOW() - INTERVAL '7 days'
        LIMIT 1
      `;
      
      if (cached.length === 0) return null;
      const first = cached[0]!;
      return {
        ...(first.analysis_data as ImageAnalysisResult),
        processingTimeMs: 0 // Cached result
      };
      
    } catch (error) {
      this.logger.warn('Cache lookup failed', { error: String(error), contentHash });
      return null;
    }
  }

  /**
   * Cache analysis result
   */
  private async cacheAnalysisResult(contentHash: string, analysis: ImageAnalysisResult): Promise<void> {
    try {
      const sql = this.db.getSQL();
      
      await sql`
        INSERT INTO image_analysis_cache (
          content_hash,
          analysis_data,
          created_at,
          last_used_at,
          usage_count
        ) VALUES (
          ${contentHash},
          ${JSON.stringify(analysis)},
          NOW(),
          NOW(),
          1
        )
        ON CONFLICT (content_hash) DO UPDATE SET
          analysis_data = EXCLUDED.analysis_data,
          last_used_at = NOW(),
          usage_count = image_analysis_cache.usage_count + 1
      `;
      
    } catch (error) {
      this.logger.warn('Failed to cache analysis result', { error: String(error), contentHash });
    }
  }

  /**
   * Update cache usage statistics
   */
  private async updateCacheUsage(contentHash: string): Promise<void> {
    try {
      const sql = this.db.getSQL();
      
      await sql`
        UPDATE image_analysis_cache
        SET last_used_at = NOW(), usage_count = usage_count + 1
        WHERE content_hash = ${contentHash}
      `;
      
    } catch (error) {
      this.logger.warn('Failed to update cache usage', { error: String(error) });
    }
  }

  /**
   * Store image metadata and analysis in database
   */
  private async storeImageMetadata(metadata: ImageMetadata, analysis: ImageAnalysisResult): Promise<void> {
    try {
      const sql = this.db.getSQL();
      
      await sql`
        INSERT INTO message_image_metadata (
          message_id,
          merchant_id,
          customer_id,
          mime_type,
          width,
          height,
          size_bytes,
          content_hash,
          ocr_text,
          labels,
          created_at
        ) VALUES (
          ${metadata.messageId}::uuid,
          ${metadata.merchantId}::uuid,
          ${metadata.customerId},
          ${metadata.mimeType},
          ${metadata.width},
          ${metadata.height},
          ${metadata.sizeBytes},
          ${metadata.contentHash},
          ${analysis.ocrText ?? null},
          ${JSON.stringify({
            labels: analysis.labels,
            objects: analysis.objects,
            contentType: analysis.contentType,
            visualFeatures: analysis.visualFeatures,
            confidence: analysis.confidence
          })},
          NOW()
        )
        ON CONFLICT (content_hash) DO UPDATE SET
          labels = EXCLUDED.labels,
          ocr_text = COALESCE(EXCLUDED.ocr_text, message_image_metadata.ocr_text)
      `;
      
    } catch (error) {
      this.logger.warn('Failed to store image metadata', {
        error: String(error),
        contentHash: metadata.contentHash
      });
    }
  }

  /**
   * Search images by content
   */
  async searchImagesByContent(
    query: string,
    merchantId: string,
    options: {
      contentTypes?: string[];
      minConfidence?: number;
      limit?: number;
    } = {}
  ): Promise<Array<{
    messageId: string;
    contentHash: string;
    labels: unknown;
    ocrText?: string;
    similarity: number;
  }>> {
    
    try {
      const sql = this.db.getSQL();
      const minConfidence = options.minConfidence || 0.5;
      const limit = options.limit || 20;
      
      const results = await sql<{
        message_id: string;
        content_hash: string;
        labels: unknown;
        ocr_text: string;
        similarity: number;
      }>`
        SELECT 
          message_id,
          content_hash,
          labels,
          ocr_text,
          ts_rank(
            to_tsvector('english', ocr_text || ' ' || labels::text),
            plainto_tsquery('english', ${query})
          ) as similarity
        FROM message_image_metadata
        WHERE merchant_id = ${merchantId}::uuid
          AND (
            ocr_text IS NOT NULL AND ocr_text ILIKE ${'%' + query + '%'}
            OR labels::text ILIKE ${'%' + query + '%'}
          )
          AND (labels->>'confidence')::float >= ${minConfidence}
        ORDER BY similarity DESC
        LIMIT ${limit}
      `;
      
      telemetry.counter('image_analysis_searches_total', 'Image content searches').add(1, {
        merchant_id: merchantId,
        results_count: String(results.length)
      });
      
      return results.map(r => ({
        messageId: r.message_id,
        contentHash: r.content_hash,
        labels: r.labels,
        ocrText: r.ocr_text,
        similarity: Number(r.similarity)
      }));
      
    } catch (error) {
      this.logger.error('Image search failed', {
        error: error instanceof Error ? error.message : String(error),
        query,
        merchantId
      });
      return [];
    }
  }

  /**
   * Get analytics for image processing
   */
  async getImageAnalytics(
    merchantId: string,
    timeRange: '24h' | '7d' | '30d' = '7d'
  ): Promise<{
    totalImages: number;
    ocrEnabled: number;
    contentTypes: Record<string, number>;
    averageConfidence: number;
    topLabels: Array<{ label: string; count: number }>;
  }> {
    
    try {
      const sql = this.db.getSQL();
      const timeFilter = timeRange === '24h' ? '24 hours' : timeRange === '7d' ? '7 days' : '30 days';
      
      const stats = await sql<{
        total_images: number;
        ocr_enabled: number;
        avg_confidence: number;
      }>`
        SELECT 
          COUNT(*) as total_images,
          COUNT(ocr_text) as ocr_enabled,
          AVG((labels->>'confidence')::float) as avg_confidence
        FROM message_image_metadata
        WHERE merchant_id = ${merchantId}::uuid
          AND created_at > NOW() - INTERVAL '${sql.unsafe(timeFilter)}'
      `;
      
      // Get content type distribution
      const contentTypes = await sql<{
        content_type: string;
        count: number;
      }>`
        SELECT 
          labels->'contentType'->>'category' as content_type,
          COUNT(*) as count
        FROM message_image_metadata
        WHERE merchant_id = ${merchantId}::uuid
          AND created_at > NOW() - INTERVAL '${sql.unsafe(timeFilter)}'
          AND labels->'contentType'->>'category' IS NOT NULL
        GROUP BY labels->'contentType'->>'category'
        ORDER BY count DESC
      `;
      
      // Get top labels
      const topLabels = await sql<{
        label: string;
        count: number;
      }>`
        SELECT 
          label_item->>'name' as label,
          COUNT(*) as count
        FROM message_image_metadata,
        jsonb_array_elements(labels->'labels') as label_item
        WHERE merchant_id = ${merchantId}::uuid
          AND created_at > NOW() - INTERVAL '${sql.unsafe(timeFilter)}'
        GROUP BY label_item->>'name'
        ORDER BY count DESC
        LIMIT 10
      `;
      
      return {
        totalImages: Number(stats[0]?.total_images || 0),
        ocrEnabled: Number(stats[0]?.ocr_enabled || 0),
        contentTypes: contentTypes.reduce((acc, ct) => {
          acc[ct.content_type] = Number(ct.count);
          return acc;
        }, {} as Record<string, number>),
        averageConfidence: Number(stats[0]?.avg_confidence || 0),
        topLabels: topLabels.map(tl => ({
          label: tl.label,
          count: Number(tl.count)
        }))
      };
      
    } catch (error) {
      this.logger.error('Failed to get image analytics', {
        error: error instanceof Error ? error.message : String(error),
        merchantId
      });
      
      return {
        totalImages: 0,
        ocrEnabled: 0,
        contentTypes: {},
        averageConfidence: 0,
        topLabels: []
      };
    }
  }
}

export default ImageAnalysisService;
