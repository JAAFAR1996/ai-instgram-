-- 070: Add source_channel (e.g., 'manychat') to conversations and message_logs

-- conversations.source_channel
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS source_channel TEXT;

-- message_logs.source_channel
ALTER TABLE public.message_logs
  ADD COLUMN IF NOT EXISTS source_channel TEXT;

-- optional indexes
CREATE INDEX IF NOT EXISTS idx_conversations_source_channel ON public.conversations (source_channel);
CREATE INDEX IF NOT EXISTS idx_message_logs_source_channel ON public.message_logs (source_channel);

