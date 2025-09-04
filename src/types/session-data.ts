/**
 * ===============================================
 * Session Data Types - Production Ready
 * Type definitions for conversation session data
 * ===============================================
 */

export interface CartItem {
  id: string;
  productId: string;
  name: string;
  price: number;
  quantity: number;
  imageUrl?: string;
}

export interface CustomerPreferences {
  language?: string;
  currency?: string;
  categories?: string[];
  priceRange?: {
    min: number;
    max: number;
  };
  brands?: string[];
  size?: string;
  color?: string[];
}

export interface SessionData {
  cart?: CartItem[];
  preferences?: CustomerPreferences;
  lastActivity?: Date | string;
  clarifyAttempts?: number;
  searchHistory?: string[];
  viewedProducts?: string[];
  [key: string]: unknown;
}

/**
 * Type guard for session data
 */
export function isSessionData(data: unknown): data is SessionData {
  return typeof data === 'object' && data !== null;
}

/**
 * Safe accessor for cart data
 */
export function getSessionCart(sessionData: unknown): CartItem[] {
  if (!isSessionData(sessionData) || !Array.isArray(sessionData.cart)) {
    return [];
  }
  return sessionData.cart.filter((item): item is CartItem => 
    typeof item === 'object' && 
    item !== null && 
    typeof (item as CartItem).id === 'string'
  );
}

/**
 * Safe accessor for preferences data
 */
export function getSessionPreferences(sessionData: unknown): CustomerPreferences {
  if (!isSessionData(sessionData) || typeof sessionData.preferences !== 'object' || !sessionData.preferences) {
    return {};
  }
  return sessionData.preferences as CustomerPreferences;
}