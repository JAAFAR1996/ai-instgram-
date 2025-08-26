-- ===============================================
-- Migration 016: Webhook Status Normalization
-- Normalizes webhook_logs status values to consistent format
-- ===============================================

-- Drop existing constraint if it exists
ALTER TABLE webhook_logs DROP CONSTRAINT IF EXISTS webhook_logs_status_check;

-- Add new constraint with normalized status values
ALTER TABLE webhook_logs
ADD CONSTRAINT webhook_logs_status_check
CHECK (status IN ('RECEIVED','PROCESSED','SUCCESS','FAILED','PENDING'));

-- Record this migration
INSERT INTO migrations (name, filename) VALUES ('Webhook Status Normalization', '016_webhook_status_normalization.sql')
ON CONFLICT (name) DO NOTHING;