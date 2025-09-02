import { getLogger } from './logger.js';
import ResponsePersonalizer from './response-personalizer.js';
import SmartProductSearch from './search/smart-product-search.js';

export interface SmartReplyContext {
  merchantId: string;
  customerId: string;
  businessCategory?: string;
  interactionText: string;
  preferences?: {
    categories?: string[];
    colors?: string[];
    brands?: string[];
    priceSensitivity?: 'low'|'medium'|'high';
  };
}

export interface SmartReplyResult {
  text: string;
  recommendations?: Array<{ id: string; sku: string; name: string; price?: number }>;
}

export class InstagramSmartResponses {
  private log = getLogger({ component: 'instagram-smart-responses' });
  private personalizer = new ResponsePersonalizer();
  private search = new SmartProductSearch();

  async generateSmartReply(ctx: SmartReplyContext): Promise<SmartReplyResult> {
    // Template by business category
    const tone = this.toneByCategory(ctx.businessCategory);
    const base = `${tone} ${ctx.interactionText}`.trim();

    // Try to fetch dynamic recommendations based on preferences + text
    const hintTokens: string[] = [];
    if (ctx.preferences?.categories?.[0]) hintTokens.push(ctx.preferences.categories[0]);
    if (ctx.preferences?.colors?.[0]) hintTokens.push(ctx.preferences.colors[0]);
    if (ctx.preferences?.brands?.[0]) hintTokens.push(ctx.preferences.brands[0]);
    const query = (hintTokens.concat([ctx.interactionText]).join(' ')).slice(0, 80);

    let recs: SmartReplyResult['recommendations'] = [];
    try {
      const results = await this.search.searchProducts(query, ctx.merchantId, { limit: 3 });
      recs = results.map(r => ({
        id: r.product.id,
        sku: r.product.sku,
        name: r.product.name_ar,
        price: Number(r.product.sale_price_amount ?? r.product.price_amount ?? 0) || undefined
      }));
    } catch (e) {
      this.log.debug('searchProducts failed', { error: String(e) });
    }

    // Personalize final tone
    const personalized = await this.personalizer.personalizeResponses(base, {
      merchantId: ctx.merchantId,
      customerId: ctx.customerId,
      tier: 'NEW',
      preferences: ctx.preferences
    });

    return { text: personalized.text, recommendations: recs && recs.length ? recs : undefined };
  }

  private toneByCategory(cat?: string): string {
    const c = (cat || '').toLowerCase();
    if (c.includes('fashion') || c.includes('ملابس') || c.includes('أزياء')) return 'ستايلك يهمنا ✨';
    if (c.includes('electronics') || c.includes('الكترونيات') || c.includes('تقنية')) return 'نجهّز لك الخيارات التقنية الأفضل ⚡';
    if (c.includes('food') || c.includes('مطعم') || c.includes('طعام')) return 'جاهزين لذوقك 👨‍🍳';
    return 'حابين نساعدك 🙌';
  }
}

export default InstagramSmartResponses;

