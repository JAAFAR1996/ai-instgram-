import { getDatabase } from '../db/adapter.js';
import { normalizeForSearch } from '../nlp/ar-normalize.js';

export interface SearchEntities {
  category?: string | null;
  gender?: string | null;
  size?: string | null;
  color?: string | null;
  brand?: string | null;
  free?: string[];
}

export interface ProductHit {
  id: string;
  sku: string;
  name_ar: string;
  category: string | null;
  price_amount: number;
  sale_price_amount: number | null;
  price_currency: string;
  stock_quantity: number;
  image_urls?: string[] | null;
  weight?: number; // ranking weight
}

export interface SearchResult {
  top: ProductHit | null;
  alternatives: ProductHit[];
}

export async function searchProduct(
  merchantId: string,
  queryText: string,
  entities: SearchEntities,
  synonyms?: Record<string, string[]>
): Promise<SearchResult> {
  const db = getDatabase();
  const sql = db.getSQL();

  // Guard: ensure RLS context matches merchantId to prevent cross-tenant leakage
  try {
    const ctx = await sql<{ merchant_id: string }>`SELECT current_setting('app.current_merchant_id', true) as merchant_id`;
    const mid = (ctx[0]?.merchant_id || '').trim();
    if (!mid || mid !== merchantId) {
      throw new Error('RLS context mismatch or not set');
    }
  } catch (e) {
    throw new Error('security_context_missing');
  }

  // Build ILIKE patterns using normalized expansions
  const expansions = normalizeForSearch(queryText || '', synonyms)
    .filter(Boolean)
    .slice(0, 6);

  // Base
  const rows = await sql<{
    id: string;
    sku: string;
    name_ar: string;
    category: string | null;
    price_amount: number;
    sale_price_amount: number | null;
    price_currency: string;
    stock_quantity: number;
    image_urls: string[] | null;
  }>`
    SELECT p.id, p.sku, p.name_ar, p.category,
           pp.price_amount::float, pp.sale_price_amount::float, pp.price_currency,
           p.stock_quantity,
           CASE WHEN jsonb_typeof(p.image_urls) = 'array' THEN array(SELECT jsonb_array_elements_text(p.image_urls)) END as image_urls
    FROM products p
    JOIN products_priced pp ON pp.id = p.id
    WHERE p.merchant_id = ${merchantId}::uuid
      AND (p.status = 'ACTIVE' OR p.status = 'OUT_OF_STOCK')
      AND (
        ${expansions.length > 0
          ? expansions.map(e => sql`(p.name_ar ILIKE ${'%' + e + '%'} OR p.category ILIKE ${'%' + e + '%'} OR p.sku ILIKE ${'%' + e + '%'})`).reduce((a, b) => sql`${a} OR ${b}`)
          : sql`TRUE`}
      )
      AND (${entities.category ? sql`p.category ILIKE ${'%' + entities.category + '%'}` : sql`TRUE`})
  `;

  // Rank with heuristics: category > size > color > brand > free tokens
  const ranked = rows.map(r => {
    let weight = 0;
    if (entities.category && r.category && icontains(r.category, entities.category)) weight += 5;
    if (entities.size) weight += 3;
    if (entities.color) weight += 2;
    if (entities.brand) weight += 2;
    if ((entities.free?.length || 0) > 0) weight += Math.min(entities.free!.length, 3);
    if (r.stock_quantity > 0) weight += 1;
    return { ...toHit(r), weight } as ProductHit;
  })
  .sort((a, b) => (b.weight || 0) - (a.weight || 0));

  return { top: ranked[0] || null, alternatives: ranked.slice(1, 4) };
}

function icontains(a: string, b: string): boolean {
  return a?.toLowerCase().includes((b || '').toLowerCase());
}

function toHit(r: any): ProductHit {
  return {
    id: String(r.id),
    sku: String(r.sku),
    name_ar: String(r.name_ar),
    category: r.category ?? null,
    price_amount: Number(r.price_amount),
    sale_price_amount: r.sale_price_amount != null ? Number(r.sale_price_amount) : null,
    price_currency: String(r.price_currency || 'USD').toUpperCase(),
    stock_quantity: Number(r.stock_quantity),
    image_urls: r.image_urls ?? null,
  };
}
