-- ===============================================
-- 065: Normalize platform case to lowercase for conversations and message_logs
-- Aligns schema with application using lowercase ('instagram','whatsapp')
-- ===============================================

BEGIN;

-- Conversations: update data then adjust CHECK constraint
UPDATE public.conversations
SET platform = LOWER(platform)
WHERE platform IS NOT NULL;

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_platform_check;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_platform_check
  CHECK (platform IN ('instagram','whatsapp'));

-- Message logs: update data then adjust CHECK constraint
UPDATE public.message_logs
SET platform = LOWER(platform)
WHERE platform IS NOT NULL;

ALTER TABLE public.message_logs
  DROP CONSTRAINT IF EXISTS message_logs_platform_check;

ALTER TABLE public.message_logs
  ADD CONSTRAINT message_logs_platform_check
  CHECK (platform IN ('instagram','whatsapp'));

COMMIT;