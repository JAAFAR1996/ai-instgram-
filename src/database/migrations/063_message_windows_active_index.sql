-- ===============================================
-- 063: Performance index for message_windows active queries
-- ===============================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='message_windows') THEN
    CREATE INDEX IF NOT EXISTS idx_message_windows_active_time
      ON public.message_windows(merchant_id, platform, window_expires_at DESC);
  END IF;
END $$;

