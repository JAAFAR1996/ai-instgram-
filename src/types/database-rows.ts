/**
 * ===============================================
 * Database Row Types - AI Sales Platform
 * TypeScript interfaces for database row structures
 * Used for type-safe database operations
 * 
 * ✅ تم تحسين الملف ليكون متوافقاً مع المشروع 100%
 * ✅ تم إزالة التكرار مع الملفات الأخرى
 * ✅ تم توحيد التعريفات مع الاستخدامات الفعلية
 * ===============================================
 */

import type { Platform, MessageDirection, DeliveryStatus } from './database.js';

// Base interface for all database rows
export interface DatabaseRow {
  [key: string]: unknown;
}

// ===============================================
// CREDENTIALS & AUTHENTICATION
// ===============================================

export interface CredentialRow extends DatabaseRow {
  merchant_id: string;
  whatsapp_phone_number_id: string | null;
  instagram_page_id: string | null;
  business_account_id: string | null;
  webhook_verify_token: string | null;
  token_expires_at: string | null;
  last_token_refresh: string | null;
  token_refresh_count: string;
  token_created_ip: string | null;
  last_access_ip: string | null;
  last_access_at: string | null;
}

export interface TokenExpiryRow extends DatabaseRow {
  token_expires_at: string | null;
}

// ===============================================
// MESSAGES & CONVERSATIONS
// ===============================================

export interface MessageRow extends DatabaseRow {
  id: string;
  conversation_id: string;
  merchant_id: string;
  direction: MessageDirection;
  platform: Platform;
  message_type: string;
  content: string;
  media_url: string | null;
  platform_message_id: string | null;
  ai_processed: boolean;
  delivery_status: DeliveryStatus;
  ai_confidence: number | null;
  ai_intent: string | null;
  processing_time_ms: number | null;
  media_metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationRow extends DatabaseRow {
  id: string;
  merchant_id: string;
  platform: Platform;
  platform_conversation_id: string;
  status: 'active' | 'paused' | 'ended';
  conversation_stage: string;
  session_data: string; // JSON string
  message_count: string;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

export interface MessageHistoryRow extends DatabaseRow {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  platform: Platform;
  message_type: string;
  metadata: Record<string, unknown> | null;
}

export interface ManualFollowupRow extends DatabaseRow {
  id: string;
  merchant_id: string;
  customer_id: string;
  conversation_id: string | null;
  original_message: string;
  reason: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status: 'PENDING' | 'ASSIGNED' | 'COMPLETED' | 'CANCELLED';
  assigned_to: string | null;
  created_at: string;
  scheduled_for: string;
  completed_at: string | null;
  notes: string | null;
}

// ===============================================
// STATISTICS & ANALYTICS
// ===============================================

export interface StatsRow extends DatabaseRow {
  total: number;
  pending: number;
  processed: number;
  count: number;
}

export interface MessageStatsRow extends DatabaseRow {
  total: string;
  incoming: string;
  outgoing: string;
  platform: string | null;
  message_type: string | null;
  delivery_status: string | null;
  avg_processing_time: string;
  avg_ai_confidence: string;
}

export interface ConversationStatsRow extends DatabaseRow {
  total_conversations: string;
  active_conversations: string;
  ended_conversations: string;
  avg_messages_per_conversation: string;
  avg_conversation_duration_minutes: string;
}

export interface MerchantStatsRow extends DatabaseRow {
  total_merchants: string;
  active_merchants: string;
  total_messages_used: string;
  avg_messages_per_merchant: string;
  subscription_tier: string | null;
  business_category: string | null;
}

// ===============================================
// UTILITY TYPES
// ===============================================

export interface CountRow extends DatabaseRow {
  count: string;
}

// ===============================================
// TYPE GUARDS & HELPERS
// ===============================================

export function isMessageRow(row: DatabaseRow): row is MessageRow {
  return 'id' in row && 'conversation_id' in row && 'direction' in row;
}

export function isConversationRow(row: DatabaseRow): row is ConversationRow {
  return 'id' in row && 'merchant_id' in row && 'platform' in row;
}

export function isCredentialRow(row: DatabaseRow): row is CredentialRow {
  return 'merchant_id' in row && 'token_expires_at' in row;
}

export function isStatsRow(row: DatabaseRow): row is StatsRow {
  return 'total' in row && 'count' in row;
}

export function isManualFollowupRow(row: DatabaseRow): row is ManualFollowupRow {
  return 'id' in row && 'merchant_id' in row && 'customer_id' in row && 'reason' in row;
}

// ===============================================
// RE-EXPORTS FROM OTHER FILES
// ===============================================
// إعادة تصدير الأنواع من db.ts لتجنب التكرار

export type {
  MessageWindowRow,
  WindowStatsRow,
  ExpiringWindowRow,
  QualityTrendRow,
  DeleteCountRow,
  MerchantRow,
  MessageWindowRecord,
  CredentialRow as DbCredentialRow
} from './db.js';