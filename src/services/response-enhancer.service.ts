/**
 * ===============================================
 * Response Enhancer Service - Success Pattern Integration
 * Connects success patterns to real-time response generation
 * ===============================================
 */

import { getDatabase } from '../db/adapter.js';
import { getLogger } from './logger.js';
import { telemetry } from './telemetry.js';
import { SelfLearningSystem } from './learning-analytics.js';
import type { SuccessPatterns } from '../types/learning.js';

export interface ResponseEnhancementContext {
  merchantId: string;
  customerMessage: string;
  aiIntent?: string;
  aiConfidence: number;
  conversationId?: string;
  platform?: string;
  timeOfDay?: number; // 0-23 hour
  customerProfile?: {
    language?: string;
    previousPurchases?: boolean;
    engagementLevel?: 'high' | 'medium' | 'low';
  };
}

export interface EnhancedResponseData {
  originalResponse: string;
  enhancedResponse: string;
  appliedPatterns: string[];
  confidenceBoost: number;
  reasoningChain: string[];
  metadata: {
    patternsUsed: number;
    timeOptimized: boolean;
    phraseIntegrated: boolean;
    intentOptimized: boolean;
    qualityPrediction: number;
  };
}

export interface PatternMatchResult {
  matched: boolean;
  pattern: string;
  confidence: number;
  applications: string[];
}

export class ResponseEnhancerService {
  private db = getDatabase();
  private logger = getLogger({ component: 'response-enhancer' });
  private learningSystem = new SelfLearningSystem();

  // Pattern cache with intelligent eviction
  private patternCache = new Map<string, {
    patterns: SuccessPatterns;
    lastUsed: number;
    hitCount: number;
  }>();
  
  private readonly PATTERN_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
  private readonly MAX_CACHE_SIZE = 100;

