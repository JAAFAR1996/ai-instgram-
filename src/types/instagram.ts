/**
 * ===============================================
 * Instagram Webhook Type Definitions
 * تعريفات أنواع البيانات لويب هوكس إنستغرام
 * ===============================================
 */

export interface IGWebhookChange {
  field: string;
  value: Record<string, unknown>;
}

export interface IGWebhookEntry {
  id: string;
  time: number;
  changes: IGWebhookChange[];
}

export interface IGWebhookPayload {
  object: 'instagram' | string;
  entry: IGWebhookEntry[];
}

// Extended types for better type safety
export interface IGMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    attachments?: Array<{
      type: string;
      payload: {
        url?: string;
        sticker_id?: string;
      };
    }>;
  };
  postback?: {
    payload: string;
    title?: string;
  };
  read?: {
    watermark: number;
  };
}

export interface IGWebhookEntryWithMessaging extends IGWebhookEntry {
  messaging?: IGMessagingEvent[];
}

export interface IGWebhookPayloadWithMessaging {
  object: 'instagram';
  entry: IGWebhookEntryWithMessaging[];
}

export interface InstagramAPICredentials {
  businessAccountId: string;
  pageAccessToken: string;
  pageId: string;
  webhookVerifyToken: string;
  appSecret: string;
  scopes?: string[];
  tokenExpiresAt?: Date;
}

export interface InstagramOAuthCredentials {
  accessToken: string;
  tokenExpiresAt?: Date;
  refreshToken?: string;
}

// Shared Instagram messaging types
export interface QuickReply {
  content_type: 'text';
  title: string;
  payload: string;
}

export interface SendMessageRequest {
  recipientId: string;
  messageType: 'text' | 'image' | 'template';
  content: string;
  attachment?: { type: string; payload: any };
  quickReplies?: QuickReply[];
}