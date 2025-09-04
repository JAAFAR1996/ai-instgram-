/**
 * ===============================================
 * Image Search Routes - Visual Search API
 * Search products by image content, OCR text, and visual similarity
 * ===============================================
 */

import { Hono } from 'hono';
import { getDatabase } from '../db/adapter.js';
import { getLogger } from '../services/logger.js';
import { telemetry } from '../services/telemetry.js';
import ImageAnalysisService from '../services/image-analysis.js';

const app = new Hono();
const logger = getLogger({ component: 'image-search-routes' });
const db = getDatabase();

/**
 * POST /api/image-search/analyze
 * Analyze uploaded image and return detailed analysis
 */
app.post('/analyze', async (c) => {
  const startTime = Date.now();
  
  try {
    // Get merchant ID from headers
    const merchantId = c.req.header('X-Merchant-Id');
    if (!merchantId) {
      return c.json({ error: 'Merchant ID required in X-Merchant-Id header' }, 400);
    }

    // Parse multipart form data
    const formData = await c.req.formData();
    const imageFile = formData.get('image') as File;
    const enableOCR = formData.get('enableOCR') !== 'false';
    const enableProductMatching = formData.get('enableProductMatching') !== 'false';
    
    if (!imageFile) {
      return c.json({ error: 'Image file required' }, 400);
    }

    // Convert file to buffer
    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
    
    // Prepare metadata
    const imageMetadata = {
      messageId: 'api-upload-' + Date.now(),
      merchantId: merchantId,
      customerId: 'api-user',
      mimeType: imageFile.type,
      width: 0,
      height: 0,
      sizeBytes: imageBuffer.length,
      contentHash: ''
    };

    // Analyze image
    const imageAnalyzer = new ImageAnalysisService();
    const analysis = await imageAnalyzer.analyzeImage(imageBuffer, imageMetadata, {
      enableOCR,
      enableVisualSearch: true,
      enableProductMatching,
      forceReprocess: true // Don't use cache for API requests
    });

    const processingTime = Date.now() - startTime;
    
    // Record API usage
    telemetry.counter('image_search_api_requests_total', 'Image search API requests').add(1, {
      merchant_id: merchantId,
      endpoint: 'analyze',
      content_type: analysis.contentType.category
    });
    
    telemetry.histogram('image_search_api_processing_time_ms', 'API processing time', 'ms').record(processingTime, {
      merchant_id: merchantId,
      endpoint: 'analyze',
      success: 'true'
    });

    return c.json({
      success: true,
      analysis: {
        contentType: analysis.contentType,
        confidence: analysis.confidence,
        ocrText: analysis.ocrText,
        labels: analysis.labels,
        objects: analysis.objects,
        visualFeatures: analysis.visualFeatures,
        productMatches: analysis.productMatches,
        processingTime
      }
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    telemetry.counter('image_search_api_errors_total', 'Image search API errors').add(1, {
      merchant_id: c.req.header('X-Merchant-Id') || 'unknown',
      endpoint: 'analyze',
      error_type: error instanceof Error ? error.constructor.name : 'Unknown'
    });
    
    logger.error('Image analysis API failed', {
      error: error instanceof Error ? error.message : String(error),
      processingTime
    });

    return c.json({ 
      error: 'Image analysis failed',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

/**
 * POST /api/image-search/find-products
 * Find products matching the uploaded image
 */
app.post('/find-products', async (c) => {
  const startTime = Date.now();
  
  try {
    const merchantId = c.req.header('X-Merchant-Id');
    if (!merchantId) {
      return c.json({ error: 'Merchant ID required in X-Merchant-Id header' }, 400);
    }

    const formData = await c.req.formData();
    const imageFile = formData.get('image') as File;
    const minSimilarity = parseFloat(formData.get('minSimilarity') as string) || 0.3;
    const limit = parseInt(formData.get('limit') as string) || 10;
    
    if (!imageFile) {
      return c.json({ error: 'Image file required' }, 400);
    }

    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
    
    const imageMetadata = {
      messageId: 'product-search-' + Date.now(),
      merchantId: merchantId,
      customerId: 'api-user',
      mimeType: imageFile.type,
      width: 0,
      height: 0,
      sizeBytes: imageBuffer.length,
      contentHash: ''
    };

    // Analyze image with focus on product matching
    const imageAnalyzer = new ImageAnalysisService();
    const analysis = await imageAnalyzer.analyzeImage(imageBuffer, imageMetadata, {
      enableOCR: true,
      enableVisualSearch: true,
      enableProductMatching: true,
      forceReprocess: true
    });

    // Filter product matches by similarity threshold
    const relevantMatches = (analysis.productMatches || [])
      .filter(match => match.similarity >= minSimilarity)
      .slice(0, limit);

    // Get detailed product information
    const sql = db.getSQL();
    const productIds = relevantMatches.map(m => m.productId);
    
    let detailedProducts = [];
    if (productIds.length > 0) {
      detailedProducts = await sql<{
        id: string;
        sku: string;
        name_ar: string;
        price_usd: number;
        category: string;
        description_ar?: string;
        image_urls: string[];
      }>`
        SELECT 
          id,
          sku,
          name_ar,
          price_usd,
          category,
          description_ar,
          COALESCE(image_urls, '[]'::jsonb) as image_urls
        FROM products
        WHERE id = ANY(${productIds}::uuid[])
          AND merchant_id = ${merchantId}::uuid
        ORDER BY CASE 
          ${productIds.map((id, index) => `WHEN id = '${id}'::uuid THEN ${index}`).join(' ')}
        END
      `;
    }

    const processingTime = Date.now() - startTime;

    // Record metrics
    telemetry.counter('image_search_api_requests_total', 'Image search API requests').add(1, {
      merchant_id: merchantId,
      endpoint: 'find-products',
      results_count: String(detailedProducts.length)
    });
    
    telemetry.histogram('image_search_api_processing_time_ms', 'API processing time', 'ms').record(processingTime, {
      merchant_id: merchantId,
      endpoint: 'find-products',
      success: 'true'
    });

    return c.json({
      success: true,
      analysis: {
        contentType: analysis.contentType,
        confidence: analysis.confidence,
        ocrText: analysis.ocrText,
        labels: analysis.labels.slice(0, 5), // Top 5 labels
        processingTime
      },
      products: detailedProducts.map(product => {
        const matchInfo = relevantMatches.find(m => m.productId === product.id);
        return {
          ...product,
          similarity: matchInfo?.similarity || 0,
          matchType: matchInfo?.matchType || 'unknown'
        };
      }),
      totalMatches: relevantMatches.length,
      searchParams: {
        minSimilarity,
        limit,
        appliedFilters: relevantMatches.length !== (analysis.productMatches || []).length
      }
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    telemetry.counter('image_search_api_errors_total', 'Image search API errors').add(1, {
      merchant_id: c.req.header('X-Merchant-Id') || 'unknown',
      endpoint: 'find-products',
      error_type: error instanceof Error ? error.constructor.name : 'Unknown'
    });
    
    logger.error('Product search API failed', {
      error: error instanceof Error ? error.message : String(error),
      processingTime
    });

    return c.json({ 
      error: 'Product search failed',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

/**
 * GET /api/image-search/content/:merchantId
 * Search existing image content by text query
 */
app.get('/content/:merchantId', async (c) => {
  const startTime = Date.now();
  
  try {
    const merchantId = c.req.param('merchantId');
    const query = c.req.query('q') || '';
    const contentType = c.req.query('contentType');
    const minConfidence = parseFloat(c.req.query('minConfidence') || '0.5');
    const limit = parseInt(c.req.query('limit') || '20');
    
    if (!query.trim()) {
      return c.json({ error: 'Search query required (q parameter)' }, 400);
    }

    const imageAnalyzer = new ImageAnalysisService();
    
    // Search image content
    const results = await imageAnalyzer.searchImagesByContent(query, merchantId, {
      contentTypes: contentType ? [contentType] : undefined,
      minConfidence,
      limit
    });

    const processingTime = Date.now() - startTime;

    // Record search metrics
    telemetry.counter('image_search_api_requests_total', 'Image search API requests').add(1, {
      merchant_id: merchantId,
      endpoint: 'content-search',
      results_count: String(results.length)
    });
    
    telemetry.histogram('image_search_api_processing_time_ms', 'API processing time', 'ms').record(processingTime, {
      merchant_id: merchantId,
      endpoint: 'content-search',
      success: 'true'
    });

    return c.json({
      success: true,
      results,
      searchParams: {
        query,
        contentType,
        minConfidence,
        limit
      },
      processingTime,
      totalResults: results.length
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    telemetry.counter('image_search_api_errors_total', 'Image search API errors').add(1, {
      merchant_id: c.req.param('merchantId'),
      endpoint: 'content-search',
      error_type: error instanceof Error ? error.constructor.name : 'Unknown'
    });
    
    logger.error('Content search API failed', {
      error: error instanceof Error ? error.message : String(error),
      processingTime
    });

    return c.json({ 
      error: 'Content search failed',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

/**
 * GET /api/image-search/analytics/:merchantId
 * Get image analysis analytics for merchant
 */
app.get('/analytics/:merchantId', async (c) => {
  try {
    const merchantId = c.req.param('merchantId');
    const timeRange = (c.req.query('timeRange') as '24h' | '7d' | '30d') || '7d';
    
    const imageAnalyzer = new ImageAnalysisService();
    const analytics = await imageAnalyzer.getImageAnalytics(merchantId, timeRange);

    telemetry.counter('image_search_api_requests_total', 'Image search API requests').add(1, {
      merchant_id: merchantId,
      endpoint: 'analytics'
    });

    return c.json({
      success: true,
      analytics,
      timeRange,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    telemetry.counter('image_search_api_errors_total', 'Image search API errors').add(1, {
      merchant_id: c.req.param('merchantId'),
      endpoint: 'analytics',
      error_type: error instanceof Error ? error.constructor.name : 'Unknown'
    });
    
    logger.error('Analytics API failed', {
      error: error instanceof Error ? error.message : String(error),
      merchantId: c.req.param('merchantId')
    });

    return c.json({ 
      error: 'Analytics retrieval failed',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

export function registerImageSearchRoutes(mainApp: Hono) {
  mainApp.route('/api/image-search', app);
}

export default app;