  /**
   * Enhance response using success patterns and merchant-specific optimizations
   */
  async enhanceResponse(
    baseResponse: string,
    context: ResponseEnhancementContext
  ): Promise<EnhancedResponseData> {
    
    const startTime = Date.now();
    let enhancedResponse = baseResponse;
    const appliedPatterns: string[] = [];
    const reasoningChain: string[] = [];
    let confidenceBoost = 0;

    try {
      // 1. Get merchant success patterns
      const patterns = await this.getMerchantPatterns(context.merchantId);
      reasoningChain.push(`Loaded patterns: ${patterns ? patterns.topPhrases.length : 0} top phrases`);

      if (!patterns) {
        reasoningChain.push('No patterns available - using baseline response');
        return this.createResult(baseResponse, baseResponse, [], 0, reasoningChain, {});
      }

      // 2. Apply Time-of-Day Optimization
      if (context.timeOfDay !== undefined) {
        const timeResult = this.applyTimeOptimizationSafe(enhancedResponse, patterns, context.timeOfDay);
        if (timeResult.enhanced) {
          enhancedResponse = timeResult.response;
          appliedPatterns.push('time_optimized');
          confidenceBoost += 0.1;
          reasoningChain.push(`Time optimization applied: ${context.timeOfDay}h`);
        }
      }

      // 3. Apply Intent-Specific Patterns
      if (context.aiIntent) {
        const ps = (patterns as unknown) as Record<string, unknown>;
        const is = ps.intentSuccess as Record<string, unknown> | undefined;
        if (is && Object.prototype.hasOwnProperty.call(is, String(context.aiIntent))) {
        const intentResult = this.applyIntentPatterns(
          enhancedResponse, 
          patterns, 
          context.aiIntent
        );
        
          if (intentResult.enhanced) {
            enhancedResponse = intentResult.response;
            appliedPatterns.push(`intent_${context.aiIntent.toLowerCase()}`);
            confidenceBoost += intentResult.boost;
            reasoningChain.push(`Intent patterns applied: ${context.aiIntent} (boost: +${intentResult.boost.toFixed(2)})`);
          }
        }
      }

      // 4. Apply Top Performing Phrases
      const phraseResult = this.applySuccessfulPhrases(enhancedResponse, patterns);
      if (phraseResult.enhanced) {
        enhancedResponse = phraseResult.response;
        appliedPatterns.push('successful_phrases');
        confidenceBoost += 0.05;
        reasoningChain.push(`Successful phrases integrated: ${phraseResult.phrasesAdded}`);
      }

      // 5. Apply Customer Profile Optimization
      if (context.customerProfile) {
        const profileResult = this.applyCustomerProfileOptimization(
          enhancedResponse, 
          context.customerProfile
        );
        
        if (profileResult.enhanced) {
          enhancedResponse = profileResult.response;
          appliedPatterns.push('customer_optimized');
          confidenceBoost += profileResult.boost;
          reasoningChain.push(`Customer profile optimization: ${profileResult.optimizations.join(', ')}`);
        }
      }

      // 6. Apply Platform-Specific Optimizations
      if (context.platform) {
        const platformResult = this.applyPlatformOptimization(enhancedResponse, context.platform);
        if (platformResult.enhanced) {
          enhancedResponse = platformResult.response;
          appliedPatterns.push(`platform_${context.platform}`);
          reasoningChain.push(`Platform optimization: ${context.platform}`);
        }
      }

      // 7. Quality Prediction
      const qualityPrediction = this.predictResponseQuality(
        enhancedResponse, 
        patterns, 
        context,
        appliedPatterns.length
      );

      reasoningChain.push(`Quality prediction: ${qualityPrediction.toFixed(2)}`);

      // 8. Track Enhancement Usage
      await this.trackEnhancementUsage(context, appliedPatterns, confidenceBoost);

      const processingTime = Date.now() - startTime;
      telemetry.histogram('response_enhancement_duration_ms', 'Response enhancement processing time', 'ms')
        .record(processingTime, { merchant_id: context.merchantId });

      return this.createResult(
        baseResponse,
        enhancedResponse,
        appliedPatterns,
        confidenceBoost,
        reasoningChain,
        {
          patternsUsed: appliedPatterns.length,
          timeOptimized: appliedPatterns.includes('time_optimized'),
          phraseIntegrated: appliedPatterns.includes('successful_phrases'),
          intentOptimized: appliedPatterns.some(p => p.startsWith('intent_')),
          qualityPrediction
        }
      );

    } catch (error) {
      this.logger.error('Response enhancement failed', { 
        merchantId: context.merchantId,
        error: String(error) 
      });

      reasoningChain.push(`Enhancement failed: ${error}`);
      return this.createResult(baseResponse, baseResponse, [], 0, reasoningChain, {});
    }
  }

  // removed unused applyTimeOptimization (replaced by applyTimeOptimizationSafe)

  // Safe version aligned with SuccessPatterns shape
  private applyTimeOptimizationSafe(
    response: string,
    patterns: SuccessPatterns,
    currentHour: number
  ): { enhanced: boolean; response: string } {
    const slotForHour = (h: number): 'morning'|'afternoon'|'evening'|'night' =>
      h >= 6 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 22 ? 'evening' : 'night';

    if (!patterns.timeSlots || patterns.timeSlots.length === 0) {
      return { enhanced: false, response };
    }

    const currentSlot = slotForHour(currentHour);
    const top = [...patterns.timeSlots].sort((a, b) => b.score - a.score)[0];
    if (!top || top.slot !== currentSlot) {
      return { enhanced: false, response };
    }

    let optimizedResponse = response;
    if (currentHour >= 6 && currentHour < 12) {
      if (!response.includes('صباح') && !response.includes('morning')) {
        optimizedResponse = `صباح الخير! ${response}`;
      }
    } else if (currentHour >= 12 && currentHour < 17) {
      optimizedResponse = response.replace(/!+/g, '.');
    } else if (currentHour >= 17 && currentHour < 24) {
      if (!response.includes('مساء') && !response.includes('evening')) {
        optimizedResponse = `مساء الخير! ${response}`;
      }
    }

    return {
      enhanced: optimizedResponse !== response,
      response: optimizedResponse,
    };
  }

