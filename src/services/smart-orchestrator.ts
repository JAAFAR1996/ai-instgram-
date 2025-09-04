import { classifyAndExtract, type IntentResult } from '../nlp/intent.js';
import { kbSearch } from '../kb/search.js';
import { findProduct } from '../repos/product-finder.js';
import type { FinderEntities } from '../repos/product-finder.js';
import MerchantCatalogService from './catalog/merchant-catalog.service.js';
import ProductRecommendationEngine from './recommendation/product-recommendation.engine.js';
import ConstitutionalAI from './constitutional-ai.js';
import CustomerProfiler from './customer-profiler.js';
import ResponsePersonalizer from './response-personalizer.js';
import AdvancedAnalyticsService from './advanced-analytics.js';
import SmartProductSearch from './search/smart-product-search.js';
import { getDatabase } from '../db/adapter.js';
import { shouldUseExtendedThinking } from '../utils/reasoning-chain.js';
import ExtendedThinkingService from './extended-thinking.js';
import type { ThinkingChain } from '../types/thinking.js';
import { getClarifyAttemptCount, getSessionClarifyAttempts } from '../types/session-data.js';

export interface OrchestratorOptions {
  askAtMostOneFollowup?: boolean;
  session?: Record<string, unknown> | null; // conversations.session_data
  useExtendedThinking?: boolean; // force enable/disable extended thinking
  showThinking?: boolean; // include thinking_chain in response
}

export interface OrchestratorResult {
  text: string;
  intent: IntentResult['intent'];
  confidence: number;
  entities: IntentResult['entities'];
  decision_path: string[];
  kb_source?: { id: string; title: string };
  session_patch?: Record<string, unknown>;
  stage?: 'AWARE' | 'BROWSE' | 'INTENT' | 'OBJECTION' | 'CLOSE';
  thinking_chain?: ThinkingChain;
}

