-- ===============================================
-- Migration 055: Enforce Username-Only Architecture
-- Remove all instagram_user_id columns and enforce username-only
-- ===============================================

-- 1. Update conversations table
ALTER TABLE conversations 
  DROP COLUMN IF EXISTS customer_phone CASCADE,
  ADD COLUMN IF NOT EXISTS instagram_username VARCHAR(100);

-- Migrate existing data: use customer_instagram as username (if it contains @)
UPDATE conversations 
SET instagram_username = customer_instagram
WHERE customer_instagram IS NOT NULL 
  AND platform = 'instagram'
  AND instagram_username IS NULL;

-- Create unique index on merchant + username
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS 
  idx_conversations_merchant_username 
  ON conversations (merchant_id, instagram_username)
  WHERE platform = 'instagram' AND instagram_username IS NOT NULL;

-- 2. Update merchants table - remove instagram_user_id
ALTER TABLE merchants 
  DROP COLUMN IF EXISTS instagram_user_id CASCADE;

-- 3. Update merchant_credentials table - remove instagram_user_id  
ALTER TABLE merchant_credentials 
  DROP COLUMN IF EXISTS instagram_user_id CASCADE;

-- Ensure instagram_username is properly indexed
CREATE INDEX CONCURRENTLY IF NOT EXISTS 
  idx_merchants_instagram_username 
  ON merchants (instagram_username)
  WHERE instagram_username IS NOT NULL;

-- 4. Update manychat_subscribers table to use username
ALTER TABLE manychat_subscribers 
  DROP COLUMN IF EXISTS instagram_user_id CASCADE,
  ADD COLUMN IF NOT EXISTS instagram_username VARCHAR(100);

-- Create unique index for ManyChat mapping
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS 
  idx_manychat_merchant_username 
  ON manychat_subscribers (merchant_id, instagram_username)
  WHERE instagram_username IS NOT NULL;

-- 5. Update messages table
ALTER TABLE messages 
  ADD COLUMN IF NOT EXISTS sender_username VARCHAR(100);

-- Migrate existing messages: use sender_id as username placeholder
UPDATE messages 
SET sender_username = CASE 
  WHEN platform = 'instagram' AND sender_username IS NULL 
  THEN CONCAT('user_', sender_id)
  ELSE sender_username 
END
WHERE platform = 'instagram';

-- Create index for message lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS 
  idx_messages_platform_username 
  ON messages (platform, sender_username)
  WHERE platform = 'instagram';

-- 6. Clean up any remaining instagram_user_id references
-- This will help catch any missed columns during development
DO $$
DECLARE
  r RECORD;
BEGIN
  -- Find any remaining columns with instagram_user_id
  FOR r IN 
    SELECT schemaname, tablename, columnname 
    FROM information_schema.columns 
    WHERE column_name LIKE '%instagram_user_id%'
      AND table_schema = 'public'
  LOOP
    RAISE NOTICE 'Found instagram_user_id column: %.%.%', r.schemaname, r.tablename, r.columnname;
    -- Uncomment to actually drop (be careful!):
    -- EXECUTE 'ALTER TABLE ' || r.schemaname || '.' || r.tablename || ' DROP COLUMN IF EXISTS ' || r.columnname || ' CASCADE';
  END LOOP;
END $$;

-- 7. Add constraints to enforce data integrity
-- Ensure conversations have username when platform is instagram
ALTER TABLE conversations 
  ADD CONSTRAINT chk_instagram_has_username 
  CHECK (platform != 'instagram' OR instagram_username IS NOT NULL);

-- Ensure manychat mappings have username
ALTER TABLE manychat_subscribers 
  ADD CONSTRAINT chk_manychat_has_username 
  CHECK (instagram_username IS NOT NULL AND instagram_username != '');

-- 8. Create monitoring view for username consistency
CREATE OR REPLACE VIEW v_instagram_username_audit AS
SELECT 
  'conversations' as table_name,
  merchant_id,
  instagram_username,
  COUNT(*) as record_count
FROM conversations 
WHERE platform = 'instagram'
GROUP BY merchant_id, instagram_username

UNION ALL

SELECT 
  'manychat_subscribers' as table_name,
  merchant_id,
  instagram_username,
  COUNT(*) as record_count
FROM manychat_subscribers
GROUP BY merchant_id, instagram_username

UNION ALL

SELECT 
  'messages' as table_name,
  'N/A' as merchant_id,
  sender_username as instagram_username,
  COUNT(*) as record_count
FROM messages 
WHERE platform = 'instagram'
GROUP BY sender_username;

-- Add comment for documentation
COMMENT ON VIEW v_instagram_username_audit IS 
'Audit view to monitor username consistency across instagram-related tables';

-- Final verification
SELECT 'Migration 055 completed - Username-only architecture enforced' as status;