-- ===============================================
-- Instagram Production Features Migration
-- Production-safe features only - NO TESTING TABLES
-- ===============================================

-- Create hashtag_mentions table (production feature)
CREATE TABLE IF NOT EXISTS hashtag_mentions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id VARCHAR(255) NOT NULL,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    hashtag VARCHAR(255),
    mentioned_user VARCHAR(255),
    content TEXT NOT NULL,
    source VARCHAR(50) NOT NULL CHECK (source IN ('comment', 'dm', 'story', 'post')),
    sentiment VARCHAR(20) DEFAULT 'neutral' CHECK (sentiment IN ('positive', 'neutral', 'negative')),
    category VARCHAR(50) DEFAULT 'generic' CHECK (category IN ('product', 'brand', 'trend', 'event', 'generic')),
    mention_type VARCHAR(50) DEFAULT 'generic' CHECK (mention_type IN ('customer', 'influencer', 'competitor', 'brand', 'generic')),
    marketing_value VARCHAR(20) DEFAULT 'medium' CHECK (marketing_value IN ('low', 'medium', 'high')),
    engagement_potential VARCHAR(20) DEFAULT 'medium' CHECK (engagement_potential IN ('low', 'medium', 'high')),
    engagement_score DECIMAL(5,2) DEFAULT 50,
    user_id VARCHAR(255) NOT NULL,
    processing_status VARCHAR(20) DEFAULT 'processed' CHECK (processing_status IN ('pending', 'processed', 'failed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(message_id, hashtag),
    UNIQUE(message_id, mentioned_user)
);

-- Create indexes for hashtag_mentions
CREATE INDEX IF NOT EXISTS idx_hashtag_mentions_merchant ON hashtag_mentions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_hashtag_mentions_hashtag ON hashtag_mentions(hashtag) WHERE hashtag IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hashtag_mentions_user ON hashtag_mentions(mentioned_user) WHERE mentioned_user IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hashtag_mentions_source ON hashtag_mentions(source);
CREATE INDEX IF NOT EXISTS idx_hashtag_mentions_sentiment ON hashtag_mentions(sentiment);
CREATE INDEX IF NOT EXISTS idx_hashtag_mentions_marketing_value ON hashtag_mentions(marketing_value);

-- Create hashtag_strategies table for hashtag monitoring strategies
CREATE TABLE IF NOT EXISTS hashtag_strategies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    target_hashtags JSONB NOT NULL DEFAULT '[]',
    monitoring_keywords JSONB NOT NULL DEFAULT '[]',
    auto_response_rules JSONB NOT NULL DEFAULT '[]',
    campaign_goals JSONB NOT NULL DEFAULT '[]',
    success_metrics JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    last_executed_at TIMESTAMP WITH TIME ZONE,
    execution_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for hashtag_strategies
CREATE INDEX IF NOT EXISTS idx_hashtag_strategies_merchant ON hashtag_strategies(merchant_id);
CREATE INDEX IF NOT EXISTS idx_hashtag_strategies_active ON hashtag_strategies(is_active) WHERE is_active = TRUE;

-- Create hashtag_trends table for tracking hashtag popularity trends
CREATE TABLE IF NOT EXISTS hashtag_trends (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    hashtag VARCHAR(255) NOT NULL,
    date DATE NOT NULL,
    usage_count INTEGER DEFAULT 1,
    unique_users INTEGER DEFAULT 1,
    engagement_score DECIMAL(5,2) DEFAULT 0,
    sentiment_breakdown JSONB DEFAULT '{"positive": 0, "neutral": 0, "negative": 0}',
    growth_rate DECIMAL(5,2) DEFAULT 0, -- percentage change from previous period
    trending_score DECIMAL(5,2) DEFAULT 0,
    peak_usage_hour INTEGER, -- 0-23
    associated_keywords JSONB DEFAULT '[]',
    competitor_usage INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(merchant_id, hashtag, date)
);

-- Create indexes for hashtag_trends
CREATE INDEX IF NOT EXISTS idx_hashtag_trends_merchant ON hashtag_trends(merchant_id);
CREATE INDEX IF NOT EXISTS idx_hashtag_trends_hashtag ON hashtag_trends(hashtag);
CREATE INDEX IF NOT EXISTS idx_hashtag_trends_date ON hashtag_trends(date DESC);
CREATE INDEX IF NOT EXISTS idx_hashtag_trends_trending_score ON hashtag_trends(trending_score DESC);
CREATE INDEX IF NOT EXISTS idx_hashtag_trends_growth ON hashtag_trends(growth_rate DESC);

-- Create marketing_opportunities table for tracking marketing leads
CREATE TABLE IF NOT EXISTS marketing_opportunities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    opportunity_type VARCHAR(100) NOT NULL,
    source_platform VARCHAR(50) NOT NULL CHECK (source_platform IN ('INSTAGRAM', 'WHATSAPP', 'TELEGRAM')),
    source_content TEXT,
    hashtags JSONB DEFAULT '[]',
    mentions JSONB DEFAULT '[]',
    priority VARCHAR(20) DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
    status VARCHAR(20) DEFAULT 'NEW' CHECK (status IN ('NEW', 'REVIEWING', 'ACTIVE', 'COMPLETED', 'DISMISSED')),
    estimated_value DECIMAL(10,2),
    conversion_probability DECIMAL(5,2),
    assigned_to UUID REFERENCES merchants(id),
    action_items JSONB DEFAULT '[]',
    notes TEXT,
    deadline TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for marketing_opportunities
CREATE INDEX IF NOT EXISTS idx_marketing_opportunities_merchant ON marketing_opportunities(merchant_id);
CREATE INDEX IF NOT EXISTS idx_marketing_opportunities_priority ON marketing_opportunities(priority);
CREATE INDEX IF NOT EXISTS idx_marketing_opportunities_status ON marketing_opportunities(status);
CREATE INDEX IF NOT EXISTS idx_marketing_opportunities_platform ON marketing_opportunities(source_platform);
CREATE INDEX IF NOT EXISTS idx_marketing_opportunities_created ON marketing_opportunities(created_at DESC);

-- Create production-safe monitoring functions
CREATE OR REPLACE FUNCTION calculate_hashtag_engagement_score(
    merchant_uuid UUID,
    hashtag_name VARCHAR(255)
) RETURNS DECIMAL(5,2) AS $$
DECLARE
    engagement_score DECIMAL(5,2) := 0;
    mention_count INTEGER;
    positive_sentiment INTEGER;
    total_sentiment INTEGER;
BEGIN
    -- Count total mentions
    SELECT COUNT(*) INTO mention_count
    FROM hashtag_mentions
    WHERE merchant_id = merchant_uuid
    AND hashtag = hashtag_name;
    
    -- Count positive sentiment
    SELECT COUNT(*) INTO positive_sentiment
    FROM hashtag_mentions
    WHERE merchant_id = merchant_uuid
    AND hashtag = hashtag_name
    AND sentiment = 'positive';
    
    SELECT COUNT(*) INTO total_sentiment
    FROM hashtag_mentions
    WHERE merchant_id = merchant_uuid
    AND hashtag = hashtag_name
    AND sentiment IS NOT NULL;
    
    -- Calculate engagement score based on mentions and sentiment
    IF mention_count > 0 THEN
        engagement_score := mention_count * 10;
        
        IF total_sentiment > 0 THEN
            engagement_score := engagement_score + ((positive_sentiment::DECIMAL / total_sentiment) * 50);
        END IF;
    END IF;
    
    RETURN LEAST(100, engagement_score);
END;
$$ LANGUAGE plpgsql;

-- Create marketing opportunity assessment function
CREATE OR REPLACE FUNCTION assess_marketing_opportunity(
    merchant_uuid UUID,
    content TEXT,
    source_platform VARCHAR(50)
) RETURNS JSONB AS $$
DECLARE
    assessment JSONB;
    hashtag_count INTEGER;
    mention_count INTEGER;
    priority VARCHAR(20) := 'LOW';
    estimated_value DECIMAL(10,2) := 0;
BEGIN
    -- Count hashtags in content
    SELECT (LENGTH(content) - LENGTH(REPLACE(content, '#', ''))) INTO hashtag_count;
    
    -- Count mentions in content
    SELECT (LENGTH(content) - LENGTH(REPLACE(content, '@', ''))) INTO mention_count;
    
    -- Assess priority based on content analysis
    IF hashtag_count >= 3 OR mention_count >= 2 THEN
        priority := 'HIGH';
        estimated_value := 100.00;
    ELSIF hashtag_count >= 1 OR mention_count >= 1 THEN
        priority := 'MEDIUM';
        estimated_value := 50.00;
    ELSE
        priority := 'LOW';
        estimated_value := 10.00;
    END IF;
    
    -- Build assessment JSON
    assessment := jsonb_build_object(
        'priority', priority,
        'estimated_value', estimated_value,
        'hashtag_count', hashtag_count,
        'mention_count', mention_count,
        'conversion_probability', CASE 
            WHEN priority = 'HIGH' THEN 75
            WHEN priority = 'MEDIUM' THEN 50
            ELSE 25
        END,
        'recommended_actions', CASE
            WHEN priority = 'HIGH' THEN '["immediate_response", "engagement", "follow_up"]'::jsonb
            WHEN priority = 'MEDIUM' THEN '["response", "monitoring"]'::jsonb
            ELSE '["monitoring"]'::jsonb
        END
    );
    
    RETURN assessment;
END;
$$ LANGUAGE plpgsql;

-- Create production monitoring views
CREATE OR REPLACE VIEW hashtag_performance_dashboard AS
SELECT 
    hm.merchant_id,
    m.business_name,
    hm.hashtag,
    COUNT(*) as mention_count,
    COUNT(CASE WHEN hm.sentiment = 'positive' THEN 1 END) as positive_mentions,
    COUNT(CASE WHEN hm.sentiment = 'negative' THEN 1 END) as negative_mentions,
    AVG(hm.engagement_score) as avg_engagement_score,
    calculate_hashtag_engagement_score(hm.merchant_id, hm.hashtag) as calculated_engagement_score,
    MAX(hm.created_at) as last_mention,
    COUNT(DISTINCT hm.user_id) as unique_users
FROM hashtag_mentions hm
JOIN merchants m ON hm.merchant_id = m.id
WHERE hm.hashtag IS NOT NULL
GROUP BY hm.merchant_id, m.business_name, hm.hashtag
ORDER BY mention_count DESC, calculated_engagement_score DESC;

CREATE OR REPLACE VIEW marketing_opportunities_dashboard AS
SELECT 
    mo.merchant_id,
    m.business_name,
    mo.opportunity_type,
    mo.priority,
    mo.status,
    mo.source_platform,
    mo.estimated_value,
    mo.conversion_probability,
    mo.created_at,
    CASE 
        WHEN mo.deadline IS NOT NULL AND mo.deadline < NOW() THEN 'overdue'
        WHEN mo.deadline IS NOT NULL AND mo.deadline < NOW() + INTERVAL '24 hours' THEN 'urgent'
        ELSE 'normal'
    END as urgency_status
FROM marketing_opportunities mo
JOIN merchants m ON mo.merchant_id = m.id
WHERE mo.status NOT IN ('COMPLETED', 'DISMISSED')
ORDER BY 
    CASE mo.priority 
        WHEN 'URGENT' THEN 1
        WHEN 'HIGH' THEN 2
        WHEN 'MEDIUM' THEN 3
        ELSE 4
    END,
    mo.created_at DESC;

-- Add comments for documentation
COMMENT ON TABLE hashtag_mentions IS 'Production hashtag mentions tracking and sentiment analysis';
COMMENT ON TABLE hashtag_strategies IS 'Merchant hashtag monitoring and response strategies';
COMMENT ON TABLE hashtag_trends IS 'Hashtag popularity trends and growth analytics';
COMMENT ON TABLE marketing_opportunities IS 'Marketing leads and opportunities from social interactions';

-- Migration completion log
INSERT INTO audit_logs (action, entity_type, details, success)
VALUES (
    'MIGRATION_EXECUTED',
    'DATABASE_SCHEMA',
    '{"migration": "011_instagram_production_features", "description": "Added production Instagram features - hashtags, trends, marketing opportunities"}',
    TRUE
);

-- Success notification
DO $$
BEGIN
    RAISE NOTICE '✅ Instagram production features migration completed successfully';
    RAISE NOTICE '📊 Added: hashtag_mentions, hashtag_strategies, hashtag_trends, marketing_opportunities';
    RAISE NOTICE '🚫 Testing tables excluded - use 011_testing_only.sql for development';
END $$;