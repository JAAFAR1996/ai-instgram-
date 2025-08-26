-- ===============================================
-- Migration 004: Webhook Infrastructure - Production Ready
-- AI Sales Platform - Complete webhook system implementation
-- ===============================================

-- Prerequisites validation
DO $$
BEGIN
    -- Ensure merchants table exists (dependency from migration 001)
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'merchants') THEN
        RAISE EXCEPTION 'Migration 004 failed: merchants table missing. Run migration 001 first.';
    END IF;
    
    -- Ensure uuid-ossp extension is available
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'uuid-ossp') THEN
        RAISE EXCEPTION 'Migration 004 failed: uuid-ossp extension missing. Create extension first.';
    END IF;
    
    RAISE NOTICE 'Migration 004: Prerequisites validated successfully';
END $$;

-- ===============================================
-- 1. WEBHOOK_LOGS TABLE - Core event tracking
-- ===============================================

CREATE TABLE IF NOT EXISTS webhook_logs (
    -- Primary identification
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    
    -- Platform configuration (based on migration 017 requirements)
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('facebook', 'whatsapp', 'instagram', 'meta', 'messenger')),
    
    -- Event identification and classification
    event_type VARCHAR(50) NOT NULL,
    event_id VARCHAR(100), -- For idempotency (from migration 007)
    
    -- Status tracking (based on migration 016 requirements)
    status VARCHAR(20) NOT NULL DEFAULT 'RECEIVED' 
        CHECK (status IN ('RECEIVED', 'PROCESSED', 'SUCCESS', 'FAILED', 'PENDING')),
    
    -- Payload and metadata storage
    details JSONB,
    payload JSONB, -- Raw webhook payload for debugging
    
    -- Instagram/Meta specific fields (from original migration 004)
    entry_id VARCHAR(100), -- Meta webhook entry ID
    message_id VARCHAR(100), -- Message ID from platform
    customer_id VARCHAR(100), -- Customer/sender ID from platform
    
    -- Processing metrics
    processing_time_ms INTEGER,
    retry_count INTEGER DEFAULT 0,
    
    -- Timestamps
    processed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===============================================
-- 2. WEBHOOK_SUBSCRIPTIONS TABLE - Platform integration management
-- ===============================================

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
    -- Primary identification
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    
    -- Platform configuration
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('facebook', 'whatsapp', 'instagram', 'meta', 'messenger')),
    
    -- Webhook configuration
    webhook_url TEXT NOT NULL,
    verify_token VARCHAR(255) NOT NULL,
    subscription_fields TEXT[], -- Array of subscribed webhook fields
    app_secret VARCHAR(255), -- Platform app secret for validation
    
    -- Status management
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' 
        CHECK (status IN ('ACTIVE', 'INACTIVE', 'FAILED', 'PENDING')),
    
    -- Health and monitoring
    last_verified_at TIMESTAMPTZ,
    last_event_received_at TIMESTAMPTZ,
    error_count INTEGER DEFAULT 0,
    consecutive_failures INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ===============================================
-- 3. WEBHOOK_DELIVERY_ATTEMPTS TABLE - Retry mechanism
-- ===============================================

CREATE TABLE IF NOT EXISTS webhook_delivery_attempts (
    -- Primary identification
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    webhook_log_id UUID NOT NULL REFERENCES webhook_logs(id) ON DELETE CASCADE,
    
    -- Retry configuration
    attempt_number INTEGER NOT NULL DEFAULT 1,
    max_retries INTEGER DEFAULT 3,
    
    -- Response tracking
    response_status INTEGER, -- HTTP status code
    response_body TEXT,
    response_headers JSONB,
    response_time_ms INTEGER,
    
    -- Error handling
    error_message TEXT,
    error_type VARCHAR(50), -- 'timeout', 'network', 'server_error', etc.
    error_details JSONB,
    
    -- Scheduling
    attempted_at TIMESTAMPTZ DEFAULT NOW(),
    next_retry_at TIMESTAMPTZ, -- When to retry next
    
    -- Success tracking
    success BOOLEAN DEFAULT FALSE,
    final_attempt BOOLEAN DEFAULT FALSE
);

-- ===============================================
-- PERFORMANCE INDEXES
-- ===============================================

