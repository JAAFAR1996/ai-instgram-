-- Migration 021: Ensure unique conversations per merchant/customer/platform
-- Adds unique index on (merchant_id, customer_instagram, platform)
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'uq_conversations_merchant_instagram_platform'
    ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_merchant_instagram_platform
        ON conversations(merchant_id, customer_instagram, platform)
        WHERE customer_instagram IS NOT NULL;
    END IF;
END $$;

COMMIT;