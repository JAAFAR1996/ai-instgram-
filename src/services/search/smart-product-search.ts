import { getDatabase } from '../../db/adapter.js';
import type { DatabaseRow } from '../../types/db.js';
import { normalizeForSearch } from '../../nlp/ar-normalize.js';
import SmartCache from '../smart-cache.js';

export interface SearchOptions { limit?: number }

export interface ProductSearchRow extends DatabaseRow {
  id: string;
  merchant_id: string;
  sku: string;
  name_ar: string;
  description_ar?: string | null;
  category?: string | null;
  price_amount?: number | null;
  sale_price_amount?: number | null;
  stock_quantity: number;
  is_featured?: boolean | null;
  relevance_score?: number;
  highlight?: string;
}

export interface SearchResult {
  product: ProductSearchRow;
  relevanceScore: number;
  matchType: 'fts' | 'fuzzy';
  highlight?: string;
  suggestions?: string[];
}

export class SmartProductSearch {
  private db = getDatabase();
  private smartCache = new SmartCache();

  async searchProducts(query: string, merchantId: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const sql = this.db.getSQL();
    const limit = options.limit || 10;
    // Smart cache lookup for frequent queries
    try {
      const cached = await this.smartCache.getProductSearchResults<SearchResult>(merchantId, query);
      if (cached && cached.length) return cached.slice(0, limit);
    } catch {}
    const rows = await sql<ProductSearchRow>`
      SELECT p.*, ts_rank(p.search_vector, plainto_tsquery('simple', ${query})) as relevance_score,
             ts_headline('simple', coalesce(p.description_ar,''), plainto_tsquery('simple', ${query})) as highlight
      FROM products p
      WHERE p.merchant_id = ${merchantId}::uuid AND p.status = 'ACTIVE'
        AND p.search_vector @@ plainto_tsquery('simple', ${query})
      ORDER BY relevance_score DESC, is_featured DESC
      LIMIT ${limit}
    `;

    let results: SearchResult[] = rows.map(r => {
      const base: SearchResult = {
        product: r,
        relevanceScore: Math.round((r.relevance_score || 0) * 100),
        matchType: 'fts',
      };
      if (typeof r.highlight === 'string') (base as any).highlight = r.highlight;
      return base;
    });

    if (results.length < Math.min(3, limit)) {
      const fuzzy = await this.fuzzySearch(query, merchantId, { limit: limit - results.length });
      results = results.concat(fuzzy);
    }
    // Write-through cache for short TTL
    try { await this.smartCache.setProductSearchResults(merchantId, query, results); } catch {}
    return results;
  }

  async fuzzySearch(query: string, merchantId: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const limit = options.limit || 5;
    const expansions = normalizeForSearch(query).slice(0, 5);
    if (expansions.length === 0) return [];

    // Build patterns safely for ILIKE ANY($2)
    const patterns = expansions.map(e => `%${e}%`);
    const sql = `
      SELECT p.*
      FROM products p
      WHERE p.merchant_id = $1::uuid AND p.status = 'ACTIVE' AND (
        p.name_ar ILIKE ANY($2::text[])
        OR p.sku ILIKE ANY($2::text[])
        OR p.category ILIKE ANY($2::text[])
      )
      ORDER BY p.is_featured DESC, p.updated_at DESC
      LIMIT $3
    `;
    const rows = await this.db.query<ProductSearchRow>(sql, [merchantId, patterns, limit]);
    return rows.map(r => ({ product: r, relevanceScore: 50, matchType: 'fuzzy' }));
  }
}

export default SmartProductSearch;
