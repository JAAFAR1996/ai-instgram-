/**
 * ===============================================
 * Message Enhancement Service - Auto-Enhancement Pipeline
 * Leverages existing infrastructure for quality-driven improvements
 * ===============================================
 */

import { getDatabase } from '../db/adapter.js';
import { getLogger } from './logger.js';
import { telemetry } from './telemetry.js';
import { ConstitutionalAI } from './constitutional-ai.js';
import { SelfLearningSystem } from './learning-analytics.js';
import ExtendedThinkingService from './extended-thinking.js';
import type { 
  ResponseContext, 
  CritiqueResult
} from '../types/constitutional-ai.js';
import type { SuccessPatterns } from '../types/learning.js';

export interface EnhancementContext {
  messageId: string;
  merchantId: string;
  originalResponse: string;
  aiConfidence: number;
  aiIntent?: string;
  processingTime: number;
  customerMessage?: string;
  conversationHistory?: Array<unknown>;
  platform?: string;
}

export interface EnhancementResult {
  enhanced: boolean;
  finalResponse: string;
  qualityScore: number;
  enhancementType: 'none' | 'constitutional' | 'thinking' | 'pattern' | 'hybrid';
  processingTime: number;
  improvements: string[];
  metadata: Record<string, any>;
}

export interface QualityThresholds {
  minConfidence: number;      // 0.7 default
  minQualityScore: number;    // 0.6 default  
  enableThinking: boolean;    // true for complex queries
  applyPatterns: boolean;     // true for pattern optimization
  forceImprovement: boolean;  // false for optional enhancement
}

export class MessageEnhancementService {
  private db = getDatabase();
  private logger = getLogger({ component: 'message-enhancement' });
  private constitutionalAI = new ConstitutionalAI();
  private learningSystem = new SelfLearningSystem();
  private thinkingService = new ExtendedThinkingService();

  // Cache for success patterns (5 minute TTL)
  private patternCache = new Map<string, { patterns: SuccessPatterns; timestamp: number }>();
  private readonly PATTERN_CACHE_TTL = 5 * 60 * 1000;

  /**
   * Main enhancement pipeline - automatically triggered by quality thresholds
   */
  async enhanceMessage(
    context: EnhancementContext, 
    thresholds: QualityThresholds = this.getDefaultThresholds()
  ): Promise<EnhancementResult> {
    
    const startTime = Date.now();
    let enhancementType: EnhancementResult['enhancementType'] = 'none';
    let finalResponse = context.originalResponse;
    let improvements: string[] = [];
    let qualityScore = 0;

    this.logger.debug('Starting message enhancement', { 
      messageId: context.messageId,
      confidence: context.aiConfidence,
      thresholds 
    });

    try {
      // 1. Quality Assessment
      const responseContext: ResponseContext = {
        merchantId: context.merchantId,
        intent: context.aiIntent,
      };

      const critique = await this.constitutionalAI.critiqueResponse(
        context.originalResponse, 
        responseContext
      );
      
      qualityScore = critique.score;

      // 2. Enhancement Decision Matrix
      const needsEnhancement = this.shouldEnhance(context, critique, thresholds);
      
      if (!needsEnhancement.enhance) {
        await this.trackResult(context, {
          enhanced: false,
          finalResponse,
          qualityScore,
          enhancementType: 'none',
          processingTime: Date.now() - startTime,
          improvements: ['quality_acceptable'],
          metadata: { reason: needsEnhancement.reason }
        });
        
        return {
          enhanced: false,
          finalResponse,
          qualityScore,
          enhancementType: 'none',
          processingTime: Date.now() - startTime,
          improvements: ['quality_acceptable'],
          metadata: { reason: needsEnhancement.reason }
        };
      }

      // 3. Apply Enhancement Strategy
      const enhancementResult = await this.applyEnhancement(
        context, 
        critique, 
        needsEnhancement.strategies
      );

      finalResponse = enhancementResult.response;
      enhancementType = enhancementResult.type;
      improvements = enhancementResult.improvements;

      // 4. Final Quality Check
      const finalCritique = await this.constitutionalAI.critiqueResponse(
        finalResponse,
        responseContext
      );

      const result: EnhancementResult = {
        enhanced: true,
        finalResponse,
        qualityScore: finalCritique.score,
        enhancementType,
        processingTime: Date.now() - startTime,
        improvements,
        metadata: {
          originalQuality: qualityScore,
          finalQuality: finalCritique.score,
          improvement: finalCritique.score - qualityScore,
          strategies: needsEnhancement.strategies
        }
      };

      await this.trackResult(context, result);
      return result;

    } catch (error) {
      this.logger.error('Enhancement pipeline failed', { 
        messageId: context.messageId,
        error: String(error) 
      });

      // Fallback: return original with error tracking
      const result: EnhancementResult = {
        enhanced: false,
        finalResponse: context.originalResponse,
        qualityScore: 0,
        enhancementType: 'none',
        processingTime: Date.now() - startTime,
        improvements: ['enhancement_failed'],
        metadata: { error: String(error) }
      };

      await this.trackResult(context, result);
      return result;
    }
  }

