-- Migration 004: Webhook Infrastructure - Essential only

-- Create webhook_logs table for monitoring webhook events
CREATE TABLE IF NOT EXISTS webhook_logs (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('INSTAGRAM', 'WHATSAPP')),
    event_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('RECEIVED','PROCESSED','SUCCESS','FAILED','PENDING')),
    details JSONB,
    processed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for webhook_logs
CREATE INDEX IF NOT EXISTS idx_webhook_logs_merchant_platform ON webhook_logs (merchant_id, platform);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_status ON webhook_logs (status);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_processed_at ON webhook_logs (processed_at);

-- Note: Migration tracking is handled automatically by the migration runner