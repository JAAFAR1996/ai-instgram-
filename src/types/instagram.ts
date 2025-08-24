export type MessagingProduct = 'instagram';

export interface InstagramAPICredentials {
  // تُستخدم صيغ متعددة عبر الخدمات
  accessToken?: string;
  pageAccessToken?: string;
  businessAccountId?: string;
  pageId?: string;
  appSecret?: string;
  webhookVerifyToken?: string;
  tokenExpiresAt?: Date; // مطلوبة في عدة خدمات
}
// توافقاً مع كود oauth - تم تعريفه لاحقاً كواجهة منفصلة

export interface QuickReply {
  title: string;
  payload: unknown;
}

export interface InstagramAPIResponse {
  success: boolean;
  // بعض الخدمات تقرأ id مباشرةً
  id?: string;
  messageId?: string;
  error?: string;
}

export interface SendMessageRequest {
  // شائعة في الكود: messagingType / messageType / content / text / recipientId / attachment / quickReplies
  messagingType?: 'RESPONSE' | 'UPDATE' | 'MESSAGE_TAG';
  messageType?: 'text' | 'image' | 'template';
  content?: string; // يُستخدم لتمرير JSON template أحياناً
  text?: string;    // نص مباشر
  recipientId?: string;
  attachment?: { type: string; payload: unknown };
  quickReplies?: QuickReply[];
}

export interface InstagramMessagePayload {
  messaging_product: MessagingProduct; // 'instagram'
  recipient: { id: string };
  message: {
    text?: string;
    attachment?: { type: string; payload: unknown };
    quick_replies?: QuickReply[];
  };
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  platformMessageId?: string;
  error?: string;
  // تُستخدم في instagram-message-sender.ts
  deliveryStatus?: 'sent' | 'failed';
  timestamp?: Date;
}

// طبقة خفيفة لتوافق صفوف SQL مع قيود DatabaseRow في generics
export type DatabaseRow = Record<string, unknown>;
export type DBRow<T extends object> = T & DatabaseRow;

// إجراءات الموديريشن المستخدمة فعليًا
export type ModerationActionType = 'delete' | 'reply' | 'hide' | 'flag' | 'invite_dm';
export interface ModerationAction {
  type: ModerationActionType;
  template?: string;
  priority: number;
}

// اعتماد OAuth مع تاريخ انتهاء اختياري (مطلوب في instagram-oauth.ts)
export interface InstagramOAuthCredentials {
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
}





// حمولة الويبهوك (مبسّطة لتكفي الاستعمال)
export interface IGWebhookPayload {
  object: 'instagram';
  entry: Array<Record<string, unknown>>;
}

// لتوافق instagram-setup.ts
export interface BusinessAccountInfo {
  id: string;
  username?: string; // نجعلها اختيارية لتجنّب أخطاء exactOptionalPropertyTypes
  name?: string;
  profile_picture_url?: string;
  followers_count?: number;
  media_count?: number;
}



export interface InstagramContext {
  merchantId: string;
  customerId: string;
  platform: 'instagram';
  stage: string;
  cart: Record<string, unknown>[];
  preferences: Record<string, unknown>;
  conversationHistory: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
    metadata?: Record<string, unknown>;
  }>;
  customerProfile?: {
    name?: string;
    phone?: string;
    instagram?: string;
    previousOrders: number;
    averageOrderValue: number;
    preferredCategories: string[];
    lastInteraction: Date;
  };
  merchantSettings?: {
    businessName: string;
    businessCategory: string;
    workingHours: Record<string, unknown>;
    paymentMethods: string[];
    deliveryFees: Record<string, unknown>;
    autoResponses: Record<string, unknown>;
  };
}

export interface MediaContent {
  format: string;
  originalFileName?: string;
  metadata?: {
    duration?: number;
    fileSize?: number;
    dimensions?: {
      width: number;
      height: number;
    };
    format?: string;
    originalFileName?: string;
    aiAnalysis?: {
      description?: string;
      objects?: string[];
      colors?: string[];
      text?: string;
      sentiment?: 'positive' | 'neutral' | 'negative';
      isProductImage?: boolean;
      suggestedTags?: string[];
    };
  };
}

