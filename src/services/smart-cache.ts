import { getCache, getSessionCache, CacheService } from '../cache/index.js';
import { normalizeArabic } from '../nlp/ar-normalize.js';
import { getLogger } from './logger.js';
import { createHash } from 'crypto';

export interface CommonReplyEntry {
  text: string;
  intent?: string;
  updatedAt: string; // ISO date
  hits: number;
}

export interface CustomerContextCache {
  // Lightweight session/context patch useful across messages
  stage?: string;
  gender?: string;
  category?: string;
  size?: string;
  color?: string;
  brand?: string;
  lastIntent?: string;
  lastSummary?: string;
  // Any additional context
  [key: string]: unknown;
}

export class SmartCache {
  private log = getLogger({ component: 'smart-cache' });
  private cache: CacheService;

  constructor(cache?: CacheService) {
    this.cache = cache || getCache();
  }

  private replyKey(merchantId: string, text: string): string {
    // Normalize text for cache key stability (Arabic aware)
    const norm = normalizeArabic(text, { stripDiacritics: true, normalizeAlef: true, taMarbutaToHa: true, yaFromMaqsura: true })
      .toLowerCase()
      .replace(/[\p{P}\p{S}]+/gu, ' ')
      .trim()
      .slice(0, 160);
    const hash = createHash('sha256').update(norm).digest('hex').slice(0, 16);
    return `reply:${merchantId}:${hash}`;
  }

  private ctxKey(merchantId: string, customerId: string): string {
    return `ctx:${merchantId}:${customerId}`;
  }

  private prodKey(merchantId: string, productId: string): string {
    return `product:${merchantId}:${productId}`;
  }

  private prodSearchKey(merchantId: string, query: string): string {
    const norm = normalizeArabic(query, { stripDiacritics: true, normalizeAlef: true, taMarbutaToHa: true, yaFromMaqsura: true })
      .toLowerCase()
      .trim();
    const hash = createHash('sha256').update(norm).digest('hex').slice(0, 16);
    return `prodsearch:${merchantId}:${hash}`;
  }

  // ---------- Common Replies ----------
  async getCommonReply(merchantId: string, text: string): Promise<CommonReplyEntry | null> {
    return this.cache.get<CommonReplyEntry>(this.replyKey(merchantId, text), { prefix: 'smart' });
  }

  async setCommonReply(merchantId: string, text: string, entry: { text: string; intent?: string; hits?: number }): Promise<boolean> {
    const value: CommonReplyEntry = {
      text: entry.text,
      updatedAt: new Date().toISOString(),
      hits: typeof entry.hits === 'number' ? entry.hits : 0,
    };
    if (typeof entry.intent === 'string') value.intent = entry.intent;
    // Cache for 7 days
    return this.cache.set(this.replyKey(merchantId, text), value, { prefix: 'smart', ttl: 7 * 24 * 3600 });
  }

  async bumpCommonReplyHit(merchantId: string, text: string): Promise<void> {
    try {
      const key = this.replyKey(merchantId, text);
      const current = await this.cache.get<CommonReplyEntry>(key, { prefix: 'smart' });
      if (current) {
        current.hits = (current.hits || 0) + 1;
        current.updatedAt = new Date().toISOString();
        await this.cache.set(key, current, { prefix: 'smart', ttl: 7 * 24 * 3600 });
      }
    } catch (e) {
      this.log.warn('bumpCommonReplyHit failed', { error: String(e) });
    }
  }

  async maybeCacheCommonReply(merchantId: string, originalUserText: string, aiResponse: string, aiIntent?: string): Promise<void> {
    // Only cache for relatively short, repetitive queries
    const text = (originalUserText || '').trim();
    if (text.length === 0) return;
    // Skip caching generic guidance or small talk to avoid repetitive replies
    const intent = (aiIntent || '').toUpperCase();
    if (intent === 'OTHER' || intent === 'SMALL_TALK') return;
    const lower = text.toLowerCase();
    const looksGeneric = /(سعر|كم|policy|سياسة|ارجاع|استرجاع|return|refund|التوصيل|الشحن|الموقع|location|hours|مواعيد|delivery)/.test(lower);
    if (!looksGeneric && text.length > 64) return;
    try {
      if (typeof aiIntent === 'string' && aiIntent.length > 0) {
        await this.setCommonReply(merchantId, text, { text: aiResponse, intent: aiIntent });
      } else {
        await this.setCommonReply(merchantId, text, { text: aiResponse });
      }
    } catch (e) {
      this.log.warn('maybeCacheCommonReply failed', { error: String(e) });
    }
  }

  // ---------- Customer Context ----------
  async getCustomerContext(merchantId: string, customerId: string): Promise<CustomerContextCache | null> {
    try {
      const sessionCache = getSessionCache();
      const cached = await sessionCache.getSession(this.ctxKey(merchantId, customerId));
      return (cached && typeof cached === 'object') ? (cached as CustomerContextCache) : null;
    } catch (e) {
      this.log.warn('getCustomerContext failed', { error: String(e) });
      return null;
    }
  }

  async patchCustomerContext(merchantId: string, customerId: string, patch: CustomerContextCache): Promise<boolean> {
    try {
      const sessionCache = getSessionCache();
      const key = this.ctxKey(merchantId, customerId);
      const existing = await sessionCache.getSession(key);
      const merged = { ...(existing || {}), ...patch } as CustomerContextCache;
      return sessionCache.setSession(key, merged);
    } catch (e) {
      this.log.warn('patchCustomerContext failed', { error: String(e) });
      return false;
    }
  }

  // ---------- Product Caching ----------
  async getProductById<T = Record<string, unknown>>(merchantId: string, productId: string): Promise<T | null> {
    return this.cache.get<T>(this.prodKey(merchantId, productId), { prefix: 'smart' });
  }

  async setProductById<T = Record<string, unknown>>(merchantId: string, productId: string, product: T, ttlSec = 10 * 60): Promise<boolean> {
    return this.cache.set(this.prodKey(merchantId, productId), product, { prefix: 'smart', ttl: ttlSec });
  }

  async invalidateProduct(merchantId: string, productId: string): Promise<boolean> {
    return this.cache.delete(this.prodKey(merchantId, productId), { prefix: 'smart' });
  }

  async getProductSearchResults<T = any>(merchantId: string, query: string): Promise<T[] | null> {
    return this.cache.get<T[]>(this.prodSearchKey(merchantId, query), { prefix: 'smart' });
  }

  async setProductSearchResults<T = any>(merchantId: string, query: string, results: T[], ttlSec = 120): Promise<boolean> {
    return this.cache.set(this.prodSearchKey(merchantId, query), results, { prefix: 'smart', ttl: ttlSec });
  }
}

export default SmartCache;
