-- Migration: Add idempotency and performance optimizations to webhook_logs
-- Date: 2025-01-16
-- Purpose: Prevent duplicate webhook processing and optimize query performance

-- 1. Add event_id column for idempotency
ALTER TABLE webhook_logs 
ADD COLUMN IF NOT EXISTS event_id text;

-- 2. Create unique index for idempotency (platform + event_id must be unique)
CREATE UNIQUE INDEX IF NOT EXISTS ux_webhook_event 
ON webhook_logs(platform, event_id);

-- 3. Create performance indexes
CREATE INDEX IF NOT EXISTS idx_webhook_logs_merchant_id 
ON webhook_logs(merchant_id);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_processed_at 
ON webhook_logs(processed_at);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_event_type 
ON webhook_logs(event_type);

-- 4. Create composite index for common queries
CREATE INDEX IF NOT EXISTS idx_webhook_logs_merchant_platform_event 
ON webhook_logs(merchant_id, platform, event_type);

-- 5. Add comment to document the event_id column
COMMENT ON COLUMN webhook_logs.event_id IS 'SHA256 hash of raw webhook body for idempotency';

-- 6. Analyze table for query planner optimization
ANALYZE webhook_logs;