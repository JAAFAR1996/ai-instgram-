/**
 * ===============================================
 * Meta Rate Limiter & Header Monitor (2025 Standards)
 * ✅ مراقبة استخدام الـ API وتطبيق Backoff ذكي
 * ===============================================
 */

import { RATE_LIMIT_HEADERS, RATE_LIMITS } from '../config/graph-api.js';
import { getRedisConnectionManager } from './RedisConnectionManager.js';
import { RedisUsageType } from '../config/RedisConfigurationFactory.js';
import { randomUUID } from 'crypto';

export interface RateLimitStatus {
  appUsage: number;
  businessUsage: number;
  pageUsage: number;
  adsUsage: number;
  timestamp: number;
}

export interface BackoffState {
  isBackingOff: boolean;
  backoffUntil: number;
  backoffDurationMs: number;
  reason: string;
}

export class MetaRateLimiter {
  private currentUsage: RateLimitStatus = {
    appUsage: 0,
    businessUsage: 0,
    pageUsage: 0,
    adsUsage: 0,
    timestamp: Date.now()
  };

  private backoffState: BackoffState = {
    isBackingOff: false,
    backoffUntil: 0,
    backoffDurationMs: 0,
    reason: ''
  };

  private redis = getRedisConnectionManager();

  /**
   * Process rate limit headers from Meta API response
   */
  processRateLimitHeaders(headers: Headers): void {
    const now = Date.now();

    // Parse usage headers
    const appUsageHeader = headers.get('X-App-Usage');
    const businessUsageHeader = headers.get('X-Business-Use-Case-Usage');
    const pageUsageHeader = headers.get('X-Page-Usage');
    const adsUsageHeader = headers.get('X-Ads-Usage');

    // Update current usage
    this.currentUsage = {
      appUsage: this.parseUsageHeader(appUsageHeader, 'call_count'),
      businessUsage: this.parseUsageHeader(businessUsageHeader, 'call_count'),
      pageUsage: this.parseUsageHeader(pageUsageHeader, 'call_count'),
      adsUsage: this.parseUsageHeader(adsUsageHeader, 'call_count'),
      timestamp: now
    };

    // Check if we need to enter backoff mode
    this.evaluateBackoffNeed();
  }

  /**
   * Check if we should back off before making request
   */
  shouldBackOff(): BackoffState {
    const now = Date.now();
    
    // Check if current backoff is still active
    if (this.backoffState.isBackingOff && now < this.backoffState.backoffUntil) {
      return this.backoffState;
    }

    // Clear expired backoff
    if (this.backoffState.isBackingOff && now >= this.backoffState.backoffUntil) {
      this.backoffState = {
        isBackingOff: false,
        backoffUntil: 0,
        backoffDurationMs: 0,
        reason: ''
      };
    }

    return this.backoffState;
  }

  /**
   * Get current usage status
   */
  getCurrentUsage(): RateLimitStatus {
    return { ...this.currentUsage };
  }

  /**
   * Force backoff (for 429 responses)
   */
  forceBackoff(durationMs: number = RATE_LIMITS.BACKOFF_BASE_MS, reason: string = '429_response'): void {
    const jitter = crypto.randomInt(0, RATE_LIMITS.JITTER_MS);
    const actualDuration = Math.min(durationMs + jitter, RATE_LIMITS.BACKOFF_MAX_MS);

    this.backoffState = {
      isBackingOff: true,
      backoffUntil: Date.now() + actualDuration,
      backoffDurationMs: actualDuration,
      reason
    };

    console.warn(`🛑 Meta API backoff activated: ${reason} for ${Math.round(actualDuration/1000)}s`);
  }

