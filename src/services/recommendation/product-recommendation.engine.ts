import SmartProductSearch from '../search/smart-product-search.js';
import type { MessageHistory } from '../ai.js';
import type { MerchantCatalogProfile } from '../catalog/merchant-catalog.service.js';

export interface RecommendedProduct {
  is_featured?: boolean;
  stock_quantity?: number;
  [key: string]: unknown;
}

export interface ProductRecommendation {
  product: RecommendedProduct;
  relevanceScore: number;
  sellingPoints: string[];
  priceJustification?: string;
  urgencyFactors?: string[];
}

export class ProductRecommendationEngine {
  private searchService = new SmartProductSearch();

  async generateRecommendations(
    customerMessage: string,
    _customerHistory: MessageHistory[],
    merchantCatalog: MerchantCatalogProfile
  ): Promise<ProductRecommendation[]> {
    const keywords = this.extractKeywords(customerMessage);
    const results = await this.searchService.searchProducts(keywords.join(' '), merchantCatalog.merchantId, { limit: 10 });
    const recs: ProductRecommendation[] = results.map(r => ({
      product: r.product,
      relevanceScore: r.relevanceScore,
      sellingPoints: this.generateSellingPoints(r.product as RecommendedProduct),
      urgencyFactors: this.generateUrgencyFactors(r.product as RecommendedProduct)
    }));
    return recs.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, 3);
  }

  private extractKeywords(text: string): string[] {
    return (text ?? '').split(/\s+/).filter(t => t.length > 1).slice(0, 8);
  }

  private generateSellingPoints(p: RecommendedProduct): string[] {
    const points: string[] = [];
    if (p.is_featured) points.push('منتج مميز ومطلوب بكثرة');
    if ((p.stock_quantity || 0) < 10) points.push('كمية محدودة - اطلب الآن');
    return points;
  }

  private generateUrgencyFactors(p: RecommendedProduct): string[] {
    const u: string[] = [];
    if ((p.stock_quantity || 0) <= 5) u.push('باقي قليل');
    return u;
  }
}

export default ProductRecommendationEngine;