  /**
   * Determine if message needs enhancement and which strategies to apply
   */
  private shouldEnhance(
    context: EnhancementContext, 
    critique: CritiqueResult, 
    thresholds: QualityThresholds
  ): { enhance: boolean; reason: string; strategies: string[] } {
    
    const strategies: string[] = [];

    // Check confidence threshold
    if (context.aiConfidence < thresholds.minConfidence) {
      strategies.push('confidence_boost');
    }

    // Check quality threshold  
    if (critique.score < thresholds.minQualityScore) {
      strategies.push('constitutional');
    }

    // Check for complex queries needing extended thinking
    if (thresholds.enableThinking && context.processingTime > 2000) {
      strategies.push('thinking');
    }

    // Check for pattern optimization opportunities
    if (thresholds.applyPatterns && context.aiIntent) {
      strategies.push('patterns');
    }

    // Force improvement if requested
    if (thresholds.forceImprovement && strategies.length === 0) {
      strategies.push('constitutional');
    }

    return {
      enhance: strategies.length > 0,
      reason: strategies.length > 0 
        ? `Quality/confidence below thresholds: ${strategies.join(', ')}`
        : 'Meets quality standards',
      strategies
    };
  }

  /**
   * Apply the selected enhancement strategies
   */
  private async applyEnhancement(
    context: EnhancementContext,
    critique: CritiqueResult, 
    strategies: string[]
  ): Promise<{ response: string; type: EnhancementResult['enhancementType']; improvements: string[] }> {
    
    let response = context.originalResponse;
    let improvements: string[] = [];
    let enhancementType: EnhancementResult['enhancementType'] = 'none';

    // Apply Constitutional AI improvement
    if (strategies.includes('constitutional')) {
      const improvement = await this.constitutionalAI.improveResponse(response, critique);
      response = improvement.improved;
      improvements.push(`constitutional: ${improvement.record.applied.join(', ')}`);
      enhancementType = enhancementType === 'none' ? 'constitutional' : 'hybrid';
    }

    // Apply Extended Thinking for complex queries
    if (strategies.includes('thinking') && context.customerMessage) {
      try {
        const result = await this.thinkingService.processWithThinking(
          context.customerMessage,
          { merchantId: context.merchantId, nlp: { intent: context.aiIntent, confidence: context.aiConfidence } },
          false
        );
        improvements.push(`thinking: ${result.chain.steps.length} steps`);
        enhancementType = enhancementType === 'none' ? 'thinking' : 'hybrid';
      } catch (error) {
        improvements.push('thinking: failed');
      }
    }

    // Apply Success Pattern Optimization
    if (strategies.includes('patterns')) {
      const patternResult = await this.applySuccessPatterns(context, response);
      if (patternResult.improved) {
        response = patternResult.response;
        improvements.push(`patterns: ${patternResult.optimizations.join(', ')}`);
        enhancementType = enhancementType === 'none' ? 'pattern' : 'hybrid';
      }
    }

    // Apply Confidence Boosting techniques
    if (strategies.includes('confidence_boost')) {
      const boostedResponse = await this.applyConfidenceBoost(context, response);
      if (boostedResponse !== response) {
        response = boostedResponse;
        improvements.push('confidence: boosted');
        enhancementType = enhancementType === 'none' ? 'constitutional' : 'hybrid';
      }
    }

    return { response, type: enhancementType, improvements };
  }

  /**
   * Apply success patterns to optimize response
   */
  private async applySuccessPatterns(
    context: EnhancementContext, 
    response: string
  ): Promise<{ improved: boolean; response: string; optimizations: string[] }> {
    
    try {
      // Get cached patterns or compute new ones
      let patterns = await this.getSuccessPatterns(context.merchantId);
      
      if (!patterns || patterns.topPhrases.length === 0) {
        return { improved: false, response, optimizations: ['no_patterns'] };
      }

      const optimizations: string[] = [];
      let optimizedResponse = response;

      // Apply successful phrases for the intent
      if (context.aiIntent) {
        const intentSuccess = (patterns as unknown as { intentSuccess?: Record<string, { avgScore?: number }> }).intentSuccess;
        const intentData = intentSuccess ? intentSuccess[context.aiIntent] : undefined;
        if ((intentData?.avgScore ?? 0) > 0.7) {
          // This intent generally performs well, apply its successful patterns
          optimizations.push('intent_optimized');
        }
      }

      // Apply top performing phrases if response is short
      if (optimizedResponse.length < 100 && patterns.topPhrases.length > 0) {
        const bestPhrase = patterns.topPhrases[0] as { phrase?: string; score?: number };
        if (bestPhrase && typeof bestPhrase.phrase === 'string' && (bestPhrase.score ?? 0) > 0.8 && !optimizedResponse.includes(bestPhrase.phrase)) {
          // Intelligently integrate successful phrase
          if (bestPhrase.phrase.includes('???') || bestPhrase.phrase.includes('thank')) {
            optimizedResponse += ` ${bestPhrase.phrase}`;
            optimizations.push('phrase_added');
          }
        }
      }

      return {
        improved: optimizations.length > 0,
        response: optimizedResponse,
        optimizations
      };

    } catch (error) {
      return { improved: false, response, optimizations: ['pattern_error'] };
    }
  }

