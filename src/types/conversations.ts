/**
 * ===============================================
 * Conversation Business Logic Types
 * TypeScript interfaces for conversation business logic
 * Used for cross-platform conversation management and AI orchestration
 * 
 * ✅ Focuses on business logic, not database schema
 * ✅ Supports cross-platform conversation features
 * ✅ Provides advanced conversation context management
 * ✅ No conflicts with other type files
 * ===============================================
 */

import { z } from 'zod';
import type { Platform } from './database.js';

// ===============================================
// CONSTANTS & ENUMS
// ===============================================

/**
 * تفضيلات التوصيل
 * Delivery preferences
 */
export const DELIVERY_PREFERENCES = ['home', 'pickup', 'both'] as const;
export type DeliveryPref = typeof DELIVERY_PREFERENCES[number];

/**
 * أوقات الإشعارات
 * Notification times
 */
export const NOTIFICATION_TIMES = ['morning', 'afternoon', 'evening', 'anytime'] as const;
export type NotifyTime = typeof NOTIFICATION_TIMES[number];

/**
 * مستويات الأولوية
 * Urgency levels
 */
export const URGENCY_LEVELS = ['low', 'medium', 'high'] as const;
export type UrgencyLevel = typeof URGENCY_LEVELS[number];

// ===============================================
// CART & PRODUCTS
// ===============================================

/**
 * عنصر السلة - يستخدم في إدارة المحادثات عبر المنصات
 * Cart item - used in cross-platform conversation management
 */
export interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  currency?: string;
  variantId?: string;
  addedAt?: Date;
  platform?: Platform;
  notes?: string;
}

/**
 * Zod schema للتحقق من عنصر السلة
 * Zod schema for cart item validation
 */
export const CartItemSchema = z.object({
  productId: z.string().min(1),
  name: z.string().min(1),
  price: z.number().positive(),
  quantity: z.number().positive().int(),
  currency: z.string().optional(),
  variantId: z.string().optional(),
  addedAt: z.date().optional(),
  platform: z.enum(['instagram', 'whatsapp']).optional(),
  notes: z.string().optional()
});

// ===============================================
// CONVERSATION STAGES & PREFERENCES
// ===============================================

// ConversationStage moved to database.ts for consistency

/**
 * نطاق السعر
 * Price range
 */
export interface PriceRange { 
  min: number; 
  max: number; 
}

/**
 * Zod schema للتحقق من نطاق السعر
 * Zod schema for price range validation
 */
export const PriceRangeSchema = z.object({
  min: z.number().min(0),
  max: z.number().min(0)
}).refine(data => data.max >= data.min, {
  message: "Maximum price must be greater than or equal to minimum price"
});

/**
 * تفضيلات العميل - تستخدم في إدارة المحادثات
 * Customer preferences - used in conversation management
 */
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

/**
 * Zod schema للتحقق من تفضيلات العميل
 * Zod schema for customer preferences validation
 */
export const CustomerPreferencesSchema = z.object({
  categories: z.array(z.string()),
  brands: z.array(z.string()),
  priceRange: PriceRangeSchema,
  style: z.array(z.string()),
  colors: z.array(z.string()),
  sizes: z.array(z.string()),
  deliveryPreference: z.enum(DELIVERY_PREFERENCES),
  paymentMethods: z.array(z.string()),
  notificationTime: z.enum(NOTIFICATION_TIMES)
});

// ===============================================
// CONVERSATION SESSIONS & CONTEXT
// ===============================================

/**
 * جلسة المحادثة - تستخدم في إدارة المحادثات عبر المنصات
 * Conversation session - used in cross-platform conversation management
 */
export interface ConversationSession {
  cart?: CartItem[];
  preferences?: Partial<CustomerPreferences>;
  interests?: string[];
  mergedFrom?: Array<{ id: string; platform: Platform }>;
  // تُستخدم في الدمج داخل CrossPlatformConversationManager
  context?: Record<string, unknown>;
  budget?: { currency: string; max?: number };
  urgency?: UrgencyLevel;
  location?: string;
}

/**
 * Zod schema للتحقق من جلسة المحادثة
 * Zod schema for conversation session validation
 */
