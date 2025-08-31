-- ===============================================
-- Migration 053: ManyChat Integration
-- AI Sales Platform - ManyChat integration support
-- ===============================================

-- Prerequisites validation
DO $$
BEGIN
    -- Ensure merchants table exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'merchants') THEN
        RAISE EXCEPTION 'Migration 053 failed: merchants table missing. Run migration 001 first.';
    END IF;
    
    -- Ensure uuid-ossp extension is available
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'uuid-ossp') THEN
        RAISE EXCEPTION 'Migration 053 failed: uuid-ossp extension missing. Create extension first.';
    END IF;
    
    RAISE NOTICE 'Migration 053: Prerequisites validated successfully';
END $$;

-- ===============================================
-- 1. ADD MANYCHAT CONFIG TO MERCHANTS TABLE
-- ===============================================

-- Add ManyChat configuration column to merchants table
ALTER TABLE merchants 
ADD COLUMN IF NOT EXISTS manychat_config JSONB DEFAULT '{}';

-- Add comment for documentation
COMMENT ON COLUMN merchants.manychat_config IS 'ManyChat configuration for the merchant including API keys, flow IDs, and settings';

-- ===============================================
-- 2. MANYCHAT_LOGS TABLE - Interaction tracking
-- ===============================================

CREATE TABLE IF NOT EXISTS manychat_logs (
    -- Primary identification
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    
    -- Subscriber identification
    subscriber_id VARCHAR(255) NOT NULL,
    message_id VARCHAR(255),
    
    -- Action and status tracking
    action VARCHAR(50) NOT NULL CHECK (action IN (
        'send_message', 'create_subscriber', 'update_subscriber', 
        'add_tag', 'remove_tag', 'get_info', 'local_ai_response', 
        'fallback_response', 'webhook_received'
    )),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'success', 'failed', 'retrying'
    )),
    
    -- Response data and metadata
    response_data JSONB DEFAULT '{}',
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    
    -- Processing metrics
    processing_time_ms INTEGER,
    platform VARCHAR(20) DEFAULT 'manychat' CHECK (platform IN (
        'manychat', 'local_ai', 'fallback', 'instagram'
    )),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add comments for documentation
COMMENT ON TABLE manychat_logs IS 'Tracks all ManyChat API interactions and responses';
COMMENT ON COLUMN manychat_logs.subscriber_id IS 'ManyChat subscriber ID or Instagram customer ID';
COMMENT ON COLUMN manychat_logs.action IS 'Type of action performed with ManyChat';
COMMENT ON COLUMN manychat_logs.response_data IS 'Full response data from ManyChat API';
COMMENT ON COLUMN manychat_logs.platform IS 'Platform used for processing (manychat, local_ai, fallback)';

-- ===============================================
-- 3. MANYCHAT_SUBSCRIBERS TABLE - Subscriber management
-- ===============================================

CREATE TABLE IF NOT EXISTS manychat_subscribers (
    -- Primary identification
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    
    -- ManyChat subscriber identification
    manychat_subscriber_id VARCHAR(255) NOT NULL,
    instagram_customer_id VARCHAR(255),
    whatsapp_customer_id VARCHAR(255),
    
    -- Subscriber information
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(20),
    email VARCHAR(255),
    language VARCHAR(10) DEFAULT 'ar',
    timezone VARCHAR(50) DEFAULT 'Asia/Baghdad',
    
    -- Tags and custom fields
    tags TEXT[] DEFAULT '{}',
    custom_fields JSONB DEFAULT '{}',
    
    -- Status and engagement
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN (
        'active', 'inactive', 'blocked', 'unsubscribed'
    )),
    engagement_score INTEGER DEFAULT 0,
    last_interaction_at TIMESTAMPTZ,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add comments for documentation
COMMENT ON TABLE manychat_subscribers IS 'ManyChat subscribers linked to merchants';
COMMENT ON COLUMN manychat_subscribers.manychat_subscriber_id IS 'ManyChat internal subscriber ID';
COMMENT ON COLUMN manychat_subscribers.instagram_customer_id IS 'Instagram customer ID for cross-platform linking';
COMMENT ON COLUMN manychat_subscribers.whatsapp_customer_id IS 'WhatsApp customer ID for cross-platform linking';
COMMENT ON COLUMN manychat_subscribers.engagement_score IS 'Calculated engagement score (0-100)';

-- ===============================================
-- 4. MANYCHAT_FLOWS TABLE - Flow management
-- ===============================================

