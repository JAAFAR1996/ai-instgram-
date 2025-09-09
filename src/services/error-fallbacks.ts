import { getLogger } from './logger.js';
import SmartCache from './smart-cache.js';
import SmartProductSearch from './search/smart-product-search.js';
import { dynamicTemplateManager } from './dynamic-template-manager.js';

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
   * باتش 2: اجعله ذكيًا وسياقيًا بدل قوالب عامة
   */
  public async buildFallback(
    merchantId: string,
    customerId: string,
    originalUserText: string
  ): Promise<FallbackResult> {
    const text = (originalUserText ?? '').trim();
    
    // باتش 2: ردود ذكية وسياقية حسب نوع الاستفسار
    const smartFallback = this.getSmartFallback(text);
    if (smartFallback) {
      return { text: smartFallback, used: 'static' };
    }
    
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

    // 3) Dynamic fallback messages from database
    try {
      const errorMessages = await dynamicTemplateManager.getErrorMessages(merchantId);
      const fallbackMessages = errorMessages.fallback;
      
      if (fallbackMessages.length > 0) {
        // اختيار رسالة عشوائية من قاعدة البيانات
        const randomIndex = Math.floor(Math.random() * fallbackMessages.length);
        const dynamicMessage = fallbackMessages[randomIndex] || fallbackMessages[0];
        
        return { text: dynamicMessage, used: 'static' };
      }
    } catch (error) {
      this.log.warn('Failed to get dynamic error messages', { error: String(error) });
    }
    
    // آخر حل: رسائل افتراضية من النظام
    const systemFallbackMessages = [
      'واضح! أعطيني تفاصيل أكثر (اسم المنتج/الكود أو اللي يدور ببالك) وأنا أجاوبك فوراً بمعلومة محددة.',
      'ممتاز! أخبرني أكثر عن ما تبحث عنه (النوع/المقاس/اللون) وسأساعدك بسرعة.',
      'رائع! وضح لي احتياجاتك بالتفصيل وسأجد لك الأنسب فوراً.',
      'ماشي! اشرح لي ما تحتاجه (المنتج/المقاس/اللون) وسأخدمك حالاً.'
    ];
    
    const randomIndex = Math.floor(Math.random() * systemFallbackMessages.length);
    const generic = systemFallbackMessages[randomIndex] || systemFallbackMessages[0];
    
    return { text: generic, used: 'static' };
  }

  /**
   * باتش 2: ردود ذكية وسياقية حسب نوع الاستفسار
   */
  private getSmartFallback(message: string): string | null {
    const lower = message.toLowerCase();
    
    // استفسارات السعر
    if (/(سعر|price|كم|ثمن|تكلفة|cost)/.test(lower)) {
      return 'حتى أكملك بسرعة: شنو اسم المنتج أو الكود؟ وإذا عندك مقاس/لون معين قوليلي حتى أعطيك السعر الدقيق.';
    }
    
    // استفسارات المقاسات
    if (/(مقاس|size|جدول|قياس|صغير|كبير|وسط)/.test(lower)) {
      return 'أرسل لك جدول المقاسات حالاً؛ قوليلي المنتج/الموديل حتى أرسل المقاس المناسب وقياسات الصدر/الخصر/الورك.';
    }
    
    // استفسارات الألوان
    if (/(لون|color|أبيض|أسود|أحمر|أزرق|أخضر|وردي|بني)/.test(lower)) {
      return 'الألوان المتوفرة تتغيّر حسب المخزون. اذكري الموديل حتى أطلع لك المتاح حالياً مع صور مباشرة.';
    }
    
    // استفسارات التوفر
    if (/(متوفر|موجود|متاح|available|stock|مخزون)/.test(lower)) {
      return 'أخبرني اسم المنتج أو الكود حتى أتحقق من التوفر الحالي في المخزون وأعطيك التفاصيل الدقيقة.';
    }
    
    // استفسارات التوصيل
    if (/(توصيل|شحن|delivery|shipping|متى|وقت)/.test(lower)) {
      return 'أخبرني عنوانك أو المنطقة حتى أحسب لك وقت التوصيل والتكلفة بالضبط.';
    }
    
    return null; // لا يوجد رد ذكي مناسب
  }
}

export default ErrorFallbacksService;
