/**
 * Price Formatter Utilities
 * أدوات تنسيق الأسعار
 */

import { getLogger } from '../services/logger.js';

const logger = getLogger({ component: 'price-formatter' });

export interface PriceInfo {
  amount: number;
  currency: string;
  formatted: string;
  isValid: boolean;
}

/**
 * تنسيق السعر بشكل صحيح
 * باتش 3: عدم إرسال "IQD" بلا مبلغ
 */
export function formatPrice(
  price: unknown,
  currency: string = 'IQD',
  fallbackText: string = 'السعر يحتاج تأكيد'
): string {
  try {
    // تحويل السعر إلى رقم
    let numericPrice: number;
    
    if (typeof price === 'number') {
      numericPrice = price;
    } else if (typeof price === 'string') {
      // إزالة أي رموز غير رقمية
      const cleanPrice = price.replace(/[^\d.,]/g, '');
      numericPrice = parseFloat(cleanPrice.replace(',', '.'));
    } else {
      logger.debug('Invalid price type', { price, type: typeof price });
      return fallbackText;
    }
    
    // التحقق من صحة السعر
    if (isNaN(numericPrice) || numericPrice <= 0) {
      logger.debug('Invalid price value', { numericPrice, originalPrice: price });
      return fallbackText;
    }
    
    // تنسيق السعر حسب العملة
    switch (currency.toUpperCase()) {
      case 'IQD':
        return `${Math.round(numericPrice).toLocaleString('en-IQ')} د.ع`;
      case 'USD':
        return `$${numericPrice.toFixed(2)}`;
      case 'EUR':
        return `€${numericPrice.toFixed(2)}`;
      default:
        return `${Math.round(numericPrice).toLocaleString('en-IQ')} ${currency}`;
    }
  } catch (error) {
    logger.warn('Price formatting failed', { error: String(error), price });
    return fallbackText;
  }
}

/**
 * باتش 3: دالة تنسيق الدينار العراقي المحددة
 */
export function formatIQD(amount?: number): string {
  if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
    return 'غير متاح';
  }
  return `${Math.round(amount).toLocaleString('en-IQ')} د.ع`;
}

/**
 * استخراج معلومات السعر من كائن المنتج
 */
export function extractPriceInfo(product: Record<string, unknown>): PriceInfo {
  const salePrice = product.sale_price_amount;
  const regularPrice = product.price_amount;
  const priceUsd = product.price_usd;
  const currency = (product.currency as string) || 'IQD';
  
  // تحديد السعر الفعلي (سعر البيع أولاً، ثم السعر العادي)
  let actualPrice: number | null = null;
  
  if (salePrice && !isNaN(Number(salePrice)) && Number(salePrice) > 0) {
    actualPrice = Number(salePrice);
  } else if (regularPrice && !isNaN(Number(regularPrice)) && Number(regularPrice) > 0) {
    actualPrice = Number(regularPrice);
  } else if (priceUsd && !isNaN(Number(priceUsd)) && Number(priceUsd) > 0) {
    actualPrice = Number(priceUsd);
  }
  
  if (actualPrice === null) {
    return {
      amount: 0,
      currency,
      formatted: 'السعر يحتاج تأكيد',
      isValid: false
    };
  }
  
  return {
    amount: actualPrice,
    currency,
    formatted: formatPrice(actualPrice, currency),
    isValid: true
  };
}

/**
 * تحسين نص المنتج ليتضمن سعراً صحيحاً
 */
export function improveProductText(
  productText: string,
  product: Record<string, unknown>
): string {
  const priceInfo = extractPriceInfo(product);
  
  if (!priceInfo.isValid) {
    return productText;
  }
  
  // استبدال "IQD" أو "د.ع" بدون رقم بالسعر الصحيح
  let improvedText = productText
    .replace(/IQD(?!\s*\d)/gi, priceInfo.formatted)
    .replace(/د\.ع(?!\s*\d)/gi, priceInfo.formatted)
    .replace(/سعر\s*IQD/gi, `سعر ${priceInfo.formatted}`)
    .replace(/سعر\s*د\.ع/gi, `سعر ${priceInfo.formatted}`);
  
  // إذا لم يكن هناك سعر في النص، أضفه
  if (!improvedText.includes(priceInfo.formatted) && !improvedText.includes('سعر')) {
    improvedText += ` - ${priceInfo.formatted}`;
  }
  
  return improvedText;
}

/**
 * إنشاء نص منتج محسن مع سعر صحيح
 */
export function createProductDescription(
  product: Record<string, unknown>,
  includePrice: boolean = true
): string {
  const name = (product.name_ar as string) || (product.name_en as string) || 'منتج';
  const description = (product.description_ar as string) || (product.description_en as string) || '';
  
  let text = name;
  
  if (description) {
    text += ` - ${description}`;
  }
  
  if (includePrice) {
    const priceInfo = extractPriceInfo(product);
    if (priceInfo.isValid) {
      text += ` - ${priceInfo.formatted}`;
    } else {
      text += ' - السعر يحتاج تأكيد';
    }
  }
  
  return text;
}

export default {
  formatPrice,
  extractPriceInfo,
  improveProductText,
  createProductDescription
};
