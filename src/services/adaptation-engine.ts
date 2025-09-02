import type { SuccessPatterns, StrategyUpdate } from '../types/learning.js';

export class AdaptationEngine {
  suggestAdjustments(patterns: SuccessPatterns, preferences?: Record<string, unknown>): StrategyUpdate {
    const bestSlots = patterns.timeSlots
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map(s => s.slot);

    const recPhrases = patterns.topPhrases
      .filter(p => !/اشتري الآن|سارع/i.test(p.phrase)) // avoid pushy
      .slice(0, 5)
      .map(p => p.phrase);

    // Adjust follow-up delay based on preferences, if any signals
    let followup = patterns.followupDelaySec;
    if (preferences && preferences['engagement'] === 'low') followup = Math.min(followup + 10, 180);
    if (preferences && preferences['engagement'] === 'high') followup = Math.max(10, followup - 10);

    return {
      merchantId: patterns.merchantId,
      updatedAt: new Date().toISOString(),
      responseStrategies: {
        bestTimeSlots: bestSlots,
        recommendedPhrases: recPhrases,
        followupDelaySec: followup,
      },
    };
  }
}

export default AdaptationEngine;

