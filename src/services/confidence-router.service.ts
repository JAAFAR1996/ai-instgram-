/**
 * ===============================================
 * Confidence-Based Enhancement Router
 * Intelligent routing based on AI confidence levels and context
 * ===============================================
 */

// removed unused getDatabase import
import { getLogger } from './logger.js';
import { telemetry } from './telemetry.js';
// removed unused MessageEnhancementService import
import ResponseEnhancerService from './response-enhancer.service.js';
import ExtendedThinkingService from './extended-thinking.js';
import { ConstitutionalAI } from './constitutional-ai.js';
// removed unused types import
import type { 
  ResponseEnhancementContext, 
  EnhancedResponseData 
} from './response-enhancer.service.js';

export interface ConfidenceRoutingContext {
  messageId: string;
  merchantId: string;
  customerMessage: string;
  currentResponse: string;
  aiConfidence: number;
  aiIntent?: string;
  processingTime: number;
  platform?: string;
  conversationHistory?: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
  }>;
  customerProfile?: {
    language?: string;
    previousInteractions: number;
    averageResponseTime?: number;
    engagementLevel?: 'high' | 'medium' | 'low';
  };
  urgencyLevel?: 'low' | 'medium' | 'high';
  complexityScore?: number; // 0-1 scale
}

export interface RoutingDecision {
  route: 'direct' | 'enhance' | 'think' | 'hybrid';
  confidence: number;
  reasoning: string[];
  requiredServices: string[];
  estimatedProcessingTime: number;
  fallbackRoute?: 'direct' | 'enhance';
}

export interface RoutedResponse {
  finalResponse: string;
  routeUsed: string;
  processingTime: number;
  qualityScore: number;
  confidenceBoost: number;
  enhancementsApplied: string[];
  metadata: {
    originalConfidence: number;
    finalConfidence: number;
    servicesCalled: string[];
    fallbackUsed: boolean;
    routingDecision: RoutingDecision;
  };
}

export class ConfidenceRouterService {
  // removed unused DB handle
  private logger = getLogger({ component: 'confidence-router' });
  
  // Service dependencies
  // private messageEnhancer = new MessageEnhancementService();
  private responseEnhancer = new ResponseEnhancerService();
  private thinkingService = new ExtendedThinkingService();
  private constitutionalAI = new ConstitutionalAI();

  // Routing configuration
  private readonly CONFIDENCE_THRESHOLDS = {
    HIGH: 0.85,     // Direct route
    MEDIUM: 0.65,   // Enhancement route
    LOW: 0.45,      // Thinking route
    CRITICAL: 0.25  // Hybrid route
  };

  // Performance tracking
  private routePerformance = new Map<string, {
    successRate: number;
    avgProcessingTime: number;
    avgQualityImprovement: number;
    usageCount: number;
  }>();

  /**
   * Main routing decision and execution pipeline
   */
  async routeMessage(context: ConfidenceRoutingContext): Promise<RoutedResponse> {
    const startTime = Date.now();
    
    try {
      // 1. Make routing decision
      const decision = await this.makeRoutingDecision(context);
      
      this.logger.info('Routing decision made', { 
        messageId: context.messageId,
        route: decision.route,
        confidence: context.aiConfidence,
        reasoning: decision.reasoning
      });

      // 2. Execute route
      const result = await this.executeRoute(context, decision);

      // 3. Track performance
      await this.trackRoutePerformance(decision.route, result, Date.now() - startTime);

      return result;

    } catch (error) {
      this.logger.error('Confidence routing failed', { 
        messageId: context.messageId,
        error: String(error) 
      });

      // Emergency fallback - return original response
      return this.createEmergencyResponse(context, Date.now() - startTime);
    }
  }

