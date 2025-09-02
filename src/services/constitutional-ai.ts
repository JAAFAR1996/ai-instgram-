import { getLogger } from './logger.js';
import { telemetry } from './telemetry.js';
import { AI_CONSTITUTION } from '../config/ai-constitution.js';
import type {
  CritiqueResult,
  ValidationResult,
  ResponseContext,
  ImprovementRecord,
  FeedbackOutcome,
  Constitution
} from '../types/constitutional-ai.js';
import { assessResponseQuality, validateAgainstConstitutionText, safeRewrite } from '../utils/response-validator.js';

export class ConstitutionalAI {
  private logger = getLogger({ component: 'constitutional-ai' });
  private constitution: Constitution = AI_CONSTITUTION;

  async critiqueResponse(response: string, context: ResponseContext): Promise<CritiqueResult> {
    const start = Date.now();
    const critique = assessResponseQuality(response, context, this.constitution);
    try {
      telemetry.trackEvent('ai_response_critiqued', {
        score: critique.score,
        meets: critique.meetsThreshold,
        issues: critique.issues.length,
        merchant_id: context.merchantId || 'unknown'
      });
    } catch {}
    this.logger.debug('Critique completed', { score: critique.score, issues: critique.issues.length });
    const dur = Date.now() - start;
    try { telemetry.recordMessageProcessing('instagram', 'outgoing', true, dur); } catch {}
    return critique;
  }

  async improveResponse(response: string, critique: CritiqueResult, context?: ResponseContext): Promise<{ improved: string; record: ImprovementRecord }> {
    const { revised, actions, notes } = safeRewrite(response, critique.issues, context);
    const postCritique = assessResponseQuality(revised, context || {}, this.constitution);
    const record: ImprovementRecord = {
      timestamp: new Date().toISOString(),
      original: response,
      improved: revised,
      prevScore: critique.score,
      newScore: postCritique.score,
      applied: actions,
      notes: [...notes, ...postCritique.suggestions]
    };
    try {
      telemetry.trackEvent('ai_response_improved', {
        prev: critique.score,
        next: postCritique.score,
        delta: postCritique.score - critique.score,
        applied: actions.join(','),
      });
    } catch {}
    this.logger.info('Response improved', { prev: critique.score, next: postCritique.score, actions });
    return { improved: revised, record };
  }

  async validateAgainstConstitution(response: string): Promise<ValidationResult> {
    const res = validateAgainstConstitutionText(response, this.constitution);
    this.logger.debug('Validation result', { passed: res.passed, score: res.score, violations: res.violations.length });
    return res;
  }

  async learnFromFeedback(interaction: { response: string; context?: ResponseContext; variant?: string }, outcome: FeedbackOutcome): Promise<void> {
    try {
      telemetry.trackEvent('ai_feedback', {
        variant: interaction.variant || 'base',
        reaction: outcome.userReaction || 'unknown',
        converted: String(!!outcome.converted),
        satisfaction: typeof outcome.satisfaction === 'number' ? String(outcome.satisfaction) : undefined,
      });
      if (interaction.variant) {
        telemetry.trackEvent('ab_test_outcome', {
          variant: interaction.variant,
          converted: String(!!outcome.converted),
          satisfaction: typeof outcome.satisfaction === 'number' ? String(outcome.satisfaction) : undefined,
        });
      }
    } catch (e) {
      this.logger.warn('Failed to record feedback', { err: String(e) });
    }
  }
}

export default ConstitutionalAI;

