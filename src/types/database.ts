/**
 * ===============================================
 * Database Types for AI Sales Platform
 * TypeScript interfaces for all database entities
 * ===============================================
 */

import { z } from 'zod';

// ===============================================
// CONSTANTS & ENUMS
// ===============================================

/**
 * حالات الاشتراك
 * Subscription statuses
 */
export const SUBSCRIPTION_STATUSES = ['ACTIVE', 'SUSPENDED', 'EXPIRED', 'TRIAL'] as const;
export type SubscriptionStatus = typeof SUBSCRIPTION_STATUSES[number];

/**
 * مستويات الاشتراك
 * Subscription tiers
 */
export const SUBSCRIPTION_TIERS = ['BASIC', 'PREMIUM', 'ENTERPRISE'] as const;
export type SubscriptionTier = typeof SUBSCRIPTION_TIERS[number];

/**
 * حالات المنتج
 * Product statuses
 */
export const PRODUCT_STATUSES = ['ACTIVE', 'INACTIVE', 'DRAFT', 'OUT_OF_STOCK', 'DISCONTINUED'] as const;
export type ProductStatus = typeof PRODUCT_STATUSES[number];

/**
 * حالات الطلب
 * Order statuses
 */
export const ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];

/**
 * طرق الدفع
 * Payment methods
 */
export const PAYMENT_METHODS = ['COD', 'ZAIN_CASH', 'ASIA_HAWALA', 'BANK_TRANSFER'] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];

/**
 * حالات الدفع
 * Payment statuses
 */
export const PAYMENT_STATUSES = ['PENDING', 'PAID', 'FAILED', 'REFUNDED'] as const;
export type PaymentStatus = typeof PAYMENT_STATUSES[number];

/**
 * مصادر الطلب
 * Order sources
 */
export const ORDER_SOURCES = ['instagram', 'MANUAL', 'WEBSITE'] as const;
export type OrderSource = typeof ORDER_SOURCES[number];

/**
 * المنصات المدعومة
 * Supported platforms
 */
export const PLATFORMS = ['instagram', 'whatsapp'] as const;
export type Platform = typeof PLATFORMS[number];

/**
 * اتجاهات الرسائل
 * Message directions
 */
export const MESSAGE_DIRECTIONS = ['INCOMING', 'OUTGOING'] as const;
export type MessageDirection = typeof MESSAGE_DIRECTIONS[number];

/**
 * أنواع الرسائل
 * Message types
 */
