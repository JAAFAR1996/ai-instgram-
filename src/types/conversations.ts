import type { DBRow } from './instagram.js';

export type Platform = 'instagram' | 'whatsapp' | 'messenger' | 'web';

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  currency?: string;
  variantId?: string;
}

export type ConversationStage =
  | 'greeting'
  | 'qualifying'
  | 'catalog'
  | 'negotiation'
  | 'checkout'
  | 'post_sale';

export interface ConversationRow extends Record<string, unknown> {
  id: string;
  platform: Platform;
  conversation_stage: ConversationStage;
  message_count?: string;           // قد تأتي كنص من SQL
  customer_name?: string;
  updated_at?: string | Date;
  created_at?: string | Date;
  session_data: string;             // JSON
}

export interface PriceRange { min: number; max: number }
export type DeliveryPref = 'home' | 'pickup' | 'both';
export type NotifyTime = 'morning' | 'afternoon' | 'evening' | 'anytime';

export interface CustomerPreferences {
  categories: string[];
  brands: string[];
  priceRange: PriceRange;
  style: string[];
  colors: string[];
  sizes: string[];
  deliveryPreference: DeliveryPref;
  paymentMethods: string[];
  notificationTime: NotifyTime;
}

export interface ConversationSession {
  cart?: CartItem[];
  preferences?: Partial<CustomerPreferences>;
  interests?: string[];
  mergedFrom?: Array<{ id: string; platform: Platform }>;
  // تُستخدم في الدمج داخل CrossPlatformConversationManager
  context?: Record<string, unknown>;
  budget?: { currency: string; max?: number };
  urgency?: 'low' | 'medium' | 'high';
  location?: string;
}

export interface UnifiedCustomerProfile {
  customerId: string;
  masterCustomerId: string;
  name?: string;
  preferredPlatform?: Platform;
  totalInteractions?: number;
}

export interface UnifiedConversationContext {
  interests: string[];
  cart: CartItem[];
  preferences: CustomerPreferences;
  // يدعم حقول السياق الموحد التي تُدمج من جلسات متعدّدة
  context?: Record<string, unknown>;
  budget?: { currency: string; max?: number };
  urgency?: 'low' | 'medium' | 'high';
  location?: string;
}

// Helpers
export type Row<T extends object> = DBRow<T>;

export const emptyPreferences = (): CustomerPreferences => ({
  categories: [],
  brands: [],
  priceRange: { min: 0, max: 0 },
  style: [],
  colors: [],
  sizes: [],
  deliveryPreference: 'both',
  paymentMethods: [],
  notificationTime: 'anytime'
});
