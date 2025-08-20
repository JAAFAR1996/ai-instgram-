-- Migration: Create webhook_events table for idempotency
-- Date: 2025-01-20
-- Purpose: Implement production-grade webhook idempotency with composite primary key

-- Create webhook_events table with composite primary key for idempotency
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id text NOT NULL,
  merchant_id uuid NOT NULL,
  platform varchar(20) NOT NULL CHECK (platform IN ('INSTAGRAM', 'WHATSAPP')),
  body_hash text NOT NULL,
  processed_at timestamp,
  created_at timestamp DEFAULT NOW() NOT NULL,
  
  -- Composite primary key ensures uniqueness per merchant+platform+event
  CONSTRAINT pk_webhook_events PRIMARY KEY (merchant_id, platform, event_id)
);

-- Index for faster lookups by event_id
CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id 
ON webhook_events(event_id);

-- Index for processed_at queries
CREATE INDEX IF NOT EXISTS idx_webhook_events_processed_at 
ON webhook_events(processed_at);

-- Index for cleanup operations (created_at)
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at 
ON webhook_events(created_at);

-- Foreign key constraint to merchants table
ALTER TABLE webhook_events 
ADD CONSTRAINT fk_webhook_events_merchant 
FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE;

-- Add Row Level Security
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- RLS policy for merchant isolation
CREATE POLICY webhook_events_merchant_policy ON webhook_events
FOR ALL 
TO authenticated_role
USING (merchant_id = current_setting('app.current_merchant_id')::uuid);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_events TO authenticated_role;

-- Add comments for documentation
COMMENT ON TABLE webhook_events IS 'Webhook events tracking for idempotency - prevents duplicate processing';
COMMENT ON COLUMN webhook_events.event_id IS 'SHA256 hash of merchant_id + body for uniqueness';
COMMENT ON COLUMN webhook_events.body_hash IS 'SHA256 hash of request body for integrity';
COMMENT ON COLUMN webhook_events.processed_at IS 'When webhook processing completed successfully';

-- Analyze table for query optimization
ANALYZE webhook_events;

-- Create function to cleanup old webhook events (older than 7 days)
CREATE OR REPLACE FUNCTION cleanup_old_webhook_events() RETURNS void AS $$
BEGIN
  DELETE FROM webhook_events 
  WHERE created_at < NOW() - INTERVAL '7 days';
  
  RAISE NOTICE 'Cleaned up old webhook events older than 7 days';
END;
$$ LANGUAGE plpgsql;

-- Optional: Create scheduled cleanup (requires pg_cron extension)
-- SELECT cron.schedule('webhook-cleanup', '0 2 * * *', 'SELECT cleanup_old_webhook_events();');