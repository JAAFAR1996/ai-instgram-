import type { Constitution, CritiqueIssue, CritiqueResult, ResponseContext, ValidationResult, ValidationItem, Principle } from '../types/constitutional-ai.js';

const AR_PUSHY_PATTERNS = [
  /اشتري الآن/gi,
  /لازم/gi,
  /فرصة\s*أ?خير?ة/gi,
  /عرض\s*ينتهي\s*الآن/gi,
  /سارع/gi,
  /تواصل\s*حالاً/gi,
];

const AR_RUDE_PATTERNS = [
  /غالي عليك/gi,
  /إذا ما عندك فلوس/gi,
  /لا تكثر أسئلة/gi,
];

const PRIVACY_PATTERNS = [
  /أرس?ل رقمك/gi,
  /ابعث رقم/gi,
  /send\s+your\s+number/gi,
  /card\s+number/gi,
  /cvv/gi,
];

const PRICE_WORDS = /(سعر|كم|price|دينار|د\.ع|IQD)/i;
const STOCK_WORDS = /(متوفر|توفر|stock|مخزون)/i;

function detectPushy(text: string): CritiqueIssue[] {
  const issues: CritiqueIssue[] = [];
  for (const r of AR_PUSHY_PATTERNS) {
    if (r.test(text)) {
      issues.push({ principleId: 'p_no_pushy_sales', category: 'ethics', severity: 'medium', message: 'صياغة قد تبدو مُلحة أكثر من اللازم', suggestion: 'اختر لغة لبقة غير ضاغطة مثل: إذا رغبت نكمل الطلب.' });
    }
  }
  for (const r of AR_RUDE_PATTERNS) {
    if (r.test(text)) {
      issues.push({ principleId: 'p_quality_tone', category: 'quality', severity: 'high', message: 'نبرة قد تُعتبر غير لبقة', suggestion: 'استخدم تعبيرات محترمة ولطيفة.' });
    }
  }
  return issues;
}

function detectPrivacyRisk(text: string): CritiqueIssue[] {
  const issues: CritiqueIssue[] = [];
  if (/[+]?\d[\d\s-]{6,}/.test(text)) {
    issues.push({ principleId: 'p_privacy', category: 'privacy', severity: 'medium', message: 'احتمال وجود رقم هاتف مكشوف', suggestion: 'تجنب مشاركة البيانات الحساسة علناً.' });
  }
  for (const r of PRIVACY_PATTERNS) {
    if (r.test(text)) {
      issues.push({ principleId: 'p_privacy', category: 'privacy', severity: 'high', message: 'طلب بيانات حساسة بشكل مباشر', suggestion: 'استخدم قنوات رسمية وآمنة لطلب البيانات الضرورية فقط.' });
    }
  }
  return issues;
}

function detectTransparencyNeeds(text: string, ctx?: ResponseContext): CritiqueIssue[] {
  const issues: CritiqueIssue[] = [];
  const qPrice = PRICE_WORDS.test(text);
  const qStock = STOCK_WORDS.test(text);
  if (qPrice || qStock) {
    // Encourage transparency
    if (!/(قد|حسب|يتطلب تأكيد|قد يحتاج تأكيد)/.test(text)) {
      issues.push({ principleId: 'p_transparent_price_stock', category: 'transparency', severity: 'low', message: 'ينبغي الإشارة لوجود تأكيد للسعر/التوفر إن لزم', suggestion: 'يمكن ذكر: السعر/التوفر يحتاج تأكيد حسب المخزون.' });
    }
  }
  // lightly use ctx to adapt severity (avoid unused param)
  if (ctx && (ctx.intent || ctx.stage)) {
    // no-op, reserved for future tuning
  }
  return issues;
}

function perCategoryInit(principles: Principle[]): Record<string, number> {
  const cats = new Set(principles.map(p => p.category));
  const m: Record<string, number> = {};
  cats.forEach(c => { m[c] = 100; });
  return m;
}

export function validateAgainstConstitutionText(response: string, constitution: Constitution): ValidationResult {
  const items: ValidationItem[] = [];
  const violations: CritiqueIssue[] = [];

  const checks: Record<string, (t: string) => boolean> = {
    p_helpful_accurate: (t) => t.trim().length > 0,
    p_no_pushy_sales: (t) => detectPushy(t).length === 0,
    p_respect_culture: (t) => !/(إهانة|سخرية)/.test(t),
    p_no_false_info: (t) => !!t || true, // heuristic only; cannot auto-verify
    p_transparent_price_stock: (t) => !!t || true,
    p_privacy: (t) => detectPrivacyRisk(t).length === 0,
    p_safety: (t) => !/(غير قانوني|مخالف)/.test(t),
    p_quality_tone: (t) => AR_RUDE_PATTERNS.every(r => !r.test(t)),
  };

  for (const p of constitution.principles) {
    const fn = checks[p.id] || ((t: string) => !!t || true);
    const passed = !!fn(response);
    items.push({ principle: p, passed });
    if (!passed) {
      violations.push({ principleId: p.id, message: `Violation: ${p.text}`, severity: p.severity >= 4 ? 'high' : 'medium', category: p.category });
    }
  }

  const score = 100 - violations.reduce((acc, v) => acc + (v.severity === 'high' ? 12 : 6), 0);
  return { passed: violations.length === 0, items, violations, score: score < 0 ? 0 : score };
}

