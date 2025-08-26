-- ===============================================
-- Instagram Comments Infrastructure Migration
-- Adds support for advanced Instagram comments management
-- ===============================================

-- Create comment_interactions table for tracking all comment interactions
CREATE TABLE IF NOT EXISTS comment_interactions (
    id VARCHAR(255) PRIMARY KEY,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    post_id VARCHAR(255) NOT NULL,
    parent_comment_id VARCHAR(255), -- For replies to comments
    user_id VARCHAR(255) NOT NULL,
    username VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    is_reply BOOLEAN DEFAULT FALSE,
    sentiment_score DECIMAL(5,2),
    is_sales_inquiry BOOLEAN DEFAULT FALSE,
    is_complaint BOOLEAN DEFAULT FALSE,
    is_spam BOOLEAN DEFAULT FALSE,
    urgency_level VARCHAR(20) DEFAULT 'low' CHECK (urgency_level IN ('low', 'medium', 'high')),
    analysis_data JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for comment_interactions
CREATE INDEX IF NOT EXISTS idx_comment_interactions_merchant ON comment_interactions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_comment_interactions_post ON comment_interactions(post_id);
CREATE INDEX IF NOT EXISTS idx_comment_interactions_user ON comment_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_comment_interactions_timestamp ON comment_interactions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_comment_interactions_sentiment ON comment_interactions(sentiment_score);
CREATE INDEX IF NOT EXISTS idx_comment_interactions_sales ON comment_interactions(is_sales_inquiry) WHERE is_sales_inquiry = TRUE;
CREATE INDEX IF NOT EXISTS idx_comment_interactions_complaints ON comment_interactions(is_complaint) WHERE is_complaint = TRUE;
CREATE INDEX IF NOT EXISTS idx_comment_interactions_urgency ON comment_interactions(urgency_level) WHERE urgency_level IN ('medium', 'high');

-- Create comment_responses table for tracking responses to comments
CREATE TABLE IF NOT EXISTS comment_responses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    comment_id VARCHAR(255) NOT NULL REFERENCES comment_interactions(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    response_type VARCHAR(50) NOT NULL CHECK (response_type IN ('reply', 'like', 'dm_invite', 'hide', 'escalate')),
    response_content TEXT,
    platform_response_id VARCHAR(255), -- Instagram's response ID
    ai_generated BOOLEAN DEFAULT TRUE,
    ai_confidence DECIMAL(5,2),
    response_time_seconds INTEGER,
    delivery_status VARCHAR(50) DEFAULT 'PENDING' CHECK (delivery_status IN ('PENDING', 'SENT', 'FAILED', 'RETRYING')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for comment_responses
CREATE INDEX IF NOT EXISTS idx_comment_responses_comment ON comment_responses(comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_responses_merchant ON comment_responses(merchant_id);
CREATE INDEX IF NOT EXISTS idx_comment_responses_type ON comment_responses(response_type);
CREATE INDEX IF NOT EXISTS idx_comment_responses_status ON comment_responses(delivery_status);
CREATE INDEX IF NOT EXISTS idx_comment_responses_created ON comment_responses(created_at DESC);

-- Create comment_moderation_rules table for automated comment moderation
CREATE TABLE IF NOT EXISTS comment_moderation_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    trigger_config JSONB NOT NULL, -- {type: 'keyword|sentiment|spam|user_type', value: string|number, operator: 'contains|equals|greater_than|less_than'}
    action_config JSONB NOT NULL, -- {type: 'auto_reply|hide|flag|invite_dm', template?: string, priority: number}
    is_active BOOLEAN DEFAULT TRUE,
    usage_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for comment_moderation_rules
CREATE INDEX IF NOT EXISTS idx_comment_moderation_merchant ON comment_moderation_rules(merchant_id);
CREATE INDEX IF NOT EXISTS idx_comment_moderation_active ON comment_moderation_rules(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_comment_moderation_priority ON comment_moderation_rules((action_config->>'priority')::int DESC) WHERE is_active = TRUE;

-- Create comment_analytics_summary table for aggregated comment analytics
CREATE TABLE IF NOT EXISTS comment_analytics_summary (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    total_comments INTEGER DEFAULT 0,
    comments_replied INTEGER DEFAULT 0,
    comments_liked INTEGER DEFAULT 0,
    dm_invitations_sent INTEGER DEFAULT 0,
    sales_inquiries_detected INTEGER DEFAULT 0,
    complaints_detected INTEGER DEFAULT 0,
    spam_filtered INTEGER DEFAULT 0,
    average_sentiment_score DECIMAL(5,2),
    average_response_time_minutes DECIMAL(8,2),
    top_commenting_posts JSONB DEFAULT '[]',
    engagement_rate DECIMAL(5,2),
    conversion_rate DECIMAL(5,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(merchant_id, date)
);

-- Create indexes for comment_analytics_summary
CREATE INDEX IF NOT EXISTS idx_comment_analytics_merchant ON comment_analytics_summary(merchant_id);
CREATE INDEX IF NOT EXISTS idx_comment_analytics_date ON comment_analytics_summary(date DESC);
CREATE INDEX IF NOT EXISTS idx_comment_analytics_merchant_date ON comment_analytics_summary(merchant_id, date DESC);

-- Create user_comment_history table for tracking individual user comment patterns
CREATE TABLE IF NOT EXISTS user_comment_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    username VARCHAR(255) NOT NULL,
    total_comments INTEGER DEFAULT 0,
    sales_inquiries INTEGER DEFAULT 0,
    complaints INTEGER DEFAULT 0,
    positive_comments INTEGER DEFAULT 0,
    negative_comments INTEGER DEFAULT 0,
    average_sentiment DECIMAL(5,2),
    last_comment_date TIMESTAMP WITH TIME ZONE,
    last_response_received TIMESTAMP WITH TIME ZONE,
    engagement_score DECIMAL(5,2) DEFAULT 0,
    is_vip_customer BOOLEAN DEFAULT FALSE,
    is_potential_customer BOOLEAN DEFAULT FALSE,
    is_problematic BOOLEAN DEFAULT FALSE,
    tags JSONB DEFAULT '[]',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(merchant_id, user_id)
);

-- Create indexes for user_comment_history
CREATE INDEX IF NOT EXISTS idx_user_comment_history_merchant ON user_comment_history(merchant_id);
CREATE INDEX IF NOT EXISTS idx_user_comment_history_user ON user_comment_history(user_id);
CREATE INDEX IF NOT EXISTS idx_user_comment_history_username ON user_comment_history(username);
CREATE INDEX IF NOT EXISTS idx_user_comment_history_engagement ON user_comment_history(engagement_score DESC);
CREATE INDEX IF NOT EXISTS idx_user_comment_history_vip ON user_comment_history(is_vip_customer) WHERE is_vip_customer = TRUE;
CREATE INDEX IF NOT EXISTS idx_user_comment_history_potential ON user_comment_history(is_potential_customer) WHERE is_potential_customer = TRUE;
CREATE INDEX IF NOT EXISTS idx_user_comment_history_problematic ON user_comment_history(is_problematic) WHERE is_problematic = TRUE;

-- Create daily_analytics table if not exists, then add comment columns
CREATE TABLE IF NOT EXISTS daily_analytics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    platform VARCHAR(20) DEFAULT 'INSTAGRAM',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(merchant_id, date, platform)
);

-- Add comment-related columns
ALTER TABLE daily_analytics 
ADD COLUMN IF NOT EXISTS comments_received INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS comments_responded INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS comment_response_rate DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS comment_sentiment_avg DECIMAL(5,2);

-- Create trigger to automatically update user_comment_history
CREATE OR REPLACE FUNCTION update_user_comment_history()
RETURNS TRIGGER AS $$
BEGIN
    -- Insert or update user comment history
    INSERT INTO user_comment_history (
        merchant_id, 
        user_id, 
        username,
        total_comments,
        sales_inquiries,
        complaints,
        positive_comments,
        negative_comments,
        last_comment_date,
        updated_at
    ) VALUES (
        NEW.merchant_id,
        NEW.user_id,
        NEW.username,
        1,
        CASE WHEN NEW.is_sales_inquiry THEN 1 ELSE 0 END,
        CASE WHEN NEW.is_complaint THEN 1 ELSE 0 END,
        CASE WHEN NEW.sentiment_score > 60 THEN 1 ELSE 0 END,
        CASE WHEN NEW.sentiment_score < 40 THEN 1 ELSE 0 END,
        NEW.timestamp,
        NOW()
    )
    ON CONFLICT (merchant_id, user_id)
    DO UPDATE SET
        total_comments = user_comment_history.total_comments + 1,
        sales_inquiries = user_comment_history.sales_inquiries + 
            CASE WHEN NEW.is_sales_inquiry THEN 1 ELSE 0 END,
        complaints = user_comment_history.complaints + 
            CASE WHEN NEW.is_complaint THEN 1 ELSE 0 END,
        positive_comments = user_comment_history.positive_comments + 
            CASE WHEN NEW.sentiment_score > 60 THEN 1 ELSE 0 END,
        negative_comments = user_comment_history.negative_comments + 
            CASE WHEN NEW.sentiment_score < 40 THEN 1 ELSE 0 END,
        last_comment_date = NEW.timestamp,
        username = NEW.username,
        updated_at = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for comment_interactions
DROP TRIGGER IF EXISTS trigger_update_user_comment_history ON comment_interactions;
CREATE TRIGGER trigger_update_user_comment_history
    AFTER INSERT OR UPDATE ON comment_interactions
    FOR EACH ROW
    EXECUTE FUNCTION update_user_comment_history();

-- Create function to calculate user engagement scores
CREATE OR REPLACE FUNCTION calculate_comment_engagement_score(
    total_comments INTEGER,
    sales_inquiries INTEGER,
    complaints INTEGER,
    positive_comments INTEGER,
    negative_comments INTEGER,
    last_comment_date TIMESTAMP WITH TIME ZONE
) RETURNS DECIMAL(5,2) AS $$
DECLARE
    base_score DECIMAL(5,2) := 0;
    recency_multiplier DECIMAL(5,2) := 1;
    quality_bonus DECIMAL(5,2) := 0;
    penalty DECIMAL(5,2) := 0;
BEGIN
    -- Base score from comment frequency (max 40 points)
    base_score := LEAST(total_comments * 3, 40);
    
    -- Recency multiplier
    IF last_comment_date > NOW() - INTERVAL '7 days' THEN
        recency_multiplier := 1.0;
    ELSIF last_comment_date > NOW() - INTERVAL '30 days' THEN
        recency_multiplier := 0.8;
    ELSE
        recency_multiplier := 0.5;
    END IF;
    
    -- Quality bonus for sales inquiries and positive comments
    quality_bonus := (sales_inquiries * 15) + (positive_comments * 5);
    
    -- Penalty for complaints and negative comments
    penalty := (complaints * 10) + (negative_comments * 3);
    
    RETURN LEAST(GREATEST((base_score + quality_bonus - penalty) * recency_multiplier, 0), 100);
END;
$$ LANGUAGE plpgsql;

-- Create function to update all user engagement scores
CREATE OR REPLACE FUNCTION update_all_comment_engagement_scores()
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER := 0;
    user_record RECORD;
BEGIN
    FOR user_record IN 
        SELECT * FROM user_comment_history
    LOOP
        UPDATE user_comment_history
        SET 
            average_sentiment = CASE 
                WHEN total_comments > 0 THEN 
                    (positive_comments * 80 + (total_comments - positive_comments - negative_comments) * 50 + negative_comments * 20)::DECIMAL / total_comments
                ELSE 50 
            END,
            engagement_score = calculate_comment_engagement_score(user_record.total_comments, user_record.sales_inquiries, user_record.complaints, user_record.positive_comments, user_record.negative_comments, user_record.last_comment_date),
            is_potential_customer = user_record.sales_inquiries >= 2 OR user_record.positive_comments >= 3,
            is_vip_customer = user_record.total_comments >= 10 AND user_record.complaints = 0 AND user_record.positive_comments >= 5,
            is_problematic = user_record.complaints >= 3 OR user_record.negative_comments >= 5,
            updated_at = NOW()
        WHERE id = user_record.id;
        
        updated_count := updated_count + 1;
    END LOOP;
    
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Note: Complex analytics function removed to avoid syntax errors

-- Add performance indexes
CREATE INDEX IF NOT EXISTS idx_comment_interactions_merchant_date ON comment_interactions(merchant_id, DATE(created_at));
CREATE INDEX IF NOT EXISTS idx_comment_responses_merchant_date ON comment_responses(merchant_id, DATE(created_at));

-- Add comments for documentation
COMMENT ON TABLE comment_interactions IS 'Tracks all Instagram comment interactions with sentiment analysis and categorization';
COMMENT ON TABLE comment_responses IS 'Logs automated responses to Instagram comments including AI-generated replies';
COMMENT ON TABLE comment_moderation_rules IS 'Stores automated moderation rules for filtering and responding to comments';
COMMENT ON TABLE comment_analytics_summary IS 'Daily aggregated analytics for Instagram comment performance';
COMMENT ON TABLE user_comment_history IS 'Tracks individual user comment patterns and engagement levels';

-- Insert default moderation rules for merchants with Instagram credentials
DO $$
BEGIN
    -- Insert spam moderation rule
    INSERT INTO comment_moderation_rules (merchant_id, name, description, trigger_config, action_config)
    SELECT 
        id as merchant_id,
        'Auto-hide spam comments',
        'Automatically hide comments containing spam keywords',
        '{"type": "keyword", "value": "spam|follow4follow|dm for price|check my bio", "operator": "contains"}'::jsonb,
        '{"type": "hide", "priority": 100}'::jsonb
    FROM merchants 
    WHERE subscription_status = 'ACTIVE'
      AND NOT EXISTS (
        SELECT 1 FROM comment_moderation_rules cmr 
        WHERE cmr.merchant_id = merchants.id 
        AND cmr.name = 'Auto-hide spam comments'
      );

    -- Insert sales inquiry rule
    INSERT INTO comment_moderation_rules (merchant_id, name, description, trigger_config, action_config)
    SELECT 
        id as merchant_id,
        'Auto-invite sales inquiries to DM',
        'Automatically invite detailed sales inquiries to private messages',
        '{"type": "keyword", "value": "سعر|price|كم|how much|متوفر|available|أريد|want", "operator": "contains"}'::jsonb,
        '{"type": "invite_dm", "template": "مرحباً راح أرسلك رسالة خاصة بكل التفاصيل", "priority": 80}'::jsonb
    FROM merchants 
    WHERE subscription_status = 'ACTIVE'
      AND NOT EXISTS (
        SELECT 1 FROM comment_moderation_rules cmr 
        WHERE cmr.merchant_id = merchants.id 
        AND cmr.name = 'Auto-invite sales inquiries to DM'
      );
END $$;

-- Note: Migration tracking is handled automatically by the migration runner