  /**
   * Wait for backoff to complete
   */
  async waitForBackoff(): Promise<void> {
    const backoff = this.shouldBackOff();
    
    if (backoff.isBackingOff) {
      const waitTime = backoff.backoffUntil - Date.now();
      
      if (waitTime > 0) {
        console.log(`⏳ Waiting ${Math.round(waitTime/1000)}s for Meta API backoff...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  /**
   * Get recommendations based on current usage
   */
  getUsageRecommendations(): {
    shouldReduce: boolean;
    recommendations: string[];
    criticalThresholds: string[];
  } {
    const recommendations: string[] = [];
    const criticalThresholds: string[] = [];
    let shouldReduce = false;

    // Check app usage
    if (this.currentUsage.appUsage > RATE_LIMITS.APP_USAGE_THRESHOLD) {
      shouldReduce = true;
      if (this.currentUsage.appUsage > 90) {
        criticalThresholds.push(`App usage at ${this.currentUsage.appUsage}% - CRITICAL`);
      } else {
        recommendations.push(`App usage at ${this.currentUsage.appUsage}% - consider reducing requests`);
      }
    }

    // Check business usage
    if (this.currentUsage.businessUsage > RATE_LIMITS.BUSINESS_USAGE_THRESHOLD) {
      shouldReduce = true;
      if (this.currentUsage.businessUsage > 90) {
        criticalThresholds.push(`Business usage at ${this.currentUsage.businessUsage}% - CRITICAL`);
      } else {
        recommendations.push(`Business usage at ${this.currentUsage.businessUsage}% - consider reducing requests`);
      }
    }

    return {
      shouldReduce,
      recommendations,
      criticalThresholds
    };
  }

  /**
   * Parse usage header JSON
   */
  private parseUsageHeader(headerValue: string | null, field: string): number {
    if (!headerValue) return 0;

    try {
      const usage = JSON.parse(headerValue);
      return usage[field] || 0;
    } catch (error) {
      console.warn(`⚠️ Failed to parse usage header: ${headerValue}`);
      return 0;
    }
  }

  /**
   * Evaluate if we need to enter backoff mode
   */
  private evaluateBackoffNeed(): void {
    const { shouldReduce, criticalThresholds } = this.getUsageRecommendations();

    // If we're already in critical territory, force backoff
    if (criticalThresholds.length > 0) {
      const duration = RATE_LIMITS.BACKOFF_BASE_MS * 2; // Double duration for critical
      this.forceBackoff(duration, `Critical thresholds: ${criticalThresholds.join(', ')}`);
      return;
    }

    // If we should reduce but not critical, enter shorter backoff
    if (shouldReduce) {
      this.forceBackoff(RATE_LIMITS.BACKOFF_BASE_MS, 'High usage detected');
    }
  }

  /**
   * Redis-based sliding window rate limiter
   */
  async checkRedisRateLimit(
    key: string, 
    windowMs: number, 
    maxRequests: number
  ): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    try {
      const redis = await this.redis.getConnection(RedisUsageType.RATE_LIMITER);
      const now = Date.now();
      const windowStart = now - windowMs;
      const windowKey = `rate_limit:${key}:${Math.floor(now / windowMs)}`;
      
      // Remove old entries and add current request
      const multi = redis.multi();
      multi.zremrangebyscore(windowKey, 0, windowStart);
      multi.zadd(windowKey, now, `${now}-${randomUUID()}`);
      multi.zcard(windowKey);
      multi.expire(windowKey, Math.ceil(windowMs / 1000) + 1);
      
      const results = await multi.exec();
      const currentCount = results?.[2]?.[1] as number || 0;
      
      return {
        allowed: currentCount <= maxRequests,
        remaining: Math.max(0, maxRequests - currentCount),
        resetTime: now + windowMs
      };
    } catch (error) {
      console.error('❌ Redis rate limit check failed:', error);
      // Fail open - allow request on Redis errors
      return { allowed: true, remaining: maxRequests, resetTime: Date.now() + windowMs };
    }
  }
}

// Singleton instance
let rateLimiterInstance: MetaRateLimiter | null = null;

/**
 * Get Meta rate limiter instance
 */
export function getMetaRateLimiter(): MetaRateLimiter {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new MetaRateLimiter();
  }
  return rateLimiterInstance;
}

/**
 * Enhanced fetch with rate limiting and backoff
 */
export async function fetchWithRateLimit(
  url: string,
  options: RequestInit = {},
  retries: number = 3
): Promise<Response> {
  const rateLimiter = getMetaRateLimiter();

  // Wait for any active backoff
  await rateLimiter.waitForBackoff();

  try {
    const response = await fetch(url, options);

    // Process rate limit headers
    rateLimiter.processRateLimitHeaders(response.headers);

    // Handle 429 responses
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const backoffMs = retryAfter 
        ? parseInt(retryAfter) * 1000 
        : RATE_LIMITS.BACKOFF_BASE_MS * Math.pow(2, 4 - retries); // Exponential backoff

      rateLimiter.forceBackoff(backoffMs, '429_rate_limited');

      if (retries > 0) {
        console.log(`🔄 Retrying request after 429, ${retries} attempts left`);
        await rateLimiter.waitForBackoff();
        return fetchWithRateLimit(url, options, retries - 1);
      }
    }

    return response;
  } catch (error) {
    if (retries > 0) {
      console.log(`🔄 Retrying request after error, ${retries} attempts left`);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Simple retry delay
      return fetchWithRateLimit(url, options, retries - 1);
    }
    throw error;
  }
}

export default MetaRateLimiter;