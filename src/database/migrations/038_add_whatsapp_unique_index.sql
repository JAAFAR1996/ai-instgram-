-- Migration 036: Add unique index for WhatsApp conversations
-- Adds unique index on (merchant_id, customer_phone, platform) for WhatsApp
BEGIN;

DO $$
BEGIN
    -- Add unique index for WhatsApp conversations
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'uq_conversations_merchant_phone_platform'
    ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_merchant_phone_platform
        ON conversations(merchant_id, customer_phone, platform)
        WHERE customer_phone IS NOT NULL;
    END IF;
END $$;

COMMENT ON INDEX uq_conversations_merchant_phone_platform IS 'Ensures one conversation per merchant/customer/platform for WhatsApp';

COMMIT;