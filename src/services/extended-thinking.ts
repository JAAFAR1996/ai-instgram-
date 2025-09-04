import type { ExtendedThinkingContext, ThinkingChain, ThinkingStep } from '../types/thinking.js';
import { createChain, addStep, finalizeStep, selfReflect, shouldUseExtendedThinking } from '../utils/reasoning-chain.js';
import { telemetry } from './telemetry.js';

export class ExtendedThinkingService {
  /**
   * Run multi-stage thinking on the query and return chain and optional text aide.
   */
  async processWithThinking(query: string, context: ExtendedThinkingContext, showThinking = true): Promise<{ chain: ThinkingChain; visible: boolean; } & Partial<{ aide: string }>>
  {
    const startTime = Date.now();
    
    // 📊 Record extended thinking usage
    telemetry.counter('extended_thinking_requests_total', 'Extended thinking requests').add(1, {
      merchant_id: context.merchantId || 'unknown',
      show_thinking: String(showThinking),
      has_context: String(Boolean(context.nlp))
    });
    
    const chain = await this.generateThinkingChain(query, context, showThinking);

    // ANALYZE → EXPLORE → EVALUATE → DECIDE
    const analyze = chain.steps.find(s => s.stage === 'ANALYZE')!;
    await this.analyzeStep(analyze, context);

    const explore = chain.steps.find(s => s.stage === 'EXPLORE')!;
    await this.analyzeStep(explore, context);

    const evaluate = chain.steps.find(s => s.stage === 'EVALUATE')!;
    try {
      const exploreHyps = Array.isArray((explore.result as any)?.hypotheses) ? (explore.result as any).hypotheses as string[] : [];
      (evaluate.meta ||= {})['exploreHypotheses'] = exploreHyps;
    } catch {}
    await this.analyzeStep(evaluate, context);

    const decide = chain.steps.find(s => s.stage === 'DECIDE')!;
    await this.analyzeStep(decide, context);

    await this.validateReasoning(chain);

    const processingTime = Date.now() - startTime;
    
    // 📊 Record completion metrics
    telemetry.histogram('extended_thinking_processing_time_ms', 'Extended thinking processing time', 'ms').record(processingTime, {
      merchant_id: context.merchantId || 'unknown',
      steps_completed: String(chain.steps.length),
      has_summary: String(Boolean(chain.summary))
    });
    
    // 📈 Record stage completion metrics
    const completedStages = chain.steps.filter(s => s.status === 'completed').map(s => s.stage);
    completedStages.forEach(stage => {
      telemetry.counter('extended_thinking_stages_completed_total', 'Extended thinking stages completed').add(1, {
        stage: stage,
        merchant_id: context.merchantId || 'unknown'
      });
    });

    const payload: { chain: ThinkingChain; visible: boolean } & Partial<{ aide: string }> = {
      chain,
      visible: !!chain.display?.showThinking,
    };
    if (showThinking && chain.summary) {
      payload.aide = `ملخص التفكير: ${chain.summary}`;
    }
    return payload;
  }

