import type { SuccessPatterns } from '../types/learning.js';

type TimeSlot = 'morning'|'afternoon'|'evening'|'night';

export function timeSlotFromDate(d: Date): TimeSlot {
  const h = d.getHours();
  if (h >= 6 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

export function extractPhrases(text: string): string[] {
  const t = (text ?? '').toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ');
  const words = t.split(/\s+/).filter(Boolean);
  const phrases: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    const bi = `${words[i]} ${words[i+1]}`;
    phrases.push(bi);
  }
  return phrases.slice(0, 50);
}

export function computeSuccessPatterns(
  merchantId: string,
  rows: Array<{ content: string; created_at: Date; processing_time_ms?: number; session_data?: Record<string, unknown> }>
): SuccessPatterns {
  const slotMap = new Map<TimeSlot, number>();
  const phraseMap = new Map<string, number>();
  const prefMap = new Map<string, number>();

  for (const r of rows) {
    // Time slots
    const slot = timeSlotFromDate(new Date(r.created_at));
    slotMap.set(slot, (slotMap.get(slot) || 0) + 1);

    // Phrases
    for (const ph of extractPhrases(r.content ?? '')) {
      phraseMap.set(ph, (phraseMap.get(ph) || 0) + 1);
    }

    // Preferences signals from session_data
    const s = r.session_data || {};
    for (const key of ['category','gender','size','color','brand']) {
      const v = s[key];
      if (typeof v === 'string' && v) {
        const k = `${key}:${v}`;
        prefMap.set(k, (prefMap.get(k) || 0) + 1);
      }
    }
  }

  const slots = [...slotMap.entries()].map(([slot, count]) => ({ slot, score: count }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  const phrases = [...phraseMap.entries()].map(([phrase, score]) => ({ phrase, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
  const prefEntries: { key: string; value: string; score: number }[] = [];
  for (const [kv, score] of prefMap.entries()) {
    const parts = kv.split(':');
    const key = parts[0];
    const value = parts[1];
    if (key && value) prefEntries.push({ key, value, score });
  }
  const prefs = prefEntries.sort((a, b) => b.score - a.score).slice(0, 20);

  // Naive followup delay: derive from processing time when available
  const times = rows.map(r => r.processing_time_ms || 0).filter(n => n > 0);
  const avg = times.length ? Math.round(times.reduce((a, c) => a + c, 0) / times.length) : 3000;
  const followupDelaySec = Math.max(10, Math.min(120, Math.round(avg / 1000)));

  return {
    merchantId,
    timeSlots: slots,
    topPhrases: phrases,
    followupDelaySec,
    preferenceSignals: prefs,
    sampleSize: rows.length,
  };
}