  /**
   * Apply intent-specific successful patterns
   */
  private applyIntentPatterns(
    response: string,
    patterns: SuccessPatterns,
    intent: string
  ): { enhanced: boolean; response: string; boost: number } {
    
    const is = ((patterns as unknown) as Record<string, unknown>).intentSuccess as Record<string, unknown> | undefined; const intentData = is ? (is[String(intent)] as { avgScore?: number }) : undefined; const avg = intentData?.avgScore ?? 0;
    if (!intentData || avg < 0.6) {
      return { enhanced: false, response, boost: 0 };
    }

    let optimizedResponse = response;
    let boost = 0;

    // Apply intent-specific enhancements
    switch (intent) {
      case 'PRICE':
        if (avg > 0.8 && !response.includes('سعر') && !response.includes('price')) {
          optimizedResponse += ' يمكنني أن أوضح لك تفاصيل الأسعار والعروض المتاحة.';
          boost = 0.15;
        }
        break;

      case 'INVENTORY':
        if (avg > 0.8 && !response.includes('متوفر') && !response.includes('stock')) {
          optimizedResponse += ' دعني أتحقق من التوفر الحالي لك فوراً.';
          boost = 0.15;
        }
        break;

      case 'OBJECTION':
        if (avg > 0.7) {
          // Add empathy and solution-focused language
          const empathyPhrases = ['أتفهم تماماً', 'هذا مهم جداً', 'دعني أساعدك'];
          const missingEmpathy = empathyPhrases.find(phrase => !response.includes(phrase));
          if (missingEmpathy) {
            optimizedResponse = `${missingEmpathy}، ${response}`;
            boost = 0.12;
          }
        }
        break;

      case 'FAQ':
        if (avg > 0.75 && response.length < 100) {
          optimizedResponse += ' هل تحتاج لتوضيحات إضافية؟';
          boost = 0.08;
        }
        break;
    }

    return { 
      enhanced: boost > 0, 
      response: optimizedResponse, 
      boost 
    };
  }

  /**
   * Apply successful phrases from patterns
   */
  private applySuccessfulPhrases(
    response: string,
    patterns: SuccessPatterns
  ): { enhanced: boolean; response: string; phrasesAdded: number } {
    
    if (!patterns.topPhrases.length) {
      return { enhanced: false, response, phrasesAdded: 0 };
    }

    let optimizedResponse = response;
    let phrasesAdded = 0;

    // Apply top 3 phrases if they're not already present and score is high
    for (const phraseData of patterns.topPhrases.slice(0, 3)) {
      if (phraseData.score < 0.8 || response.includes(phraseData.phrase)) {
        continue;
      }

      // Intelligent phrase integration based on context
      const integrationResult = this.integratePhrase(
        optimizedResponse, 
        phraseData.phrase
      );
      
      if (integrationResult.integrated) {
        optimizedResponse = integrationResult.response;
        phrasesAdded++;
      }
    }

    return { 
      enhanced: phrasesAdded > 0, 
      response: optimizedResponse, 
      phrasesAdded 
    };
  }

  /**
   * Intelligently integrate successful phrase into response
   */
  private integratePhrase(
    response: string,
    phrase: string
  ): { integrated: boolean; response: string } {
    
    // Don't integrate if response is already long
    if (response.length > 200) {
      return { integrated: false, response };
    }

    // Context-aware integration
    if (phrase.includes('شكر') || phrase.includes('thank')) {
      // Gratitude phrases - append at the end
      return { integrated: true, response: `${response} ${phrase}` };
    }

    if (phrase.includes('مرحب') || phrase.includes('welcome')) {
      // Welcome phrases - prepend
      return { integrated: true, response: `${phrase} ${response}` };
    }

    if (phrase.includes('مساعد') || phrase.includes('help')) {
      // Help offer phrases - append
      return { integrated: true, response: `${response} ${phrase}` };
    }

    // Default integration at the end
    return { integrated: true, response: `${response} ${phrase}` };
  }

