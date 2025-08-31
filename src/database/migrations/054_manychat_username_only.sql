-- ===============================================
-- Migration 054: ManyChat Username Only
-- Unify ManyChat integration to use username only
-- ===============================================

BEGIN;

-- Add new username column
ALTER TABLE manychat_subscribers
  ADD COLUMN IF NOT EXISTS instagram_username TEXT;

-- Migrate existing data: username takes priority
UPDATE manychat_subscribers
SET instagram_username = COALESCE(
  instagram_username, 
  instagram_customer_id, 
  instagram_user_id
)
WHERE instagram_username IS NULL;

-- Drop old indexes
DROP INDEX IF EXISTS idx_manychat_subscribers_instagram_id;

-- Create new unique index for username
CREATE UNIQUE INDEX IF NOT EXISTS ux_manychat_sub_m_merchant_user
  ON manychat_subscribers(merchant_id, instagram_username)
  WHERE instagram_username IS NOT NULL;

-- Create index for username lookups
CREATE INDEX IF NOT EXISTS idx_manychat_sub_instagram_username
  ON manychat_subscribers(instagram_username)
  WHERE instagram_username IS NOT NULL;

-- Create new function for username-based lookups
CREATE OR REPLACE FUNCTION get_manychat_subscriber_by_instagram_username(
  p_merchant_id UUID, 
  p_instagram_username TEXT
)
RETURNS TABLE (manychat_subscriber_id VARCHAR) AS $$
  SELECT m.manychat_subscriber_id
  FROM manychat_subscribers m
  WHERE m.merchant_id = p_merchant_id
    AND m.instagram_username = p_instagram_username
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- Add comment for documentation
COMMENT ON FUNCTION get_manychat_subscriber_by_instagram_username IS 'Get ManyChat subscriber ID by Instagram username';

-- Update existing function to use username
CREATE OR REPLACE FUNCTION get_manychat_subscriber_by_instagram(
  p_merchant_id UUID, 
  p_instagram_username TEXT
)
RETURNS TABLE (manychat_subscriber_id VARCHAR) AS $$
  SELECT m.manychat_subscriber_id
  FROM manychat_subscribers m
  WHERE m.merchant_id = p_merchant_id
    AND m.instagram_username = p_instagram_username
  LIMIT 1;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION get_manychat_subscriber_by_instagram IS 'Legacy function - now uses username instead of ID';

COMMIT;

