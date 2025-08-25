/**
 * ===============================================
 * Database Row Types
 * TypeScript interfaces for database row structures
 * Compatible with all SQL type definitions
 * ===============================================
 */

export interface DatabaseRow {
  [key: string]: unknown;
}

// Database row types with proper structure
export interface MessageWindowRow extends DatabaseRow {
  id: string;
  merchant_id: string;
  customer_instagram?: string;
  platform: string;
  last_customer_message_at: string;
  window_expires_at: string;
  is_expired: boolean;
  initial_message_id?: string;
  message_count_in_window: number;
  merchant_response_count: number;
  created_at: string;
  updated_at: string;
}

export interface DeleteCountRow extends DatabaseRow {
  count: number;
}

export interface WindowStatsRow extends DatabaseRow {
  total_windows: number;
  active_windows: number;
  expired_windows: number;
  avg_messages_per_window: number;
}

export interface ExpiringWindowRow extends DatabaseRow {
  id: string;
  merchant_id: string;
  customer_instagram?: string;
  window_expires_at: string;
  message_count_in_window: number;
}

export interface MessageWindowRecord extends DatabaseRow {
  id: string;
  merchant_id: string;
  customer_instagram?: string;
  platform: string;
  last_customer_message_at: string;
  window_expires_at: string;
  is_expired: boolean;
  message_count_in_window: number;
  merchant_response_count: number;
}

export interface QualityTrendRow extends DatabaseRow {
  date: string;
  quality_rating?: number;
  status: string;
  messages_sent_24h: number;
  delivery_rate: number;
  response_rate: number;
}

export interface MerchantRow extends DatabaseRow {
  id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
}



export interface CredentialRow extends DatabaseRow {
  id: string;
  merchant_id: string;
  platform: 'instagram' | 'facebook' | 'whatsapp';
  credential_type: 'access_token' | 'app_secret' | 'webhook_secret';
  value: string;
  expires_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface QueueJobData {
  merchantId: string;
  [key: string]: unknown;
}

export interface InstagramWebhookPayload {
  object: 'instagram';
  entry: Array<{
    id: string;
    time: number;
    messaging?: Array<{
      sender: { id: string };
      recipient: { id: string };
      timestamp: number;
      message?: {
        mid: string;
        text?: string;
        attachments?: Array<{
          type: string;
          payload: { url: string };
        }>;
      };
    }>;
    changes?: Array<{
      field: string;
      value: {
        id: string;
        text?: string;
        media?: {
          id: string;
          media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
        };
      };
    }>;
  }>;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl?: boolean;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}