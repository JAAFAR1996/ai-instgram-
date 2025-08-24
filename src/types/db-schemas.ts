import { z } from 'zod';

export const RlsContextRow = z.object({
  has_merchant_context: z.boolean(),
  merchant_id: z.string().uuid().nullable(),
  is_admin: z.boolean(),
  context_age_seconds: z.number().int(),
});

export const MerchantRow = z.object({
  id: z.string().uuid(),
  business_name: z.string(),
  business_category: z.string().nullable(),
  created_at: z.string().or(z.date()),
  updated_at: z.string().or(z.date()).optional(),
});

export const ConversationRow = z.object({
  id: z.string().uuid(),
  platform: z.string(),
  created_at: z.string().or(z.date()),
  updated_at: z.string().or(z.date()).optional(),
  last_message_at: z.string().or(z.date()).optional(),
  session_data: z.any().optional().nullable(),
  conversation_stage: z.string().nullable().optional(),
  business_name: z.string().nullable().optional(),
  business_category: z.string().nullable().optional(),
});

export const TemplateRow = z.object({
  id: z.string().uuid(),
  merchant_id: z.string().uuid(),
  name: z.string(),
  type: z.string(),
  content: z.string(),
  variables: z.any().nullable().optional(),
  approved: z.boolean().nullable().optional(),
  created_at: z.string().or(z.date()),
  updated_at: z.string().or(z.date()).optional(),
});

export const MessageRow = z.object({
  id: z.string().uuid(),
  merchant_id: z.string().uuid(),
  recipient_id: z.string(),
  template_id: z.string().uuid().nullable(),
  message_id: z.string().nullable(),
  message_type: z.string(),
  status: z.string(),
  sent_at: z.string().or(z.date()).nullable(),
  delivered_at: z.string().or(z.date()).nullable(),
  read_at: z.string().or(z.date()).nullable(),
  error_message: z.string().nullable(),
  created_at: z.string().or(z.date()),
});
