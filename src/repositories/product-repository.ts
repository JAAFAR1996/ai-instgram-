import { getDatabase } from '../db/adapter.js';

export interface ProductBrief {
  id: string;
  sku: string;
  name_ar: string;
  category: string | null;
  price_amount: number;
  sale_price_amount: number | null;
  price_currency: string;
  stock_quantity: number;
}

export async function getTopProductsByMerchant(
  merchantId: string,
  limit: number = 10
): Promise<ProductBrief[]> {
  const db = getDatabase();
  const sql = db.getSQL();

  // Prefer most recently updated and available products
  const rows = await sql<any>`
    SELECT id, sku, name_ar, category,
           price_amount::float, sale_price_amount::float, price_currency, stock_quantity
    FROM products_priced
    WHERE merchant_id = ${merchantId}::uuid
      AND (status = 'ACTIVE' OR status = 'OUT_OF_STOCK')
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `;

  return rows.map((r: { id: string; sku: string; name_ar: string; price_usd: number; category: string; description_ar?: string; image_urls: string[] }) => ({
    id: String(r.id),
    sku: String(r.sku),
    name_ar: String(r.name_ar),
    category: r.category ?? null,
    price_amount: Number(r.price_amount),
    sale_price_amount: r.sale_price_amount != null ? Number(r.sale_price_amount) : null,
    price_currency: String(r.price_currency ?? 'USD').toUpperCase(),
    stock_quantity: Number(r.stock_quantity)
  }));
}