export const ConversationSessionSchema = z.object({
  cart: z.array(CartItemSchema).optional(),
  preferences: CustomerPreferencesSchema.partial().optional(),
  interests: z.array(z.string()).optional(),
  mergedFrom: z.array(z.object({
    id: z.string(),
    platform: z.enum(['instagram', 'whatsapp'])
  })).optional(),
  context: z.record(z.unknown()).optional(),
  budget: z.object({
    currency: z.string(),
    max: z.number().positive().optional()
  }).optional(),
  urgency: z.enum(URGENCY_LEVELS).optional(),
  location: z.string().optional()
});

/**
 * الملف الشخصي الموحد للعميل - يستخدم في إدارة المحادثات عبر المنصات
 * Unified customer profile - used in cross-platform conversation management
 */
export interface UnifiedCustomerProfile {
  customerId: string;
  masterCustomerId: string;
  name?: string;
  preferredPlatform?: Platform;
  totalInteractions?: number;
}

/**
 * Zod schema للتحقق من الملف الشخصي الموحد للعميل
 * Zod schema for unified customer profile validation
 */
export const UnifiedCustomerProfileSchema = z.object({
  customerId: z.string().min(1),
  masterCustomerId: z.string().min(1),
  name: z.string().optional(),
  preferredPlatform: z.enum(['instagram', 'whatsapp']).optional(),
  totalInteractions: z.number().int().positive().optional()
});

/**
 * السياق الموحد للمحادثة - يستخدم في إدارة المحادثات عبر المنصات
 * Unified conversation context - used in cross-platform conversation management
 */
export interface UnifiedConversationContext {
  interests: string[];
  cart: CartItem[];
  preferences: CustomerPreferences;
  // يدعم حقول السياق الموحد التي تُدمج من جلسات متعدّدة
  context?: Record<string, unknown>;
  budget?: { currency: string; max?: number };
  urgency?: UrgencyLevel;
  location?: string;
}

/**
 * Zod schema للتحقق من السياق الموحد للمحادثة
 * Zod schema for unified conversation context validation
 */
export const UnifiedConversationContextSchema = z.object({
  interests: z.array(z.string()),
  cart: z.array(CartItemSchema),
  preferences: CustomerPreferencesSchema,
  context: z.record(z.unknown()).optional(),
  budget: z.object({
    currency: z.string(),
    max: z.number().positive().optional()
  }).optional(),
  urgency: z.enum(URGENCY_LEVELS).optional(),
  location: z.string().optional()
});

// ===============================================
// UTILITY TYPES & HELPERS
// ===============================================

/**
 * دالة لإنشاء تفضيلات فارغة للعميل
 * Function to create empty customer preferences
 */
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

/**
 * دوال مساعدة للتحقق من صحة البيانات
 * Helper functions for data validation
 */

/**
 * دالة للتحقق من صحة تفضيل التوصيل
 * Function to validate delivery preference
 */
export function isValidDeliveryPref(pref: string): pref is DeliveryPref {
  return DELIVERY_PREFERENCES.includes(pref as DeliveryPref);
}

/**
 * دالة للتحقق من صحة وقت الإشعار
 * Function to validate notification time
 */
export function isValidNotifyTime(time: string): time is NotifyTime {
  return NOTIFICATION_TIMES.includes(time as NotifyTime);
}

/**
 * دالة للتحقق من صحة مستوى الأولوية
 * Function to validate urgency level
 */
export function isValidUrgencyLevel(level: string): level is UrgencyLevel {
  return URGENCY_LEVELS.includes(level as UrgencyLevel);
}

/**
 * دالة للتحقق من صحة عنصر السلة
 * Function to validate cart item
 */
export function isValidCartItem(item: unknown): item is CartItem {
  return CartItemSchema.safeParse(item).success;
}

/**
 * دالة للتحقق من صحة تفضيلات العميل
 * Function to validate customer preferences
 */
export function isValidCustomerPreferences(prefs: unknown): prefs is CustomerPreferences {
  return CustomerPreferencesSchema.safeParse(prefs).success;
}
