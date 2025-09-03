import { normalizeArabic, normalizeForSearch } from './ar-normalize.js';

export type Intent = 'PRICE' | 'INVENTORY' | 'FAQ' | 'OBJECTION' | 'SMALL_TALK' | 'OTHER';

export interface Entities {
  category?: string | null;
  gender?: string | null; // رجالي / نسائي / ولادي ...
  size?: string | null;   // e.g., 46, M, L
  color?: string | null;  // e.g., أسود
  brand?: string | null;  // e.g., Nike
  free?: string[];        // additional tokens
  custom?: Record<string, string | null>; // per-merchant custom keys (e.g., موديل/سنة)
}

export interface IntentResult {
  intent: Intent;
  entities: Entities;
  confidence: number; // 0..1
}

export interface MerchantNLPHints {
  synonyms?: Record<string, string[]>; // per-merchant synonyms (جزمة=حذاء)
  categories?: string[];               // known categories to prioritize
  brands?: string[];                   // known brands to prioritize
  colors?: string[];                   // known colors per merchant (or default)
  genders?: string[];                  // e.g., ['رجالي','نسائي','ولادي']
  sizeAliases?: Record<string, string[]>; // e.g., {'XL': ['اكسترالارج','X L']}
  customEntities?: Record<string, string[]>; // e.g., { 'موديل': ['كورولا','كامري'], 'سنة':['2020','2021'] }
}

const DEFAULT_COLORS = ['اسود','ابيض','احمر','ازرق','اخضر','اصفر','رمادي','بني','زهري','بنفسجي'];
const DEFAULT_GENDERS = ['رجالي','نسائي','ولادي','بناتي'];