  /**
   * Apply customer profile-based optimizations
   */
  private applyCustomerProfileOptimization(
    response: string,
    profile: NonNullable<ResponseEnhancementContext['customerProfile']>
  ): { enhanced: boolean; response: string; boost: number; optimizations: string[] } {
    
    let optimizedResponse = response;
    let boost = 0;
    const optimizations: string[] = [];

    // Language preference optimization
    if (profile.language === 'ar' && response.split(' ').some(word => /[a-zA-Z]/.test(word))) {
      // Contains English words - boost Arabic
      optimizations.push('arabic_preferred');
      boost += 0.05;
    }

    // Returning customer optimization
    if (profile.previousPurchases) {
      if (!response.includes('مرة أخرى') && !response.includes('again')) {
        optimizedResponse = `يسعدنا تعاملك معنا مرة أخرى! ${response}`;
        optimizations.push('returning_customer');
        boost += 0.1;
      }
    }

    // Engagement level optimization
    switch (profile.engagementLevel) {
      case 'high':
        if (response.length < 80) {
          optimizedResponse += ' يمكنني تقديم المزيد من التفاصيل إذا كنت تحتاجها.';
          optimizations.push('high_engagement');
          boost += 0.08;
        }
        break;
      case 'low':
        // Keep it concise and clear
        if (response.length > 150) {
          optimizations.push('low_engagement_simplified');
          boost += 0.05;
        }
        break;
    }

    return {
      enhanced: optimizations.length > 0,
      response: optimizedResponse,
      boost,
      optimizations
    };
  }

  /**
   * Apply platform-specific optimizations
   */
  private applyPlatformOptimization(
    response: string,
    platform: string
  ): { enhanced: boolean; response: string } {
    
    let optimizedResponse = response;

    switch (platform) {
      case 'instagram':
        // Instagram prefers more engaging, visual language
        if (!response.includes('📱') && !response.includes('🛍️') && response.length < 100) {
          optimizedResponse = `${response} 🛍️`;
        }
        break;
      case 'whatsapp':
        // WhatsApp can handle longer messages
        if (response.length < 60) {
          optimizedResponse += ' يمكنك الرد في أي وقت.';
        }
        break;
    }

    return { 
      enhanced: optimizedResponse !== response, 
      response: optimizedResponse 
    };
  }

  /**
   * Predict response quality based on patterns and enhancements
   */
  private predictResponseQuality(
    response: string,
    patterns: SuccessPatterns,
    context: ResponseEnhancementContext,
    enhancementsApplied: number
  ): number {
    
    let qualityScore = 0.5; // Base score

    // Length optimization
    if (response.length >= 50 && response.length <= 150) {
      qualityScore += 0.1;
    }

    // Intent match bonus
    if (context.aiIntent) { 
      const is2 = ((patterns as unknown) as Record<string, unknown>).intentSuccess as Record<string, unknown> | undefined; 
      const d = is2 ? (is2[String(context.aiIntent)] as { avgScore?: number }) : undefined; 
      if ((d?.avgScore ?? 0) > 0.7) {
        qualityScore += 0.15;
      }
    }

    // Enhancement bonus
    qualityScore += Math.min(enhancementsApplied * 0.05, 0.2);

    // Confidence factor
    qualityScore += Math.max(0, (context.aiConfidence - 0.5) * 0.4);

    return Math.min(qualityScore, 1.0);
  }

