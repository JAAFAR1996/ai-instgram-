-- ===============================================
-- Instagram Stories Infrastructure Migration
-- Adds support for advanced Instagram Stories features
-- ===============================================

-- Create story_interactions table for tracking all story-related interactions
CREATE TABLE IF NOT EXISTS story_interactions (
    id VARCHAR(255) PRIMARY KEY,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    interaction_type VARCHAR(50) NOT NULL CHECK (interaction_type IN ('story_reply', 'story_mention', 'story_view', 'story_reaction')),
    story_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    username VARCHAR(255),
    content TEXT,
    media_url TEXT,
    metadata JSONB DEFAULT '{}',
    ai_response_sent BOOLEAN DEFAULT FALSE,
    ai_response_content TEXT,
    ai_response_timestamp TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for story_interactions
CREATE INDEX IF NOT EXISTS idx_story_interactions_merchant ON story_interactions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_story_interactions_type ON story_interactions(interaction_type);
CREATE INDEX IF NOT EXISTS idx_story_interactions_user ON story_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_story_interactions_story ON story_interactions(story_id);
CREATE INDEX IF NOT EXISTS idx_story_interactions_created ON story_interactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_story_interactions_merchant_created ON story_interactions(merchant_id, created_at DESC);

-- Create story_templates table for reusable story templates
CREATE TABLE IF NOT EXISTS story_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL CHECK (category IN ('product_showcase', 'engagement', 'promo', 'qa', 'behind_scenes')),
    template_data JSONB NOT NULL DEFAULT '{}',
    response_template JSONB,
    usage_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for story_templates
CREATE INDEX IF NOT EXISTS idx_story_templates_merchant ON story_templates(merchant_id);
CREATE INDEX IF NOT EXISTS idx_story_templates_category ON story_templates(category);
CREATE INDEX IF NOT EXISTS idx_story_templates_active ON story_templates(is_active) WHERE is_active = TRUE;

-- Create sales_opportunities table for tracking sales leads from various sources
CREATE TABLE IF NOT EXISTS sales_opportunities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    customer_id VARCHAR(255) NOT NULL,
    source_platform VARCHAR(50) NOT NULL CHECK (source_platform IN ('INSTAGRAM', 'WHATSAPP', 'TELEGRAM')),
    opportunity_type VARCHAR(100) NOT NULL,
    status VARCHAR(50) DEFAULT 'NEW' CHECK (status IN ('NEW', 'ACTIVE', 'QUALIFIED', 'CONVERTED', 'LOST')),
    estimated_value DECIMAL(10,2),
    probability_score INTEGER CHECK (probability_score >= 0 AND probability_score <= 100),
    metadata JSONB DEFAULT '{}',
    notes TEXT,
    assigned_to UUID REFERENCES merchants(id),
    conversion_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(merchant_id, customer_id, source_platform)
);

-- Create indexes for sales_opportunities
CREATE INDEX IF NOT EXISTS idx_sales_opportunities_merchant ON sales_opportunities(merchant_id);
CREATE INDEX IF NOT EXISTS idx_sales_opportunities_customer ON sales_opportunities(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_opportunities_platform ON sales_opportunities(source_platform);
CREATE INDEX IF NOT EXISTS idx_sales_opportunities_status ON sales_opportunities(status);
CREATE INDEX IF NOT EXISTS idx_sales_opportunities_created ON sales_opportunities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_opportunities_value ON sales_opportunities(estimated_value DESC) WHERE estimated_value IS NOT NULL;

-- Create daily_analytics table if not exists, then add story metrics
CREATE TABLE IF NOT EXISTS daily_analytics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(merchant_id, date)
);

-- Add story metrics columns
ALTER TABLE daily_analytics 
ADD COLUMN IF NOT EXISTS story_interactions INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS unique_story_users INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS story_response_rate DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS story_engagement_score DECIMAL(5,2);

-- Add story-related columns to conversations table
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS source_type VARCHAR(50) DEFAULT 'DIRECT' CHECK (source_type IN ('DIRECT', 'STORY', 'COMMENT', 'MENTION')),
ADD COLUMN IF NOT EXISTS story_context JSONB DEFAULT '{}';

