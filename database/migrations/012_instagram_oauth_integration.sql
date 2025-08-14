/**
 * ===============================================
 * Instagram OAuth Integration Tables
 * Tables for managing OAuth credentials with proper scopes
 * ===============================================
 */

-- Create merchant integrations table for OAuth data
CREATE TABLE IF NOT EXISTS merchant_integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('INSTAGRAM', 'WHATSAPP', 'FACEBOOK')),
    
    -- OAuth and API credentials (encrypted)
    credentials JSONB NOT NULL DEFAULT '{}',
    
    -- Business account info
    business_account_id VARCHAR(100),
    business_account_name VARCHAR(100),
    business_account_data JSONB DEFAULT '{}',
    
    -- OAuth scopes and permissions
    scopes JSONB DEFAULT '[]',
    permissions_verified BOOLEAN DEFAULT FALSE,
    last_permission_check TIMESTAMPTZ,
    
    -- Token management
    token_expires_at TIMESTAMPTZ,
    refresh_token_encrypted TEXT,
    
    -- Status and health
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED', 'ERROR')),
    last_api_call TIMESTAMPTZ,
    api_call_count INTEGER DEFAULT 0,
    last_error TEXT,
    error_count INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(merchant_id, platform)
);

-- OAuth state tracking table (for security)
CREATE TABLE IF NOT EXISTS oauth_states (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    state_token VARCHAR(255) UNIQUE NOT NULL,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    platform VARCHAR(20) NOT NULL,
    redirect_uri TEXT,
    
    -- Security
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
    used BOOLEAN DEFAULT FALSE,
    user_agent TEXT,
    ip_address INET,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Instagram webhook events log
CREATE TABLE IF NOT EXISTS instagram_webhook_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    
    -- Webhook data
    event_type VARCHAR(50) NOT NULL, -- 'messages', 'messaging_postbacks', etc.
    instagram_user_id VARCHAR(100),
    business_account_id VARCHAR(100),
    
    -- Message details
    message_id VARCHAR(100),
    message_type VARCHAR(50), -- 'text', 'image', 'story_reply', etc.
    message_data JSONB NOT NULL DEFAULT '{}',
    
    -- Processing
    processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMPTZ,
    processing_error TEXT,
    response_sent BOOLEAN DEFAULT FALSE,
    response_data JSONB,
    
    -- Metadata
    webhook_signature VARCHAR(255),
    raw_payload JSONB,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- API usage tracking
CREATE TABLE IF NOT EXISTS instagram_api_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    
    -- API call details
    endpoint VARCHAR(200) NOT NULL,
    method VARCHAR(10) NOT NULL,
    status_code INTEGER,
    response_time_ms INTEGER,
    
    -- Rate limiting
    rate_limit_remaining INTEGER,
    rate_limit_reset TIMESTAMPTZ,
    
    -- Request/response data
    request_data JSONB,
    response_data JSONB,
    error_message TEXT,
    
    -- Timestamps
    called_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_merchant_integrations_merchant_platform 
ON merchant_integrations(merchant_id, platform);

CREATE INDEX IF NOT EXISTS idx_merchant_integrations_status 
ON merchant_integrations(status) WHERE status != 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_merchant_integrations_token_expiry 
ON merchant_integrations(token_expires_at) WHERE token_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_oauth_states_token 
ON oauth_states(state_token);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry 
ON oauth_states(expires_at) WHERE NOT used;

CREATE INDEX IF NOT EXISTS idx_instagram_webhooks_merchant_processed 
ON instagram_webhook_events(merchant_id, processed, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_instagram_webhooks_business_account 
ON instagram_webhook_events(business_account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_instagram_api_usage_merchant_time 
ON instagram_api_usage(merchant_id, called_at DESC);

-- Row Level Security
ALTER TABLE merchant_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_api_usage ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY merchant_integrations_isolation ON merchant_integrations
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id', true)::UUID);

CREATE POLICY oauth_states_isolation ON oauth_states
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id', true)::UUID);

CREATE POLICY instagram_webhook_events_isolation ON instagram_webhook_events
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id', true)::UUID);

CREATE POLICY instagram_api_usage_isolation ON instagram_api_usage
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id', true)::UUID);

-- Updated trigger for merchant_integrations
CREATE OR REPLACE FUNCTION update_merchant_integrations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER merchant_integrations_updated_at
    BEFORE UPDATE ON merchant_integrations
    FOR EACH ROW
    EXECUTE FUNCTION update_merchant_integrations_updated_at();

-- Cleanup function for expired OAuth states
CREATE OR REPLACE FUNCTION cleanup_expired_oauth_states()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM oauth_states 
    WHERE expires_at < NOW() - INTERVAL '1 hour';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ language 'plpgsql';

-- Function to check token expiry
CREATE OR REPLACE FUNCTION check_token_expiry()
RETURNS TABLE(
    merchant_id UUID,
    platform VARCHAR(20),
    business_account_name VARCHAR(100),
    expires_at TIMESTAMPTZ,
    days_until_expiry INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        mi.merchant_id,
        mi.platform,
        mi.business_account_name,
        mi.token_expires_at,
        EXTRACT(DAY FROM (mi.token_expires_at - NOW()))::INTEGER
    FROM merchant_integrations mi
    WHERE mi.token_expires_at IS NOT NULL
    AND mi.token_expires_at <= NOW() + INTERVAL '7 days'
    AND mi.status = 'ACTIVE'
    ORDER BY mi.token_expires_at ASC;
END;
$$ language 'plpgsql';

-- View for Instagram integration status
CREATE OR REPLACE VIEW instagram_integration_status AS
SELECT 
    m.id as merchant_id,
    m.business_name,
    mi.business_account_id,
    mi.business_account_name,
    mi.status as integration_status,
    mi.scopes,
    mi.permissions_verified,
    mi.token_expires_at,
    mi.last_api_call,
    mi.api_call_count,
    mi.error_count,
    CASE 
        WHEN mi.token_expires_at IS NULL THEN 'no_expiry'
        WHEN mi.token_expires_at <= NOW() THEN 'expired'
        WHEN mi.token_expires_at <= NOW() + INTERVAL '7 days' THEN 'expiring_soon'
        ELSE 'valid'
    END as token_status,
    CASE
        WHEN mi.scopes::jsonb ? 'instagram_business_manage_messages' THEN true
        ELSE false
    END as has_message_access,
    mi.created_at as connected_at,
    mi.updated_at as last_updated
FROM merchants m
LEFT JOIN merchant_integrations mi ON (
    m.id = mi.merchant_id 
    AND mi.platform = 'INSTAGRAM'
);

-- Comments
COMMENT ON TABLE merchant_integrations IS 'OAuth integrations for social media platforms';
COMMENT ON TABLE oauth_states IS 'OAuth state tokens for security (CSRF protection)';
COMMENT ON TABLE instagram_webhook_events IS 'Log of Instagram webhook events received';
COMMENT ON TABLE instagram_api_usage IS 'Instagram API usage tracking for rate limiting';
COMMENT ON VIEW instagram_integration_status IS 'Current status of Instagram integrations';

-- Grant permissions (adjust as needed)
-- GRANT ALL ON merchant_integrations TO ai_sales_app;
-- GRANT ALL ON oauth_states TO ai_sales_app;
-- GRANT ALL ON instagram_webhook_events TO ai_sales_app;
-- GRANT ALL ON instagram_api_usage TO ai_sales_app;