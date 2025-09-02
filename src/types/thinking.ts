/**
 * Extended Thinking/Reasoning types
 * Models a multi-stage reasoning chain with per-step confidence and reflection.
 */

export type ReasoningStage = 'WAIT' | 'ANALYZE' | 'EXPLORE' | 'EVALUATE' | 'DECIDE';

export interface ThinkingStep<TInput = unknown, TResult = unknown> {
  id: string;
  stage: ReasoningStage;
  label: string;
  input?: TInput;
  result?: TResult;
  notes?: string[];
  confidence: number; // 0..1
  startedAt: string; // ISO timestamp
  endedAt?: string; // ISO timestamp
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  reflections?: string[];
  meta?: Record<string, unknown>;
}

export interface ThinkingChain {
  id: string;
  query: string;
  steps: ThinkingStep[];
  createdAt: string;
  completedAt?: string;
  overallConfidence: number; // 0..1
  summary?: string;
  warnings?: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  display?: {
    showThinking: boolean;
    showInterimWait: boolean; // whether to show "يفكر..." indicator
  };
  contextHints?: {
    intent?: string;
    confidence?: number;
  };
}

export interface ExtendedThinkingContext {
  merchantId?: string;
  username?: string;
  session?: Record<string, unknown> | null;
  nlp?: {
    intent?: string;
    entities?: Record<string, unknown>;
    confidence?: number;
  };
  hints?: Record<string, unknown>;
}

