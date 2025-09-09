import { getDatabase } from '../../db/adapter.js';
import { getCache } from '../../cache/index.js';

import type { DatabaseRow } from '../../types/db.js';

export interface ProductRow extends DatabaseRow {
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
  // Derived attribute and vertical signals (DB-driven behavior)
  attributeStats?: {
    sizeCount: number;
    colorCount: number;
    brandCount: number;
    materialCount: number;
  };
  requiresSizes?: boolean;
  requiresColors?: boolean;
  verticals?: string[]; // e.g., ['apparel','accessories']
  primaryVertical?: string;
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

    // Compute attribute stats and vertical hints
    const attributeStats = this.computeAttributeStats(rows);
    const verticals = this.detectVerticals(rows);
    const requiresSizes = attributeStats.sizeCount > Math.max(3, Math.floor(rows.length * 0.2));
    const requiresColors = attributeStats.colorCount > Math.max(3, Math.floor(rows.length * 0.2));

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
      lastUpdated: new Date(),
      attributeStats,
      requiresSizes,
      requiresColors,
      verticals,
      primaryVertical: verticals[0] || 'general'
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

  private computeAttributeStats(products: ProductRow[]): { sizeCount: number; colorCount: number; brandCount: number; materialCount: number } {
    let sizeCount = 0, colorCount = 0, brandCount = 0, materialCount = 0;
    for (const p of products) {
      const a = (p.attributes || {}) as Record<string, unknown>;
      const has = (k: string) => {
        const v = (a as any)?.[k];
        return (typeof v === 'string' && v.trim()) || (Array.isArray(v) && v.length) || (typeof v === 'object' && v != null);
      };
      if (has('size')) sizeCount++;
      if (has('sizes')) sizeCount++;
      if (has('color')) colorCount++;
      if (has('colors')) colorCount++;
      if (has('brand')) brandCount++;
      if (has('material')) materialCount++;
    }
    return { sizeCount, colorCount, brandCount, materialCount };
  }

  private detectVerticals(products: ProductRow[]): string[] {
    const tokens = new Set<string>();
    const add = (v: string) => tokens.add(v);
    for (const p of products) {
      const cat = (p.category || '').toLowerCase();
      const name = (p.name_ar || p.name_en || '').toLowerCase();
      const text = `${cat} ${name}`;
      if (/(قميص|قمصان|تيشيرت|بنطلون|فستان|عباية|hoodie|t-?shirt|dress|jeans|شورت|ملابس|بجامة)/.test(text)) add('apparel');
      if (/(حذاء|جزمة|shoes|sneaker|صندل|كعب)/.test(text)) add('footwear');
      if (/(شنطة|حقيبة|bag|محفظة|قبعة|كاب|نظارة|إكسسوار|اكسسوار|accessor)/.test(text)) add('accessories');
      if (/(موبايل|هاتف|phone|لابتوب|كمبيوتر|سماعة|headphone|electronics|الكترون)/.test(text)) add('electronics');
      if (/(عطر|ميكاب|مكياج|beauty|perfume|cosmetic)/.test(text)) add('beauty');
      if (/(أثاث|مطبخ|منزل|home|furniture|kitchen)/.test(text)) add('home');
    }
    if (tokens.size === 0) return ['general'];
    // Order by perceived specificity
    const order = ['apparel','footwear','accessories','beauty','electronics','home','general'];
    return Array.from(tokens).sort((a,b) => order.indexOf(a) - order.indexOf(b));
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
