import { classifyAndExtract, type IntentResult } from '../nlp/intent.js';
import { kbSearch } from '../kb/search.js';
import { findProduct } from '../repos/product-finder.js';
import { getDatabase } from '../db/adapter.js';

export interface OrchestratorOptions {
  askAtMostOneFollowup?: boolean;
  session?: Record<string, unknown> | null; // conversations.session_data
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
}

export async function orchestrate(
  merchantId: string,
  username: string,
  messageText: string,
  options: OrchestratorOptions = { askAtMostOneFollowup: true }
): Promise<OrchestratorResult> {
  const db = getDatabase();
  const sql = db.getSQL();

  // Load merchant hints (ai_config)
  const rows = await sql<{ ai_config: any; business_name: string; business_category: string | null; merchant_type: string | null; currency: string | null }>`
    SELECT ai_config, business_name, business_category, merchant_type::text as merchant_type, currency FROM merchants WHERE id = ${merchantId}::uuid LIMIT 1
  `;
  const merchant = rows[0] || { ai_config: {}, business_name: 'متجرنا', business_category: null, merchant_type: 'other', currency: 'IQD' } as any;
  const aiCfg = merchant.ai_config || {};

  const hints = {
    synonyms: aiCfg?.synonyms || { 'جزمه': ['حذاء','بوت'] },
    categories: aiCfg?.categories || [],
    brands: aiCfg?.brands || [],
    colors: aiCfg?.colors || [],
    genders: aiCfg?.genders || undefined,
    sizeAliases: aiCfg?.sizeAliases || {},
    customEntities: aiCfg?.customEntities || {},
  } as any;

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
  const sessionEntities = {
    category: (session as any)?.category || undefined,
    gender: (session as any)?.gender || undefined,
    size: (session as any)?.size || undefined,
    color: (session as any)?.color || undefined,
    brand: (session as any)?.brand || undefined,
  } as Partial<IntentResult['entities']>;
  analysis.entities = {
    ...sessionEntities,
    ...analysis.entities,
  };
  const decision: string[] = [`intent=${analysis.intent}`, `confidence=${analysis.confidence.toFixed(2)}`];

  // Small talk
  if (analysis.intent === 'SMALL_TALK') {
    const text = `هلا ${username}! شلونك؟ خلي أعرف شنو تبحث عنه اليوم 🌟`;
    return { text, intent: analysis.intent, confidence: analysis.confidence, entities: analysis.entities, decision_path: decision };
  }

  // Pricing / Inventory via SQL
  if (analysis.intent === 'PRICE' || analysis.intent === 'INVENTORY') {
    // Check missing critical property
    const needsCategory = !analysis.entities.category;
    const clarifyAttempts = Number((session as any)?.clarify_attempts?.category || 0);
    if (needsCategory && options.askAtMostOneFollowup) {
      if (clarifyAttempts < 1) {
        const text = 'تريد شنو بالضبط؟ قميص، حذاء، بنطلون؟';
        decision.push('clarify=category');
        return {
          text,
          intent: analysis.intent,
          confidence: analysis.confidence,
          entities: analysis.entities,
          decision_path: decision,
          session_patch: {
            clarify_attempts: {
              ...(session as any)?.clarify_attempts,
              category: clarifyAttempts + 1
            }
          }
        };
      }
      // Max attempts reached → proceed with best approximate match
      decision.push('clarify=max_reached');
    }

    const q = messageText;
    const res = await findProduct(merchantId, q, analysis.entities as any, hints.synonyms);
    if (res.top) {
      const top = res.top!;
      if (top.stock_quantity <= 0) {
        // نفاد المخزون → بدائل مباشرة
        decision.push('sql=hit_out_of_stock');
        const alts = res.alternatives;
        let altText = 'ماكو نفس المواصفات، تحب أشوف بدائل قريبة؟';
        if (alts.length) {
          const formatted = alts.map(a => `${a.name_ar.split(' ').slice(0,3).join(' ')} ${Math.round(Number(a.final_price_iqd ?? a.base_price_iqd || 0)).toLocaleString('ar-IQ')} د.ع`).slice(0,3);
          if (formatted.length) altText = `ماكو نفس المواصفات، الأقرب: ${formatted.join('، ')}. أي واحد يعجبك؟`;
        }
        return {
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
        };
      }
      const priceIQD = top.final_price_iqd ?? top.base_price_iqd;
      const avail = top.stock_quantity > 0 ? 'متوفر' : 'غير متوفر حالياً';
      let extras: string[] = [];
      if (top.stock_quantity > 0 && top.stock_quantity <= 5) extras.push('باقي قليل');
      if ((merchant.settings as any)?.deliveryToday === true) extras.push('التوصيل اليوم');
      const extra = extras.length ? `، ${extras.join('، ')}` : '';
      let text: string;
      if (priceIQD == null || isNaN(Number(priceIQD))) {
        text = 'السعر يحتاج تأكيد. المدير راح يتواصل وياك يثبتّه.';
        decision.push('sql=hit_no_price');
      } else {
        text = `سعر ${top.name_ar}${analysis.entities.size ? ` مقاس ${analysis.entities.size}` : ''} ${Math.round(Number(priceIQD)).toLocaleString('ar-IQ')} د.ع، ${avail}${extra}. نمشي بالطلب؟`;
        decision.push('sql=hit');
      }
      return {
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
      };
    }
    decision.push('sql=miss');
    const alts = res.alternatives;
    let text = 'ماكو نفس المواصفات، تحب أشوف بدائل قريبة؟';
    if (alts.length) {
      const formatted = alts.map(a => `${a.name_ar.split(' ').slice(0,3).join(' ')} ${Math.round(Number(a.final_price_iqd ?? a.base_price_iqd || 0)).toLocaleString('ar-IQ')} د.ع`).slice(0,3);
      if (formatted.length) text = `ماكو نفس المواصفات، الأقرب: ${formatted.join('، ')}. أي واحد يعجبك؟`;
    }
    return {
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
    };
  }

  // FAQ via KB search
  if (analysis.intent === 'FAQ') {
    const hits = await kbSearch(merchantId, messageText, 3, { merchantType: merchant.merchant_type || undefined });
    if (hits.length > 0) {
      const top = hits[0]!;
      const snippet = top.chunk.trim().slice(0, 280);
      const text = `حسب سياسة «${top.title}»: ${snippet}${snippet.length >= 280 ? '…' : ''}`;
      decision.push('rag=hit');
      return {
        text,
        intent: analysis.intent,
        confidence: analysis.confidence,
        entities: analysis.entities,
        decision_path: decision,
        stage: 'BROWSE',
        kb_source: { id: top.id, title: top.title },
        session_patch: { last_kb_doc_id: top.id }
      };
    }
    decision.push('rag=miss');
    const text = 'أحتاج أتأكد من السياسة. أرجعلك بالتفاصيل حالاً بعد المراجعة.';
    return { text, intent: analysis.intent, confidence: analysis.confidence, entities: analysis.entities, decision_path: decision };
  }

  // OBJECTION handling
  if (analysis.intent === 'OBJECTION') {
    const text = 'أفهمك. عندي خيارات تناسب ميزانيتك. تفضل تحدد فئة أو سعر تقريبي؟';
    decision.push('objection=ack');
    return { text, intent: analysis.intent, confidence: analysis.confidence, entities: analysis.entities, decision_path: decision, stage: 'OBJECTION' };
  }

  // OTHER: short guidance
  const text = `أوكي! حتى أساعدك بسرعة، خبرني شنو المنتج والمقاس/اللون إذا تريده.`;
  return {
    text,
    intent: analysis.intent,
    confidence: analysis.confidence,
    entities: analysis.entities,
    decision_path: decision,
    stage: 'AWARE',
    session_patch: {
      ...(analysis.entities.gender ? { gender: analysis.entities.gender } : {}),
      ...(analysis.entities.size ? { size: analysis.entities.size } : {}),
      ...(analysis.entities.color ? { color: analysis.entities.color } : {}),
      ...(analysis.entities.category ? { category: analysis.entities.category } : {})
    }
  };
}
