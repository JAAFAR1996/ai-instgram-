import type { Redis as RedisType } from 'ioredis';

interface QuotaUsage {
  used: number;
  limit: number;
  percentage: number;
}

export interface QuotaCheckResult {
  level: 'NORMAL' | 'WARNING' | 'CRITICAL';
  usage?: QuotaUsage;
  recommendedIntervalMultiplier: number;
}

export class UpstashQuotaMonitor {
  private lastLevel: 'NORMAL' | 'WARNING' | 'CRITICAL' = 'NORMAL';
  private restUrl?: string;
  private restToken?: string;
  private thresholds: [number, number];

  constructor(
    private logger: any,
    options?: {
      restUrl?: string;
      restToken?: string;
      thresholds?: [number, number];
    }
  ) {
    this.restUrl = options?.restUrl ?? process.env.UPSTASH_REDIS_REST_URL ?? '';
    this.restToken = options?.restToken ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? '';
    this.thresholds = options?.thresholds || [0.8, 0.95];
  }

  private async fetchUsageViaRest(): Promise<QuotaUsage | null> {
    if (!this.restUrl || !this.restToken) {
      return null;
    }

    try {
      const response = await fetch(`${this.restUrl}/_upstash/usage`, {
        headers: {
          Authorization: `Bearer ${this.restToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: any = await response.json();
      const used = Number(data?.requests ?? data?.usage?.requests ?? 0);
      const limit = Number(data?.limit ?? data?.usage?.limit ?? 1);
      return { used, limit, percentage: used / limit };
    } catch (error) {
      this.logger.warn('فشل في جلب بيانات الحصة من Upstash REST', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async fetchUsageViaInfo(redis?: RedisType): Promise<QuotaUsage | null> {
    if (!redis) {
      return null;
    }

    try {
      const info = await redis.info();
      const usedMatch = info.match(/total_commands_processed:(d+)/);
      const used = usedMatch ? Number(usedMatch[1]) : 0;
      const limit = Number(process.env.UPSTASH_REDIS_REQUEST_LIMIT || 100000);
      return { used, limit, percentage: used / limit };
    } catch (error) {
      this.logger.error('فشل في جلب بيانات الحصة عبر INFO', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async check(redis?: RedisType): Promise<QuotaCheckResult> {
    const usage =
      (await this.fetchUsageViaRest()) || (await this.fetchUsageViaInfo(redis));

    if (!usage) {
      return {
        level: 'NORMAL',
        recommendedIntervalMultiplier: 1,
      };
    }

    const [warnThreshold, criticalThreshold] = this.thresholds;
    let level: 'NORMAL' | 'WARNING' | 'CRITICAL' = 'NORMAL';
    let multiplier = 1;

    if (usage.percentage >= criticalThreshold) {
      level = 'CRITICAL';
      multiplier = 4;
    } else if (usage.percentage >= warnThreshold) {
      level = 'WARNING';
      multiplier = 2;
    }

    if (level !== 'NORMAL' && level !== this.lastLevel) {
      const message =
        level === 'CRITICAL'
          ? '🚨 تم الوصول إلى حد الحصة الحرجة في Upstash'
          : '⚠️ اقترب استخدام Upstash من الحد المسموح';
      // يمكن استبدال هذا بتنبيه Slack أو بريد إلكتروني
      this.logger.warn(message, { usage });
    }

    this.lastLevel = level;
    return { level, usage, recommendedIntervalMultiplier: multiplier };
  }
}
