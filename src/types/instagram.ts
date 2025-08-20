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