export async function orchestrate(
  merchantId: string,
  username: string,
  messageText: string,
  options: OrchestratorOptions = { askAtMostOneFollowup: true }
): Promise<OrchestratorResult> {
  const t0 = Date.now();
  const consAI = new ConstitutionalAI();
  const profiler = new CustomerProfiler();
  const personalizer = new ResponsePersonalizer();
  const analytics = new AdvancedAnalyticsService();
  const productSearch = new SmartProductSearch();
  const db = getDatabase();
  const sql = db.getSQL();

  // Load merchant hints (ai_config)
  const rows = await sql<{ ai_config: Record<string, unknown> | null; business_name: string; business_category: string | null; merchant_type: string | null; currency: string | null; settings: Record<string, unknown> | null }>`
    SELECT ai_config, business_name, business_category, merchant_type::text as merchant_type, currency, settings FROM merchants WHERE id = ${merchantId}::uuid LIMIT 1
  `;
  const merchant: { ai_config: Record<string, unknown> | null; business_name: string; business_category: string | null; merchant_type: string | null; currency: string | null; settings: Record<string, unknown> | null } =
    rows[0] ?? { ai_config: {}, business_name: 'متجرنا', business_category: null, merchant_type: 'other', currency: 'IQD', settings: {} };
  const aiCfg = merchant.ai_config || {};

  const hints: {
    synonyms: Record<string, string[]>;
    categories: string[];
    brands: string[];
    colors: string[];
    genders?: string[];
    sizeAliases: Record<string, string[]>;
    customEntities: Record<string, string[]>;
  } = {
    synonyms: (aiCfg?.synonyms && typeof aiCfg.synonyms === 'object') ? (aiCfg.synonyms as Record<string, string[]>) : ({} as Record<string, string[]>),
    categories: Array.isArray((aiCfg as Record<string, unknown>)?.categories) ? (aiCfg as Record<string, unknown>).categories as string[] : [],
    brands: Array.isArray((aiCfg as Record<string, unknown>)?.brands) ? (aiCfg as Record<string, unknown>).brands as string[] : [],
    colors: Array.isArray((aiCfg as Record<string, unknown>)?.colors) ? (aiCfg as Record<string, unknown>).colors as string[] : [],
    ...(Array.isArray((aiCfg as Record<string, unknown>)?.genders) ? { genders: (aiCfg as Record<string, unknown>).genders as string[] } : {}),
    sizeAliases: ((aiCfg as Record<string, unknown>)?.sizeAliases && typeof (aiCfg as Record<string, unknown>).sizeAliases === 'object') ? (aiCfg as Record<string, unknown>).sizeAliases as Record<string, string[]> : ({} as Record<string, string[]>),
    customEntities: ((aiCfg as Record<string, unknown>)?.customEntities && typeof (aiCfg as Record<string, unknown>).customEntities === 'object') ? (aiCfg as Record<string, unknown>).customEntities as Record<string, string[]> : ({} as Record<string, string[]>),
  };

  // Customer profiling to influence categorization and personalization
  let customerProfile: Awaited<ReturnType<CustomerProfiler['personalizeResponses']>> | undefined;
  try {
    customerProfile = await profiler.personalizeResponses(merchantId, username);
    if (customerProfile?.preferences?.categories?.length) {
      const merged = new Set([...(hints.categories || []), ...customerProfile.preferences.categories]);
      hints.categories = Array.from(merged);
    }
  } catch {}

  // Dynamically derive categories from catalog if requested
  if (aiCfg?.categories_dynamic === true && (!Array.isArray(hints.categories) || hints.categories.length === 0)) {
    try {
      const cats = await sql<{ category: string | null }>`
        SELECT DISTINCT category FROM public.products WHERE merchant_id = ${merchantId}::uuid AND category IS NOT NULL LIMIT 50
      `;
      hints.categories = cats.map(c => c.category!).filter(Boolean);
    } catch {}
  }

  // Merge session memory into entity extraction (do not override explicit message extraction)
  const analysis = classifyAndExtract(messageText, hints);
  const session = options.session || {};
  const readStr = (key: string): string | undefined => {
    const v = (session as Record<string, unknown>)[key];
    return typeof v === 'string' ? v : undefined;
  };
  const sessionEntities: Partial<IntentResult['entities']> = {};
  const cat = readStr('category'); if (cat) sessionEntities.category = cat;
  const gen = readStr('gender'); if (gen) sessionEntities.gender = gen;
  const sz  = readStr('size'); if (sz) sessionEntities.size = sz;
  const col = readStr('color'); if (col) sessionEntities.color = col;
  const br  = readStr('brand'); if (br) sessionEntities.brand = br;
  analysis.entities = {
    ...sessionEntities,
    ...analysis.entities,
  };
  const decision: string[] = [`intent=${analysis.intent}`, `confidence=${analysis.confidence.toFixed(2)}`];

  // Lightweight product context for telemetry/decision breadcrumbs
  try {
    const relevant = await productSearch.searchProducts(messageText, merchantId, { limit: 5 });
    decision.push(relevant.length > 0 ? 'product_context=has_hits' : 'product_context=no_hits');
  } catch {}

  // Post-processing pipeline: Constitutional AI + Personalization + Analytics
  const postProcess = async (res: OrchestratorResult): Promise<OrchestratorResult> => {
    let text = res.text;
    try {
      const critique = await consAI.critiqueResponse(text, {
        merchantId,
        username,
        intent: res.intent,
        ...(res.stage ? { stage: res.stage } : {}),
      });
      if (!critique.meetsThreshold) {
        const { improved } = await consAI.improveResponse(text, critique, { merchantId, username, intent: res.intent, ...(res.stage ? { stage: res.stage } : {}) });
        text = improved;
        res.decision_path = [...res.decision_path, 'constitutional_ai=improved'];
        // record analytics with quality score
        try { await analytics.recordAIInteraction({ merchantId, customerId: username, model: 'smart-orchestrator', intent: res.intent, latencyMs: Date.now() - t0, qualityScore: critique.score, improved: true }); } catch {}
      } else {
        res.decision_path = [...res.decision_path, 'constitutional_ai=ok'];
        try { await analytics.recordAIInteraction({ merchantId, customerId: username, model: 'smart-orchestrator', intent: res.intent, latencyMs: Date.now() - t0, qualityScore: critique.score, improved: false }); } catch {}
      }
    } catch {
      // best-effort only
      try { await analytics.recordAIInteraction({ merchantId, customerId: username, model: 'smart-orchestrator', intent: res.intent, latencyMs: Date.now() - t0 }); } catch {}
    }

    try {
      if (customerProfile) {
        const personalized = await personalizer.personalizeResponses(text, {
          merchantId,
          customerId: username,
          tier: customerProfile.tier,
          preferences: customerProfile.preferences,
        });
        text = personalized.text;
        res.decision_path = [...res.decision_path, 'personalized=applied'];
        if (personalized.recommendations?.length) {
          const recLine = personalized.recommendations.slice(0, 3).map(r => `• ${r.name}${r.price ? ` — ${r.price.toLocaleString('ar-IQ')} د.ع` : ''}`).join('\n');
          text = `${text}\n${recLine}`;
        }
      }
    } catch {}

    return { ...res, text };
  };

  // Optional extended thinking for complex queries
  const useThinking = (options.useExtendedThinking ?? shouldUseExtendedThinking(messageText, { intent: analysis.intent, confidence: analysis.confidence })) === true;
  let thinkingChain: ThinkingChain | undefined;
  const withThinking = (res: OrchestratorResult): OrchestratorResult => {
    if (!useThinking || !thinkingChain) return res;
    return { ...res, thinking_chain: thinkingChain };
  };
  if (useThinking) {
    try {
      const thinkingService = new ExtendedThinkingService();
      const thinking = await thinkingService.processWithThinking(messageText, {
        merchantId,
        username,
        session: options.session || {},
        nlp: { intent: analysis.intent, entities: analysis.entities as Record<string, unknown>, confidence: analysis.confidence },
        hints
      }, options.showThinking ?? true);
      thinkingChain = thinking.chain;
      decision.push('thinking=enabled');
      decision.push(`thinking_steps=${thinking.chain.steps.length}`);
      decision.push(`thinking_conf=${Math.round((thinking.chain.overallConfidence ?? 0) * 100)}`);
    } catch {}
  }

  // Small talk
  if (analysis.intent === 'SMALL_TALK') {
    const text = `هلا ${username}! شلونك؟ خلي أعرف شنو تبحث عنه اليوم 🌟`;
    return withThinking(await postProcess({ text, intent: analysis.intent, confidence: analysis.confidence, entities: analysis.entities, decision_path: decision }));
  }

  // Generic OTHER response (non-sector-specific) before falling back further
  if (String(analysis.intent) === 'OTHER') {
    const examples = Array.isArray(hints.categories) && hints.categories.length
      ? ` (مثال: ${hints.categories.slice(0, 3).filter(Boolean).join(' / ')})`
      : '';
    const text = `أوكي! حتى أساعدك بسرعة، اكتب اسم المنتج أو الفئة${examples} والمواصفات المهمة (مثل اللون/القياس/السعة/الموديل) إذا موجود.`;
    return withThinking(await postProcess({ text, intent: analysis.intent, confidence: analysis.confidence, entities: analysis.entities, decision_path: decision, stage: 'AWARE' }));
  }

  // Pricing / Inventory via SQL
  if (analysis.intent === 'PRICE' || analysis.intent === 'INVENTORY') {
    // Check missing critical property
    const needsCategory = !analysis.entities.category;
    const clarifyAttempts = getClarifyAttemptCount(session, 'category');
    if (needsCategory && options.askAtMostOneFollowup) {
      if (clarifyAttempts < 1) {
        const text = 'تريد شنو بالضبط؟ قميص، حذاء، بنطلون؟';
        decision.push('clarify=category');
        return withThinking({
          text,
          intent: analysis.intent,
          confidence: analysis.confidence,
          entities: analysis.entities,
          decision_path: decision,
          session_patch: {
            clarify_attempts: {
              ...getSessionClarifyAttempts(session),
              category: clarifyAttempts + 1
            }
          }
        });
      }
      // Max attempts reached → proceed with best approximate match
      decision.push('clarify=max_reached');
    }

    const q = messageText;
    const res = await findProduct(merchantId, q, analysis.entities as FinderEntities, hints.synonyms);
    if (res.top) {
      const top = res.top!;
      if (top.stock_quantity <= 0) {
        // نفاد المخزون → بدائل مباشرة
        decision.push('sql=hit_out_of_stock');
        const alts = res.alternatives;
        let altText = 'ماكو نفس المواصفات، تحب أشوف بدائل قريبة؟';
        if (alts.length) {
          const formatted = alts.map(a => {
            const price = (a.final_price_iqd ?? a.base_price_iqd) ?? 0;
            return `${a.name_ar.split(' ').slice(0,3).join(' ')} ${Math.round(Number(price)).toLocaleString('ar-IQ')} د.ع`;
          }).slice(0,3);
          if (formatted.length) altText = `ماكو نفس المواصفات، الأقرب: ${formatted.join('، ')}. أي واحد يعجبك؟`;
        }
        return withThinking(await postProcess({
          text: altText,
          intent: analysis.intent,
          confidence: analysis.confidence,
          entities: analysis.entities,
          decision_path: decision,
          stage: 'BROWSE',
          session_patch: {
            ...(analysis.entities.gender ? { gender: analysis.entities.gender } : {}),
            ...(analysis.entities.size ? { size: analysis.entities.size } : {}),
            ...(analysis.entities.color ? { color: analysis.entities.color } : {}),
            ...(analysis.entities.category ? { category: analysis.entities.category } : {})
          }
        }));
      }
      const priceIQD = top.final_price_iqd ?? top.base_price_iqd;
      const avail = top.stock_quantity > 0 ? 'متوفر' : 'غير متوفر حالياً';
      let extras: string[] = [];
      if (top.stock_quantity > 0 && top.stock_quantity <= 5) extras.push('باقي قليل');
      if ((merchant.settings as Record<string, unknown>)?.['deliveryToday'] === true) extras.push('التوصيل اليوم');
      const extra = extras.length ? `، ${extras.join('، ')}` : '';
      let text: string;
      if (priceIQD == null || isNaN(Number(priceIQD))) {
        text = 'السعر يحتاج تأكيد. المدير راح يتواصل وياك يثبتّه.';
        decision.push('sql=hit_no_price');
      } else {
        text = `سعر ${top.name_ar}${analysis.entities.size ? ` مقاس ${analysis.entities.size}` : ''} ${Math.round(Number(priceIQD)).toLocaleString('ar-IQ')} د.ع، ${avail}${extra}. نمشي بالطلب؟`;
        decision.push('sql=hit');
      }
      return withThinking(await postProcess({
        text,
        intent: analysis.intent,
        confidence: analysis.confidence,
        entities: analysis.entities,
        decision_path: decision,
        stage: 'INTENT',
        session_patch: {
          last_product_id: top.id,
          ...(analysis.entities.gender ? { gender: analysis.entities.gender } : {}),
          ...(analysis.entities.size ? { size: analysis.entities.size } : {}),
          ...(analysis.entities.color ? { color: analysis.entities.color } : {}),
          ...(analysis.entities.category ? { category: analysis.entities.category } : {})
        }
      }));
    }
    decision.push('sql=miss');
    const alts = res.alternatives;
    let text = 'ماكو نفس المواصفات، تحب أشوف بدائل قريبة؟';
    if (alts.length) {
      const formatted = alts.map(a => {
        const price = (a.final_price_iqd ?? a.base_price_iqd) ?? 0;
        return `${a.name_ar.split(' ').slice(0,3).join(' ')} ${Math.round(Number(price)).toLocaleString('ar-IQ')} د.ع`;
      }).slice(0,3);
      if (formatted.length) text = `ماكو نفس المواصفات، الأقرب: ${formatted.join('، ')}. أي واحد يعجبك؟`;
    } else {
      try {
        const catalog = await new MerchantCatalogService().analyzeMerchantInventory(merchantId);
        const recs = await new ProductRecommendationEngine().generateRecommendations(messageText, [], catalog);
        const names = recs.map(r => r.product.name_ar).slice(0,3);
        if (names.length) text = `ماكو نفس المواصفات، الأقرب: ${names.join('، ')}. أي واحد يعجبك؟`;
      } catch {}
    }
    return withThinking(await postProcess({
      text,
      intent: analysis.intent,
      confidence: analysis.confidence,
      entities: analysis.entities,
      decision_path: decision,
      stage: 'BROWSE',
      session_patch: {
        ...(analysis.entities.gender ? { gender: analysis.entities.gender } : {}),
        ...(analysis.entities.size ? { size: analysis.entities.size } : {}),
        ...(analysis.entities.color ? { color: analysis.entities.color } : {}),
        ...(analysis.entities.category ? { category: analysis.entities.category } : {})
      }
    }));
  }

  // FAQ via KB search
  if (analysis.intent === 'FAQ') {
    const kbOpts: { merchantType?: string; tags?: Record<string, string | boolean> } = {};
    if (merchant.merchant_type) kbOpts.merchantType = merchant.merchant_type;
    const hits = await kbSearch(merchantId, messageText, 3, kbOpts);
    if (hits.length > 0) {
      const top = hits[0]!;
      const snippet = top.chunk.trim().slice(0, 280);
      const text = `حسب سياسة «${top.title}»: ${snippet}${snippet.length >= 280 ? '…' : ''}`;
      decision.push('rag=hit');
      return withThinking(await postProcess({
        text,
        intent: analysis.intent,
        confidence: analysis.confidence,
        entities: analysis.entities,
        decision_path: decision,
        stage: 'BROWSE',
        kb_source: { id: top.id, title: top.title },
        session_patch: { last_kb_doc_id: top.id }
      }));
    }
    decision.push('rag=miss');
    const text = 'أحتاج أتأكد من السياسة. أرجعلك بالتفاصيل حالاً بعد المراجعة.';
    return withThinking(await postProcess({ text, intent: analysis.intent, confidence: analysis.confidence, entities: analysis.entities, decision_path: decision }));
  }
  // SmartProductSearch suggestions for general queries (best-effort)
  if (String(analysis.intent) === 'OTHER') {
    try {
      const hits = await productSearch.searchProducts(messageText, merchantId, { limit: 5 });
      if (hits.length > 0) {
      const info = hits.map(h => {
        const p = h.product as { name_ar: string; sale_price_amount?: unknown; price_amount?: unknown };
        const price = Number(p.sale_price_amount ?? p.price_amount ?? 0);
        const priceText = price > 0 ? `${Math.round(price).toLocaleString('ar-IQ')} د.ع` : 'السعر يحتاج تأكيد';
        return `• ${String(p.name_ar).split(' ').slice(0,6).join(' ')} - ${priceText}`;
      }).join('\n');
        decision.push('smart_search=used');
        return withThinking(await postProcess({
          text: `توقعت يمكن تقصد هالخيارات:\n${info}\nتحب أي واحد بيها؟`,
          intent: analysis.intent,
          confidence: analysis.confidence,
          entities: analysis.entities,
          decision_path: decision,
          stage: 'BROWSE'
        }));
      }
    } catch {}
  }
      // Prefer SmartProductSearch hits for direct relevance
      const smartHits = await productSearch.searchProducts(messageText, merchantId, { limit: 5 });
      if (smartHits.length > 0) {
        const info = smartHits.map(h => {
          const p = h.product as { name_ar: string; sale_price_amount?: unknown; price_amount?: unknown };
          const price = Number(p.sale_price_amount ?? p.price_amount ?? 0);
          const priceText = price > 0 ? `${Math.round(price).toLocaleString('ar-IQ')} د.ع` : 'السعر يحتاج تأكيد';
          return `• ${String(p.name_ar).split(' ').slice(0,6).join(' ')} - ${priceText}`;
        }).join('\n');
        decision.push('smart_search=used');
        return withThinking(await postProcess({
          text: `عدنا خيارات قريبة من طلبك:\n${info}\nأي واحد يهمك أكثر؟`,
          intent: analysis.intent,
          confidence: analysis.confidence,
          entities: analysis.entities,
          decision_path: decision,
          stage: 'BROWSE'
        }));
      }
  }