export function classifyAndExtract(text: string, hints: MerchantNLPHints = {}): IntentResult {
  const raw = (text || '').trim();
  const normalized = normalizeArabic(raw, { taMarbutaToHa: true });
  const tokens = normalized.split(/\s+/);
  const searchForms = normalizeForSearch(normalized, hints.synonyms);

  // Intent classification based on keywords
  const has = (re: RegExp) => re.test(normalized);
  const isPrice = has(/\b(سعر|بكم|كم سعر|price|تكلف|القيمة)\b/);
  const isInventory = has(/\b(متوفر|موجود|نفاذ|ستوك|stock|مخزون|يتوفر|مقاس|size)\b/);
  const isFAQ = has(/\b(سياسة|تبديل|استبدال|ارجاع|توصيل|شحن|الدفع|طريقة|ساعات|دوام|فتح|متى)\b/);
  const isObjection = has(/\b(غالي|سعره|مرتفع|خصم|نزله|ترخيص|ارخص|ما اريد|ما يعجبني|بعدين)\b/);
  const isSmallTalk = has(/\b(مرحبا|هلو|السلام|شلون|كيفك|هاي|هلا)\b/);

  let intent: Intent = 'OTHER';
  let confidence = 0.5;
  if (isPrice) { intent = 'PRICE'; confidence = 0.85; }
  else if (isInventory) { intent = 'INVENTORY'; confidence = 0.8; }
  else if (isFAQ) { intent = 'FAQ'; confidence = 0.75; }
  else if (isObjection) { intent = 'OBJECTION'; confidence = 0.8; }
  else if (isSmallTalk) { intent = 'SMALL_TALK'; confidence = 0.7; }

  // Entities extraction
  const entities: Entities = { free: [], custom: {} };

  // small helper: Levenshtein distance for fuzzy correction
  const lev = (a: string, b: string): number => {
    const s = a, t = b;
    const m = s.length, n = t.length;
    if (m === 0) return n; if (n === 0) return m;
    const d = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
    for (let i = 0; i <= m; i++) d[i]![0] = i;
    for (let j = 0; j <= n; j++) d[0]![j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = s[i - 1] === t[j - 1] ? 0 : 1;
        d[i]![j] = Math.min(
          d[i - 1]![j]! + 1,
          d[i]![j - 1]! + 1,
          d[i - 1]![j - 1]! + cost
        );
      }
    }
    return d[m]![n]!;
  };

  // size: numbers 20-60, S/M/L/XL/XXL
  const sizeMatch = normalized.match(/\b(\d{2})\b/);
  if (sizeMatch) { const cap = sizeMatch[1] || null; entities.size = cap; }
  const sizeAlpha = normalized.match(/\b(XXL|XL|XS|S|M|L|XXS)\b/i);
  if (!entities.size && sizeAlpha) entities.size = (sizeAlpha[1] || '').toUpperCase() || null;
  if (!entities.size) {
    const sizeAliases = hints.sizeAliases ?? {};
    for (const [k, alts] of Object.entries(sizeAliases)) {
      for (const alt of alts) {
        if (normalized.includes(normalizeArabic(alt))) { entities.size = k; break; }
      }
      if (entities.size) break;
    }
  }

  // gender
  const genders = Array.isArray(hints.genders) && hints.genders.length > 0 ? hints.genders : DEFAULT_GENDERS;
  for (const g of genders) {
    if (normalized.includes(normalizeArabic(g))) { entities.gender = g; break; }
  }
  if (!entities.gender) {
    // fuzzy correction from tokens
    const tks = tokens.filter(Boolean);
    let best: { g: string; dist: number } | null = null;
    for (const tk of tks) {
      for (const g of genders) {
        const dist = lev(normalizeArabic(tk), normalizeArabic(g));
        if (!best || dist < best.dist) best = { g, dist };
      }
    }
    if (best && best.dist <= 1) entities.gender = best.g;
  }

  // color
  const colors = Array.isArray(hints.colors) && hints.colors.length > 0 ? hints.colors : DEFAULT_COLORS;
  for (const c of colors) {
    if (normalized.includes(normalizeArabic(c))) { entities.color = c; break; }
  }
  if (!entities.color) {
    const tks = tokens.filter(Boolean);
    let best: { c: string; dist: number } | null = null;
    for (const tk of tks) {
      for (const c of colors) {
        const dist = lev(normalizeArabic(tk), normalizeArabic(c));
        if (!best || dist < best.dist) best = { c, dist };
      }
    }
    if (best && best.dist <= 1) entities.color = best.c;
  }

  // brand
  if (Array.isArray(hints.brands) && hints.brands.length > 0) {
    for (const b of hints.brands) {
      if (normalized.toLowerCase().includes(b.toLowerCase())) { entities.brand = b; break; }
    }
  }

  // category (use provided categories + synonyms fallback)
  if (Array.isArray(hints.categories) && hints.categories.length > 0) {
    for (const cat of hints.categories) {
      for (const form of searchForms) {
        if (form.includes(normalizeArabic(cat))) { entities.category = cat; break; }
      }
      if (entities.category) break;
    }
    if (!entities.category) {
      // fuzzy correction across categories
      let best: { cat: string; dist: number } | null = null;
      for (const tk of tokens) {
        for (const cat of hints.categories) {
          const dist = lev(normalizeArabic(tk), normalizeArabic(cat));
          if (!best || dist < best.dist) best = { cat, dist };
        }
      }
      if (best && best.dist <= 1) entities.category = best.cat;
    }
  }

  // free tokens (basic heuristic)
  entities.free = tokens.filter(t => t.length >= 2 && !/\d+/.test(t));

  // Custom per-merchant entities (match by synonyms; fuzzy distance <=1)
  if (hints.customEntities && Object.keys(hints.customEntities).length) {
    for (const [key, values] of Object.entries(hints.customEntities)) {
      let found: string | null = null;
      // exact/normalized containment
      for (const v of values) {
        if (normalized.includes(normalizeArabic(v))) { found = v; break; }
      }
      // fuzzy if not found
      if (!found) {
        let best: { v: string; dist: number } | null = null;
        for (const tk of tokens) {
          for (const v of values) {
            const dist = lev(normalizeArabic(tk), normalizeArabic(v));
            if (!best || dist < best.dist) best = { v, dist };
          }
        }
        if (best && best.dist <= 1) found = best.v;
      }
      if (found) (entities.custom as Record<string, string | null>)[key] = found;
    }
  }

  return { intent, entities, confidence };
}
