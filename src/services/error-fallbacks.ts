import { getLogger } from './logger.js';
import SmartCache from './smart-cache.js';
import SmartProductSearch from './search/smart-product-search.js';

export interface FallbackResult {
  text: string;
  used: 'cache' | 'product_suggestions' | 'static';
  recommendations?: Array<{ id: string; sku: string; name: string; price?: number }>;
}

/**
 * Graceful degradation and user-friendly fallbacks for AI failures/timeouts.
 */
export class ErrorFallbacksService {
  private log = getLogger({ component: 'error-fallbacks' });
  private cache = new SmartCache();
  private search = new SmartProductSearch();

  /**
   * Build best-effort fallback. Never throws.
   */
  public async buildFallback(
    merchantId: string,
    customerId: string,
    originalUserText: string
  ): Promise<FallbackResult> {
    const text = (originalUserText || '').trim();
    try {
      // Read cached context to improve decisions (use value to avoid unused param)
      await this.cache.getCustomerContext(merchantId, customerId);
      // 1) Try cached common reply
      const cached = await this.cache.getCommonReply(merchantId, text);
      if (cached && cached.text) {
        await this.cache.bumpCommonReplyHit(merchantId, text);
        return { text: cached.text, used: 'cache' };
      }
    } catch (e) {
      this.log.warn('fallback: cache lookup failed', { error: String(e) });
    }

    try {
      // 2) Try quick product suggestions for short queries
      const tokens = text.toLowerCase();
      const producty = /(فستان|قميص|بنطلون|dress|t\-?shirt|shoes|حذاء|جلدية|شنطة|bag|عباية|abaya|size|مقاس|لون)/.test(tokens);
      if (producty && text.length <= 64) {
        const results = await this.search.searchProducts(text, merchantId, { limit: 3 });
        if (results.length > 0) {
          const recs = results.map(r => {
            const priceNum = Number(r.product.sale_price_amount ?? r.product.price_amount ?? 0);
            const base: { id: string; sku: string; name: string; price?: number } = {
              id: r.product.id, sku: r.product.sku, name: r.product.name_ar,
            };
            if (priceNum > 0) base.price = priceNum;
            return base;
          });
          const names = recs.map(r => `• ${r.name}${r.price ? ` – ${r.price} د.ع` : ''}`).join('\n');
          const reply = `صار خلل بسيط عندي، بس عندي اقتراحات سريعة لك:\n${names}\nتحب أشوف مقاسات/ألوان متوفرة؟`;
          return { text: reply, used: 'product_suggestions', recommendations: recs };
        }
      }
    } catch (e) {
      this.log.warn('fallback: product suggestions failed', { error: String(e) });
    }

    // 3) Static, friendly fallback
    const generic = 'صار عندي خلل بسيط، بس حاضر أخدمك! ممكن توضح أكثر اللي تحتاجه (النوع/المقاس/اللون/المناسبة) حتى أساعدك بسرعة؟';
    return { text: generic, used: 'static' };
  }
}

export default ErrorFallbacksService;
