import { getDatabase } from '../../db/adapter.js';
import { getCache } from '../../cache/index.js';

export interface ProductRow {
  id: string;
  sku: string;
  name_ar: string;
  name_en?: string | null;
  description_ar?: string | null;
  category?: string | null;
  price_amount?: number | null;
  sale_price_amount?: number | null;
  price_usd?: number | null;
  cost_usd?: number | null;
  stock_quantity: number;
  is_featured?: boolean | null;
  attributes?: Record<string, unknown> | null;
  tags?: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface CategoryAnalysis {
  name: string;
  count: number;
  averagePrice: number;
  priceRange: { min: number; max: number };
  topProduct: ProductRow | null;
}

export interface MerchantCatalogProfile {
  merchantId: string;
  totalProducts: number;
  categories: CategoryAnalysis[];
  priceRanges: Array<{ min: number; max: number; count: number }>;
  topProducts: ProductRow[];
  lowStockItems: ProductRow[];
  featuredProducts: ProductRow[];
  averagePrice: number;
  mostExpensive: ProductRow | null;
  cheapest: ProductRow | null;
  lastUpdated: Date;
}

export class MerchantCatalogService {
  private db = getDatabase();
  private cache = getCache();

  async analyzeMerchantInventory(merchantId: string): Promise<MerchantCatalogProfile> {
    const cacheKey = `merchant_catalog_${merchantId}`;
    const cached = await this.cache.get<MerchantCatalogProfile>(cacheKey, { prefix: 'ctx' });
    if (cached) return cached;

    const sql = this.db.getSQL();
    const rows = await sql<ProductRow>`
      SELECT id, sku, name_ar, name_en, description_ar, category,
             price_amount::float, sale_price_amount::float, stock_quantity,
             is_featured, attributes, tags, created_at, updated_at
      FROM products
      WHERE merchant_id = ${merchantId}::uuid AND status = 'ACTIVE'
      ORDER BY created_at DESC
    `;

    const total = rows.length;
    const categories = this.analyzeCategories(rows);
    const priceNumbers = rows.map(p => Number(p.sale_price_amount ?? p.price_amount ?? 0)).filter(n => n > 0);
    const averagePrice = priceNumbers.length ? priceNumbers.reduce((a, b) => a + b, 0) / priceNumbers.length : 0;
    const mostExpensive = rows.reduce<ProductRow | null>((max, p) => ((p.sale_price_amount ?? p.price_amount ?? 0) > ((max?.sale_price_amount ?? max?.price_amount) ?? 0) ? p : max), null);
    const cheapest = rows.reduce<ProductRow | null>((min, p) => (min == null || ((p.sale_price_amount ?? p.price_amount ?? 0) < ((min.sale_price_amount ?? min.price_amount) ?? 0)) ? p : min), null);

    const profile: MerchantCatalogProfile = {
      merchantId,
      totalProducts: total,
      categories,
      priceRanges: this.calculatePriceRanges(rows),
      topProducts: rows.slice(0, 10),
      lowStockItems: rows.filter(p => (p.stock_quantity || 0) < 5),
      featuredProducts: rows.filter(p => !!p.is_featured).slice(0, 10),
      averagePrice,
      mostExpensive,
      cheapest,
      lastUpdated: new Date()
    };

    await this.cache.set(cacheKey, profile, { prefix: 'ctx', ttl: 3600 });
    return profile;
  }

  private analyzeCategories(products: ProductRow[]): CategoryAnalysis[] {
    const bucket = new Map<string, ProductRow[]>();
    for (const p of products) {
      const key = (p.category || 'uncategorized').trim();
      if (!bucket.has(key)) bucket.set(key, []);
      bucket.get(key)!.push(p);
    }
    return Array.from(bucket.entries()).map(([name, items]) => {
      const prices = items.map(p => Number(p.sale_price_amount ?? p.price_amount ?? 0)).filter(n => n > 0);
      const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
      const min = prices.length ? Math.min(...prices) : 0;
      const max = prices.length ? Math.max(...prices) : 0;
      const topProduct = items.reduce<ProductRow | null>((maxP, p) => ((p.sale_price_amount ?? p.price_amount ?? 0) > ((maxP?.sale_price_amount ?? maxP?.price_amount) ?? 0) ? p : maxP), null);
      return { name, count: items.length, averagePrice: avg, priceRange: { min, max }, topProduct };
    });
  }

  private calculatePriceRanges(products: ProductRow[]): Array<{ min: number; max: number; count: number }> {
    const prices = products.map(p => Number(p.sale_price_amount ?? p.price_amount ?? 0)).filter(n => n > 0).sort((a, b) => a - b);
    if (prices.length === 0) return [];
    const step = Math.max(1, Math.round(prices.length / 5));
    const ranges: Array<{ min: number; max: number; count: number }> = [];
    for (let i = 0; i < prices.length; i += step) {
      const slice = prices.slice(i, i + step);
      ranges.push({ min: slice[0]!, max: slice[slice.length - 1]!, count: slice.length });
    }
    return ranges;
  }
}

export default MerchantCatalogService;