-- webhook_logs indexes
CREATE INDEX IF NOT EXISTS idx_webhook_logs_merchant_platform 
ON webhook_logs (merchant_id, platform);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_status 
ON webhook_logs (status);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_processed_at 
ON webhook_logs (processed_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_platform_time 
ON webhook_logs (platform, processed_at DESC);

-- Instagram/Meta specific indexes
CREATE INDEX IF NOT EXISTS idx_webhook_logs_entry_id 
ON webhook_logs (entry_id) WHERE entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_logs_message_id 
ON webhook_logs (message_id) WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_logs_customer_id 
ON webhook_logs (customer_id) WHERE customer_id IS NOT NULL;

-- Idempotency index (from migration 007)
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_logs_platform_event_unique 
ON webhook_logs (platform, event_id) WHERE event_id IS NOT NULL;

-- Performance composite index
CREATE INDEX IF NOT EXISTS idx_webhook_logs_merchant_platform_status 
ON webhook_logs (merchant_id, platform, status, processed_at DESC);

-- webhook_subscriptions indexes
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_merchant 
ON webhook_subscriptions (merchant_id);

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_platform 
ON webhook_subscriptions (platform);

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_status 
ON webhook_subscriptions (status);

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_active 
ON webhook_subscriptions (merchant_id, platform) WHERE status = 'ACTIVE';

-- webhook_delivery_attempts indexes
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_webhook_log 
ON webhook_delivery_attempts (webhook_log_id);

CREATE INDEX IF NOT EXISTS idx_webhook_delivery_attempted_at 
ON webhook_delivery_attempts (attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_delivery_next_retry 
ON webhook_delivery_attempts (next_retry_at) WHERE next_retry_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_delivery_failed_retries 
ON webhook_delivery_attempts (webhook_log_id, success) WHERE success = FALSE;

-- ===============================================
-- TRIGGERS AND FUNCTIONS
-- ===============================================

-- Function to update webhook_subscriptions updated_at timestamp
CREATE OR REPLACE FUNCTION update_webhook_subscription_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to update webhook_logs updated_at timestamp
CREATE OR REPLACE FUNCTION update_webhook_logs_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers
DROP TRIGGER IF EXISTS trigger_webhook_subscriptions_updated_at ON webhook_subscriptions;
CREATE TRIGGER trigger_webhook_subscriptions_updated_at
    BEFORE UPDATE ON webhook_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_webhook_subscription_timestamp();

DROP TRIGGER IF EXISTS trigger_webhook_logs_updated_at ON webhook_logs;
CREATE TRIGGER trigger_webhook_logs_updated_at
    BEFORE UPDATE ON webhook_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_webhook_logs_timestamp();

-- ===============================================
-- BUSINESS LOGIC FUNCTIONS
-- ===============================================

-- Function to clean up old webhook logs (retention policy)
CREATE OR REPLACE FUNCTION cleanup_old_webhook_logs(retention_days INTEGER DEFAULT 30)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Delete webhook logs older than retention period
    DELETE FROM webhook_logs 
    WHERE created_at < NOW() - (retention_days || ' days')::INTERVAL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    -- Delete orphaned delivery attempts
    DELETE FROM webhook_delivery_attempts 
    WHERE webhook_log_id NOT IN (SELECT id FROM webhook_logs);
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get webhook statistics
CREATE OR REPLACE FUNCTION get_webhook_stats(
    p_merchant_id UUID DEFAULT NULL,
    p_hours_back INTEGER DEFAULT 24
) RETURNS TABLE(
    platform VARCHAR(20),
    total_events BIGINT,
    successful_events BIGINT,
    failed_events BIGINT,
    pending_events BIGINT,
    success_rate NUMERIC,
    avg_processing_time_ms NUMERIC,
    last_event_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        wl.platform,
        COUNT(*) as total_events,
        COUNT(CASE WHEN wl.status = 'SUCCESS' THEN 1 END) as successful_events,
        COUNT(CASE WHEN wl.status IN ('FAILED', 'ERROR') THEN 1 END) as failed_events,
        COUNT(CASE WHEN wl.status = 'PENDING' THEN 1 END) as pending_events,
        CASE 
            WHEN COUNT(*) > 0 THEN 
                ROUND(
                    (COUNT(CASE WHEN wl.status = 'SUCCESS' THEN 1 END)::NUMERIC / COUNT(*)::NUMERIC) * 100, 
                    2
                )
            ELSE 0 
        END as success_rate,
        AVG(wl.processing_time_ms) as avg_processing_time_ms,
        MAX(wl.processed_at) as last_event_at
    FROM webhook_logs wl
    WHERE 
        (p_merchant_id IS NULL OR wl.merchant_id = p_merchant_id)
        AND wl.processed_at >= NOW() - (p_hours_back || ' hours')::INTERVAL
    GROUP BY wl.platform
    ORDER BY total_events DESC;
END;
$$ LANGUAGE plpgsql;

-- ===============================================
-- ROW LEVEL SECURITY (RLS) - Tenant Isolation
-- ===============================================

-- Enable RLS on all webhook tables
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_delivery_attempts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for webhook_logs
DROP POLICY IF EXISTS webhook_logs_tenant_policy ON webhook_logs;
CREATE POLICY webhook_logs_tenant_policy ON webhook_logs
    FOR ALL USING (
        merchant_id = current_setting('app.current_merchant_id', true)::UUID
        OR current_setting('app.admin_mode', true) = 'true'
    );

-- RLS Policies for webhook_subscriptions
DROP POLICY IF EXISTS webhook_subscriptions_tenant_policy ON webhook_subscriptions;
CREATE POLICY webhook_subscriptions_tenant_policy ON webhook_subscriptions
    FOR ALL USING (
        merchant_id = current_setting('app.current_merchant_id', true)::UUID
        OR current_setting('app.admin_mode', true) = 'true'
    );

-- RLS Policies for webhook_delivery_attempts
DROP POLICY IF EXISTS webhook_delivery_attempts_tenant_policy ON webhook_delivery_attempts;
CREATE POLICY webhook_delivery_attempts_tenant_policy ON webhook_delivery_attempts
    FOR ALL USING (
        webhook_log_id IN (
            SELECT id FROM webhook_logs 
            WHERE merchant_id = current_setting('app.current_merchant_id', true)::UUID
        )
        OR current_setting('app.admin_mode', true) = 'true'
    );

-- ===============================================
-- MONITORING VIEWS
-- ===============================================

-- View for webhook statistics (from original migration)
CREATE OR REPLACE VIEW webhook_stats_view AS
SELECT 
    ws.merchant_id,
    ws.platform,
    ws.status as subscription_status,
    COUNT(wl.id) as total_events_24h,
    COUNT(CASE WHEN wl.status = 'SUCCESS' THEN 1 END) as successful_events_24h,
    COUNT(CASE WHEN wl.status IN ('FAILED', 'ERROR') THEN 1 END) as failed_events_24h,
    COUNT(CASE WHEN wl.status = 'RECEIVED' THEN 1 END) as received_events_24h,
    COUNT(CASE WHEN wl.status = 'PENDING' THEN 1 END) as pending_events_24h,
    CASE 
        WHEN COUNT(wl.id) > 0 THEN 
            ROUND(
                (COUNT(CASE WHEN wl.status IN ('SUCCESS', 'PROCESSED') THEN 1 END)::NUMERIC / COUNT(wl.id)::NUMERIC) * 100, 
                2
            )
        ELSE 0 
    END as success_rate_24h,
    MAX(wl.processed_at) as last_event_at,
    ws.last_verified_at,
    ws.webhook_url,
    ws.error_count,
    AVG(wl.processing_time_ms) as avg_processing_time_ms
FROM webhook_subscriptions ws
LEFT JOIN webhook_logs wl ON (
    ws.merchant_id = wl.merchant_id 
    AND ws.platform = wl.platform 
    AND wl.processed_at >= NOW() - INTERVAL '24 hours'
)
GROUP BY 
    ws.merchant_id, ws.platform, ws.status, 
    ws.last_verified_at, ws.webhook_url, ws.error_count;

-- View for webhook health monitoring
CREATE OR REPLACE VIEW webhook_health_view AS
SELECT 
    m.id as merchant_id,
    m.business_name,
    ws.platform,
    ws.status as subscription_status,
    CASE 
        WHEN ws.status = 'ACTIVE' AND ws.error_count = 0 THEN 'healthy'
        WHEN ws.status = 'ACTIVE' AND ws.error_count < 5 THEN 'degraded'
        WHEN ws.status = 'ACTIVE' AND ws.error_count >= 5 THEN 'critical'
        ELSE 'inactive'
    END as health_status,
    ws.last_event_received_at,
    ws.error_count,
    ws.consecutive_failures,
    CASE 
        WHEN ws.last_event_received_at IS NULL THEN 'never'
        WHEN ws.last_event_received_at < NOW() - INTERVAL '24 hours' THEN 'stale'
        WHEN ws.last_event_received_at < NOW() - INTERVAL '1 hour' THEN 'recent'
        ELSE 'active'
    END as activity_status
FROM merchants m
LEFT JOIN webhook_subscriptions ws ON m.id = ws.merchant_id
WHERE m.subscription_status = 'ACTIVE';

-- ===============================================
-- DOCUMENTATION AND COMMENTS
-- ===============================================

-- Table comments
COMMENT ON TABLE webhook_logs IS 'Core webhook event tracking for all platform integrations';
COMMENT ON TABLE webhook_subscriptions IS 'Active webhook subscriptions and their configuration';
COMMENT ON TABLE webhook_delivery_attempts IS 'Retry mechanism tracking for failed webhook deliveries';

-- Column comments
COMMENT ON COLUMN webhook_logs.event_id IS 'Unique event identifier for idempotency (SHA256 hash of raw payload)';
COMMENT ON COLUMN webhook_logs.entry_id IS 'Meta/Instagram webhook entry ID';
COMMENT ON COLUMN webhook_logs.message_id IS 'Platform-specific message identifier';
COMMENT ON COLUMN webhook_logs.customer_id IS 'Customer/sender ID from the platform';
COMMENT ON COLUMN webhook_subscriptions.subscription_fields IS 'Array of subscribed webhook fields (messages, messaging_postbacks, etc.)';

-- Function comments
COMMENT ON FUNCTION cleanup_old_webhook_logs(INTEGER) IS 'Cleanup function for webhook log retention policy';
COMMENT ON FUNCTION get_webhook_stats(UUID, INTEGER) IS 'Get comprehensive webhook statistics for monitoring';

-- View comments
COMMENT ON VIEW webhook_stats_view IS 'Comprehensive webhook statistics for dashboard display';
COMMENT ON VIEW webhook_health_view IS 'Webhook health monitoring for alerts and diagnostics';

-- ===============================================
-- MIGRATION COMPLETION
-- ===============================================

-- Analyze tables for query optimizer
ANALYZE webhook_logs;
ANALYZE webhook_subscriptions;
ANALYZE webhook_delivery_attempts;

-- Final validation
DO $$
DECLARE
    table_count INTEGER;
    index_count INTEGER;
    trigger_count INTEGER;
BEGIN
    -- Verify tables were created
    SELECT COUNT(*) INTO table_count
    FROM information_schema.tables 
    WHERE table_name IN ('webhook_logs', 'webhook_subscriptions', 'webhook_delivery_attempts');
    
    -- Verify indexes were created
    SELECT COUNT(*) INTO index_count
    FROM pg_indexes 
    WHERE tablename IN ('webhook_logs', 'webhook_subscriptions', 'webhook_delivery_attempts');
    
    -- Verify triggers were created
    SELECT COUNT(*) INTO trigger_count
    FROM information_schema.triggers 
    WHERE trigger_name IN ('trigger_webhook_subscriptions_updated_at', 'trigger_webhook_logs_updated_at');
    
    IF table_count < 3 THEN
        RAISE EXCEPTION 'Migration 004 failed: Expected 3 tables, found %', table_count;
    END IF;
    
    IF index_count < 10 THEN
        RAISE EXCEPTION 'Migration 004 failed: Insufficient indexes created, found %', index_count;
    END IF;
    
    IF trigger_count < 2 THEN
        RAISE EXCEPTION 'Migration 004 failed: Expected 2 triggers, found %', trigger_count;
    END IF;
    
    RAISE NOTICE 'Migration 004 completed successfully:';
    RAISE NOTICE '  - Tables created: %', table_count;
    RAISE NOTICE '  - Indexes created: %', index_count;
    RAISE NOTICE '  - Triggers created: %', trigger_count;
    RAISE NOTICE '  - RLS policies enabled: 3 tables';
    RAISE NOTICE '  - Views created: webhook_stats_view, webhook_health_view';
    RAISE NOTICE '  - Functions created: cleanup_old_webhook_logs, get_webhook_stats';
END $$;
