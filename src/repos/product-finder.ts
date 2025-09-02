import { getDatabase } from '../db/adapter.js';
import { normalizeForSearch } from '../nlp/ar-normalize.js';

export interface FinderEntities {
  category?: string | null;
  gender?: string | null;
  size?: string | null;
  color?: string | null;
  brand?: string | null;
  custom?: Record<string, string | null>;
  free?: string[];
}

export interface ProductPick {
  id: string;
  sku: string;
  name_ar: string;
  category: string | null;
  stock_quantity: number;
  base_price_iqd: number | null;
  final_price_iqd: number | null;
}

export interface FinderResult {
  top: ProductPick | null;
  alternatives: ProductPick[];
}

export async function findProduct(
  merchantId: string,
  queryText: string,
  entities: FinderEntities,
  synonyms?: Record<string, string[]>
): Promise<FinderResult> {
  const db = getDatabase();
  const sql = db.getSQL();

  // Ensure RLS context presents and matches
  const ctx = await sql<{ merchant_id: string }>`SELECT current_setting('app.current_merchant_id', true) as merchant_id`;
  const mid = (ctx[0]?.merchant_id || '').trim();
  if (!mid || mid !== merchantId) throw new Error('security_context_missing');

  const expansions = normalizeForSearch(queryText || '', synonyms).filter(Boolean).slice(0, 6);

  const rows = await sql<{
    id: string;
    merchant_id: string;
    sku: string;
    name_ar: string;
    category: string | null;
    stock_quantity: number;
    base_price_iqd: number | null;
    final_price_iqd: number | null;
  }>`
    SELECT pep.id, pep.merchant_id, pep.sku, pep.name_ar, pep.category, pep.stock_quantity,
           pep.base_price_iqd::float, pep.final_price_iqd::float
    FROM public.products_effective_prices pep
    WHERE pep.merchant_id = ${merchantId}::uuid
      AND (
        ${expansions.length > 0
          ? expansions.map(e => sql`(pep.name_ar ILIKE ${'%' + e + '%'} OR pep.category ILIKE ${'%' + e + '%'} OR pep.sku ILIKE ${'%' + e + '%'})`).reduce((a, b) => sql`${a} OR ${b}`)
          : sql`true`}
      )
      AND (${entities.category ? sql`pep.category ILIKE ${'%' + entities.category + '%'}` : sql`true`})
    ORDER BY pep.stock_quantity DESC, pep.final_price_iqd ASC NULLS LAST, pep.name_ar ASC
    LIMIT 10
  `;

  const picks = rows.map(r => ({
    id: String(r.id),
    sku: String(r.sku),
    name_ar: String(r.name_ar),
    category: r.category,
    stock_quantity: Number(r.stock_quantity || 0),
    base_price_iqd: r.base_price_iqd != null ? Number(r.base_price_iqd) : null,
    final_price_iqd: r.final_price_iqd != null ? Number(r.final_price_iqd) : null,
  } as ProductPick));

  // Rank with simple weights: category>size>color>brand>free + in-stock boost
  const ranked = picks.map(p => {
    let w = 0;
    if (entities.category && p.category && icontains(p.category, entities.category)) w += 5;
    if (entities.size) w += 3;
    if (entities.color) w += 2;
    if (entities.brand) w += 2;
    if ((entities.free?.length || 0) > 0) w += Math.min(entities.free!.length, 3);
    if (p.stock_quantity > 0) w += 1;
    // Boost using custom entities (e.g., موديل/سنة)
    if (entities.custom) {
      // Each matched custom attribute adds +1 (cap at +3)
      const customHits = Object.values(entities.custom).filter(Boolean).length;
      w += Math.min(customHits, 3);
    }
    return { p, w };
  }).sort((a, b) => b.w - a.w).map(x => x.p);

  return {
    top: ranked[0] || null,
    alternatives: ranked.slice(1, 4)
  };
}

function icontains(a?: string | null, b?: string | null): boolean {
  return (a || '').toLowerCase().includes((b || '').toLowerCase());
}
