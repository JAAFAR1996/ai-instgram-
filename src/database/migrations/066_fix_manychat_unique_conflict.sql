-- ===============================================
-- 066: Ensure ON CONFLICT works for manychat_subscribers
-- Adds a real UNIQUE CONSTRAINT on (merchant_id, instagram_username)
-- and normalizes usernames to lowercase
-- ===============================================

BEGIN;

-- Normalize existing usernames to lowercase
UPDATE public.manychat_subscribers
SET instagram_username = LOWER(instagram_username)
WHERE instagram_username IS NOT NULL;

-- Add unique constraint to support ON CONFLICT (merchant_id, instagram_username)
ALTER TABLE public.manychat_subscribers
  ADD CONSTRAINT uq_manychat_merchant_username
  UNIQUE (merchant_id, instagram_username);

COMMIT;