  /**
   * Intelligent routing decision based on confidence and context
   */
  private async makeRoutingDecision(context: ConfidenceRoutingContext): Promise<RoutingDecision> {
    const reasoning: string[] = [];
    let route: RoutingDecision['route'] = 'direct';
    let estimatedProcessingTime = 100; // Base processing time

    // Primary confidence-based routing
    if (context.aiConfidence >= this.CONFIDENCE_THRESHOLDS.HIGH) {
      route = 'direct';
      reasoning.push(`High confidence (${context.aiConfidence.toFixed(2)}) - direct route`);
    } else if (context.aiConfidence >= this.CONFIDENCE_THRESHOLDS.MEDIUM) {
      route = 'enhance';
      reasoning.push(`Medium confidence (${context.aiConfidence.toFixed(2)}) - enhancement needed`);
      estimatedProcessingTime += 200;
    } else if (context.aiConfidence >= this.CONFIDENCE_THRESHOLDS.LOW) {
      route = 'think';
      reasoning.push(`Low confidence (${context.aiConfidence.toFixed(2)}) - extended thinking required`);
      estimatedProcessingTime += 1000;
    } else {
      route = 'hybrid';
      reasoning.push(`Very low confidence (${context.aiConfidence.toFixed(2)}) - hybrid approach needed`);
      estimatedProcessingTime += 1500;
    }

    // Context-based route modification
    const contextModification = this.applyContextModification(context, route);
    if (contextModification.modified) {
      route = contextModification.newRoute;
      reasoning.push(contextModification.reason);
      estimatedProcessingTime += contextModification.additionalTime;
    }

    // Performance-based route optimization
    const performanceOptimization = this.applyPerformanceOptimization(context, route);
    if (performanceOptimization.modified) {
      route = performanceOptimization.newRoute;
      reasoning.push(performanceOptimization.reason);
    }

    return {
      route,
      confidence: this.calculateRoutingConfidence(context, route),
      reasoning,
      requiredServices: this.getRequiredServices(route),
      estimatedProcessingTime,
      fallbackRoute: this.determineFallbackRoute(route)
    };
  }

  /**
   * Apply context-based modifications to routing decision
   */
  private applyContextModification(
    context: ConfidenceRoutingContext,
    currentRoute: RoutingDecision['route']
  ): { modified: boolean; newRoute: RoutingDecision['route']; reason: string; additionalTime: number } {
    
    // Urgency-based modification
    if (context.urgencyLevel === 'high' && currentRoute === 'think') {
      return {
        modified: true,
        newRoute: 'enhance',
        reason: 'High urgency - downgraded from thinking to enhancement',
        additionalTime: -800
      };
    }

    // Complexity-based modification
    if (context.complexityScore && context.complexityScore > 0.8 && currentRoute === 'direct') {
      return {
        modified: true,
        newRoute: 'enhance',
        reason: `High complexity (${context.complexityScore.toFixed(2)}) - upgraded to enhancement`,
        additionalTime: 200
      };
    }

    // Customer experience-based modification
    if (context.customerProfile?.engagementLevel === 'high' && currentRoute === 'direct') {
      return {
        modified: true,
        newRoute: 'enhance',
        reason: 'High engagement customer - upgraded to enhancement for better experience',
        additionalTime: 150
      };
    }

    // Processing time-based modification
    if (context.processingTime > 3000 && currentRoute === 'think') {
      return {
        modified: true,
        newRoute: 'enhance',
        reason: 'Already slow processing - downgraded to prevent timeout',
        additionalTime: -600
      };
    }

    // Platform-based modification
    if (context.platform === 'instagram' && currentRoute === 'think') {
      return {
        modified: true,
        newRoute: 'enhance',
        reason: 'Instagram platform - faster response needed',
        additionalTime: -500
      };
    }

    return { modified: false, newRoute: currentRoute, reason: '', additionalTime: 0 };
  }