  /**
   * Perform the logic of a single step based on its stage.
   */
  async analyzeStep(step: ThinkingStep, context: ExtendedThinkingContext): Promise<void> {
    const q = String(step?.meta?.query ?? step?.input ?? '').toString();
    switch (step.stage) {
      case 'ANALYZE': {
        const tokens = extractKeywords(q);
        const intent = context.nlp?.intent || 'UNKNOWN';
        const nlpConfidence = context.nlp?.confidence ?? 0.5;
        const notes: string[] = [];
        if (context.session && Object.keys(context.session).length) notes.push('استخدام الذاكرة السياقية');
        finalizeStep(step, {
          tokens,
          detectedLanguage: detectLang(q),
          intent,
        }, Math.max(0.5, nlpConfidence), notes);
        break;
      }
      case 'EXPLORE': {
        const hypotheses: string[] = [];
        const ql = q.toLowerCase();
        if (/(سعر|كم|price)/.test(ql)) hypotheses.push('طلب تسعير');
        if (/(سياسة|policy|ارجاع|استرجاع|refund|return)/.test(ql)) hypotheses.push('سؤال سياسة/إرجاع');
        if (/(مقاس|لون|size|color)/.test(ql)) hypotheses.push('تحديد مواصفات المنتج');
        if (!hypotheses.length) hypotheses.push('استفسار عام/توجيه');
        finalizeStep(step, { hypotheses }, hypotheses.length >= 1 ? 0.6 : 0.4);
        break;
      }
      case 'EVALUATE': {
        // Simple evaluation: rank hypotheses by presence of keywords and nlp intent
        const hyps: string[] = Array.isArray((step.meta as any)?.exploreHypotheses)
          ? (step.meta as any).exploreHypotheses as string[]
          : [];
        const ranked = hyps.map(h => ({ h, score: scoreHypothesis(h, q, context) }))
          .sort((a, b) => b.score - a.score);
        const best = ranked[0]?.h ?? hyps[0] ?? 'غير محدد';
        const score = ranked[0]?.score ?? 0.5;
        finalizeStep(step, { best, ranked }, Math.max(0.5, Math.min(1, score)));
        break;
      }
      case 'DECIDE': {
        // Decide on next action phrasing
        const ql = q.toLowerCase();
        const wantsPrice = /(سعر|كم|price)/.test(ql);
        const wantsPolicy = /(سياسة|policy|ارجاع|استرجاع|refund|return)/.test(ql);
        const wantsSpec = /(مقاس|لون|size|color)/.test(ql);

        let decision: string;
        if (wantsPrice) {
          decision = 'تقديم سعر تقريبي إن توفر أو الاستفسار عن الفئة/المقاس.';
        } else if (wantsPolicy) {
          decision = 'اقتباس مقتطف موجز من سياسة المتجر وطلب توضيح إذا لزم.';
        } else if (wantsSpec) {
          decision = 'طرح سؤال توضيحي عن المقاس/اللون للسير قدماً.';
        } else {
          decision = 'توجيه المستخدم لتحديد المنتج والفئة والمقاس/اللون.';
        }
        finalizeStep(step, decision, 0.7);
        break;
      }
      default: {
        finalizeStep(step, undefined, 0.5);
      }
    }
  }

  /**
   * Generate a skeleton chain with stages and an optional initial WAIT indicator.
   */
  async generateThinkingChain(query: string, context?: ExtendedThinkingContext, showThinking = true): Promise<ThinkingChain> {
    const opts: { showThinking?: boolean; showInterimWait?: boolean; intent?: string; confidence?: number } = {
      showThinking,
      showInterimWait: true,
    };
    if (context && context.nlp && typeof context.nlp.intent === 'string') {
      opts.intent = context.nlp.intent;
    }
    if (context && context.nlp && typeof context.nlp.confidence === 'number') {
      opts.confidence = context.nlp.confidence;
    }
    const chain = createChain(query, opts);

    // Optional WAIT step to enable "يفكر..." UI indicators
    const useWait = shouldUseExtendedThinking(query, context?.nlp);
    if (useWait) {
      const s = addStep(chain, 'WAIT', 'Let me think…');
      finalizeStep(s, 'أمهلني لحظة أفكر بالموضوع…', 0.9);
    }

    // Core stages
    addStep(chain, 'ANALYZE', 'تحليل السؤال', { query });
    addStep(chain, 'EXPLORE', 'استكشاف الفرضيات', { query });
    addStep(chain, 'EVALUATE', 'تقييم الخيارات', { query });
    addStep(chain, 'DECIDE', 'القرار');

    return chain;
  }

  /**
   * Validate reasoning, add reflections and finalize chain.
   */
  async validateReasoning(chain: ThinkingChain): Promise<void> {
    selfReflect(chain);
  }
}

function extractKeywords(q: string): string[] {
  return (q || '')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 20);
}

function detectLang(q: string): string {
  // Naive detection sufficient for hinting
  if (/[\u0600-\u06FF]/.test(q)) return 'ar';
  if (/[A-Za-z]/.test(q)) return 'en';
  return 'unknown';
}

function scoreHypothesis(h: string, q: string, context: ExtendedThinkingContext): number {
  const ql = (q || '').toLowerCase();
  let score = 0.5;
  if (/تسعير|price|سعر|كم/.test(h + ' ' + ql)) score += 0.2;
  if (/سياسة|policy|refund|ارجاع|استرجاع|return/.test(h + ' ' + ql)) score += 0.15;
  if (/مقاس|لون|size|color/.test(h + ' ' + ql)) score += 0.1;
  score += Math.max(0, (context?.nlp?.confidence ?? 0) - 0.5) * 0.3;
  return Math.min(1, score);
}

export default ExtendedThinkingService;
