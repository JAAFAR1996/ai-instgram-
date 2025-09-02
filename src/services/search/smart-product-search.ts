import { getDatabase } from '../../db/adapter.js';
import { normalizeForSearch } from '../../nlp/ar-normalize.js';

export interface SearchOptions { limit?: number }

export interface ProductSearchRow {
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

  async searchProducts(query: string, merchantId: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const sql = this.db.getSQL();
    const limit = options.limit || 10;
    const rows = await sql<ProductSearchRow>`
      SELECT p.*, ts_rank(p.search_vector, plainto_tsquery('simple', ${query})) as relevance_score,
             ts_headline('simple', coalesce(p.description_ar,''), plainto_tsquery('simple', ${query})) as highlight
      FROM products p
      WHERE p.merchant_id = ${merchantId}::uuid AND p.status = 'ACTIVE'
        AND p.search_vector @@ plainto_tsquery('simple', ${query})
      ORDER BY relevance_score DESC, is_featured DESC
      LIMIT ${limit}
    `;

    let results: SearchResult[] = rows.map(r => ({
      product: r,
      relevanceScore: Math.round((r.relevance_score || 0) * 100),
      matchType: 'fts',
      highlight: r.highlight
    }));

    if (results.length < Math.min(3, limit)) {
      const fuzzy = await this.fuzzySearch(query, merchantId, { limit: limit - results.length });
      results = results.concat(fuzzy);
    }
    return results;
  }

  async fuzzySearch(query: string, merchantId: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const sql = this.db.getSQL();
    const limit = options.limit || 5;
    const expansions = normalizeForSearch(query).slice(0, 5);
    const rows = await sql<ProductSearchRow>`
      SELECT p.*
      FROM products p
      WHERE p.merchant_id = ${merchantId}::uuid AND p.status = 'ACTIVE' AND (
        ${expansions.length > 0
          ? expansions.map(e => sql`(p.name_ar ILIKE ${'%' + e + '%'} OR p.sku ILIKE ${'%' + e + '%'} OR p.category ILIKE ${'%' + e + '%'})`).reduce((a,b) => sql`${a} OR ${b}`)
          : sql`false`}
      )
      ORDER BY p.is_featured DESC, p.updated_at DESC
      LIMIT ${limit}
    `;
    return rows.map(r => ({ product: r, relevanceScore: 50, matchType: 'fuzzy' }));
  }
}

export default SmartProductSearch;

