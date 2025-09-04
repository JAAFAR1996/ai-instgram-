/**
 * ===============================================
 * Message Analytics API - Real-time Enhancement Analytics
 * Comprehensive analytics for message enhancement system
 * ===============================================
 */

import { Hono } from 'hono';
import { getDatabase } from '../db/adapter.js';
import { getLogger } from '../services/logger.js';
import { telemetry } from '../services/telemetry.js';
import MessageEnhancementService from '../services/message-enhancement.service.js';
import ResponseEnhancerService from '../services/response-enhancer.service.js';
import ConfidenceRouterService from '../services/confidence-router.service.js';
import { SelfLearningSystem } from '../services/learning-analytics.js';

const app = new Hono();
const logger = getLogger({ component: 'message-analytics-api' });
const db = getDatabase();

// Service instances
const messageEnhancer = new MessageEnhancementService();
const responseEnhancer = new ResponseEnhancerService();
const confidenceRouter = new ConfidenceRouterService();
const learningSystem = new SelfLearningSystem();

/**
 * GET /api/message-analytics/overview/:merchantId
 * Real-time overview of message enhancement system
 */
app.get('/overview/:merchantId', async (c) => {
  const startTime = Date.now();
  
  try {
    const merchantId = c.req.param('merchantId');
    const timeRange = (c.req.query('timeRange') as '1h' | '24h' | '7d' | '30d') || '24h';
    
    const sql = db.getSQL();
    
    // Get time interval for query
    const intervals = {
      '1h': '1 hour',
      '24h': '24 hours', 
      '7d': '7 days',
      '30d': '30 days'
    };
    
    // Core metrics query
    const overview = await sql`
      SELECT 
        COUNT(*) as total_messages,
        COUNT(*) FILTER (WHERE ai_confidence IS NOT NULL) as ai_processed_messages,
        AVG(ai_confidence) as avg_ai_confidence,
        AVG(processing_time_ms) as avg_processing_time,
        COUNT(*) FILTER (WHERE (metadata->'enhancement'->>'enhanced')::boolean = true) as enhanced_messages,
        AVG((metadata->'enhancement'->>'qualityScore')::float) as avg_quality_score,
        COUNT(*) FILTER (WHERE ai_confidence < 0.5) as low_confidence_messages,
        COUNT(*) FILTER (WHERE ai_confidence >= 0.8) as high_confidence_messages,
        
        -- Intent distribution
        COUNT(*) FILTER (WHERE ai_intent = 'PRICE') as price_intents,
        COUNT(*) FILTER (WHERE ai_intent = 'INVENTORY') as inventory_intents,
        COUNT(*) FILTER (WHERE ai_intent = 'FAQ') as faq_intents,
        COUNT(*) FILTER (WHERE ai_intent = 'OBJECTION') as objection_intents,
        COUNT(*) FILTER (WHERE ai_intent = 'SMALL_TALK') as small_talk_intents,
        
        -- Platform distribution
        COUNT(*) FILTER (WHERE platform = 'instagram') as instagram_messages,
        COUNT(*) FILTER (WHERE platform = 'whatsapp') as whatsapp_messages,
        COUNT(*) FILTER (WHERE platform = 'manychat') as manychat_messages,
        
        -- Enhancement types
        COUNT(*) FILTER (WHERE metadata->'enhancement'->>'type' = 'constitutional') as constitutional_enhancements,
        COUNT(*) FILTER (WHERE metadata->'enhancement'->>'type' = 'thinking') as thinking_enhancements,
        COUNT(*) FILTER (WHERE metadata->'enhancement'->>'type' = 'pattern') as pattern_enhancements,
        COUNT(*) FILTER (WHERE metadata->'enhancement'->>'type' = 'hybrid') as hybrid_enhancements
        
      FROM message_logs 
      WHERE merchant_id = ${merchantId}::uuid
        AND created_at > NOW() - INTERVAL '${intervals[timeRange as keyof typeof intervals]}'
        AND direction = 'OUTGOING'
    `;

    // Enhancement effectiveness query
    const effectiveness = await sql`
      SELECT 
        AVG(CAST(metadata->'enhancement'->'metadata'->>'improvement' AS FLOAT)) as avg_quality_improvement,
        AVG(CAST(metadata->'enhancement'->>'confidenceBoost' AS FLOAT)) as avg_confidence_boost,
        AVG(CAST(metadata->'enhancement'->>'processingTime' AS INT)) as avg_enhancement_time,
        COUNT(*) FILTER (WHERE (metadata->'enhancement'->'metadata'->>'improvement')::float > 0.1) as significant_improvements,
        MAX(CAST(metadata->'enhancement'->'metadata'->>'improvement' AS FLOAT)) as max_improvement
      FROM message_logs
      WHERE merchant_id = ${merchantId}::uuid
        AND created_at > NOW() - INTERVAL '${intervals[timeRange as keyof typeof intervals]}'
        AND metadata->'enhancement' IS NOT NULL
    `;

    // Success patterns summary
    const patterns = await learningSystem.analyzeSuccessPatterns(merchantId, timeRange === '30d' ? 30 : 7);

    const processingTime = Date.now() - startTime;

    // Record API usage
    telemetry.counter('message_analytics_requests_total', 'Message analytics API requests').add(1, {
      merchant_id: merchantId,
      endpoint: 'overview',
      time_range: timeRange
    });

    return c.json({
      success: true,
      data: {
        timeRange,
        overview: overview[0] || {},
        effectiveness: effectiveness[0] || {},
        successPatterns: {
          topPhrases: patterns?.topPhrases?.slice(0, 5) || [],
          intentSuccess: patterns?.intentSuccess || {},
          timeSlots: patterns?.timeSlots?.slice(0, 3) || [],
          totalPatterns: patterns?.topPhrases?.length ?? 0
        },
        processingTime,
        generatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Overview analytics failed', { error: String(error) });
    
    telemetry.counter('message_analytics_errors_total', 'Message analytics API errors').add(1, {
      merchant_id: c.req.param('merchantId'),
      endpoint: 'overview'
    });

    return c.json({ 
      error: 'Failed to generate overview analytics',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

/**
 * GET /api/message-analytics/confidence-trends/:merchantId
 * Confidence and quality trends over time
 */
app.get('/confidence-trends/:merchantId', async (c) => {
  try {
    const merchantId = c.req.param('merchantId');
    const timeRange = c.req.query('timeRange') || '24h';
    const granularity = (c.req.query('granularity') as 'hour' | 'day') || 'hour';
    
    const sql = db.getSQL();
    
    const timeFormat = granularity === 'hour' 
      ? "DATE_TRUNC('hour', created_at)"
      : "DATE_TRUNC('day', created_at)";
    
    const intervals = {
      '1h': '1 hour',
      '24h': '24 hours',
      '7d': '7 days', 
      '30d': '30 days'
    };

    const trends = await sql`
      SELECT 
        ${sql.unsafe(timeFormat)} as time_bucket,
        COUNT(*) as message_count,
        AVG(ai_confidence) as avg_confidence,
        AVG(CAST(metadata->'enhancement'->>'qualityScore' AS FLOAT)) as avg_quality_score,
        COUNT(*) FILTER (WHERE (metadata->'enhancement'->>'enhanced')::boolean = true) as enhanced_count,
        AVG(processing_time_ms) as avg_processing_time,
        AVG(CAST(metadata->'enhancement'->>'confidenceBoost' AS FLOAT)) as avg_confidence_boost
      FROM message_logs
      WHERE merchant_id = ${merchantId}::uuid
        AND created_at > NOW() - INTERVAL '${intervals[timeRange as keyof typeof intervals]}'
        AND direction = 'OUTGOING'
      GROUP BY time_bucket
      ORDER BY time_bucket ASC
    `;

    return c.json({
      success: true,
      data: {
        trends,
        timeRange,
        granularity,
        totalDataPoints: trends.length
      }
    });

  } catch (error) {
    logger.error('Confidence trends failed', { error: String(error) });
    return c.json({ error: 'Failed to get confidence trends' }, 500);
  }
});

/**
 * GET /api/message-analytics/enhancement-performance/:merchantId
 * Enhancement strategy performance analysis
 */
app.get('/enhancement-performance/:merchantId', async (c) => {
  try {
    const merchantId = c.req.param('merchantId');
    const days = parseInt(c.req.query('days') || '7');
    
    // Get enhancement statistics
    const enhancementStats = await messageEnhancer.getEnhancementStats(merchantId, days);
    const responseStats = await responseEnhancer.getEnhancementStats(merchantId, days);
    const routingStats = await confidenceRouter.getRoutingStats(merchantId, days);

    const sql = db.getSQL();
    
    // Performance by enhancement type
    const performanceByType = await sql`
      SELECT 
        metadata->'enhancement'->>'type' as enhancement_type,
        COUNT(*) as usage_count,
        AVG(CAST(metadata->'enhancement'->>'qualityScore' AS FLOAT)) as avg_quality_score,
        AVG(CAST(metadata->'enhancement'->>'confidenceBoost' AS FLOAT)) as avg_confidence_boost,
        AVG(CAST(metadata->'enhancement'->>'processingTime' AS INT)) as avg_processing_time,
        STDDEV(CAST(metadata->'enhancement'->>'qualityScore' AS FLOAT)) as quality_score_stddev
      FROM message_logs
      WHERE merchant_id = ${merchantId}::uuid
        AND created_at > NOW() - INTERVAL '${days} days'
        AND metadata->'enhancement' IS NOT NULL
        AND (metadata->'enhancement'->>'enhanced')::boolean = true
      GROUP BY enhancement_type
      ORDER BY usage_count DESC
    `;

    // Success rate by intent
    const successByIntent = await sql`
      SELECT 
        ai_intent,
        COUNT(*) as total_messages,
        COUNT(*) FILTER (WHERE (metadata->'enhancement'->>'enhanced')::boolean = true) as enhanced_messages,
        AVG(CAST(metadata->'enhancement'->>'qualityScore' AS FLOAT)) as avg_quality_score,
        AVG(ai_confidence) as avg_confidence
      FROM message_logs
      WHERE merchant_id = ${merchantId}::uuid
        AND created_at > NOW() - INTERVAL '${days} days'
        AND ai_intent IS NOT NULL
        AND direction = 'OUTGOING'
      GROUP BY ai_intent
      ORDER BY total_messages DESC
    `;

    return c.json({
      success: true,
      data: {
        enhancementStats,
        responseStats,
        routingStats,
        performanceByType,
        successByIntent,
        analysisWindow: `${days} days`
      }
    });

  } catch (error) {
    logger.error('Enhancement performance analysis failed', { error: String(error) });
    return c.json({ error: 'Failed to analyze enhancement performance' }, 500);
  }
});

/**
 * GET /api/message-analytics/success-patterns/:merchantId
 * Success patterns and optimization opportunities
 */
app.get('/success-patterns/:merchantId', async (c) => {
  try {
    const merchantId = c.req.param('merchantId');
    const days = parseInt(c.req.query('days') || '14');
    
    // Get comprehensive success patterns
    const patterns = await learningSystem.analyzeSuccessPatterns(merchantId, days);
    
    const sql = db.getSQL();
    
    // Pattern effectiveness analysis
    const patternEffectiveness = await sql`
      SELECT 
        jsonb_array_elements_text(metadata->'enhancement'->'appliedPatterns') as pattern_name,
        COUNT(*) as usage_count,
        AVG(CAST(metadata->'enhancement'->>'qualityScore' AS FLOAT)) as avg_quality_after,
        AVG(CAST(metadata->'enhancement'->'metadata'->>'improvement' AS FLOAT)) as avg_improvement
      FROM message_logs
      WHERE merchant_id = ${merchantId}::uuid
        AND created_at > NOW() - INTERVAL '${days} days'
        AND metadata->'enhancement'->'appliedPatterns' IS NOT NULL
        AND jsonb_array_length(metadata->'enhancement'->'appliedPatterns') > 0
      GROUP BY pattern_name
      HAVING COUNT(*) >= 5
      ORDER BY avg_improvement DESC NULLS LAST
      LIMIT 10
    `;

    // Optimization opportunities
    const opportunities = await sql`
      SELECT 
        ai_intent,
        COUNT(*) as low_confidence_count,
        AVG(ai_confidence) as avg_confidence,
        COUNT(*) FILTER (WHERE (metadata->'enhancement'->>'enhanced')::boolean = false) as unenhanced_count
      FROM message_logs
      WHERE merchant_id = ${merchantId}::uuid
        AND created_at > NOW() - INTERVAL '${days} days'
        AND ai_confidence < 0.7
        AND direction = 'OUTGOING'
      GROUP BY ai_intent
      ORDER BY low_confidence_count DESC
    `;

    return c.json({
      success: true,
      data: {
        patterns: patterns || {},
        patternEffectiveness,
        optimizationOpportunities: opportunities,
        recommendations: generateRecommendations(patterns, opportunities),
        analysisWindow: `${days} days`
      }
    });

  } catch (error) {
    logger.error('Success patterns analysis failed', { error: String(error) });
    return c.json({ error: 'Failed to analyze success patterns' }, 500);
  }
});

/**
 * POST /api/message-analytics/simulate-enhancement
 * Simulate enhancement for a given message
 */
app.post('/simulate-enhancement', async (c) => {
  try {
    const body = await c.req.json();
    const { merchantId, customerMessage, currentResponse, aiConfidence, aiIntent } = body;
    
    if (!merchantId || !customerMessage || !currentResponse) {
      return c.json({ error: 'Missing required fields' }, 400);
    }

    // Create simulation contexts
    const enhancementContext = {
      messageId: 'simulation-' + Date.now(),
      merchantId,
      customerMessage,
      originalResponse: currentResponse,
      aiConfidence: aiConfidence ?? 0.5,
      aiIntent: aiIntent || 'OTHER',
      processingTime: 0,
      platform: 'simulation'
    };

    // Run enhancement simulation
    const enhancementResult = await messageEnhancer.enhanceMessage(enhancementContext);
    
    // Run pattern enhancement simulation
    const patternResult = await responseEnhancer.enhanceResponse(currentResponse, {
      merchantId,
      customerMessage,
      aiConfidence: enhancementContext.aiConfidence,
      aiIntent: enhancementContext.aiIntent,
      timeOfDay: new Date().getHours()
    });

    // Run routing simulation
    const routingResult = await confidenceRouter.routeMessage({
      messageId: enhancementContext.messageId,
      merchantId,
      customerMessage,
      currentResponse,
      aiConfidence: enhancementContext.aiConfidence,
      aiIntent: enhancementContext.aiIntent,
      processingTime: 0,
      platform: 'simulation'
    });

    return c.json({
      success: true,
      simulation: {
        original: {
          response: currentResponse,
          confidence: context.aiConfidence,
          intent: context.aiIntent
        },
        enhancement: {
          enhanced: enhancementResult.enhanced,
          response: enhancementResult.finalResponse,
          qualityScore: enhancementResult.qualityScore,
          improvements: enhancementResult.improvements,
          type: enhancementResult.enhancementType
        },
        patterns: {
          enhanced: patternResult.appliedPatterns.length > 0,
          response: patternResult.enhancedResponse,
          patterns: patternResult.appliedPatterns,
          confidenceBoost: patternResult.confidenceBoost,
          reasoning: patternResult.reasoningChain
        },
        routing: {
          route: routingResult.routeUsed,
          response: routingResult.finalResponse,
          qualityScore: routingResult.qualityScore,
          enhancementsApplied: routingResult.enhancementsApplied
        }
      }
    });

  } catch (error) {
    logger.error('Enhancement simulation failed', { error: String(error) });
    return c.json({ error: 'Simulation failed' }, 500);
  }
});

/**
 * GET /api/message-analytics/real-time-stats/:merchantId
 * Real-time enhancement statistics
 */
app.get('/real-time-stats/:merchantId', async (c) => {
  try {
    const merchantId = c.req.param('merchantId');
    const sql = db.getSQL();
    
    // Last hour statistics
    const realTimeStats = await sql`
      SELECT 
        COUNT(*) as messages_last_hour,
        COUNT(*) FILTER (WHERE (metadata->'enhancement'->>'enhanced')::boolean = true) as enhanced_last_hour,
        AVG(ai_confidence) as avg_confidence_last_hour,
        AVG(processing_time_ms) as avg_processing_time_last_hour,
        COUNT(*) FILTER (WHERE ai_confidence < 0.5) as low_confidence_last_hour,
        MAX(created_at) as last_message_time
      FROM message_logs
      WHERE merchant_id = ${merchantId}::uuid
        AND created_at > NOW() - INTERVAL '1 hour'
        AND direction = 'OUTGOING'
    `;

    // Current enhancement queue status (if applicable)
    const queueStats = {
      pending: 0,
      processing: 0,
      completed: 0
    };

    return c.json({
      success: true,
      data: {
        realTimeStats: realTimeStats[0] || {},
        queueStats,
        timestamp: new Date().toISOString(),
        refreshInterval: 30000 // 30 seconds
      }
    });

  } catch (error) {
    logger.error('Real-time stats failed', { error: String(error) });
    return c.json({ error: 'Failed to get real-time stats' }, 500);
  }
});

// Helper function to generate recommendations
function generateRecommendations(patterns: Record<string, unknown>, opportunities: Array<Record<string, unknown>>): string[] {
  const recommendations: string[] = [];

  // Pattern-based recommendations
  if (patterns?.topPhrases?.length > 0) {
    const topPhrase = patterns.topPhrases[0];
    if (topPhrase.score > 0.8) {
      recommendations.push(`Consider using the phrase "${topPhrase.phrase}" more frequently - it has a ${(topPhrase.score * 100).toFixed(1)}% success rate`);
    }
  }

  // Intent-based recommendations
  if (opportunities?.length > 0) {
    const topOpportunity = opportunities[0];
    if (topOpportunity.low_confidence_count > 10) {
      recommendations.push(`Focus on improving ${topOpportunity.ai_intent} responses - ${topOpportunity.low_confidence_count} low-confidence messages detected`);
    }
  }

  // Time-based recommendations
  if (patterns?.timeSlots?.length > 0) {
    const bestTimeSlot = patterns.timeSlots[0];
    if (bestTimeSlot.avgScore > 0.8) {
      recommendations.push(`Peak performance time: ${bestTimeSlot.hour}:00 with ${(bestTimeSlot.avgScore * 100).toFixed(1)}% success rate`);
    }
  }

  return recommendations;
}

/**
 * Register message analytics routes
 */
export function registerMessageAnalyticsRoutes(mainApp: Hono) {
  mainApp.route('/api/message-analytics', app);
}

export default app;