  /**
   * Apply confidence boosting techniques
   */
  private async applyConfidenceBoost(
    context: EnhancementContext, 
    response: string
  ): Promise<string> {
    
    // Add confidence-building phrases based on intent
    switch (context.aiIntent) {
      case 'PRICE':
        return response.includes('السعر') 
          ? response 
          : response + ' يمكنني مساعدتك في معرفة تفاصيل السعر الدقيقة.';
      
      case 'INVENTORY':
        return response.includes('متوفر') 
          ? response 
          : response + ' دعني أتحقق من التوفر الحالي لك.';
      
      case 'FAQ':
        return response + ' هل هذا يجيب على سؤالك؟';
        
      default:
        return response + ' يسعدني مساعدتك!';
    }
  }

  /**
   * Get success patterns from cache or compute fresh
   */
  private async getSuccessPatterns(merchantId: string): Promise<SuccessPatterns | null> {
    const cached = this.patternCache.get(merchantId);
    
    if (cached && Date.now() - cached.timestamp < this.PATTERN_CACHE_TTL) {
      return cached.patterns;
    }

    try {
      const patterns = await this.learningSystem.analyzeSuccessPatterns(merchantId, 7);
      this.patternCache.set(merchantId, { patterns, timestamp: Date.now() });
      return patterns;
    } catch {
      return null;
    }
  }

  /**
   * Track enhancement results for analytics
   */
  private async trackResult(context: EnhancementContext, result: EnhancementResult): Promise<void> {
    const sql = this.db.getSQL();

    try {
      // Update message_logs with enhancement metadata
      await sql`
        UPDATE message_logs 
        SET 
          metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({
            enhancement: {
              enhanced: result.enhanced,
              type: result.enhancementType,
              qualityScore: result.qualityScore,
              improvements: result.improvements,
              processingTime: result.processingTime,
              metadata: result.metadata
            }
          })}::jsonb,
          updated_at = NOW()
        WHERE id = ${context.messageId}::uuid
      `;

      // Record telemetry
      telemetry.trackEvent('message_enhancement_completed', {
        merchant_id: context.merchantId,
        enhanced: result.enhanced,
        type: result.enhancementType,
        quality_score: result.qualityScore,
        processing_time: result.processingTime
      });

    } catch (error) {
      this.logger.warn('Failed to track enhancement result', { 
        messageId: context.messageId, 
        error: String(error) 
      });
    }
  }

  /**
   * Get default quality thresholds
   */
  private getDefaultThresholds(): QualityThresholds {
    return {
      minConfidence: Number(process.env.ENHANCEMENT_MIN_CONFIDENCE) || 0.7,
      minQualityScore: Number(process.env.ENHANCEMENT_MIN_QUALITY) || 0.6,
      enableThinking: process.env.ENHANCEMENT_ENABLE_THINKING !== 'false',
      applyPatterns: process.env.ENHANCEMENT_APPLY_PATTERNS !== 'false', 
      forceImprovement: process.env.ENHANCEMENT_FORCE_IMPROVEMENT === 'true'
    };
  }

  /**
   * Get enhancement statistics for analytics
   */
  async getEnhancementStats(merchantId: string, days = 7): Promise<any> {
    const sql = this.db.getSQL();

    try {
      const stats = await sql`
        SELECT 
          COUNT(*) as total_messages,
          COUNT(*) FILTER (WHERE (metadata->'enhancement'->>'enhanced')::boolean = true) as enhanced_count,
          AVG((metadata->'enhancement'->>'qualityScore')::float) as avg_quality_score,
          AVG((metadata->'enhancement'->>'processingTime')::int) as avg_processing_time,
          COUNT(*) FILTER (WHERE metadata->'enhancement'->>'type' = 'constitutional') as constitutional_count,
          COUNT(*) FILTER (WHERE metadata->'enhancement'->>'type' = 'thinking') as thinking_count,
          COUNT(*) FILTER (WHERE metadata->'enhancement'->>'type' = 'pattern') as pattern_count,
          COUNT(*) FILTER (WHERE metadata->'enhancement'->>'type' = 'hybrid') as hybrid_count
        FROM message_logs
        WHERE merchant_id = ${merchantId}::uuid
          AND created_at > NOW() - INTERVAL '${days} days'
          AND metadata->'enhancement' IS NOT NULL
      `;

      return stats[0] || {};
    } catch {
      return {};
    }
  }
}

export default MessageEnhancementService;