export function assessResponseQuality(response: string, context: ResponseContext | undefined, constitution: Constitution): CritiqueResult {
  const issues: CritiqueIssue[] = [];
  const suggestions: string[] = [];
  const appliedChecks: string[] = [];

  // Collect issues
  const pushy = detectPushy(response);
  if (pushy.length) { issues.push(...pushy); appliedChecks.push('pushy'); suggestions.push('خفف نبرة الإلحاح وحافظ على اللطافة.'); }

  const privacy = detectPrivacyRisk(response);
  if (privacy.length) { issues.push(...privacy); appliedChecks.push('privacy'); suggestions.push('تجنب طلب أو عرض معلومات حساسة في النص.'); }

  const trans = detectTransparencyNeeds(response, context);
  if (trans.length) { issues.push(...trans); appliedChecks.push('transparency'); suggestions.push('أضف توضيح بسيط حول السعر/التوفر عند الحاجة.'); }

  // Constitution-level validation
  const validation = validateAgainstConstitutionText(response, constitution);
  for (const v of validation.violations) {
    // Avoid duplicates for privacy/pushy covered above
    if (!issues.some(i => i.principleId === v.principleId)) issues.push(v);
  }

  // Category scores start at 100, deduct per issue by severity and principle weight if available
  const categoryScores = perCategoryInit(constitution.principles);
  for (const iss of issues) {
    const p = constitution.principles.find(pr => pr.id === iss.principleId);
    const cat = iss.category || p?.category || 'quality';
    const weight = p?.weight ?? 0.08;
    const sevFactor = iss.severity === 'high' ? 14 : iss.severity === 'medium' ? 8 : 4;
    categoryScores[cat] = Math.max(0, (categoryScores[cat] ?? 100) - Math.round(sevFactor * (1 + weight)));
  }

  // Overall score as mean of category scores, bounded
  const cats = Object.keys(categoryScores);
  const mean = cats.reduce((a, c) => a + (categoryScores[c] ?? 0), 0) / (cats.length || 1);
  const baseScore = Math.max(0, Math.min(100, Math.round(mean)));

  const meetsThreshold = baseScore >= 75; // configurable
  return { score: baseScore, issues, suggestions, meetsThreshold, categoryScores, appliedChecks };
}

export function safeRewrite(response: string, issues: CritiqueIssue[], context?: ResponseContext): { revised: string; actions: string[]; notes: string[] } {
  let revised = response.trim();
  const actions: string[] = [];
  const notes: string[] = [];

  // Tone down pushy phrases
  if (issues.some(i => i.principleId === 'p_no_pushy_sales' || i.principleId === 'p_quality_tone')) {
    actions.push('tone_down_pushy');
    revised = revised
      .replace(/اشتري الآن/gi, 'إذا تحب نكمل الطلب')
      .replace(/لازم/gi, 'ممكن')
      .replace(/سارع/gi, 'خبرني إذا يناسبك');
  }

  // Privacy: remove direct asks for phone/card
  if (issues.some(i => i.principleId === 'p_privacy')) {
    actions.push('remove_privacy_risk');
    revised = revised
      .replace(/أرسل رقمك/gi, 'نقدر نكمل عبر القناة الرسمية بدون مشاركة بيانات حساسة')
      .replace(/ابعث رقم/gi, 'خلينا نكمل بالرسائل بدون بيانات شخصية');
    notes.push('تم تجنب طلب بيانات حساسة.');
  }

  // Transparency: add gentle disclaimer if pricing/stock mentioned but no disclaimer
  if ((PRICE_WORDS.test(revised) || STOCK_WORDS.test(revised)) && !/(قد|حسب|يتطلب تأكيد|قد يحتاج تأكيد)/.test(revised)) {
    actions.push('add_transparency_disclaimer');
    revised += (revised.endsWith('؟') || revised.endsWith('.') || revised.endsWith('!') ? ' ' : '. ') + 'قد يحتاج السعر/التوفر تأكيد حسب المخزون.';
  }

  // Ensure clarity and politeness
  if (!/[.!؟]$/.test(revised)) {
    revised += '.';
  }

  if (context && context.merchantId) notes.push(`merchant:${context.merchantId}`);

  return { revised, actions, notes };
}