  /**
   * Apply performance-based route optimization
   */
  private applyPerformanceOptimization(
    context: ConfidenceRoutingContext,
    currentRoute: RoutingDecision['route']
  ): { modified: boolean; newRoute: RoutingDecision['route']; reason: string } {
    
    const performance = this.routePerformance.get(`${context.merchantId}:${currentRoute}`);
    
    if (!performance || performance.usageCount < 10) {
      return { modified: false, newRoute: currentRoute, reason: '' };
    }

    // If success rate is very low, try fallback route
    if (performance.successRate < 0.6) {
      const fallbackRoute = this.determineFallbackRoute(currentRoute);
      if (fallbackRoute && fallbackRoute !== currentRoute) {
        return {
          modified: true,
          newRoute: fallbackRoute,
          reason: `Poor success rate (${performance.successRate.toFixed(2)}) - using fallback route`,
        };
      }
    }

    return { modified: false, newRoute: currentRoute, reason: '' };
  }

  /**
   * Execute the selected route
   */
  private async executeRoute(
    context: ConfidenceRoutingContext,
    decision: RoutingDecision
  ): Promise<RoutedResponse> {
    
    const servicesCalled: string[] = [];
    let finalResponse = context.currentResponse;
    let qualityScore = context.aiConfidence;
    let confidenceBoost = 0;
    let enhancementsApplied: string[] = [];
    let fallbackUsed = false;

    try {
      switch (decision.route) {
        case 'direct':
          // Direct route - minimal processing
          servicesCalled.push('direct');
          break;

        case 'enhance':
          // Enhancement route - pattern-based improvements
          const enhancementResult = await this.executeEnhancementRoute(context);
          servicesCalled.push('response-enhancer');
          finalResponse = enhancementResult.enhancedResponse;
          confidenceBoost = enhancementResult.confidenceBoost;
          enhancementsApplied = enhancementResult.appliedPatterns;
          qualityScore = enhancementResult.metadata.qualityPrediction;
          break;

        case 'think':
          // Thinking route - extended reasoning
          const thinkingResult = await this.executeThinkingRoute(context);
          servicesCalled.push('extended-thinking');
          if (thinkingResult.improvedResponse) {
            finalResponse = thinkingResult.improvedResponse;
            qualityScore = Math.min(context.aiConfidence + 0.2, 1.0);
            enhancementsApplied.push('extended-thinking');
          }
          break;

        case 'hybrid':
          // Hybrid route - multiple enhancement strategies
          const hybridResult = await this.executeHybridRoute(context);
          servicesCalled.push(...hybridResult.servicesCalled);
          finalResponse = hybridResult.response;
          qualityScore = hybridResult.qualityScore;
          confidenceBoost = hybridResult.confidenceBoost;
          enhancementsApplied = hybridResult.enhancements;
          break;
      }

    } catch (error) {
      // Fallback execution
      if (decision.fallbackRoute && decision.fallbackRoute !== decision.route) {
        this.logger.warn('Primary route failed, using fallback', { 
          primary: decision.route,
          fallback: decision.fallbackRoute,
          error: String(error)
        });

        const fallbackDecision: RoutingDecision = {
          ...decision,
          route: decision.fallbackRoute
        };

        const fallbackResult = await this.executeRoute(context, fallbackDecision);
        fallbackResult.metadata.fallbackUsed = true;
        return fallbackResult;
      }

      throw error;
    }

    return {
      finalResponse,
      routeUsed: decision.route,
      processingTime: Date.now(),
      qualityScore,
      confidenceBoost,
      enhancementsApplied,
      metadata: {
        originalConfidence: context.aiConfidence,
        finalConfidence: Math.min(context.aiConfidence + confidenceBoost, 1.0),
        servicesCalled,
        fallbackUsed,
        routingDecision: decision
      }
    };
  }

