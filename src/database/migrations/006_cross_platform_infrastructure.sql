-- Cross-Platform Conversation Management Infrastructure
-- Tables and functions for unified customer experience across WhatsApp and Instagram

-- Create platform_switches table to track customer platform changes
CREATE TABLE IF NOT EXISTS platform_switches (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
    from_platform VARCHAR(20) NOT NULL CHECK (from_platform IN ('WHATSAPP', 'INSTAGRAM')),
    to_platform VARCHAR(20) NOT NULL CHECK (to_platform IN ('WHATSAPP', 'INSTAGRAM')),
    from_identifier VARCHAR(255) NOT NULL, -- phone number or instagram username
    to_identifier VARCHAR(255) NOT NULL,
    from_conversation_id UUID REFERENCES conversations(id),
    to_conversation_id UUID REFERENCES conversations(id),
    reason VARCHAR(50) NOT NULL CHECK (reason IN ('customer_initiated', 'merchant_redirect', 'auto_follow')),
    context_preserved BOOLEAN DEFAULT false,
    continuity_score DECIMAL(3,2) CHECK (continuity_score >= 0 AND continuity_score <= 1),
    switch_timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for platform_switches
CREATE INDEX IF NOT EXISTS idx_platform_switches_merchant ON platform_switches (merchant_id);
CREATE INDEX IF NOT EXISTS idx_platform_switches_timestamp ON platform_switches (switch_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_platform_switches_identifiers ON platform_switches (from_identifier, to_identifier);
CREATE INDEX IF NOT EXISTS idx_platform_switches_conversations ON platform_switches (from_conversation_id, to_conversation_id);

-- Create unified_customer_profiles table for cross-platform customer data
CREATE TABLE IF NOT EXISTS unified_customer_profiles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
    master_customer_id VARCHAR(255) NOT NULL, -- Primary identifier across platforms
    whatsapp_number VARCHAR(20),
    instagram_username VARCHAR(100),
    customer_name VARCHAR(255),
    preferred_platform VARCHAR(20) CHECK (preferred_platform IN ('WHATSAPP', 'INSTAGRAM')),
    total_interactions INTEGER DEFAULT 0,
    unified_context JSONB DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    last_activity TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Unique constraint to prevent duplicate profiles
    UNIQUE(merchant_id, master_customer_id),
    
    -- Ensure at least one platform identifier exists
    CHECK (whatsapp_number IS NOT NULL OR instagram_username IS NOT NULL)
);

-- Create indexes for unified_customer_profiles
CREATE INDEX IF NOT EXISTS idx_unified_profiles_merchant ON unified_customer_profiles (merchant_id);
CREATE INDEX IF NOT EXISTS idx_unified_profiles_whatsapp ON unified_customer_profiles (whatsapp_number);
CREATE INDEX IF NOT EXISTS idx_unified_profiles_instagram ON unified_customer_profiles (instagram_username);
CREATE INDEX IF NOT EXISTS idx_unified_profiles_last_activity ON unified_customer_profiles (last_activity DESC);
CREATE INDEX IF NOT EXISTS idx_unified_profiles_tags ON unified_customer_profiles USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_unified_profiles_context ON unified_customer_profiles USING GIN (unified_context);

-- Create customer_journey_events table for tracking cross-platform journey
CREATE TABLE IF NOT EXISTS customer_journey_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
    customer_profile_id UUID REFERENCES unified_customer_profiles(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('WHATSAPP', 'INSTAGRAM')),
    event_type VARCHAR(50) NOT NULL, -- 'message_sent', 'platform_switch', 'conversion', etc.
    event_stage VARCHAR(50), -- conversation stage at time of event
    event_data JSONB DEFAULT '{}',
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for customer_journey_events
CREATE INDEX IF NOT EXISTS idx_journey_events_merchant ON customer_journey_events (merchant_id);
CREATE INDEX IF NOT EXISTS idx_journey_events_customer ON customer_journey_events (customer_profile_id);
CREATE INDEX IF NOT EXISTS idx_journey_events_platform ON customer_journey_events (platform);
CREATE INDEX IF NOT EXISTS idx_journey_events_timestamp ON customer_journey_events (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_journey_events_type ON customer_journey_events (event_type);

-- Create conversation_merges table to track conversation consolidation
CREATE TABLE IF NOT EXISTS conversation_merges (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
    primary_conversation_id UUID REFERENCES conversations(id),
    merged_conversation_ids UUID[] NOT NULL,
    merge_strategy VARCHAR(50) DEFAULT 'most_complete',
    context_fields_merged TEXT[] DEFAULT '{}',
    conflicts_resolved INTEGER DEFAULT 0,
    data_loss TEXT[] DEFAULT '{}',
    merge_timestamp TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for conversation_merges
CREATE INDEX IF NOT EXISTS idx_conversation_merges_merchant ON conversation_merges (merchant_id);
CREATE INDEX IF NOT EXISTS idx_conversation_merges_primary ON conversation_merges (primary_conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_merges_timestamp ON conversation_merges (merge_timestamp DESC);

-- Create function to get unified customer profile
CREATE OR REPLACE FUNCTION get_unified_customer_profile(
    p_merchant_id UUID,
    p_whatsapp_number VARCHAR(20) DEFAULT NULL,
    p_instagram_username VARCHAR(100) DEFAULT NULL
)
RETURNS TABLE(
    profile_id UUID,
    master_customer_id VARCHAR(255),
    whatsapp_number VARCHAR(20),
    instagram_username VARCHAR(100),
    customer_name VARCHAR(255),
    preferred_platform VARCHAR(20),
    total_interactions INTEGER,
    unified_context JSONB,
    tags TEXT[],
    last_activity TIMESTAMPTZ,
    platform_stats JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ucp.id as profile_id,
        ucp.master_customer_id,
        ucp.whatsapp_number,
        ucp.instagram_username,
        ucp.customer_name,
        ucp.preferred_platform,
        ucp.total_interactions,
        ucp.unified_context,
        ucp.tags,
        ucp.last_activity,
        (
            SELECT jsonb_object_agg(
                c.platform,
                jsonb_build_object(
                    'conversation_count', COUNT(DISTINCT c.id),
                    'message_count', COUNT(ml.id),
                    'last_message', MAX(ml.created_at),
                    'avg_response_time', 0
                )
            )
            FROM conversations c
            LEFT JOIN message_logs ml ON c.id = ml.conversation_id
            WHERE c.merchant_id = p_merchant_id
            AND (
                (p_whatsapp_number IS NOT NULL AND c.customer_phone = p_whatsapp_number) OR
                (p_instagram_username IS NOT NULL AND c.customer_instagram = p_instagram_username)
            )
            GROUP BY c.platform
        ) as platform_stats
    FROM unified_customer_profiles ucp
    WHERE ucp.merchant_id = p_merchant_id
    AND (
        (p_whatsapp_number IS NOT NULL AND ucp.whatsapp_number = p_whatsapp_number) OR
        (p_instagram_username IS NOT NULL AND ucp.instagram_username = p_instagram_username)
    )
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Create function to create or update unified customer profile
CREATE OR REPLACE FUNCTION upsert_unified_customer_profile(
    p_merchant_id UUID,
    p_whatsapp_number VARCHAR(20) DEFAULT NULL,
    p_instagram_username VARCHAR(100) DEFAULT NULL,
    p_customer_name VARCHAR(255) DEFAULT NULL,
    p_preferred_platform VARCHAR(20) DEFAULT NULL,
    p_unified_context JSONB DEFAULT '{}',
    p_tags TEXT[] DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
    profile_id UUID;
    master_id VARCHAR(255);
BEGIN
    -- Generate master customer ID
    master_id := COALESCE(p_whatsapp_number, p_instagram_username, gen_random_uuid()::text);
    
    -- Try to insert new profile
    INSERT INTO unified_customer_profiles (
        merchant_id,
        master_customer_id,
        whatsapp_number,
        instagram_username,
        customer_name,
        preferred_platform,
        unified_context,
        tags,
        total_interactions
    ) VALUES (
        p_merchant_id,
        master_id,
        p_whatsapp_number,
        p_instagram_username,
        p_customer_name,
        p_preferred_platform,
        p_unified_context,
        p_tags,
        1
    )
    ON CONFLICT (merchant_id, master_customer_id) 
    DO UPDATE SET
        whatsapp_number = COALESCE(EXCLUDED.whatsapp_number, unified_customer_profiles.whatsapp_number),
        instagram_username = COALESCE(EXCLUDED.instagram_username, unified_customer_profiles.instagram_username),
        customer_name = COALESCE(EXCLUDED.customer_name, unified_customer_profiles.customer_name),
        preferred_platform = COALESCE(EXCLUDED.preferred_platform, unified_customer_profiles.preferred_platform),
        unified_context = unified_customer_profiles.unified_context || EXCLUDED.unified_context,
        tags = array(SELECT DISTINCT unnest(unified_customer_profiles.tags || EXCLUDED.tags)),
        total_interactions = unified_customer_profiles.total_interactions + 1,
        last_activity = NOW(),
        updated_at = NOW()
    RETURNING id INTO profile_id;
    
    RETURN profile_id;
END;
$$ LANGUAGE plpgsql;

-- Create function to track customer journey event
CREATE OR REPLACE FUNCTION track_customer_journey_event(
    p_merchant_id UUID,
    p_customer_profile_id UUID,
    p_conversation_id UUID,
    p_platform VARCHAR(20),
    p_event_type VARCHAR(50),
    p_event_stage VARCHAR(50) DEFAULT NULL,
    p_event_data JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
    event_id UUID;
BEGIN
    INSERT INTO customer_journey_events (
        merchant_id,
        customer_profile_id,
        conversation_id,
        platform,
        event_type,
        event_stage,
        event_data,
        timestamp
    ) VALUES (
        p_merchant_id,
        p_customer_profile_id,
        p_conversation_id,
        p_platform,
        p_event_type,
        p_event_stage,
        p_event_data,
        NOW()
    ) RETURNING id INTO event_id;
    
    RETURN event_id;
END;
$$ LANGUAGE plpgsql;

-- Create function to analyze platform switch patterns
CREATE OR REPLACE FUNCTION analyze_platform_switch_patterns(
    p_merchant_id UUID,
    p_days_back INTEGER DEFAULT 30
)
RETURNS TABLE(
    switch_pattern VARCHAR(50),
    count BIGINT,
    avg_continuity_score DECIMAL(5,2),
    most_common_reason VARCHAR(50)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        CONCAT(ps.from_platform, '_TO_', ps.to_platform) as switch_pattern,
        COUNT(*) as count,
        ROUND(AVG(ps.continuity_score), 2) as avg_continuity_score,
        MODE() WITHIN GROUP (ORDER BY ps.reason) as most_common_reason
    FROM platform_switches ps
    WHERE ps.merchant_id = p_merchant_id
    AND ps.switch_timestamp >= NOW() - INTERVAL '1 day' * p_days_back
    GROUP BY ps.from_platform, ps.to_platform
    ORDER BY count DESC;
END;
$$ LANGUAGE plpgsql;

-- Create view for cross-platform customer analytics
CREATE OR REPLACE VIEW cross_platform_customer_analytics AS
SELECT 
    m.id as merchant_id,
    m.business_name,
    ucp.preferred_platform,
    COUNT(*) as total_customers,
    COUNT(CASE WHEN ucp.whatsapp_number IS NOT NULL AND ucp.instagram_username IS NOT NULL THEN 1 END) as multi_platform_customers,
    COUNT(CASE WHEN 'multi-platform' = ANY(ucp.tags) THEN 1 END) as tagged_multi_platform,
    COUNT(CASE WHEN 'high-engagement' = ANY(ucp.tags) THEN 1 END) as high_engagement_customers,
    AVG(ucp.total_interactions) as avg_interactions_per_customer,
    COUNT(CASE WHEN ucp.last_activity >= NOW() - INTERVAL '7 days' THEN 1 END) as active_last_7_days,
    COUNT(CASE WHEN ucp.last_activity >= NOW() - INTERVAL '30 days' THEN 1 END) as active_last_30_days
FROM merchants m
JOIN unified_customer_profiles ucp ON m.id = ucp.merchant_id
GROUP BY m.id, m.business_name, ucp.preferred_platform;

-- Create view for platform switch analytics
CREATE OR REPLACE VIEW platform_switch_analytics AS
SELECT 
    ps.merchant_id,
    DATE_TRUNC('day', ps.switch_timestamp) as switch_date,
    ps.from_platform,
    ps.to_platform,
    ps.reason,
    COUNT(*) as switch_count,
    AVG(ps.continuity_score) as avg_continuity_score,
    COUNT(CASE WHEN ps.context_preserved = true THEN 1 END) as successful_transfers,
    ROUND(
        COUNT(CASE WHEN ps.context_preserved = true THEN 1 END)::numeric / 
        COUNT(*)::numeric * 100, 2
    ) as transfer_success_rate
FROM platform_switches ps
GROUP BY ps.merchant_id, DATE_TRUNC('day', ps.switch_timestamp), ps.from_platform, ps.to_platform, ps.reason
ORDER BY switch_date DESC;

-- Add Row Level Security
ALTER TABLE platform_switches ENABLE ROW LEVEL SECURITY;
ALTER TABLE unified_customer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_journey_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_merges ENABLE ROW LEVEL SECURITY;

-- RLS Policies for platform_switches
DROP POLICY IF EXISTS platform_switches_tenant_policy ON platform_switches;
CREATE POLICY platform_switches_tenant_policy ON platform_switches
    FOR ALL USING (
        merchant_id = current_setting('app.current_merchant_id', true)::UUID
    );

-- RLS Policies for unified_customer_profiles
DROP POLICY IF EXISTS unified_customer_profiles_tenant_policy ON unified_customer_profiles;
CREATE POLICY unified_customer_profiles_tenant_policy ON unified_customer_profiles
    FOR ALL USING (
        merchant_id = current_setting('app.current_merchant_id', true)::UUID
    );

-- RLS Policies for customer_journey_events
DROP POLICY IF EXISTS customer_journey_events_tenant_policy ON customer_journey_events;
CREATE POLICY customer_journey_events_tenant_policy ON customer_journey_events
    FOR ALL USING (
        merchant_id = current_setting('app.current_merchant_id', true)::UUID
    );

-- RLS Policies for conversation_merges
DROP POLICY IF EXISTS conversation_merges_tenant_policy ON conversation_merges;
CREATE POLICY conversation_merges_tenant_policy ON conversation_merges
    FOR ALL USING (
        merchant_id = current_setting('app.current_merchant_id', true)::UUID
    );

-- Create trigger to update unified_customer_profiles updated_at
CREATE OR REPLACE FUNCTION update_unified_profile_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_unified_profiles_updated_at ON unified_customer_profiles;
CREATE TRIGGER trigger_unified_profiles_updated_at
    BEFORE UPDATE ON unified_customer_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_unified_profile_timestamp();

-- Insert migration record
INSERT INTO migrations (name, filename) 
VALUES ('Cross-Platform Conversation Management Infrastructure', '006_cross_platform_infrastructure.sql')
ON CONFLICT (name) DO NOTHING;