CREATE TABLE IF NOT EXISTS manychat_flows (
    -- Primary identification
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    
    -- Flow identification
    flow_name VARCHAR(255) NOT NULL,
    flow_id VARCHAR(255) NOT NULL,
    flow_type VARCHAR(50) NOT NULL CHECK (flow_type IN (
        'welcome', 'ai_response', 'comment_response', 'story_response',
        'purchase_intent', 'price_inquiry', 'customer_support', 'custom'
    )),
    
    -- Flow configuration
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0,
    trigger_conditions JSONB DEFAULT '{}',
    
    -- Flow content and settings
    default_message TEXT,
    ai_prompt TEXT,
    tags_to_add TEXT[] DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add comments for documentation
COMMENT ON TABLE manychat_flows IS 'ManyChat flows configuration for merchants';
COMMENT ON COLUMN manychat_flows.flow_id IS 'ManyChat internal flow ID';
COMMENT ON COLUMN manychat_flows.trigger_conditions IS 'JSON conditions for when to trigger this flow';

-- ===============================================
-- 5. MANYCHAT_WEBHOOKS TABLE - Webhook management
-- ===============================================

CREATE TABLE IF NOT EXISTS manychat_webhooks (
    -- Primary identification
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    
    -- Webhook configuration
    webhook_url TEXT NOT NULL,
    webhook_secret VARCHAR(255),
    webhook_type VARCHAR(50) NOT NULL CHECK (webhook_type IN (
        'subscriber_created', 'message_received', 'flow_completed',
        'tag_added', 'tag_removed', 'custom'
    )),
    
    -- Status and health
    is_active BOOLEAN DEFAULT true,
    last_triggered_at TIMESTAMPTZ,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    last_error TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add comments for documentation
COMMENT ON TABLE manychat_webhooks IS 'ManyChat webhook configurations for merchants';
COMMENT ON COLUMN manychat_webhooks.webhook_secret IS 'Secret for webhook signature verification';

-- ===============================================
-- 6. INDEXES FOR PERFORMANCE
-- ===============================================

-- ManyChat logs indexes
CREATE INDEX IF NOT EXISTS idx_manychat_logs_merchant_id ON manychat_logs(merchant_id);
CREATE INDEX IF NOT EXISTS idx_manychat_logs_subscriber_id ON manychat_logs(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_manychat_logs_created_at ON manychat_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_manychat_logs_action_status ON manychat_logs(action, status);
CREATE INDEX IF NOT EXISTS idx_manychat_logs_platform ON manychat_logs(platform);

-- ManyChat subscribers indexes
CREATE INDEX IF NOT EXISTS idx_manychat_subscribers_merchant_id ON manychat_subscribers(merchant_id);
CREATE INDEX IF NOT EXISTS idx_manychat_subscribers_manychat_id ON manychat_subscribers(manychat_subscriber_id);
CREATE INDEX IF NOT EXISTS idx_manychat_subscribers_instagram_id ON manychat_subscribers(instagram_customer_id);
CREATE INDEX IF NOT EXISTS idx_manychat_subscribers_whatsapp_id ON manychat_subscribers(whatsapp_customer_id);
CREATE INDEX IF NOT EXISTS idx_manychat_subscribers_status ON manychat_subscribers(status);
CREATE INDEX IF NOT EXISTS idx_manychat_subscribers_last_interaction ON manychat_subscribers(last_interaction_at);

-- ManyChat flows indexes
CREATE INDEX IF NOT EXISTS idx_manychat_flows_merchant_id ON manychat_flows(merchant_id);
CREATE INDEX IF NOT EXISTS idx_manychat_flows_flow_id ON manychat_flows(flow_id);
CREATE INDEX IF NOT EXISTS idx_manychat_flows_type_active ON manychat_flows(flow_type, is_active);
CREATE INDEX IF NOT EXISTS idx_manychat_flows_priority ON manychat_flows(priority);

-- ManyChat webhooks indexes
CREATE INDEX IF NOT EXISTS idx_manychat_webhooks_merchant_id ON manychat_webhooks(merchant_id);
CREATE INDEX IF NOT EXISTS idx_manychat_webhooks_type_active ON manychat_webhooks(webhook_type, is_active);

-- ===============================================
-- 7. UNIQUE CONSTRAINTS
-- ===============================================

-- Ensure unique ManyChat subscriber IDs per merchant
ALTER TABLE manychat_subscribers 
ADD CONSTRAINT uk_manychat_subscribers_merchant_manychat_id 
UNIQUE (merchant_id, manychat_subscriber_id);

-- Ensure unique flow IDs per merchant
ALTER TABLE manychat_flows 
ADD CONSTRAINT uk_manychat_flows_merchant_flow_id 
UNIQUE (merchant_id, flow_id);

-- Ensure unique webhook URLs per merchant
ALTER TABLE manychat_webhooks 
ADD CONSTRAINT uk_manychat_webhooks_merchant_url 
UNIQUE (merchant_id, webhook_url);

-- ===============================================
-- 8. ROW LEVEL SECURITY (RLS) POLICIES
-- ===============================================

-- Enable RLS on all tables
ALTER TABLE manychat_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE manychat_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE manychat_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE manychat_webhooks ENABLE ROW LEVEL SECURITY;

-- ManyChat logs RLS policies
CREATE POLICY manychat_logs_merchant_isolation ON manychat_logs
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id')::UUID);

-- ManyChat subscribers RLS policies
CREATE POLICY manychat_subscribers_merchant_isolation ON manychat_subscribers
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id')::UUID);

-- ManyChat flows RLS policies
CREATE POLICY manychat_flows_merchant_isolation ON manychat_flows
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id')::UUID);

-- ManyChat webhooks RLS policies
CREATE POLICY manychat_webhooks_merchant_isolation ON manychat_webhooks
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id')::UUID);

-- ===============================================
-- 9. TRIGGERS FOR UPDATED_AT
-- ===============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_manychat_logs_updated_at 
    BEFORE UPDATE ON manychat_logs 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_manychat_subscribers_updated_at 
    BEFORE UPDATE ON manychat_subscribers 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_manychat_flows_updated_at 
    BEFORE UPDATE ON manychat_flows 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_manychat_webhooks_updated_at 
    BEFORE UPDATE ON manychat_webhooks 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===============================================
-- 10. HELPER FUNCTIONS
-- ===============================================

-- Function to get ManyChat subscriber by Instagram ID
CREATE OR REPLACE FUNCTION get_manychat_subscriber_by_instagram(
    p_merchant_id UUID,
    p_instagram_customer_id VARCHAR(255)
)
RETURNS TABLE (
    id UUID,
    manychat_subscriber_id VARCHAR(255),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(20),
    email VARCHAR(255),
    language VARCHAR(10),
    timezone VARCHAR(50),
    tags TEXT[],
    custom_fields JSONB,
    status VARCHAR(20),
    engagement_score INTEGER,
    last_interaction_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ms.id,
        ms.manychat_subscriber_id,
        ms.first_name,
        ms.last_name,
        ms.phone,
        ms.email,
        ms.language,
        ms.timezone,
        ms.tags,
        ms.custom_fields,
        ms.status,
        ms.engagement_score,
        ms.last_interaction_at
    FROM manychat_subscribers ms
    WHERE ms.merchant_id = p_merchant_id
      AND ms.instagram_customer_id = p_instagram_customer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get active ManyChat flows for merchant
CREATE OR REPLACE FUNCTION get_active_manychat_flows(
    p_merchant_id UUID,
    p_flow_type VARCHAR(50) DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    flow_name VARCHAR(255),
    flow_id VARCHAR(255),
    flow_type VARCHAR(50),
    priority INTEGER,
    default_message TEXT,
    ai_prompt TEXT,
    tags_to_add TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        mf.id,
        mf.flow_name,
        mf.flow_id,
        mf.flow_type,
        mf.priority,
        mf.default_message,
        mf.ai_prompt,
        mf.tags_to_add
    FROM manychat_flows mf
    WHERE mf.merchant_id = p_merchant_id
      AND mf.is_active = true
      AND (p_flow_type IS NULL OR mf.flow_type = p_flow_type)
    ORDER BY mf.priority DESC, mf.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log ManyChat interaction
CREATE OR REPLACE FUNCTION log_manychat_interaction(
    p_merchant_id UUID,
    p_subscriber_id VARCHAR(255),
    p_action VARCHAR(50),
    p_status VARCHAR(20),
    p_response_data JSONB DEFAULT '{}',
    p_error_message TEXT DEFAULT NULL,
    p_platform VARCHAR(20) DEFAULT 'manychat'
)
RETURNS UUID AS $$
DECLARE
    v_log_id UUID;
BEGIN
    INSERT INTO manychat_logs (
        merchant_id,
        subscriber_id,
        action,
        status,
        response_data,
        error_message,
        platform,
        created_at
    ) VALUES (
        p_merchant_id,
        p_subscriber_id,
        p_action,
        p_status,
        p_response_data,
        p_error_message,
        p_platform,
        NOW()
    ) RETURNING id INTO v_log_id;
    
    RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===============================================
-- 11. MIGRATION COMPLETION
-- ===============================================

-- Log migration completion
INSERT INTO migration_logs (
    migration_name,
    migration_version,
    applied_at,
    status,
    details
) VALUES (
    '053_manychat_integration',
    '053',
    NOW(),
    'completed',
    'ManyChat integration tables and functions created successfully'
);

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Migration 053 completed successfully: ManyChat integration support added';
    RAISE NOTICE 'Created tables: manychat_logs, manychat_subscribers, manychat_flows, manychat_webhooks';
    RAISE NOTICE 'Added indexes and RLS policies for security and performance';
    RAISE NOTICE 'Created helper functions for ManyChat operations';
END $$;
