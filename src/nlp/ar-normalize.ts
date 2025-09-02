// Arabic normalization utilities for search/matching (do not alter display text)

const AR_DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g; // tashkeel + tatweel range
const TATWEEL = /\u0640/g;

export interface NormalizationOptions {
  // When true, convert ta marbuta to ha (search only)
  taMarbutaToHa?: boolean;
  // When true, convert alef variants to bare alef
  normalizeAlef?: boolean;
  // When true, convert alef maqsura to ya
  yaFromMaqsura?: boolean;
  // When true, strip diacritics and tatweel
  stripDiacritics?: boolean;
  // Map of per-merchant synonyms to expand search terms
  synonyms?: Record<string, string[]>;
}

export function normalizeArabic(input: string, opts: NormalizationOptions = {}): string {
  let text = input || '';
  if (opts.stripDiacritics !== false) {
    text = text.replace(AR_DIACRITICS, '').replace(TATWEEL, '');
  }
  if (opts.normalizeAlef !== false) {
    // أ/إ/آ -> ا
    text = text.replace(/[\u0623\u0625\u0622]/g, '\u0627');
  }
  if (opts.taMarbutaToHa) {
    // ة -> ه (search only)
    text = text.replace(/\u0629/g, '\u0647');
  }
  if (opts.yaFromMaqsura !== false) {
    // ى -> ي
    text = text.replace(/\u0649/g, '\u064A');
  }
  return standardizeDigits(text).trim();
}

export function standardizeDigits(input: string): string {
  // Arabic-Indic ٠-٩ / Eastern ۰-۹ -> ASCII 0-9
  const arabicIndic = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
  const easternIndic = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
  return input
    .split('')
    .map((ch) => {
      const ai = arabicIndic.indexOf(ch);
      if (ai !== -1) return String(ai);
      const ei = easternIndic.indexOf(ch);
      if (ei !== -1) return String(ei);
      return ch;
    })
    .join('');
}

export function applySynonyms(text: string, synonyms?: Record<string, string[]>): string[] {
  // Returns an array of expansions for fuzzy matching
  if (!synonyms || Object.keys(synonyms).length === 0) return [text];
  const expansions = new Set<string>([text]);
  const normalizedText = normalizeArabic(text, {
    stripDiacritics: true,
    normalizeAlef: true,
    taMarbutaToHa: true,
    yaFromMaqsura: true,
  });

  for (const [canonical, alts] of Object.entries(synonyms)) {
    const nCanon = normalizeArabic(canonical, {
      stripDiacritics: true,
      normalizeAlef: true,
      taMarbutaToHa: true,
      yaFromMaqsura: true,
    });
    if (normalizedText.includes(nCanon)) {
      for (const alt of alts) expansions.add(normalizedText.replace(nCanon, normalizeArabic(alt)));
    }
    for (const alt of alts) {
      const nAlt = normalizeArabic(alt, {
        stripDiacritics: true,
        normalizeAlef: true,
        taMarbutaToHa: true,
        yaFromMaqsura: true,
      });
      if (normalizedText.includes(nAlt)) {
        expansions.add(normalizedText.replace(nAlt, nCanon));
      }
    }
  }
  return Array.from(expansions);
}

export function normalizeForSearch(input: string, synonyms?: Record<string, string[]>): string[] {
  const base = normalizeArabic(input, {
    stripDiacritics: true,
    normalizeAlef: true,
    taMarbutaToHa: true,
    yaFromMaqsura: true,
  });
  return applySynonyms(base, synonyms);
}

