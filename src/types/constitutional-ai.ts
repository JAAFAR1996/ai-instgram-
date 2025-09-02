/**
 * Constitutional AI - Types
 */

export type PrincipleCategory = 'accuracy' | 'ethics' | 'culture' | 'privacy' | 'transparency' | 'quality' | 'safety';

export interface Principle {
  id: string;
  text: string;
  category: PrincipleCategory;
  weight: number; // 0..1
  severity: 1 | 2 | 3 | 4 | 5; // guideline impact
}

export interface Constitution {
  version: string;
  locale: string;
  principles: Principle[];
}

export interface ResponseContext {
  merchantId?: string;
  username?: string;
  intent?: string;
  stage?: string;
  entities?: Record<string, unknown>;
  session?: Record<string, unknown> | null;
  kbSourceTitle?: string;
}

export interface CritiqueIssue {
  principleId: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
  suggestion?: string;
  category?: PrincipleCategory;
}

export interface CritiqueResult {
  score: number; // 0..100
  issues: CritiqueIssue[];
  suggestions: string[];
  meetsThreshold: boolean;
  categoryScores: Record<string, number>; // 0..100 per category
  appliedChecks: string[];
}

export interface ValidationItem {
  principle: Principle;
  passed: boolean;
  details?: string;
}

export interface ValidationResult {
  passed: boolean;
  items: ValidationItem[];
  violations: CritiqueIssue[];
  score: number; // 0..100
}

export interface ImprovementRecord {
  timestamp: string;
  original: string;
  improved: string;
  prevScore: number;
  newScore: number;
  applied: string[];
  notes: string[];
}

export interface FeedbackOutcome {
  variant?: string; // for A/B
  userReaction?: 'positive' | 'neutral' | 'negative';
  converted?: boolean; // purchase or key conversion
  timeToRespondMs?: number;
  satisfaction?: number; // 0..100
  metadata?: Record<string, unknown>;
}

