-- 097: Performance indexes for conversations and message logs
BEGIN;

-- Accelerate lookup of conversations by merchant and instagram username
CREATE INDEX IF NOT EXISTS idx_conversations_merchant_customer
  ON public.conversations(merchant_id, customer_instagram);

-- Speed up time-ordered scans of messages per conversation
CREATE INDEX IF NOT EXISTS idx_message_logs_conv_created
  ON public.message_logs(conversation_id, created_at DESC);

COMMIT;

