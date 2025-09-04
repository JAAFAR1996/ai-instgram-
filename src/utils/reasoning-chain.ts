import { randomUUID } from 'node:crypto';
import type { ThinkingChain, ThinkingStep, ReasoningStage } from '../types/thinking.js';

export function createChain(query: string, opts?: { showThinking?: boolean; showInterimWait?: boolean; intent?: string; confidence?: number; }): ThinkingChain {
  const display: NonNullable<ThinkingChain['display']> = {
    showThinking: opts?.showThinking ?? true,
    showInterimWait: opts?.showInterimWait ?? true,
  };
  const contextHints: NonNullable<ThinkingChain['contextHints']> = {};
  if (opts && typeof opts.intent === 'string') contextHints.intent = opts.intent;
  if (opts && typeof opts.confidence === 'number') contextHints.confidence = opts.confidence;
  return {
    id: randomUUID(),
    query,
    steps: [],
    createdAt: new Date().toISOString(),
    overallConfidence: 0,
    status: 'pending',
    display,
    contextHints,
  };
}

export function addStep<TIn = unknown>(chain: ThinkingChain, stage: ReasoningStage, label: string, input?: TIn): ThinkingStep<TIn> {
  const step: ThinkingStep<TIn> = {
    id: randomUUID(),
    stage,
    label,
    confidence: 0,
    startedAt: new Date().toISOString(),
    status: 'in_progress',
  };
  if (typeof input !== 'undefined') (step as any).input = input;
  chain.steps.push(step);
  chain.status = 'in_progress';
  return step;
}

export function finalizeStep<TResult = unknown>(step: ThinkingStep<any, TResult>, result: TResult, confidence: number, notes?: string[] | string): void {
  step.result = result;
  step.confidence = clamp01(confidence);
  step.endedAt = new Date().toISOString();
  step.status = 'completed';
  if (notes) step.notes = Array.isArray(notes) ? notes : [notes];
}

export function clamp01(n: number): number {
  if (!isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return Number(n.toFixed(3));
}

export function computeChainConfidence(chain: ThinkingChain): number {
  if (!chain.steps.length) return 0;
  // Weighted: later stages matter more
  const weights: Record<ReasoningStage, number> = {
    WAIT: 0.5,
    ANALYZE: 1,
    EXPLORE: 1,
    EVALUATE: 1.25,
    DECIDE: 1.5,
  };
  let num = 0;
  let den = 0;
  for (const s of chain.steps) {
    const w = weights[s.stage] ?? 1;
    num += w * (s.confidence || 0);
    den += w;
  }
  const base = den > 0 ? num / den : 0;
  // Slight penalty if any step is low confidence (<0.4)
  const hasLow = chain.steps.some(s => (s.confidence || 0) < 0.4);
  const adjusted = hasLow ? base * 0.9 : base;
  return clamp01(adjusted);
}

export function selfReflect(chain: ThinkingChain): void {
  // Simple consistency/reflection heuristic
  const reflections: string[] = [];
  const analyze = chain.steps.find(s => s.stage === 'ANALYZE');
  const explore = chain.steps.find(s => s.stage === 'EXPLORE');
  const evaluate = chain.steps.find(s => s.stage === 'EVALUATE');
  const decide = chain.steps.find(s => s.stage === 'DECIDE');

  if (analyze && explore && decide) {
    const q = String(chain.query || '').toLowerCase();
    const askedForPrice = /\b(price|سعر|كم|فلوس)\b/.test(q);
    const decideMentionsPrice = String(decide.result ?? '').includes('سعر');
    if (askedForPrice && !decideMentionsPrice) {
      reflections.push('القرار لا يغطي سؤال السعر بشكل واضح.');
      // Reduce decide confidence a bit
      decide.confidence = clamp01(decide.confidence * 0.85);
    }
  }

  // Attach reflections to the evaluate or decide step
  const target = evaluate || decide;
  if (target) {
    target.reflections = [...(target.reflections || []), ...reflections];
  }

  chain.overallConfidence = computeChainConfidence(chain);
  if (!chain.completedAt) chain.completedAt = new Date().toISOString();
  chain.status = 'completed';
  if (!chain.summary) {
    chain.summary = summarizeChain(chain);
  }
}

export function summarizeChain(chain: ThinkingChain): string {
  const parts: string[] = [];
  for (const s of chain.steps) {
    const label = s.label || s.stage;
    const conf = Math.round((s.confidence || 0) * 100);
    const snippet = String(s.result ?? '').trim().slice(0, 120).replace(/\s+/g, ' ');
    parts.push(`${label} (${conf}%): ${snippet}`);
  }
  return parts.join(' | ');
}

export function shouldUseExtendedThinking(query: string, nlp?: { intent?: string; confidence?: number }): boolean {
  const q = (query || '').toLowerCase();
  const long = q.length > 100; // enable for moderately long queries too
  const hasWhyOrHow = /(ليش|كيف|شنو|policy|سياسة|استرجاع|إرجاع|return|refund|why|how|طريقة|مشكلة|ضمان|رسوم|توصيل|جدول|مقاس)/.test(q);
  const hasQuestion = q.includes('?') || /^(ليش|كيف|شنو|هل|لو|ممكن)/.test(q.trim());
  const lowNlp = (nlp?.confidence ?? 1) < 0.6;
  const intent = (nlp?.intent || '').toUpperCase();
  const intentComplex = intent === 'OTHER' || intent === 'FAQ' || intent === 'OBJECTION';
  return long || hasWhyOrHow || hasQuestion || lowNlp || intentComplex;
}
