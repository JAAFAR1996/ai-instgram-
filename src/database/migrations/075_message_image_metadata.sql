-- 075: Message image metadata storage

CREATE TABLE IF NOT EXISTS public.message_image_metadata (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id uuid REFERENCES public.message_logs(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id text,
  mime_type text,
  width int,
  height int,
  size_bytes int,
  content_hash text,
  ocr_text text,
  labels jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_msg_img_meta_message ON public.message_image_metadata(message_id);
CREATE INDEX IF NOT EXISTS idx_msg_img_meta_merchant ON public.message_image_metadata(merchant_id);

