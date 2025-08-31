-- ===============================================
-- Migration 055: Backfill Username Windows
-- Clean up old message windows to use username only
-- ===============================================

BEGIN;

-- Change column type to TEXT for flexibility
ALTER TABLE message_windows 
  ALTER COLUMN customer_instagram TYPE TEXT;

-- Add comment for documentation
COMMENT ON COLUMN message_windows.customer_instagram IS 'Instagram username (not ID) for 24h window tracking';

-- Create index for username lookups in message windows
CREATE INDEX IF NOT EXISTS idx_message_windows_instagram_username
  ON message_windows(customer_instagram)
  WHERE platform = 'instagram';

COMMIT;