  /**
   * Execute enhancement route
   */
  private async executeEnhancementRoute(context: ConfidenceRoutingContext): Promise<EnhancedResponseData> {
    const enhancementContext: ResponseEnhancementContext = {
      merchantId: context.merchantId,
      customerMessage: context.customerMessage,
      aiIntent: context.aiIntent,
      aiConfidence: context.aiConfidence,
      platform: context.platform,
      timeOfDay: new Date().getHours(),
      customerProfile: context.customerProfile
    };

    return await this.responseEnhancer.enhanceResponse(context.currentResponse, enhancementContext);
  }

  /**
   * Execute thinking route
   */
  private async executeThinkingRoute(context: ConfidenceRoutingContext): Promise<any> {
    return await this.thinkingService.processWithThinking(
      context.customerMessage,
      { merchantId: context.merchantId, nlp: { intent: context.aiIntent, confidence: context.aiConfidence } },
      false
    );
  }

  /**
   * Execute hybrid route with multiple strategies
   */
  private async executeHybridRoute(context: ConfidenceRoutingContext): Promise<{
    response: string;
    qualityScore: number;
    confidenceBoost: number;
    enhancements: string[];
    servicesCalled: string[];
  }> {
    
    const servicesCalled: string[] = [];
    let currentResponse = context.currentResponse;
    let totalBoost = 0;
    const enhancements: string[] = [];

    // 1. First try constitutional AI improvement
    try {
      const critiqueResult = await this.constitutionalAI.critiqueResponse(currentResponse, {
        merchantId: context.merchantId
      });

      if (critiqueResult.score < 0.7) {
        const improvement = await this.constitutionalAI.improveResponse(currentResponse, critiqueResult);
        currentResponse = improvement.improved;
        totalBoost += 0.15;
        enhancements.push('constitutional');
        servicesCalled.push('constitutional-ai');
      }
    } catch (error) {
      this.logger.warn('Constitutional AI failed in hybrid route', { error: String(error) });
    }

    // 2. Then apply pattern enhancement
    try {
      const enhancementResult = await this.executeEnhancementRoute({
        ...context,
        currentResponse
      });
      
      currentResponse = enhancementResult.enhancedResponse;
      totalBoost += enhancementResult.confidenceBoost;
      enhancements.push(...enhancementResult.appliedPatterns);
      servicesCalled.push('response-enhancer');
    } catch (error) {
      this.logger.warn('Response enhancement failed in hybrid route', { error: String(error) });
    }

    // 3. Finally, if still low confidence, try thinking
    const currentConfidence = context.aiConfidence + totalBoost;
    if (currentConfidence < 0.6) {
      try {
        const thinkingResult = await this.executeThinkingRoute({
          ...context,
          currentResponse
        });
        
        if (thinkingResult.improvedResponse) {
          currentResponse = thinkingResult.improvedResponse;
          totalBoost += 0.2;
          enhancements.push('extended-thinking');
          servicesCalled.push('extended-thinking');
        }
      } catch (error) {
        this.logger.warn('Extended thinking failed in hybrid route', { error: String(error) });
      }
    }

    return {
      response: currentResponse,
      qualityScore: Math.min(context.aiConfidence + totalBoost, 1.0),
      confidenceBoost: totalBoost,
      enhancements,
      servicesCalled
    };
  }

  /**
   * Calculate routing decision confidence
   */
  private calculateRoutingConfidence(
    context: ConfidenceRoutingContext,
    route: RoutingDecision['route']
  ): number {
    
    let confidence = 0.7; // Base confidence

    // Route-specific confidence adjustments
    switch (route) {
      case 'direct':
        confidence += context.aiConfidence * 0.3;
        break;
      case 'enhance':
        confidence += 0.1;
        break;
      case 'think':
        confidence += 0.15;
        break;
      case 'hybrid':
        confidence += 0.2;
        break;
    }

    // Context-based adjustments
    if (context.urgencyLevel === 'high') confidence -= 0.05;
    if (context.complexityScore && context.complexityScore > 0.7) confidence += 0.1;
    if (context.customerProfile?.engagementLevel === 'high') confidence += 0.05;

    return Math.min(confidence, 1.0);
  }