export interface WebhookEvent {
  field: string;
  value: {
    id: string;
    media?: {
      id: string;
      media_product_type: 'feed' | 'story' | 'reels' | 'ad';
    };
  };
}

export interface JobData {
  merchantId: string;
  [key: string]: unknown;
}

export interface BullJob {
  data: JobData;
  attemptsMade?: number;
  opts?: {
    attempts?: number;
    delay?: number;
  };
}

export interface PerformanceMetrics {
  endpoint: string;
  method: string;
  responseTime: number;
  statusCode: number;
  timestamp: Date;
  merchantId?: string;
  errorMessage?: string;
}

export interface LogContext {
  merchantId?: string;
  endpoint?: string;
  event?: string;
  [key: string]: unknown;
}

export interface QualityStatus {
  status: 'EXCELLENT' | 'GOOD' | 'MEDIUM' | 'LOW' | 'CRITICAL';
}

// ===============================================
// Zod Schemas للتحقق من البيانات على الحدود
// ===============================================
import { z } from 'zod';

// Schema للنتائج المُرسلة
export const ZSendResult = z.object({
  success: z.boolean(),
  messageId: z.string().optional(),
  platformMessageId: z.string().optional(),
  error: z.string().optional(),
  deliveryStatus: z.enum(['sent', 'failed']).optional(),
  timestamp: z.preprocess((v) => (typeof v === 'string' ? new Date(v) : v), z.date()).optional()
});
export type TSendResult = z.infer<typeof ZSendResult>;

// Schema لـ Instagram Webhook
export const ZInstagramWebhook = z.object({
  object: z.literal('instagram'),
  entry: z.array(z.object({
    id: z.string(),
    time: z.number(),
    messaging: z.array(z.object({
      sender: z.object({ id: z.string() }),
      recipient: z.object({ id: z.string() }),
      timestamp: z.number(),
      message: z.object({
        mid: z.string().optional(),
        text: z.string().optional(),
        attachments: z.array(z.object({
          type: z.string(),
          payload: z.object({ url: z.string() })
        })).optional()
      }).optional()
    })).optional(),
    changes: z.array(z.object({
      field: z.string(),
      value: z.record(z.unknown())
    })).optional()
  }))
});
export type TInstagramWebhook = z.infer<typeof ZInstagramWebhook>;

// Schema لـ API Response
export const ZInstagramAPIResponse = z.object({
  success: z.boolean(),
  id: z.string().optional(),
  messageId: z.string().optional(),
  error: z.string().optional()
});
export type TInstagramAPIResponse = z.infer<typeof ZInstagramAPIResponse>;

// Schema لـ Send Message Request
export const ZSendMessageRequest = z.object({
  messagingType: z.enum(['RESPONSE', 'UPDATE', 'MESSAGE_TAG']).optional(),
  messageType: z.enum(['text', 'image', 'template']).optional(),
  content: z.string().optional(),
  text: z.string().optional(),
  recipientId: z.string().optional(),
  attachment: z.object({
    type: z.string(),
    payload: z.unknown()
  }).optional(),
  quickReplies: z.array(z.object({
    title: z.string(),
    payload: z.unknown()
  })).optional()
});
export type TSendMessageRequest = z.infer<typeof ZSendMessageRequest>;

// Schema لمعلومات Business Account
export const ZBusinessAccountInfo = z.object({
  id: z.string(),
  username: z.string().optional(),
  name: z.string().optional(),
  profile_picture_url: z.string().optional(),
  followers_count: z.number().optional(),
  media_count: z.number().optional()
});
export type TBusinessAccountInfo = z.infer<typeof ZBusinessAccountInfo>;

// Schema لـ OAuth Credentials
export const ZInstagramOAuthCredentials = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  tokenExpiresAt: z.preprocess((v) => (typeof v === 'string' ? new Date(v) : v), z.date()).optional()
});
export type TInstagramOAuthCredentials = z.infer<typeof ZInstagramOAuthCredentials>;