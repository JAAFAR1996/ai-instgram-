/**
 * Self-Learning Loop - Types
 */

export type OutcomeType = 'REPLY_SENT' | 'FOLLOW_UP' | 'CONVERTED' | 'LOST' | 'PENDING';

export interface LearningOutcome {
  type: OutcomeType;
  converted?: boolean;
  conversionValue?: number;
  satisfaction?: number; // 0..100
  lostReason?: string;
  strategiesUsed?: string[];
  stage?: string;
  intent?: string;
  qualityScore?: number;
  metadata?: Record<string, unknown>;
  at?: string; // ISO timestamp
}

export interface SuccessPatterns {
  merchantId: string;
  timeSlots: { slot: 'morning'|'afternoon'|'evening'|'night'; score: number }[];
  topPhrases: { phrase: string; score: number }[];
  followupDelaySec: number; // recommended
  preferenceSignals: { key: string; value: string; score: number }[];
  sampleSize: number;
  // Optional intent-based statistics when available
  intentSuccess?: Record<string, any>;
}

export interface StrategyUpdate {
  merchantId: string;
  updatedAt: string;
  responseStrategies: {
    bestTimeSlots: string[];
    recommendedPhrases: string[];
    followupDelaySec: number;
  };
}