  /**
   * Get merchant patterns with intelligent caching
   */
  private async getMerchantPatterns(merchantId: string): Promise<SuccessPatterns | null> {
    const cached = this.patternCache.get(merchantId);
    const now = Date.now();

    if (cached && (now - cached.lastUsed) < this.PATTERN_CACHE_TTL) {
      cached.lastUsed = now;
      cached.hitCount++;
      return cached.patterns;
    }

    try {
      const patterns = await this.learningSystem.analyzeSuccessPatterns(merchantId, 14);
      
      // Cache eviction if needed
      if (this.patternCache.size >= this.MAX_CACHE_SIZE) {
        const lruKey = this.findLRUKey();
        if (lruKey) this.patternCache.delete(lruKey);
      }

      this.patternCache.set(merchantId, { 
        patterns, 
        lastUsed: now, 
        hitCount: 1 
      });

      return patterns;
    } catch (error) {
      this.logger.warn('Failed to get merchant patterns', { merchantId, error: String(error) });
      return null;
    }
  }

  /**
   * Find least recently used cache key for eviction
   */
  private findLRUKey(): string | null {
    let lruKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, value] of this.patternCache.entries()) {
      if (value.lastUsed < oldestTime) {
        oldestTime = value.lastUsed;
        lruKey = key;
      }
    }

    return lruKey;
  }

  /**
   * Track enhancement usage for analytics
   */
  private async trackEnhancementUsage(
    context: ResponseEnhancementContext,
    appliedPatterns: string[],
    confidenceBoost: number
  ): Promise<void> {
    
    try {
      telemetry.trackEvent('response_pattern_enhancement', {
        merchant_id: context.merchantId,
        patterns_applied: appliedPatterns.length,
        confidence_boost: confidenceBoost,
        intent: context.aiIntent || 'unknown',
        platform: context.platform || 'unknown'
      });

      // Track pattern effectiveness
      for (const pattern of appliedPatterns) {
        telemetry.counter('pattern_usage_total', 'Pattern usage counter')
          .add(1, { pattern, merchant_id: context.merchantId });
      }
    } catch (error) {
      this.logger.warn('Failed to track enhancement usage', { error: String(error) });
    }
  }

  /**
   * Create standardized result object
   */
  private createResult(
    original: string,
    enhanced: string,
    patterns: string[],
    boost: number,
    reasoning: string[],
    metadata: Record<string, unknown>
  ): EnhancedResponseData {
    
    return {
      originalResponse: original,
      enhancedResponse: enhanced,
      appliedPatterns: patterns,
      confidenceBoost: boost,
      reasoningChain: reasoning,
      metadata: {
        patternsUsed: patterns.length,
        timeOptimized: Boolean((metadata as any).timeOptimized),
        phraseIntegrated: Boolean((metadata as any).phraseIntegrated),
        intentOptimized: Boolean((metadata as any).intentOptimized),
        qualityPrediction: Number((metadata as any).qualityPrediction ?? 0.5)
      }
    };
  }

  /**
   * Get enhancement statistics for merchant
   */
  async getEnhancementStats(merchantId: string, days = 7): Promise<any> {
    const sql = this.db.getSQL();

    try {
      const stats = await sql`
        SELECT 
          COUNT(*) as total_enhancements,
          AVG(CAST(metadata->'enhancement'->>'confidenceBoost' AS FLOAT)) as avg_confidence_boost,
          COUNT(*) FILTER (WHERE metadata->'enhancement'->'appliedPatterns' ? 'time_optimized') as time_optimizations,
          COUNT(*) FILTER (WHERE metadata->'enhancement'->'appliedPatterns' ? 'successful_phrases') as phrase_integrations,
          COUNT(*) FILTER (WHERE (metadata->'enhancement'->'appliedPatterns')::text LIKE '%intent_%') as intent_optimizations,
          AVG(CAST(metadata->'enhancement'->'metadata'->>'qualityPrediction' AS FLOAT)) as avg_quality_prediction
        FROM message_logs
        WHERE merchant_id = ${merchantId}::uuid
          AND created_at > NOW() - (${days}::int * INTERVAL '1 day')
          AND metadata->'enhancement' IS NOT NULL
      `;

      return stats[0] || {};
    } catch (error) {
      this.logger.warn('Failed to get enhancement stats', { merchantId, error: String(error) });
      return {};
    }
  }
}

export default ResponseEnhancerService;
