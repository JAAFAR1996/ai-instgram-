export type Platform = 'whatsapp' | 'instagram';

export interface DatabaseRow {
  [key: string]: unknown;
}

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

export interface MessageRow extends DatabaseRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  platform: Platform;
  message_type: string;
  metadata: Record<string, unknown> | null;
}

export interface ConversationRow extends DatabaseRow {
  id: string;
  merchant_id: string;
  platform: Platform;
  platform_conversation_id: string;
  status: 'active' | 'paused' | 'ended';
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  context: Record<string, unknown> | null;
}

export interface StatsRow extends DatabaseRow {
  total: number;
  pending: number;
  processed: number;
  count: number;
}

export interface MessageHistoryRow extends DatabaseRow {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}