-- Create story_analytics_summary table for aggregated analytics
CREATE TABLE IF NOT EXISTS story_analytics_summary (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    total_interactions INTEGER DEFAULT 0,
    story_replies INTEGER DEFAULT 0,
    story_mentions INTEGER DEFAULT 0,
    story_reactions INTEGER DEFAULT 0,
    story_views INTEGER DEFAULT 0,
    unique_users INTEGER DEFAULT 0,
    response_rate DECIMAL(5,2),
    engagement_score DECIMAL(5,2),
    top_interaction_hour INTEGER,
    conversion_rate DECIMAL(5,2),
    revenue_attributed DECIMAL(10,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(merchant_id, date)
);

-- Create indexes for story_analytics_summary
CREATE INDEX IF NOT EXISTS idx_story_analytics_merchant ON story_analytics_summary(merchant_id);
CREATE INDEX IF NOT EXISTS idx_story_analytics_date ON story_analytics_summary(date DESC);
CREATE INDEX IF NOT EXISTS idx_story_analytics_merchant_date ON story_analytics_summary(merchant_id, date DESC);

-- Create story_user_engagement table for tracking individual user engagement patterns
CREATE TABLE IF NOT EXISTS story_user_engagement (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    username VARCHAR(255),
    total_interactions INTEGER DEFAULT 0,
    last_interaction_type VARCHAR(50),
    last_interaction_date TIMESTAMP WITH TIME ZONE,
    engagement_score DECIMAL(5,2) DEFAULT 0,
    is_potential_customer BOOLEAN DEFAULT FALSE,
    preferred_interaction_time INTEGER, -- Hour of day (0-23)
    interaction_frequency VARCHAR(50) DEFAULT 'LOW' CHECK (interaction_frequency IN ('LOW', 'MEDIUM', 'HIGH')),
    conversion_probability DECIMAL(5,2),
    tags JSONB DEFAULT '[]',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(merchant_id, user_id)
);

-- Create indexes for story_user_engagement
CREATE INDEX IF NOT EXISTS idx_story_user_engagement_merchant ON story_user_engagement(merchant_id);
CREATE INDEX IF NOT EXISTS idx_story_user_engagement_user ON story_user_engagement(user_id);
CREATE INDEX IF NOT EXISTS idx_story_user_engagement_score ON story_user_engagement(engagement_score DESC);
CREATE INDEX IF NOT EXISTS idx_story_user_engagement_potential ON story_user_engagement(is_potential_customer) WHERE is_potential_customer = TRUE;
CREATE INDEX IF NOT EXISTS idx_story_user_engagement_frequency ON story_user_engagement(interaction_frequency);

-- Add trigger to automatically update story_user_engagement
CREATE OR REPLACE FUNCTION update_story_user_engagement()
RETURNS TRIGGER AS $$
BEGIN
    -- Insert or update user engagement data
    INSERT INTO story_user_engagement (
        merchant_id, 
        user_id, 
        username,
        total_interactions,
        last_interaction_type,
        last_interaction_date,
        updated_at
    ) VALUES (
        NEW.merchant_id,
        NEW.user_id,
        NEW.username,
        1,
        NEW.interaction_type,
        NEW.created_at,
        NOW()
    )
    ON CONFLICT (merchant_id, user_id)
    DO UPDATE SET
        total_interactions = story_user_engagement.total_interactions + 1,
        last_interaction_type = NEW.interaction_type,
        last_interaction_date = NEW.created_at,
        username = COALESCE(NEW.username, story_user_engagement.username),
        updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for story_interactions
DROP TRIGGER IF EXISTS trigger_update_story_user_engagement ON story_interactions;
CREATE TRIGGER trigger_update_story_user_engagement
    AFTER INSERT ON story_interactions
    FOR EACH ROW
    EXECUTE FUNCTION update_story_user_engagement();

-- Create function to calculate engagement scores
CREATE OR REPLACE FUNCTION calculate_story_engagement_score(
    total_interactions INTEGER,
    interaction_types TEXT[],
    last_interaction_date TIMESTAMP WITH TIME ZONE
) RETURNS DECIMAL(5,2) AS $$
DECLARE
    base_score DECIMAL(5,2) := 0;
    recency_multiplier DECIMAL(5,2) := 1;
    type_bonus DECIMAL(5,2) := 0;
BEGIN
    -- Base score from interaction count (max 50 points)
    base_score := LEAST(total_interactions * 5, 50);
    
    -- Recency multiplier (interactions in last 7 days get full score)
    IF last_interaction_date > NOW() - INTERVAL '7 days' THEN
        recency_multiplier := 1.0;
    ELSIF last_interaction_date > NOW() - INTERVAL '30 days' THEN
        recency_multiplier := 0.7;
    ELSE
        recency_multiplier := 0.3;
    END IF;
    
    -- Type bonus (story_reply and story_mention are more valuable)
    IF 'story_reply' = ANY(interaction_types) THEN
        type_bonus := type_bonus + 20;
    END IF;
    IF 'story_mention' = ANY(interaction_types) THEN
        type_bonus := type_bonus + 15;
    END IF;
    
    RETURN LEAST((base_score + type_bonus) * recency_multiplier, 100);
END;
$$ LANGUAGE plpgsql;

-- Add function to update engagement scores periodically
CREATE OR REPLACE FUNCTION update_all_story_engagement_scores()
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER := 0;
    engagement_record RECORD;
BEGIN
    FOR engagement_record IN 
        SELECT 
            merchant_id,
            user_id,
            total_interactions,
            last_interaction_date,
            ARRAY_AGG(DISTINCT si.interaction_type) as interaction_types
        FROM story_user_engagement sue
        LEFT JOIN story_interactions si ON sue.merchant_id = si.merchant_id AND sue.user_id = si.user_id
        GROUP BY sue.merchant_id, sue.user_id, sue.total_interactions, sue.last_interaction_date
    LOOP
        UPDATE story_user_engagement
        SET 
            engagement_score = calculate_story_engagement_score(
                engagement_record.total_interactions,
                engagement_record.interaction_types,
                engagement_record.last_interaction_date
            ),
            updated_at = NOW()
        WHERE merchant_id = engagement_record.merchant_id 
        AND user_id = engagement_record.user_id;
        
        updated_count := updated_count + 1;
    END LOOP;
    
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_message_logs_story_response ON message_logs(conversation_id, message_type) 
WHERE message_type = 'STORY_RESPONSE';

CREATE INDEX IF NOT EXISTS idx_conversations_story_context ON conversations 
USING GIN(story_context) WHERE story_context != '{}';

-- Add comments for documentation
COMMENT ON TABLE story_interactions IS 'Tracks all Instagram story-related interactions including replies, mentions, views, and reactions';
COMMENT ON TABLE story_templates IS 'Stores reusable templates for Instagram stories with automated response templates';
COMMENT ON TABLE sales_opportunities IS 'Tracks sales leads and opportunities from various social media platforms';
COMMENT ON TABLE story_analytics_summary IS 'Daily aggregated analytics for Instagram story performance';
COMMENT ON TABLE story_user_engagement IS 'Individual user engagement tracking for Instagram stories';

-- Insert sample story templates for common use cases
INSERT INTO story_templates (merchant_id, name, category, template_data, response_template)
SELECT 
    id as merchant_id,
    'ترحيب بالعملاء الجدد',
    'engagement',
    '{"text": "أهلاً بكم في متجرنا! 🛍️✨", "elements": {"polls": false, "questions": true, "hashtags": ["#ترحيب", "#عملاء_جدد"]}}',
    '{"type": "text", "content": "أهلاً وسهلاً! شكراً لمتابعتك ستورينا 🥰 إذا عندك أي استفسار عن منتجاتنا، لا تتردد تراسلني!", "quick_replies": [{"title": "المنتجات 🛍️", "payload": "PRODUCTS"}, {"title": "الأسعار 💰", "payload": "PRICES"}]}'
FROM merchants 
WHERE id IN (SELECT merchant_id FROM merchant_credentials WHERE instagram_token_encrypted IS NOT NULL)
ON CONFLICT DO NOTHING;

INSERT INTO story_templates (merchant_id, name, category, template_data, response_template)
SELECT 
    id as merchant_id,
    'عرض المنتجات',
    'product_showcase',
    '{"text": "شوفوا منتجاتنا الجديدة! 🔥", "elements": {"polls": true, "questions": false, "hashtags": ["#منتجات_جديدة", "#تسوق"]}}',
    '{"type": "text", "content": "حبيت المنتج؟ 😍 راسلني واحصل على تفاصيل أكثر وأسعار خاصة! ✨", "quick_replies": [{"title": "التفاصيل 📋", "payload": "DETAILS"}, {"title": "السعر 💰", "payload": "PRICE"}]}'
FROM merchants 
WHERE id IN (SELECT merchant_id FROM merchant_credentials WHERE instagram_token_encrypted IS NOT NULL)
ON CONFLICT DO NOTHING;

-- Note: Migration tracking is handled automatically by the migration runner