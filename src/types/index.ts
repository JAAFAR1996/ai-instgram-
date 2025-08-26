/**
 * ===============================================
 * Types Index - AI Sales Platform
 * Central export point for all TypeScript types
 * Provides organized access to all type definitions
 * 
 * ✅ Single entry point for all types
 * ✅ Organized by category
 * ✅ Reduces import complexity
 * ✅ Improves maintainability
 * ===============================================
 */

// Import Platform type for type guards (moved to top)
import type { Platform } from './database.js';

// ===============================================
// DATABASE & SQL TYPES
// ===============================================

// Core database types
export type {
  DatabaseError,
  BaseEntity,
  TimestampedEntity,
  Platform,
  MessageDirection,
  MessageType,
  DeliveryStatus,
  ConversationStage,
  SubscriptionStatus,
  SubscriptionTier,
  ProductStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  OrderSource
} from './database.js';

// Database row types
export type {
  DatabaseRow,
  CredentialRow,
  TokenExpiryRow,
  MessageRow,
  ConversationRow,
  MessageHistoryRow,
  StatsRow,
  MessageStatsRow,
  ConversationStatsRow,
  MerchantStatsRow,
  CountRow,
  isMessageRow,
  isConversationRow,
  isCredentialRow,
  isStatsRow
} from './database-rows.js';

// SQL and database utilities
export type {
  Sql,
  SqlFragment,
  SqlResult,
  BaseRow,
  CountResult
} from './sql.js';

// Database schemas (Zod)
export {
  RlsContextRow,
  MerchantRow,
  TemplateRow
} from './db-schemas.js';

// ===============================================
// BUSINESS LOGIC TYPES
// ===============================================

// Conversation business logic
export type {
  CartItem,
  PriceRange,
  DeliveryPref,
  NotifyTime,
  CustomerPreferences,
  ConversationSession,
  UnifiedCustomerProfile,
  UnifiedConversationContext,
  emptyPreferences
} from './conversations.js';

// Instagram specific types
export type {
  InstagramAPICredentials,
  InstagramOAuthCredentials,
  SendMessageRequest,
  SendResult,
  QuickReply,
  BusinessAccountInfo,
  IGWebhookPayload,
  InstagramContext,
  DBRow
} from './instagram.js';

// Social media types
export type {
  StoryInteraction,
  CommentInteraction,
  MediaContent as SocialMediaContent
} from './social.js';

// ===============================================
// SERVICE & CONTROL TYPES
// ===============================================

// Service control
export {
  ToggleServiceSchema,
  ServiceNameSchema,
  ServiceStatus,
  ServiceToggleRequest
} from './service-control.js';

// Common utilities
export {
  toInt
} from './common.js';

// ===============================================
// APPLICATION TYPES
// ===============================================

// App configuration
export type {
  AppConfig,
  LogLevel
} from './app.js';

// ===============================================
// RE-EXPORTS FOR COMPATIBILITY
// ===============================================

// Re-export commonly used types for backward compatibility
export type {
  MessageWindowRow,
  WindowStatsRow,
  ExpiringWindowRow,
  QualityTrendRow,
  DeleteCountRow,
  MerchantRow as DbMerchantRow,
  MessageWindowRecord
} from './db.js';

// ===============================================
// TYPE GUARDS & HELPERS
// ===============================================

// Common type guards
export const isString = (value: unknown): value is string => typeof value === 'string';
export const isNumber = (value: unknown): value is number => typeof value === 'number';
export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
export const isObject = (value: unknown): value is Record<string, unknown> => 
  typeof value === 'object' && value !== null && !Array.isArray(value);
export const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

// Platform type guards
export const isPlatform = (value: unknown): value is Platform => 
  isString(value) && ['instagram', 'whatsapp'].includes(value as string);

// ===============================================
// CONSTANTS
// ===============================================

// Platform constants
export const PLATFORMS = {
  INSTAGRAM: 'instagram' as const,
  WHATSAPP: 'whatsapp' as const
} as const;

// Message directions
export const MESSAGE_DIRECTIONS = {
  INCOMING: 'INCOMING' as const,
  OUTGOING: 'OUTGOING' as const
} as const;

// Delivery statuses
export const DELIVERY_STATUSES = {
  PENDING: 'PENDING' as const,
  SENT: 'SENT' as const,
  DELIVERED: 'DELIVERED' as const,
  READ: 'READ' as const,
  FAILED: 'FAILED' as const
} as const;
