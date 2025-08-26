-- Migration 017: Fix Platform Case Sensitivity and Add Instagram Support
-- Date: 2025-08-18
-- Description: Update webhook_logs platform constraint to use lowercase and add missing platforms

BEGIN;

-- Log migration start
INSERT INTO migration_log (migration_id, started_at, description) 
VALUES ('017', NOW(), 'Fix platform case sensitivity and add Instagram support')
ON CONFLICT (migration_id) DO UPDATE SET started_at = NOW();

-- Step 1: Update existing data to lowercase (if any exists)
UPDATE webhook_logs 
SET platform = LOWER(platform)
WHERE platform IN ('INSTAGRAM', 'WHATSAPP', 'FACEBOOK', 'META');

UPDATE webhook_subscriptions 
SET platform = LOWER(platform)
WHERE platform IN ('INSTAGRAM', 'WHATSAPP', 'FACEBOOK', 'META');

-- Step 2: Drop existing constraints
ALTER TABLE webhook_logs 
DROP CONSTRAINT IF EXISTS webhook_logs_platform_check;

ALTER TABLE webhook_subscriptions 
DROP CONSTRAINT IF EXISTS webhook_subscriptions_platform_check;

-- Step 3: Add updated constraints with lowercase and extended platform support
ALTER TABLE webhook_logs 
ADD CONSTRAINT webhook_logs_platform_check 
CHECK (platform IN (
    'facebook',
    'whatsapp', 
    'instagram',
    'meta',
    'messenger'
));

ALTER TABLE webhook_subscriptions 
ADD CONSTRAINT webhook_subscriptions_platform_check 
CHECK (platform IN (
    'facebook',
    'whatsapp', 
    'instagram',
    'meta',
    'messenger'
));

-- Step 4: Add event_id column for idempotency (if not exists)
ALTER TABLE webhook_logs 
ADD COLUMN IF NOT EXISTS event_id VARCHAR(100);

-- Add unique constraint for idempotency
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_logs_platform_event_unique 
ON webhook_logs(platform, event_id);

-- Step 5: Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_webhook_logs_platform_status_new 
ON webhook_logs(platform, status, processed_at DESC);

-- Step 6: Verify the migration with test inserts
DO $
BEGIN
    -- Test lowercase platform values
    INSERT INTO webhook_logs (
        merchant_id, platform, event_type, event_id, status, details, processed_at
    ) VALUES (
        uuid_generate_v4(), 'instagram', 'test_event', 'migration-test-017-ig', 'TEST', '{"test": true}', NOW()
    ), (
        uuid_generate_v4(), 'whatsapp', 'test_event', 'migration-test-017-wa', 'TEST', '{"test": true}', NOW()
    ), (
        uuid_generate_v4(), 'facebook', 'test_event', 'migration-test-017-fb', 'TEST', '{"test": true}', NOW()
    );
    
    -- Clean up test data
    DELETE FROM webhook_logs WHERE event_id LIKE 'migration-test-017-%';
    
    RAISE NOTICE 'Platform case sensitivity fixed and verified successfully';
END $;

-- Step 7: Add helpful comments
COMMENT ON CONSTRAINT webhook_logs_platform_check ON webhook_logs 
IS 'Supported webhook platforms (lowercase): facebook, whatsapp, instagram, meta, messenger';

COMMENT ON CONSTRAINT webhook_subscriptions_platform_check ON webhook_subscriptions 
IS 'Supported webhook platforms (lowercase): facebook, whatsapp, instagram, meta, messenger';

-- Step 8: Update the view to handle new platforms
CREATE OR REPLACE VIEW webhook_stats_view AS
SELECT 
    ws.merchant_id,
    ws.platform,
    ws.status as subscription_status,
    COUNT(wl.id) as total_events_24h,
    COUNT(CASE WHEN wl.status = 'SUCCESS' THEN 1 END) as successful_events_24h,
    COUNT(CASE WHEN wl.status = 'ERROR' THEN 1 END) as failed_events_24h,
    COUNT(CASE WHEN wl.status = 'RECEIVED' THEN 1 END) as received_events_24h,
    CASE 
        WHEN COUNT(wl.id) > 0 THEN 
            ROUND((COUNT(CASE WHEN wl.status IN ('SUCCESS', 'RECEIVED') THEN 1 END)::numeric / COUNT(wl.id)::numeric) * 100, 2)
        ELSE 0 
    END as success_rate_24h,
    MAX(wl.processed_at) as last_event_at,
    ws.last_verified_at,
    ws.webhook_url
FROM webhook_subscriptions ws
LEFT JOIN webhook_logs wl ON ws.merchant_id = wl.merchant_id 
    AND ws.platform = wl.platform 
    AND wl.processed_at >= NOW() - INTERVAL '24 hours'
GROUP BY ws.merchant_id, ws.platform, ws.status, ws.last_verified_at, ws.webhook_url;

-- Update migration log
UPDATE migration_log 
SET completed_at = NOW(), status = 'SUCCESS' 
WHERE migration_id = '017';

COMMIT;

-- Log success
\echo 'Migration 017: Platform case sensitivity fixed and Instagram support added ✅'