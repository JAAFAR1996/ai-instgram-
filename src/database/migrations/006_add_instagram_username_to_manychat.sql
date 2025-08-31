-- ===============================================
-- Migration: Add instagram_username column to manychat_subscribers
-- Fixes missing column error for ManyChat integration
-- ===============================================

ALTER TABLE manychat_subscribers 
ADD COLUMN IF NOT EXISTS instagram_username VARCHAR(255);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_manychat_instagram_username 
ON manychat_subscribers(instagram_username);

-- Add comment for documentation
COMMENT ON COLUMN manychat_subscribers.instagram_username IS 'Instagram username (without @) for mapping between Instagram and ManyChat';