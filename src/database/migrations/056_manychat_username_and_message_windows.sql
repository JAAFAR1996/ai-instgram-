-- ===============================================
-- 056: ManyChat username mapping + message windows
-- Align DB schema with Instagram→ManyChat→Server→AI flow
-- ===============================================

DO $$
BEGIN
  -- Ensure merchants table exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'merchants' AND table_schema='public') THEN
    RAISE EXCEPTION 'Migration 056 failed: merchants table missing.';
  END IF;

  -- Ensure manychat_subscribers table exists (from 053)
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'manychat_subscribers' AND table_schema='public') THEN
    RAISE EXCEPTION 'Migration 056 failed: manychat_subscribers table missing. Apply migration 053 first.';
  END IF;
END $$;

-- ===============================================
-- 0) Merchant ↔ Instagram page mapping (minimal)
-- ===============================================

CREATE TABLE IF NOT EXISTS public.merchant_instagram_mapping (
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  business_account_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_merchant_instagram_mapping PRIMARY KEY (page_id)
);

CREATE INDEX IF NOT EXISTS idx_mim_merchant_id ON public.merchant_instagram_mapping(merchant_id) WHERE is_active = true;

COMMENT ON TABLE public.merchant_instagram_mapping IS 'Maps Instagram page_id to merchant with optional business account id';

-- ===============================================
-- 1) Add instagram_username mapping (case-insensitive)
-- ===============================================

ALTER TABLE public.manychat_subscribers
  ADD COLUMN IF NOT EXISTS instagram_username TEXT;

-- Normalize username to lowercase via expression index & uniqueness per merchant
CREATE UNIQUE INDEX IF NOT EXISTS uk_manychat_subscribers_merchant_username
  ON public.manychat_subscribers (merchant_id, lower(instagram_username));

COMMENT ON COLUMN public.manychat_subscribers.instagram_username IS 'Instagram username (lowercased for uniqueness)';

-- Helper function to fetch ManyChat subscriber by username
CREATE OR REPLACE FUNCTION public.get_manychat_subscriber_by_instagram_username(
  p_merchant_id UUID,
  p_username TEXT
) RETURNS TABLE(manychat_subscriber_id TEXT)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT m.manychat_subscriber_id
  FROM public.manychat_subscribers m
  WHERE m.merchant_id = p_merchant_id
    AND CASE WHEN p_username IS NULL THEN FALSE ELSE lower(m.instagram_username) = lower(p_username) END;
END;
$$;

COMMENT ON FUNCTION public.get_manychat_subscriber_by_instagram_username(UUID, TEXT)
  IS 'Return ManyChat subscriber_id for a given merchant and Instagram username';

-- ===============================================
-- 2) Message windows (24h window enforcement)
-- ===============================================

CREATE TABLE IF NOT EXISTS public.message_windows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('instagram','whatsapp','facebook')),
  customer_phone TEXT,
  customer_instagram TEXT,
  window_expires_at TIMESTAMPTZ NOT NULL,
  is_expired BOOLEAN GENERATED ALWAYS AS (window_expires_at <= NOW()) STORED,
  message_count_in_window INTEGER NOT NULL DEFAULT 0,
  merchant_response_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Targeted indexes
CREATE INDEX IF NOT EXISTS idx_message_windows_merchant ON public.message_windows(merchant_id);
CREATE INDEX IF NOT EXISTS idx_message_windows_active ON public.message_windows(merchant_id, platform) WHERE is_expired = FALSE;
CREATE INDEX IF NOT EXISTS idx_message_windows_instagram ON public.message_windows(lower(customer_instagram)) WHERE customer_instagram IS NOT NULL;

COMMENT ON TABLE public.message_windows IS 'Tracks 24h customer service window per merchant & customer';

-- Upsert helper for updating/creating a window when a customer message arrives
CREATE OR REPLACE FUNCTION public.update_message_window(
  p_merchant_id UUID,
  p_customer_phone TEXT,
  p_customer_instagram TEXT,
  p_platform TEXT,
  p_message_id UUID
) RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_expires TIMESTAMPTZ := NOW() + INTERVAL '24 hours';
BEGIN
  INSERT INTO public.message_windows (merchant_id, platform, customer_phone, customer_instagram, window_expires_at, message_count_in_window)
  VALUES (p_merchant_id, p_platform, p_customer_phone, p_customer_instagram, v_expires, 1)
  ON CONFLICT (merchant_id, platform, customer_phone, customer_instagram)
  DO UPDATE SET
    window_expires_at = EXCLUDED.window_expires_at,
    message_count_in_window = public.message_windows.message_count_in_window + 1,
    updated_at = v_now;
END;
$$;

-- Check helper that returns window status for API layer
CREATE OR REPLACE FUNCTION public.check_message_window(
  p_merchant_id UUID,
  p_customer_phone TEXT,
  p_customer_instagram TEXT,
  p_platform TEXT
) RETURNS TABLE (
  can_send_message BOOLEAN,
  window_expires_at TIMESTAMPTZ,
  time_remaining_minutes INTEGER,
  message_count_in_window INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_expires TIMESTAMPTZ;
  v_msgs INT := 0;
BEGIN
  SELECT mw.window_expires_at, mw.message_count_in_window
    INTO v_expires, v_msgs
  FROM public.message_windows mw
  WHERE mw.merchant_id = p_merchant_id
    AND mw.platform = p_platform
    AND (
      (p_customer_phone IS NOT NULL AND mw.customer_phone = p_customer_phone)
      OR (p_customer_instagram IS NOT NULL AND lower(mw.customer_instagram) = lower(p_customer_instagram))
    )
  ORDER BY mw.window_expires_at DESC
  LIMIT 1;

  IF v_expires IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::timestamptz, NULL::int, 0;
  ELSE
    RETURN QUERY SELECT (v_expires > v_now), v_expires, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (v_expires - v_now)) / 60)::int), v_msgs;
  END IF;
END;
$$;

-- Add a composite unique constraint to support ON CONFLICT in update_message_window
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uk_message_windows_identity'
  ) THEN
    ALTER TABLE public.message_windows
      ADD CONSTRAINT uk_message_windows_identity UNIQUE (merchant_id, platform, customer_phone, customer_instagram);
  END IF;
END $$;

-- RLS enablement if 015/037/039 rely on it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename='message_windows'
  ) THEN
    ALTER TABLE public.message_windows ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;
