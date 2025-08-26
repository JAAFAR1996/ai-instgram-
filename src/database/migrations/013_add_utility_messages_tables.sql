-- ===============================================
-- Migration: Add Utility Messages Tables (2025 Feature)
-- Instagram Utility Messages: Order updates, notifications, reminders
-- ===============================================

-- Utility Message Templates Table
CREATE TABLE IF NOT EXISTS utility_message_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('ORDER_UPDATE', 'ACCOUNT_NOTIFICATION', 'APPOINTMENT_REMINDER', 'DELIVERY_NOTIFICATION', 'PAYMENT_UPDATE')),
    content TEXT NOT NULL,
    variables JSONB DEFAULT '[]'::jsonb,
    approved BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Indexes for performance
    CONSTRAINT utility_template_unique_name UNIQUE (merchant_id, name)
);

-- Create indexes for utility_message_templates
CREATE INDEX IF NOT EXISTS idx_utility_templates_merchant ON utility_message_templates(merchant_id);
CREATE INDEX IF NOT EXISTS idx_utility_templates_type ON utility_message_templates(type);
CREATE INDEX IF NOT EXISTS idx_utility_templates_approved ON utility_message_templates(approved);

-- Utility Message Logs Table (for compliance tracking)
CREATE TABLE IF NOT EXISTS utility_message_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    recipient_id VARCHAR(255) NOT NULL,
    template_id UUID NOT NULL REFERENCES utility_message_templates(id),
    message_id VARCHAR(255),
    message_type VARCHAR(50) NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for utility_message_logs
CREATE INDEX IF NOT EXISTS idx_utility_logs_merchant ON utility_message_logs(merchant_id);
CREATE INDEX IF NOT EXISTS idx_utility_logs_recipient ON utility_message_logs(recipient_id);
CREATE INDEX IF NOT EXISTS idx_utility_logs_template ON utility_message_logs(template_id);
CREATE INDEX IF NOT EXISTS idx_utility_logs_type ON utility_message_logs(message_type);
CREATE INDEX IF NOT EXISTS idx_utility_logs_sent_at ON utility_message_logs(sent_at);

-- Enhanced OAuth Security Table (2025 Enhancement)
CREATE TABLE IF NOT EXISTS oauth_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    state VARCHAR(255) NOT NULL,
    code_verifier VARCHAR(255),
    code_challenge VARCHAR(255),
    pkce_method VARCHAR(10) DEFAULT 'S256',
    redirect_uri TEXT NOT NULL,
    scopes TEXT[] DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '1 hour'),
    used BOOLEAN DEFAULT false,
    
    -- Security constraints
    CONSTRAINT oauth_state_unique UNIQUE (state),
    CONSTRAINT oauth_pkce_method_check CHECK (pkce_method IN ('S256', 'plain'))
);

-- Create indexes for oauth_sessions
CREATE INDEX IF NOT EXISTS idx_oauth_sessions_merchant ON oauth_sessions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_oauth_sessions_state ON oauth_sessions(state);
CREATE INDEX IF NOT EXISTS idx_oauth_sessions_expires ON oauth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_sessions_used ON oauth_sessions(used);

-- Update merchant_credentials table to support enhanced OAuth
ALTER TABLE merchant_credentials 
ADD COLUMN IF NOT EXISTS oauth_version VARCHAR(10) DEFAULT '2.0',
ADD COLUMN IF NOT EXISTS pkce_supported BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS last_security_audit TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS security_flags JSONB DEFAULT '{}'::jsonb;

-- Enhanced Instagram Integration Table
CREATE TABLE IF NOT EXISTS instagram_business_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    instagram_business_id VARCHAR(255) NOT NULL,
    instagram_username VARCHAR(255) NOT NULL,
    account_name VARCHAR(255),
    profile_picture_url TEXT,
    followers_count INTEGER DEFAULT 0,
    media_count INTEGER DEFAULT 0,
    access_token_encrypted TEXT NOT NULL,
    scopes TEXT[] DEFAULT ARRAY[]::TEXT[],
    token_expires_at TIMESTAMP WITH TIME ZONE,
    last_token_refresh TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    business_login_enabled BOOLEAN DEFAULT true, -- 2025 feature
    utility_messages_enabled BOOLEAN DEFAULT true, -- 2025 feature
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraints
    CONSTRAINT ig_business_unique UNIQUE (merchant_id),
    CONSTRAINT ig_business_id_unique UNIQUE (instagram_business_id)
);

