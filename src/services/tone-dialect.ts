/**
 * ===============================================
 * Tone & Dialect Adapter
 * - Adapts AI responses to Iraqi (Baghdadi) dialect when requested
 * - Adjusts tone by customer tier (NEW/REPEAT/VIP) and sentiment
 * ===============================================
 */

export type Dialect = 'standard' | 'baghdadi';
export type Tier = 'NEW' | 'REPEAT' | 'VIP';
export type Sentiment = 'positive' | 'neutral' | 'negative';

export interface ToneDialectOptions {
  dialect: Dialect;
  tier: Tier;
  sentiment: Sentiment;
}

/** Lightweight Arabic/Iraqi sentiment detection (emojis + keywords) */
export function detectSentiment(text: string): Sentiment {
  const t = (text ?? '').toLowerCase();
  if (!t) return 'neutral';
  const posEmoji = ['😍','❤','❤️','👍','😊','😁','🔥','👏','💯','⭐','🥰','😄','😃'];
  const negEmoji = ['😡','😠','👎','😞','😢','😭','💔','🤬'];
  const posWords = ['حلو','حلوة','جميل','تمام','ممتاز','زين','شكراً','تسلم','ثقة','لطيف','great','awesome','nice','love','perfect','thanks','good'];
  const negWords = ['غالي','سيء','رديء','مو','ما','تأخير','مشكلة','خربان','تعبان','أسوأ','bad','late','broken','cancel','غلط'];
  let score = 0;
  for (const e of posEmoji) if (t.includes(e)) score += 2;
  for (const e of negEmoji) if (t.includes(e)) score -= 2;
  for (const w of posWords) if (t.includes(w)) score += 1;
  for (const w of negWords) if (t.includes(w)) score -= 1;
  if (score >= 2) return 'positive';
  if (score <= -2) return 'negative';
  return 'neutral';
}

/** Basic Iraqi colloquial replacements (conservative) */
function toBaghdadi(text: string): string {
  let s = text;
  const rep: Array<[RegExp, string]> = [
    [/\bمرحبا\b/g, 'هلا'],
    [/\bأهلًا\b/g, 'هلا'],
    [/\bكيف\s+حال[ك|كِ]\b/g, 'شلونك'],
    [/\bكيف\b/g, 'شلون'],
    [/\bما\s+هو\b/g, 'شنو'],
    [/\bماذا\b/g, 'شنو'],
    [/\bنعم\b/g, 'إي'],
    [/\bأنت\b/g, 'إنت'],
    [/\bأنا\b/g, 'اني'],
    [/\bشكرا\b/g, 'شكراً، تسلم'],
    [/\bرجاءً\b/g, 'رجاءً لو تكرمت'],
  ];
  for (const [r, v] of rep) s = s.replace(r, v);
  return s;
}

/** Add tier-based courtesy phrases */
function applyTierTone(text: string, tier: Tier): string {
  const base = text.trim();
  if (tier === 'VIP') {
    return `منورنا 🌟، ${base}`;
  }
  if (tier === 'REPEAT') {
    return `نورتنا من جديد 🙌، ${base}`;
  }
  // NEW
  return base.startsWith('هلا') || base.startsWith('مرحبا') ? base : `هلا بيك 👋، ${base}`;
}

/**
 * Apply empathy or enthusiasm based on sentiment
 */
function applySentimentAdjust(text: string, sentiment: Sentiment): string {
  if (sentiment === 'negative') {
    // Soft empathy lead-in
    return `نعتذر إذا صار أي إزعاج 🙏. ${text}`;
  }
  if (sentiment === 'positive') {
    return `يسعدنا رأيك الطيب ✨. ${text}`;
  }
  return text;
}

/** Public API: adapt message by dialect, tier, and sentiment */
export function adaptDialectAndTone(message: string, opts: ToneDialectOptions): string {
  if (!(message && message.trim())) return message;
  let out = message.trim();
  if (opts.dialect === 'baghdadi') out = toBaghdadi(out);
  out = applyTierTone(out, opts.tier);
  out = applySentimentAdjust(out, opts.sentiment);
  return out;
}

/** Simple heuristic to detect promotional content (for 24h window policy) */
export function looksPromotional(text: string): boolean {
  const t = (text ?? '').toLowerCase();
  if (!t) return false;
  const promo = [
    /عرض/gi, /خصم/gi, /كوبون/gi, /اشتر/gi, /اشتري/gi, /buy now/gi, /sale/gi, /promo/gi,
  ];
  return promo.some(r => r.test(t));
}

export default {
  adaptDialectAndTone,
  detectSentiment,
  looksPromotional,
};