export const MESSAGE_TYPES = ['TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'STICKER', 'LOCATION', 'CONTACT'] as const;
export type MessageType = typeof MESSAGE_TYPES[number];

/**
 * حالات التسليم
 * Delivery statuses
 */
export const DELIVERY_STATUSES = ['PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED'] as const;
export type DeliveryStatus = typeof DELIVERY_STATUSES[number];

/**
 * مراحل المحادثة
 * Conversation stages
 */
export const CONVERSATION_STAGES = [
  'GREETING',
  'BROWSING',
  'PRODUCT_INQUIRY',
  'INTERESTED',
  'NEGOTIATING',
  'CONFIRMING',
  'COLLECTING_INFO',
  'COMPLETED',
  'ABANDONED',
  'SUPPORT'
] as const;
export type ConversationStage = typeof CONVERSATION_STAGES[number];

/**
 * حالات الجودة
 * Quality statuses
 */
export const QUALITY_STATUSES = ['EXCELLENT', 'GOOD', 'MEDIUM', 'LOW', 'CRITICAL'] as const;
export type QualityStatus = typeof QUALITY_STATUSES[number];

// ===============================================
// ERROR HANDLING
// ===============================================

/**
 * خطأ قاعدة البيانات - يستخدم في جميع أنحاء المشروع
 * Database error - used throughout the project
 */
export class DatabaseError extends Error {
  constructor(
    message: string,
    public code?: string,
    public query?: string,
    public params?: unknown[]
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

// ===============================================
// BASE ENTITIES
// ===============================================

/**
 * الكيان الأساسي مع المعرف
 * Base entity with ID
 */
export interface BaseEntity {
  id: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * الكيان مع الطوابع الزمنية
 * Entity with timestamps
 */
export interface TimestampedEntity extends BaseEntity {
  created_at: Date;
  updated_at: Date;
}

// ===============================================
// MERCHANT RELATED TYPES
// ===============================================

/**
 * إعدادات التاجر
 * Merchant settings
 */
export interface MerchantSettings {
  working_hours: {
    enabled: boolean;
    timezone: string;
    schedule: {
      [day: string]: {
        open: string;
        close: string;
        enabled: boolean;
      };
    };
  };
  payment_methods: PaymentMethod[];
  delivery_fees: {
    inside_baghdad: number;
    outside_baghdad: number;
  };
  auto_responses: {
    welcome_message: string;
    outside_hours: string;
  };
}

/**
 * واجهة برمجة تطبيقات Instagram Graph
 * Instagram Graph API interface
 */
export interface InstagramGraphAPI {
  accessToken: string; // For Graph API
  pageId: string;      // Instagram Business Account ID
  businessAccountId: string; // Instagram Business Account
}

/**
 * التاجر - الكيان الرئيسي في النظام
 * Merchant - main entity in the system
 */
export interface Merchant extends TimestampedEntity {
  business_name: string;
  business_category: string;
  business_address?: string;
  
  // Contact Information
  instagram_username?: string;
  email?: string;
  
  // Subscription Management
  subscription_status: SubscriptionStatus;
  subscription_tier: SubscriptionTier;
  subscription_started_at: Date;
  subscription_expires_at?: Date;
  
  // Business Settings
  settings: MerchantSettings;
  
  // Audit fields
  last_activity_at: Date;
  search_vector?: string; // For full-text search
}

// ===============================================
// PRODUCT RELATED TYPES
// ===============================================

/**
 * خصائص المنتج
 * Product attributes
 */
export interface ProductAttributes {
  [key: string]: string | number | boolean;
  // Examples: color: 'أحمر', size: 'L', weight: '1kg', brand: 'Samsung'
}

/**
 * متغيرات المنتج
 * Product variants
 */
export interface ProductVariant {
  name: string;
  values: string[];
  // Example: {name: 'Color', values: ['أحمر', 'أزرق']}
}

/**
 * صورة المنتج
 * Product image
 */
export interface ProductImage {
  url: string;
  alt: string;
  order: number;
}

/**
 * المنتج - الكيان الأساسي للمنتجات
 * Product - core product entity
 */
export interface Product extends TimestampedEntity {
  merchant_id: string;
  
  // Product Information
  sku: string;
  name_ar: string;
  name_en?: string;
  description_ar?: string;
  description_en?: string;
  category: string;
  
  // Pricing
  price_usd: number;
  cost_usd?: number;
  discount_percentage: number;
  
  // Inventory Management
  stock_quantity: number;
  stock_reserved: number;
  min_stock_alert: number;
  max_stock_limit?: number;
  
  // Product Attributes
  attributes: ProductAttributes;
  variants: ProductVariant[];
  
  // Media
  images: ProductImage[];
  videos: string[];
  
  // SEO and Marketing
  tags: string[];
  is_featured: boolean;
  is_on_sale: boolean;
  sale_price_usd?: number;
  sale_starts_at?: Date;
  sale_ends_at?: Date;
  
  // Status
  status: ProductStatus;
  
  // Search optimization
  search_vector?: string;
}

// ===============================================
// ORDER RELATED TYPES
// ===============================================

/**
 * عنصر الطلب
 * Order item
 */
export interface OrderItem {
  sku: string;
  product_id: string;
  name: string;
  price: number;
  quantity: number;
  total: number;
  attributes?: ProductAttributes;
}

/**
 * الطلب - الكيان الأساسي للطلبات
 * Order - core order entity
 */
export interface Order extends TimestampedEntity {
  order_number: string;
  merchant_id: string;
  
  // Customer Information
  customer_phone: string;
  customer_name?: string;
  customer_address: string;
  customer_notes?: string;
  
  // Order Details
  items: OrderItem[];
  
  // Pricing
  subtotal_amount: number;
  discount_amount: number;
  delivery_fee: number;
  total_amount: number;
  
  // Order Management
  status: OrderStatus;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  
  // Source Tracking
  order_source: OrderSource;
  conversation_id?: string;
  
  // Delivery Information
  delivery_date?: Date;
  delivery_time_slot?: string;
  delivery_instructions?: string;
  tracking_number?: string;
  
  // Internal Notes
  merchant_notes?: string;
  admin_notes?: string;
  
  // Status timestamps
  confirmed_at?: Date;
  shipped_at?: Date;
  delivered_at?: Date;
  cancelled_at?: Date;
}

// ===============================================
// CONVERSATION RELATED TYPES
// ===============================================

/**
 * بيانات جلسة المحادثة
 * Conversation session data
 */
export interface ConversationSessionData {
  cart: OrderItem[];
  preferences: Record<string, any>;
  context: Record<string, any>;
  intent?: string;
  last_product_viewed?: string;
  interaction_count: number;
}

/**
 * المحادثة - الكيان الأساسي للمحادثات
 * Conversation - core conversation entity
 */
export interface Conversation extends TimestampedEntity {
  merchant_id: string;
  
  // Customer Identification
  customer_instagram?: string;
  customer_name?: string;
  
  // Platform Information
  platform: Platform;
  platform_thread_id?: string;
  
  // Conversation State
  conversation_stage: ConversationStage;
  
  // AI Context
  session_data: ConversationSessionData;
  
  // Conversation Metrics
  message_count: number;
  ai_response_count: number;
  avg_response_time_ms?: number;
  
  // Outcome Tracking
  converted_to_order: boolean;
  order_id?: string;
  abandonment_reason?: string;
  
  // Timestamps
  last_message_at: Date;
  last_ai_response_at?: Date;
  ended_at?: Date;
}

// ===============================================
// MESSAGE RELATED TYPES
// ===============================================

/**
 * بيانات وصفية للوسائط في الرسائل
 * Media metadata for messages
 */
export interface MessageMediaMetadata {
  filename?: string;
  filesize?: number;
  mimetype?: string;
  width?: number;
  height?: number;
  duration?: number;
}

/**
 * سجل الرسالة - الكيان الأساسي للرسائل
 * Message log - core message entity
 */
export interface MessageLog extends BaseEntity {
  conversation_id: string;
  
  // Message Information
  direction: MessageDirection;
  platform: Platform;
  message_type: MessageType;
  
  // Message Content
  content?: string;
  media_url?: string;
  media_caption?: string;
  media_metadata?: MessageMediaMetadata;
  
  // Platform-specific IDs
  platform_message_id?: string;
  reply_to_message_id?: string;
  
  // AI Processing
  ai_processed: boolean;
  ai_response_time_ms?: number;
  ai_model_used?: string;
  ai_tokens_used?: number;
  
  // Status
  delivery_status: DeliveryStatus;
  
  // Timestamps
  processed_at?: Date;
  
  // Search
  content_search?: string;
}

// ===============================================
// ANALYTICS AND REPORTING TYPES
// ===============================================

/**
 * تحليلات التاجر
 * Merchant analytics
 */
export interface MerchantAnalytics {
  merchant_id: string;
  business_name: string;
  subscription_status: SubscriptionStatus;
  merchant_since: Date;
  
  // Order Statistics
  total_orders: number;
  confirmed_orders: number;
  delivered_orders: number;
  cancelled_orders: number;
  
  // Revenue Statistics
  total_revenue: number;
  avg_order_value: number;
  
  // Customer Statistics
  unique_customers: number;
  active_customers_30d: number;
  
  // Product Statistics
  total_products: number;
  active_products: number;
  low_stock_products: number;
  
  // Conversation Statistics
  total_conversations: number;
  converted_conversations: number;
  
  // Performance Metrics
  order_confirmation_rate: number;
  conversation_conversion_rate: number;
  delivery_success_rate: number;
  
  // Recent Activity
  last_order_at?: Date;
  last_conversation_at?: Date;
}

/**
 * إحصائيات المنصة
 * Platform statistics
 */
export interface PlatformStats {
  date: Date;
  active_merchants: number;
  total_merchants: number;
  daily_orders: number;
  daily_confirmed_orders: number;
  daily_revenue: number;
  daily_conversations: number;
  daily_converted_conversations: number;
  daily_messages: number;
  daily_incoming_messages: number;
  daily_outgoing_messages: number;
  daily_order_confirmation_rate: number;
  daily_conversation_conversion_rate: number;
}

/**
 * أداء المنتج
 * Product performance
 */
export interface ProductPerformance {
  id: string;
  merchant_id: string;
  sku: string;
  name_ar: string;
  category: string;
  price_usd: number;
  stock_quantity: number;
  created_at: Date;
  
  // Sales Statistics
  total_sold: number;
  total_revenue: number;
  order_count: number;
  unique_buyers: number;
  sales_last_7_days: number;
  sales_last_30_days: number;
  
  // Performance Metrics
  avg_selling_price: number;
  sell_through_rate: number;
}

/**
 * تحليلات العميل
 * Customer analytics
 */
export interface CustomerAnalytics {
  customer_phone: string;
  customer_name?: string;
  merchant_id: string;
  
  // Order Statistics
  total_orders: number;
  delivered_orders: number;
  total_spent: number;
  avg_order_value: number;
  
  // Timing
  first_order_at: Date;
  last_order_at: Date;
  avg_days_between_orders?: number;
  
  // Conversation Statistics
  total_conversations: number;
  avg_messages_per_conversation: number;
  
  // Customer Classification
  customer_type: 'NEW' | 'REPEAT';
  customer_status: 'ACTIVE' | 'INACTIVE' | 'CHURNED';
}

// ===============================================
// DATABASE CONNECTION AND QUERY TYPES
// ===============================================

/**
 * إعدادات قاعدة البيانات القديمة
 * Legacy database configuration
 */
export interface LegacyDatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl?: boolean;
  pool?: {
    min: number;
    max: number;
  };
}

/**
 * نتيجة الاستعلام
 * Query result
 */
export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
  command: string;
}

/**
 * الهجرة
 * Migration
 */
export interface Migration {
  id: number;
  name: string;
  filename: string;
  executed_at?: Date;
}

// ===============================================
// SECURITY AND COMPLIANCE TYPES
// ===============================================

/**
 * بيانات اعتماد التاجر
 * Merchant credentials
 */
export interface MerchantCredentials extends TimestampedEntity {
  merchant_id: string;
  platform: Platform;
  instagram_token_encrypted?: string;
  instagram_page_id?: string;
  business_account_id?: string;
  webhook_verify_token?: string;
  token_expires_at?: Date;
  last_token_refresh?: Date;
  token_refresh_count: number;
  token_created_ip?: string;
  last_access_ip?: string;
  last_access_at?: Date;
}

/**
 * نافذة الرسائل
 * Message window
 */
export interface MessageWindow extends TimestampedEntity {
  merchant_id: string;
  customer_instagram?: string;
  platform: Platform;
  last_customer_message_at: Date;
  window_expires_at: Date;
  is_expired: boolean;
  initial_message_id?: string;
  message_count_in_window: number;
  merchant_response_count: number;
}

/**
 * سجل التدقيق
 * Audit log
 */
export interface AuditLog extends BaseEntity {
  merchant_id?: string;
  action: string;
  entity_type?: string;
  entity_id?: string;
  details: Record<string, any>;
  trace_id?: string;
  session_id?: string;
  ip_address?: string;
  user_agent?: string;
  request_path?: string;
  request_method?: string;
  execution_time_ms?: number;
  memory_usage_mb?: number;
  success: boolean;
  error_message?: string;
  error_code?: string;
}

/**
 * مقاييس الجودة
 * Quality metrics
 */
export interface QualityMetrics extends TimestampedEntity {
  merchant_id: string;
  platform: Platform;
  quality_rating?: number;
  messaging_quality_score?: number;
  messages_sent_24h: number;
  messages_delivered_24h: number;
  messages_read_24h: number;
  user_initiated_conversations_24h: number;
  business_initiated_conversations_24h: number;
  block_rate_24h: number;
  report_rate_24h: number;
  avg_response_time_minutes?: number;
  response_rate_24h: number;
  template_violations_24h: number;
  policy_violations_24h: number;
  status: QualityStatus;
  last_quality_check: Date;
}

// ===============================================
// ZOD SCHEMAS للتحقق من البيانات على الحدود
// ===============================================

/**
 * Schema للتحقق من Merchant
 * Schema for Merchant validation
 */
export const ZMerchant = z.object({
  id: z.string().uuid(),
  business_name: z.string().min(1),
  business_category: z.string().optional(),
  whatsapp_number: z.string().optional(),
  instagram_username: z.string().optional(),
  subscription_status: z.enum(SUBSCRIPTION_STATUSES),
  subscription_tier: z.enum(SUBSCRIPTION_TIERS),
  settings: z.record(z.unknown()).optional(),
  ai_config: z.record(z.unknown()).optional(),
  created_at: z.preprocess((v) => (typeof v === 'string' ? new Date(v) : v), z.date()),
  updated_at: z.preprocess((v) => (typeof v === 'string' ? new Date(v) : v), z.date()),
  deleted_at: z.preprocess((v) => (typeof v === 'string' ? new Date(v) : v), z.date()).nullable().optional()
});
export type TMerchant = z.infer<typeof ZMerchant>;

/**
 * Schema للتحقق من Conversation
 * Schema for Conversation validation
 */
export const ZConversation = z.object({
  id: z.string().uuid(),
  merchant_id: z.string().uuid(),
  customer_phone: z.string().optional(),
  customer_instagram: z.string().optional(),
  platform: z.enum(PLATFORMS),
  conversation_stage: z.string(),
  session_data: z.object({
    cart: z.array(z.record(z.unknown())).optional(),
    preferences: z.record(z.unknown()).optional(),
    context: z.record(z.unknown()).optional()
  }).optional(),
  last_message_at: z.preprocess((v) => (typeof v === 'string' ? new Date(v) : v), z.date()).optional(),
  created_at: z.preprocess((v) => (typeof v === 'string' ? new Date(v) : v), z.date()),
  updated_at: z.preprocess((v) => (typeof v === 'string' ? new Date(v) : v), z.date())
});
export type TConversation = z.infer<typeof ZConversation>;

/**
 * Schema للتحقق من Message
 * Schema for Message validation
 */
export const ZMessage = z.object({
  id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  direction: z.enum(MESSAGE_DIRECTIONS),
  platform: z.enum(PLATFORMS),
  message_type: z.enum(MESSAGE_TYPES),
  content: z.string().optional(),
  media_url: z.string().optional(),
  platform_message_id: z.string().optional(),
  delivery_status: z.enum(DELIVERY_STATUSES).optional(),
  ai_processed: z.boolean(),
  created_at: z.preprocess((v) => (typeof v === 'string' ? new Date(v) : v), z.date())
});
export type TMessage = z.infer<typeof ZMessage>;

/**
 * Schema للتحقق من Webhook Request
 * Schema for Webhook Request validation
 */
export const ZWebhookRequest = z.object({
  object: z.string(),
  entry: z.array(z.record(z.unknown()))
});
export type TWebhookRequest = z.infer<typeof ZWebhookRequest>;

/**
 * Schema للتحقق من API Response
 * Schema for API Response validation
 */
export const ZAPIResponse = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  message: z.string().optional()
});
export type TAPIResponse = z.infer<typeof ZAPIResponse>;

// ===============================================
// HELPER FUNCTIONS
// ===============================================

/**
 * دالة للتحقق من صحة حالة الاشتراك
 * Function to validate subscription status
 */
export function isValidSubscriptionStatus(status: string): status is SubscriptionStatus {
  return SUBSCRIPTION_STATUSES.includes(status as SubscriptionStatus);
}

/**
 * دالة للتحقق من صحة مستوى الاشتراك
 * Function to validate subscription tier
 */
export function isValidSubscriptionTier(tier: string): tier is SubscriptionTier {
  return SUBSCRIPTION_TIERS.includes(tier as SubscriptionTier);
}

/**
 * دالة للتحقق من صحة المنصة
 * Function to validate platform
 */
export function isValidPlatform(platform: string): platform is Platform {
  return PLATFORMS.includes(platform as Platform);
}

/**
 * دالة للتحقق من صحة مرحلة المحادثة
 * Function to validate conversation stage
 */
export function isValidConversationStage(stage: string): stage is ConversationStage {
  return CONVERSATION_STAGES.includes(stage as ConversationStage);
}