-- Create indexes for instagram_business_accounts
CREATE INDEX IF NOT EXISTS idx_ig_business_merchant ON instagram_business_accounts(merchant_id);
CREATE INDEX IF NOT EXISTS idx_ig_business_username ON instagram_business_accounts(instagram_username);
CREATE INDEX IF NOT EXISTS idx_ig_business_token_expires ON instagram_business_accounts(token_expires_at);

-- Compliance Tracking Table (2025 Requirement)
CREATE TABLE IF NOT EXISTS compliance_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    compliance_type VARCHAR(50) NOT NULL CHECK (compliance_type IN ('WEBHOOK_VERIFICATION', 'OAUTH_SECURITY', 'DATA_ENCRYPTION', 'TOKEN_REFRESH', 'UTILITY_MESSAGE')),
    event_data JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'SUCCESS' CHECK (status IN ('SUCCESS', 'FAILED', 'WARNING')),
    meta_api_version VARCHAR(10) DEFAULT 'v23.0',
    security_level VARCHAR(20) DEFAULT 'STANDARD' CHECK (security_level IN ('BASIC', 'STANDARD', 'ENHANCED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for compliance_logs
CREATE INDEX IF NOT EXISTS idx_compliance_merchant ON compliance_logs(merchant_id);
CREATE INDEX IF NOT EXISTS idx_compliance_type ON compliance_logs(compliance_type);
CREATE INDEX IF NOT EXISTS idx_compliance_status ON compliance_logs(status);
CREATE INDEX IF NOT EXISTS idx_compliance_created ON compliance_logs(created_at);

-- Row Level Security (RLS) for all new tables
ALTER TABLE utility_message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE utility_message_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_business_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for utility_message_templates
DROP POLICY IF EXISTS utility_templates_merchant_access ON utility_message_templates;
CREATE POLICY utility_templates_merchant_access ON utility_message_templates
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id')::uuid);

-- RLS Policies for utility_message_logs
DROP POLICY IF EXISTS utility_logs_merchant_access ON utility_message_logs;
CREATE POLICY utility_logs_merchant_access ON utility_message_logs
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id')::uuid);

-- RLS Policies for oauth_sessions
DROP POLICY IF EXISTS oauth_sessions_merchant_access ON oauth_sessions;
CREATE POLICY oauth_sessions_merchant_access ON oauth_sessions
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id')::uuid);

-- RLS Policies for instagram_business_accounts
DROP POLICY IF EXISTS ig_business_merchant_access ON instagram_business_accounts;
CREATE POLICY ig_business_merchant_access ON instagram_business_accounts
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id')::uuid);

-- RLS Policies for compliance_logs
DROP POLICY IF EXISTS compliance_logs_merchant_access ON compliance_logs;
CREATE POLICY compliance_logs_merchant_access ON compliance_logs
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id')::uuid);

-- Admin policies (bypass RLS for admin users)
DROP POLICY IF EXISTS utility_templates_admin_access ON utility_message_templates;
CREATE POLICY utility_templates_admin_access ON utility_message_templates
    FOR ALL USING (current_setting('app.current_role', true) = 'admin');

DROP POLICY IF EXISTS utility_logs_admin_access ON utility_message_logs;
CREATE POLICY utility_logs_admin_access ON utility_message_logs
    FOR ALL USING (current_setting('app.current_role', true) = 'admin');

DROP POLICY IF EXISTS oauth_sessions_admin_access ON oauth_sessions;
CREATE POLICY oauth_sessions_admin_access ON oauth_sessions
    FOR ALL USING (current_setting('app.current_role', true) = 'admin');

DROP POLICY IF EXISTS ig_business_admin_access ON instagram_business_accounts;
CREATE POLICY ig_business_admin_access ON instagram_business_accounts
    FOR ALL USING (current_setting('app.current_role', true) = 'admin');

DROP POLICY IF EXISTS compliance_logs_admin_access ON compliance_logs;
CREATE POLICY compliance_logs_admin_access ON compliance_logs
    FOR ALL USING (current_setting('app.current_role', true) = 'admin');

-- Functions for automated maintenance
CREATE OR REPLACE FUNCTION cleanup_expired_oauth_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM oauth_sessions 
    WHERE expires_at < NOW() 
    OR (used = true AND created_at < NOW() - INTERVAL '24 hours');
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    INSERT INTO compliance_logs (
        merchant_id,
        compliance_type,
        event_data,
        status
    ) VALUES (
        '00000000-0000-0000-0000-000000000000'::uuid, -- System user
        'OAUTH_SECURITY',
        jsonb_build_object('deleted_sessions', deleted_count, 'cleanup_type', 'expired_oauth'),
        'SUCCESS'
    );
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply the trigger to relevant tables
DROP TRIGGER IF EXISTS update_utility_templates_updated_at ON utility_message_templates;
CREATE TRIGGER update_utility_templates_updated_at
    BEFORE UPDATE ON utility_message_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ig_business_updated_at ON instagram_business_accounts;
CREATE TRIGGER update_ig_business_updated_at
    BEFORE UPDATE ON instagram_business_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create a view for merchant dashboard (utility messages summary)
CREATE OR REPLACE VIEW merchant_utility_messages_summary AS
SELECT 
    m.id as merchant_id,
    m.business_name,
    COUNT(DISTINCT ut.id) as total_templates,
    COUNT(DISTINCT CASE WHEN ut.approved = true THEN ut.id END) as approved_templates,
    COUNT(DISTINCT ul.id) as total_sent,
    COUNT(DISTINCT CASE WHEN ul.sent_at >= NOW() - INTERVAL '30 days' THEN ul.id END) as sent_last_30_days,
    COUNT(DISTINCT CASE WHEN ul.sent_at >= NOW() - INTERVAL '7 days' THEN ul.id END) as sent_last_7_days,
    COUNT(DISTINCT CASE WHEN ul.sent_at >= CURRENT_DATE THEN ul.id END) as sent_today
FROM merchants m
LEFT JOIN utility_message_templates ut ON m.id = ut.merchant_id
LEFT JOIN utility_message_logs ul ON m.id = ul.merchant_id
GROUP BY m.id, m.business_name;

-- Grant appropriate permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON utility_message_templates TO authenticated;
GRANT SELECT, INSERT ON utility_message_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON oauth_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON instagram_business_accounts TO authenticated;
GRANT SELECT, INSERT ON compliance_logs TO authenticated;
GRANT SELECT ON merchant_utility_messages_summary TO authenticated;

-- Comments for documentation
COMMENT ON TABLE utility_message_templates IS 'Templates for Instagram utility messages (order updates, notifications, reminders) - 2025 Meta feature';
COMMENT ON TABLE utility_message_logs IS 'Compliance tracking for sent utility messages';
COMMENT ON TABLE oauth_sessions IS 'Enhanced OAuth sessions with PKCE support for 2025 security standards';
COMMENT ON TABLE instagram_business_accounts IS 'Instagram Business account details with 2025 Business Login features';
COMMENT ON TABLE compliance_logs IS 'Compliance tracking for Meta 2025 requirements';

-- Migration complete notification
DO $$
BEGIN
    RAISE NOTICE '✅ Migration 013: Utility Messages & Enhanced OAuth Security (2025) completed successfully';
    RAISE NOTICE '📊 Added tables: utility_message_templates, utility_message_logs, oauth_sessions, instagram_business_accounts, compliance_logs';
    RAISE NOTICE '🔒 Applied Row Level Security policies to all new tables';
    RAISE NOTICE '⚡ Created indexes for optimal performance';
    RAISE NOTICE '🎯 Ready for Instagram Utility Messages and enhanced OAuth 2025 features';
END $$;