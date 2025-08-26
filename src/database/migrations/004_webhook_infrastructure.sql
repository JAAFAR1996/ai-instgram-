-- Webhook Infrastructure Migration
-- Add tables and indexes for webhook event logging and monitoring

-- Create webhook_logs table for monitoring webhook events
CREATE TABLE IF NOT EXISTS webhook_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('INSTAGRAM', 'WHATSAPP')),
    event_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('SUCCESS', 'ERROR', 'PENDING')),
    details JSONB,
    processed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for webhook_logs
CREATE INDEX IF NOT EXISTS idx_webhook_logs_merchant_platform ON webhook_logs (merchant_id, platform);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_status ON webhook_logs (status);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_processed_at ON webhook_logs (processed_at);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_platform_time ON webhook_logs (platform, processed_at DESC);

-- Create webhook_subscriptions table to track active webhook subscriptions
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('INSTAGRAM', 'WHATSAPP')),
    webhook_url TEXT NOT NULL,
    verify_token VARCHAR(255) NOT NULL,
    subscription_fields TEXT[], -- Array of subscribed fields (messages, messaging_postbacks, etc.)
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'FAILED')),
    last_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for webhook_subscriptions
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_merchant ON webhook_subscriptions (merchant_id);
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_platform ON webhook_subscriptions (platform);
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_status ON webhook_subscriptions (status);

-- Create webhook_delivery_attempts table for retry tracking
CREATE TABLE IF NOT EXISTS webhook_delivery_attempts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    webhook_log_id UUID REFERENCES webhook_logs(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    response_status INTEGER,
    response_body TEXT,
    response_headers JSONB,
    error_message TEXT,
    attempted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for webhook_delivery_attempts
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_webhook_log ON webhook_delivery_attempts (webhook_log_id);
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_attempted_at ON webhook_delivery_attempts (attempted_at);

-- Create function to update webhook_subscriptions updated_at timestamp
CREATE OR REPLACE FUNCTION update_webhook_subscription_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for webhook_subscriptions
DROP TRIGGER IF EXISTS trigger_webhook_subscriptions_updated_at ON webhook_subscriptions;
CREATE TRIGGER trigger_webhook_subscriptions_updated_at
    BEFORE UPDATE ON webhook_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_webhook_subscription_timestamp();

-- Create view for webhook statistics
CREATE OR REPLACE VIEW webhook_stats_view AS
SELECT 
    ws.merchant_id,
    ws.platform,
    ws.status as subscription_status,
    COUNT(wl.id) as total_events_24h,
    COUNT(CASE WHEN wl.status = 'SUCCESS' THEN 1 END) as successful_events_24h,
    COUNT(CASE WHEN wl.status = 'ERROR' THEN 1 END) as failed_events_24h,
    CASE 
        WHEN COUNT(wl.id) > 0 THEN 
            ROUND((COUNT(CASE WHEN wl.status = 'SUCCESS' THEN 1 END)::numeric / COUNT(wl.id)::numeric) * 100, 2)
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

-- Create function to clean up old webhook logs (retention policy)
CREATE OR REPLACE FUNCTION cleanup_old_webhook_logs()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Delete webhook logs older than 30 days
    DELETE FROM webhook_logs 
    WHERE created_at < NOW() - INTERVAL '30 days';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    -- Delete delivery attempts for deleted webhook logs
    DELETE FROM webhook_delivery_attempts 
    WHERE webhook_log_id NOT IN (SELECT id FROM webhook_logs);
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Add Instagram-specific fields to webhook_logs for better tracking
ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS entry_id VARCHAR(100);
ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS message_id VARCHAR(100);
ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS customer_id VARCHAR(100);

-- Create indexes for new fields
CREATE INDEX IF NOT EXISTS idx_webhook_logs_entry_id ON webhook_logs(entry_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_message_id ON webhook_logs(message_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_customer_id ON webhook_logs(customer_id);

-- Add Row Level Security
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_delivery_attempts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for webhook_logs
DROP POLICY IF EXISTS webhook_logs_tenant_policy ON webhook_logs;
CREATE POLICY webhook_logs_tenant_policy ON webhook_logs
    FOR ALL USING (
        merchant_id = current_setting('app.current_merchant_id', true)::UUID
    );

-- RLS Policies for webhook_subscriptions  
DROP POLICY IF EXISTS webhook_subscriptions_tenant_policy ON webhook_subscriptions;
CREATE POLICY webhook_subscriptions_tenant_policy ON webhook_subscriptions
    FOR ALL USING (
        merchant_id = current_setting('app.current_merchant_id', true)::UUID
    );

-- RLS Policies for webhook_delivery_attempts
DROP POLICY IF EXISTS webhook_delivery_attempts_tenant_policy ON webhook_delivery_attempts;
CREATE POLICY webhook_delivery_attempts_tenant_policy ON webhook_delivery_attempts
    FOR ALL USING (
        webhook_log_id IN (
            SELECT id FROM webhook_logs 
            WHERE merchant_id = current_setting('app.current_merchant_id', true)::UUID
        )
    );

-- Insert migration record
INSERT INTO migrations (name, filename) 
VALUES ('Webhook Infrastructure', '004_webhook_infrastructure.sql')
ON CONFLICT (name) DO NOTHING;