  /**
   * Get required services for route
   */
  private getRequiredServices(route: RoutingDecision['route']): string[] {
    switch (route) {
      case 'direct': return [];
      case 'enhance': return ['response-enhancer'];
      case 'think': return ['extended-thinking'];
      case 'hybrid': return ['constitutional-ai', 'response-enhancer', 'extended-thinking'];
      default: return [];
    }
  }

  /**
   * Determine fallback route
   */
  private determineFallbackRoute(route: RoutingDecision['route']): 'direct' | 'enhance' | undefined {
    switch (route) {
      case 'think': return 'enhance';
      case 'hybrid': return 'enhance';
      case 'enhance': return 'direct';
      default: return undefined;
    }
  }

  /**
   * Create emergency response for failures
   */
  private createEmergencyResponse(
    context: ConfidenceRoutingContext,
    processingTime: number
  ): RoutedResponse {
    
    return {
      finalResponse: context.currentResponse,
      routeUsed: 'emergency',
      processingTime,
      qualityScore: context.aiConfidence,
      confidenceBoost: 0,
      enhancementsApplied: [],
      metadata: {
        originalConfidence: context.aiConfidence,
        finalConfidence: context.aiConfidence,
        servicesCalled: ['emergency'],
        fallbackUsed: false,
        routingDecision: {
          route: 'direct',
          confidence: 0,
          reasoning: ['Emergency fallback due to routing failure'],
          requiredServices: [],
          estimatedProcessingTime: processingTime
        }
      }
    };
  }

  /**
   * Track route performance for optimization
   */
  private async trackRoutePerformance(
    route: string,
    result: RoutedResponse,
    actualProcessingTime: number
  ): Promise<void> {
    
    try {
      // Track telemetry
      telemetry.trackEvent('confidence_routing_completed', {
        route,
        quality_score: result.qualityScore,
        confidence_boost: result.confidenceBoost,
        processing_time: actualProcessingTime,
        enhancements_count: result.enhancementsApplied.length
      });

      telemetry.histogram('confidence_routing_duration_ms', 'Confidence routing processing time', 'ms')
        .record(actualProcessingTime, { route });

      // Update performance tracking
      const performanceKey = `${route}`;
      const current = this.routePerformance.get(performanceKey) || {
        successRate: 0,
        avgProcessingTime: 0,
        avgQualityImprovement: 0,
        usageCount: 0
      };

      const isSuccess = result.qualityScore > 0.6;
      const qualityImprovement = result.metadata.finalConfidence - result.metadata.originalConfidence;

      // Exponential moving average
      const alpha = 0.1;
      current.successRate = current.successRate * (1 - alpha) + (isSuccess ? 1 : 0) * alpha;
      current.avgProcessingTime = current.avgProcessingTime * (1 - alpha) + actualProcessingTime * alpha;
      current.avgQualityImprovement = current.avgQualityImprovement * (1 - alpha) + qualityImprovement * alpha;
      current.usageCount++;

      this.routePerformance.set(performanceKey, current);

    } catch (error) {
      this.logger.warn('Failed to track route performance', { error: String(error) });
    }
  }

  /**
   * Get routing statistics for analytics
   */
  async getRoutingStats(merchantId: string, days = 7): Promise<any> {
    try {
      const stats = {
        totalRouted: 0,
        routeDistribution: {} as Record<string, number>,
        averageProcessingTime: 0,
        averageQualityImprovement: 0,
        fallbackUsage: 0,
        performanceData: Object.fromEntries(this.routePerformance.entries()),
        requestedMerchantId: merchantId,
        windowDays: days
      };

      // Get database stats would require message_logs analysis
      // This is a placeholder for the structure
      return stats;
    } catch {
      return {};
    }
  }
}

export default ConfidenceRouterService;
