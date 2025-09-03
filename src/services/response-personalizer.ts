import { getLogger } from './logger.js';
import SmartProductSearch from './search/smart-product-search.js';

export interface PersonalizeOptions {
  merchantId: string;
  customerId: string;
  tier: 'NEW'|'REPEAT'|'VIP';
  preferences?: {
    categories?: string[];
    colors?: string[];
    sizes?: string[];
    brands?: string[];
    priceSensitivity?: 'low'|'medium'|'high';
  };
  queryHint?: string;
}

export interface PersonalizedResult {
  text: string;
  recommendations: Array<{ id: string; sku: string; name: string; price: number }>;
}

export class ResponsePersonalizer {
  private log = getLogger({ component: 'response-personalizer' });
  private search = new SmartProductSearch();

  private greetingForTier(tier: PersonalizeOptions['tier']): string {
    if (tier === 'VIP') return 'هلا وسهلا عميلنا المميز ✨';
    if (tier === 'REPEAT') return 'رجعنا نفرح بخدمتك 🌟';
    return 'أهلاً وسهلاً بيك 🙌';
  }

  private adjustTone(
    base: string,
    tier: PersonalizeOptions['tier'],
    priceSensitivity?: 'low' | 'medium' | 'high'
  ): string {
    let text = base.trim();
    if (tier === 'VIP') text = `خاص لك: ${text}`;
    if (priceSensitivity === 'high') text += ' (نراعي ميزانيتك)';
    return text;
  }

  private async dynamicRecs(opts: PersonalizeOptions, limit = 3): Promise<PersonalizedResult['recommendations']> {
    try {
      const hintTokens: string[] = [];
      const p = opts.preferences || {};
      if (p.categories && p.categories[0]) hintTokens.push(p.categories[0]);
      if (p.colors && p.colors[0]) hintTokens.push(p.colors[0]);
      if (p.brands && p.brands[0]) hintTokens.push(p.brands[0]);
      if (opts.queryHint) hintTokens.push(opts.queryHint);
      const query = hintTokens.filter(Boolean).join(' ');
      if (!query) return [];
      const results = await this.search.searchProducts(query, opts.merchantId, { limit });
      return results.map(r => ({ id: r.product.id, sku: r.product.sku, name: r.product.name_ar, price: Math.round(Number(r.product.sale_price_amount ?? r.product.price_amount ?? 0)) }));
    } catch (e) {
      this.log.warn('dynamicRecs failed', { error: String(e) });
      return [];
    }
  }

  public async personalizeResponses(baseText: string, opts: PersonalizeOptions): Promise<PersonalizedResult> {
    const greet = this.greetingForTier(opts.tier);
    const tone = this.adjustTone(baseText, opts.tier, opts.preferences?.priceSensitivity);
    const recommendations = await this.dynamicRecs(opts);
    const text = `${greet} ${tone}`.trim();
    return { text, recommendations };
  }
}

export default ResponsePersonalizer;
