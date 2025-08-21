/**
 * ===============================================
 * Database Types for AI Sales Platform
 * TypeScript interfaces for all database entities
 * ===============================================
 */

// Base interfaces
export interface BaseEntity {
  id: string;
  created_at: Date;
  updated_at: Date;
}

export interface TimestampedEntity extends BaseEntity {
  created_at: Date;
  updated_at: Date;
}

// Enums for better type safety
export type SubscriptionStatus = 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'TRIAL';
export type SubscriptionTier = 'BASIC' | 'PREMIUM' | 'ENTERPRISE';
export type ProductStatus = 'ACTIVE' | 'INACTIVE' | 'DRAFT' | 'OUT_OF_STOCK' | 'DISCONTINUED';
export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'REFUNDED';
export type PaymentMethod = 'COD' | 'ZAIN_CASH' | 'ASIA_HAWALA' | 'BANK_TRANSFER';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
export type OrderSource = 'whatsapp' | 'instagram' | 'MANUAL' | 'WEBSITE';
export type Platform = 'whatsapp' | 'instagram';
export type MessageDirection = 'INCOMING' | 'OUTGOING';
export type MessageType = 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'DOCUMENT' | 'STICKER' | 'LOCATION' | 'CONTACT';
export type DeliveryStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
export type ConversationStage = 
  | 'GREETING' 
  | 'BROWSING' 
  | 'PRODUCT_INQUIRY' 
  | 'INTERESTED' 
  | 'NEGOTIATING' 
  | 'CONFIRMING' 
  | 'COLLECTING_INFO' 
  | 'COMPLETED' 
  | 'ABANDONED' 
  | 'SUPPORT';

// Merchant related types
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

export interface InstagramGraphAPI {
  accessToken: string; // For Graph API
  pageId: string;      // Instagram Business Account ID
  businessAccountId: string; // Instagram Business Account
}

export interface Merchant extends TimestampedEntity {
  business_name: string;
  business_category: string;
  business_address?: string;
  
  // Contact Information
  whatsapp_number: string;
  whatsapp_number_id?: string;
  instagram_username?: string;
  instagram_user_id?: string;
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

// Product related types
export interface ProductAttributes {
  [key: string]: string | number | boolean;
  // Examples: color: 'أحمر', size: 'L', weight: '1kg', brand: 'Samsung'
}

export interface ProductVariant {
  name: string;
  values: string[];
  // Example: {name: 'Color', values: ['أحمر', 'أزرق']}
}

export interface ProductImage {
  url: string;
  alt: string;
  order: number;
}

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

// Order related types
export interface OrderItem {
  sku: string;
  product_id: string;
  name: string;
  price: number;
  quantity: number;
  total: number;
  attributes?: ProductAttributes;
}

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

// Conversation related types
export interface ConversationSessionData {
  cart: OrderItem[];
  preferences: Record<string, any>;
  context: Record<string, any>;
  intent?: string;
  last_product_viewed?: string;
  interaction_count: number;
}

export interface Conversation extends TimestampedEntity {
  merchant_id: string;
  
  // Customer Identification
  customer_phone?: string;
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

// Message related types
export interface MessageMediaMetadata {
  filename?: string;
  filesize?: number;
  mimetype?: string;
  width?: number;
  height?: number;
  duration?: number;
}

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

// Analytics and reporting types
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

// Database connection and query types
export interface DatabaseConfig {
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

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
  command: string;
}

// Migration types
export interface Migration {
  id: number;
  name: string;
  filename: string;
  executed_at?: Date;
}

// Error types
export interface DatabaseError extends Error {
  code?: string;
  detail?: string;
  hint?: string;
  position?: string;
  internalPosition?: string;
  internalQuery?: string;
  where?: string;
  schema?: string;
  table?: string;
  column?: string;
  dataType?: string;
  constraint?: string;
  file?: string;
  line?: string;
  routine?: string;
}

// Security and compliance types
export interface MerchantCredentials extends TimestampedEntity {
  merchant_id: string;
  platform: Platform;
  whatsapp_token_encrypted?: string;
  whatsapp_phone_number_id?: string;
  instagram_token_encrypted?: string;
  instagram_page_id?: string;
  webhook_verify_token?: string;
  token_expires_at?: Date;
  last_token_refresh?: Date;
  token_refresh_count: number;
  token_created_ip?: string;
  last_access_ip?: string;
  last_access_at?: Date;
}

export interface MessageWindow extends TimestampedEntity {
  merchant_id: string;
  customer_phone?: string;
  customer_instagram?: string;
  platform: Platform;
  last_customer_message_at: Date;
  window_expires_at: Date;
  is_expired: boolean;
  initial_message_id?: string;
  message_count_in_window: number;
  merchant_response_count: number;
}

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

export type QualityStatus = 'EXCELLENT' | 'GOOD' | 'MEDIUM' | 'LOW' | 'CRITICAL';

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
