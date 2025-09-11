import { getDatabase } from '../db/adapter.js';
// import { normalizeForSearch } from '../nlp/ar-normalize.js';

type Entities = {
  term?: string;
  category?: string;
  size?: string;
  color?: string;
  brand?: string;
};

export interface SearchEntities {
  term?: string | null;
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

export async function searchProducts(merchantId: string, entities: Entities, limit = 20, offset = 0) {
  const db = getDatabase();
  const sql = db.getSQL();

  const filters: any[] = [];
  const safe = (v?: string) => (v ?? "").trim();

  const term = safe(entities.term);
  if (term) {
    const ors = [
      sql.like('p.name_ar', term),
      sql.like('p.sku', term),
      sql.like('p.category', term)
    ];
    filters.push(sql.or(...ors));
  }
  if (safe(entities.category)) filters.push(sql.fragment`LOWER(p.category) = LOWER(${entities.category})`);
  if (safe(entities.brand)) filters.push(sql.fragment`LOWER(p.attributes->>'brand') = LOWER(${entities.brand})`);
  if (safe(entities.size)) filters.push(sql.fragment`p.attributes->>'size' = ${entities.size}`);
  if (safe(entities.color)) filters.push(sql.fragment`p.attributes->>'color' = ${entities.color}`);

  filters.push(sql.fragment`p.merchant_id = ${merchantId}`);
  filters.push(sql.fragment`p.status = 'ACTIVE'`);

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
    SELECT 
      p.id, p.sku, p.name_ar, p.category,
      pp.effective_price::float as price_amount,
      pp.sale_price::float as sale_price_amount,
      pp.price_currency,
      p.stock_quantity,
      CASE WHEN jsonb_typeof(p.images) = 'array' 
           THEN array(SELECT (img->>'url') FROM jsonb_array_elements(p.images) img) 
      END as image_urls
    FROM products p
    JOIN product_prices pp ON pp.product_id = p.id
    ${sql.where(...filters)}
    ORDER BY p.updated_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  return rows.map(toHit);
}

export async function searchProduct(
  merchantId: string,
  queryText: string,
  entities: SearchEntities
): Promise<SearchResult> {
  const db = getDatabase();
  const sql = db.getSQL();

  // Guard: ensure RLS context matches merchantId to prevent cross-tenant leakage
  try {
    const ctx = await sql<{ merchant_id: string }>`SELECT current_setting('app.current_merchant_id', true) as merchant_id`;
    const mid = (ctx[0]?.merchant_id ?? '').trim();
    if (!mid || mid !== merchantId) {
      throw new Error('RLS context mismatch or not set');
    }
  } catch (e) {
    throw new Error('security_context_missing');
  }

  // Safe string helper to prevent empty/null search conditions
  const safe = (v?: string | null) => (v ?? "").trim();

  // Build search filters with proper SQL conditions
  const filters = [];
  
  // Add merchant and status filters
  filters.push(sql.fragment`p.merchant_id = ${merchantId}::uuid`);
  filters.push(sql.fragment`p.status = 'ACTIVE'`);

  // Handle search term with multiple fields
  const term = safe(entities.term || queryText);
  if (term) {
    const ors = [
      sql.like('p.name_ar', term),
      sql.like('p.sku', term),
      sql.like('p.category', term)
    ];
    filters.push(sql.or(...ors));
  }

  // Add entity-based filters with exact matches
  if (safe(entities.category)) filters.push(sql.fragment`LOWER(p.category) = LOWER(${entities.category})`);
  if (safe(entities.brand)) filters.push(sql.fragment`LOWER(p.attributes->>'brand') = LOWER(${entities.brand})`);
  if (safe(entities.size)) filters.push(sql.fragment`p.attributes->>'size' = ${entities.size}`);
  if (safe(entities.color)) filters.push(sql.fragment`p.attributes->>'color' = ${entities.color}`);

  // Fallback expansions are not used directly in SQL anymore; normalization remains in services

  // Base query with improved structure
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
           pp.price_amount::float as price_amount, 
           pp.sale_price_amount::float as sale_price_amount, 
           pp.price_currency,
           p.stock_quantity,
           CASE WHEN jsonb_typeof(p.images) = 'array' 
                THEN array(SELECT (img->>'url') FROM jsonb_array_elements(p.images) img) 
           END as image_urls
    FROM products p
    JOIN products_priced pp ON pp.id = p.id
    ${sql.where(...filters)}
    ORDER BY p.updated_at DESC
    LIMIT 20 OFFSET 0
  `;

  // Rank with heuristics: category > size > color > brand > free tokens
  const ranked = rows.map(r => {
    let weight = 0;
    if (entities.category && r.category && icontains(r.category, entities.category)) weight += 5;
    if (entities.size) weight += 3;
    if (entities.color) weight += 2;
    if (entities.brand) weight += 2;
  const freeLen = entities.free?.length ?? 0;
  if (freeLen > 0) weight += Math.min(freeLen, 3);
    if (r.stock_quantity > 0) weight += 1;
    return { ...toHit(r), weight } as ProductHit;
  })
  .sort((a, b) => (b.weight || 0) - (a.weight || 0));

  return { top: ranked[0] ?? null, alternatives: ranked.slice(1, 4) };
}

function icontains(a: string, b: string): boolean {
  return a?.toLowerCase().includes((b ?? '').toLowerCase());
}

function toHit(r: { id: unknown; sku: unknown; name_ar: unknown; category: unknown; price_amount: unknown; sale_price_amount: unknown; price_currency: unknown; stock_quantity: unknown; image_urls: unknown }): ProductHit {
  return {
    id: String(r.id),
    sku: String(r.sku),
    name_ar: String(r.name_ar),
    category: r.category != null ? String(r.category) : null,
    price_amount: Number(r.price_amount),
    sale_price_amount: r.sale_price_amount != null ? Number(r.sale_price_amount) : null,
    price_currency: String(r.price_currency || 'USD').toUpperCase(),
    stock_quantity: Number(r.stock_quantity),
    image_urls: Array.isArray(r.image_urls) ? (r.image_urls as string[]) : null,
  };
}
