-- ===============================================
-- Instagram Media Infrastructure Migration
-- Adds support for media-rich conversations and content management
-- ===============================================

-- Create media_messages table for tracking all media content
CREATE TABLE IF NOT EXISTS media_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id VARCHAR(255) UNIQUE NOT NULL,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    direction VARCHAR(20) NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
    media_type VARCHAR(50) NOT NULL CHECK (media_type IN ('image', 'video', 'audio', 'document', 'sticker', 'gif')),
    media_url TEXT NOT NULL,
    thumbnail_url TEXT,
    caption TEXT,
    metadata JSONB DEFAULT '{}',
    upload_status VARCHAR(20) DEFAULT 'uploaded' CHECK (upload_status IN ('pending', 'uploading', 'uploaded', 'failed')),
    user_id VARCHAR(255) NOT NULL,
    file_size BIGINT,
    duration_seconds INTEGER, -- for video/audio
    dimensions JSONB, -- {width: number, height: number}
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for media_messages
CREATE INDEX IF NOT EXISTS idx_media_messages_conversation ON media_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_media_messages_merchant ON media_messages(merchant_id);
CREATE INDEX IF NOT EXISTS idx_media_messages_type ON media_messages(media_type);
CREATE INDEX IF NOT EXISTS idx_media_messages_direction ON media_messages(direction);
CREATE INDEX IF NOT EXISTS idx_media_messages_user ON media_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_media_messages_created ON media_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_messages_status ON media_messages(upload_status);

-- Create media_analysis table for AI analysis of media content
CREATE TABLE IF NOT EXISTS media_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id VARCHAR(255) UNIQUE NOT NULL REFERENCES media_messages(media_id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    description TEXT,
    is_product_inquiry BOOLEAN DEFAULT FALSE,
    suggested_response JSONB,
    confidence DECIMAL(5,2) DEFAULT 0,
    extracted_text TEXT, -- OCR or speech-to-text results
    detected_objects JSONB DEFAULT '[]',
    marketing_value VARCHAR(20) DEFAULT 'medium' CHECK (marketing_value IN ('low', 'medium', 'high')),
    analysis_data JSONB DEFAULT '{}', -- Full AI analysis results
    processing_time_ms INTEGER,
    ai_model_version VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for media_analysis
CREATE INDEX IF NOT EXISTS idx_media_analysis_merchant ON media_analysis(merchant_id);
CREATE INDEX IF NOT EXISTS idx_media_analysis_product_inquiry ON media_analysis(is_product_inquiry) WHERE is_product_inquiry = TRUE;
CREATE INDEX IF NOT EXISTS idx_media_analysis_confidence ON media_analysis(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_media_analysis_marketing_value ON media_analysis(marketing_value);
CREATE INDEX IF NOT EXISTS idx_media_analysis_created ON media_analysis(created_at DESC);

-- Create media_templates table for reusable media content
CREATE TABLE IF NOT EXISTS media_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL CHECK (category IN ('product', 'promo', 'greeting', 'thanks', 'story', 'faq')),
    media_type VARCHAR(50) NOT NULL CHECK (media_type IN ('image', 'video', 'gif')),
    template_url TEXT NOT NULL,
    overlay_elements JSONB DEFAULT '{}', -- Text overlays, logos, etc.
    usage_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    tags JSONB DEFAULT '[]',
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for media_templates
CREATE INDEX IF NOT EXISTS idx_media_templates_merchant ON media_templates(merchant_id);
CREATE INDEX IF NOT EXISTS idx_media_templates_category ON media_templates(category);
CREATE INDEX IF NOT EXISTS idx_media_templates_type ON media_templates(media_type);
CREATE INDEX IF NOT EXISTS idx_media_templates_active ON media_templates(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_media_templates_usage ON media_templates(usage_count DESC);

-- Create media_responses table for tracking AI responses to media
CREATE TABLE IF NOT EXISTS media_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id VARCHAR(255) NOT NULL REFERENCES media_messages(media_id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    response_type VARCHAR(50) NOT NULL CHECK (response_type IN ('text', 'media', 'product_catalog', 'template')),
    response_content TEXT,
    response_media_url TEXT,
    template_id UUID REFERENCES media_templates(id),
    ai_confidence DECIMAL(5,2),
    response_time_seconds INTEGER,
    platform_message_id VARCHAR(255),
    delivery_status VARCHAR(50) DEFAULT 'PENDING' CHECK (delivery_status IN ('PENDING', 'SENT', 'FAILED', 'RETRYING')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for media_responses
CREATE INDEX IF NOT EXISTS idx_media_responses_media ON media_responses(media_id);
CREATE INDEX IF NOT EXISTS idx_media_responses_conversation ON media_responses(conversation_id);
CREATE INDEX IF NOT EXISTS idx_media_responses_merchant ON media_responses(merchant_id);
CREATE INDEX IF NOT EXISTS idx_media_responses_type ON media_responses(response_type);
CREATE INDEX IF NOT EXISTS idx_media_responses_status ON media_responses(delivery_status);
CREATE INDEX IF NOT EXISTS idx_media_responses_created ON media_responses(created_at DESC);

-- Create media_analytics_summary table for aggregated media analytics
CREATE TABLE IF NOT EXISTS media_analytics_summary (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    total_media_messages INTEGER DEFAULT 0,
    images_received INTEGER DEFAULT 0,
    videos_received INTEGER DEFAULT 0,
    documents_received INTEGER DEFAULT 0,
    media_responses_sent INTEGER DEFAULT 0,
    product_inquiries_from_media INTEGER DEFAULT 0,
    average_response_time_minutes DECIMAL(8,2),
    media_conversion_rate DECIMAL(5,2),
    top_performing_templates JSONB DEFAULT '[]',
    engagement_by_media_type JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(merchant_id, date)
);

-- Create indexes for media_analytics_summary
CREATE INDEX IF NOT EXISTS idx_media_analytics_merchant ON media_analytics_summary(merchant_id);
CREATE INDEX IF NOT EXISTS idx_media_analytics_date ON media_analytics_summary(date DESC);
CREATE INDEX IF NOT EXISTS idx_media_analytics_merchant_date ON media_analytics_summary(merchant_id, date DESC);

-- Add media-related columns to daily_analytics table
ALTER TABLE daily_analytics 
ADD COLUMN IF NOT EXISTS media_messages_received INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS media_messages_sent INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS product_inquiries_from_media INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS media_response_rate DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS average_media_response_time_minutes DECIMAL(8,2);

-- Create trigger to automatically update media analytics
CREATE OR REPLACE FUNCTION update_media_analytics()
RETURNS TRIGGER AS $$
BEGIN
    -- Update daily analytics for media messages
    INSERT INTO daily_analytics (
        merchant_id,
        date,
        platform,
        media_messages_received,
        media_messages_sent
    ) VALUES (
        NEW.merchant_id,
        CURRENT_DATE,
        'INSTAGRAM',
        CASE WHEN NEW.direction = 'incoming' THEN 1 ELSE 0 END,
        CASE WHEN NEW.direction = 'outgoing' THEN 1 ELSE 0 END
    )
    ON CONFLICT (merchant_id, date, platform)
    DO UPDATE SET
        media_messages_received = daily_analytics.media_messages_received + 
            CASE WHEN NEW.direction = 'incoming' THEN 1 ELSE 0 END,
        media_messages_sent = daily_analytics.media_messages_sent + 
            CASE WHEN NEW.direction = 'outgoing' THEN 1 ELSE 0 END,
        updated_at = NOW();
    
    -- Update media analytics summary
    INSERT INTO media_analytics_summary (
        merchant_id,
        date,
        total_media_messages,
        images_received,
        videos_received,
        documents_received
    ) VALUES (
        NEW.merchant_id,
        CURRENT_DATE,
        1,
        CASE WHEN NEW.media_type = 'image' AND NEW.direction = 'incoming' THEN 1 ELSE 0 END,
        CASE WHEN NEW.media_type = 'video' AND NEW.direction = 'incoming' THEN 1 ELSE 0 END,
        CASE WHEN NEW.media_type = 'document' AND NEW.direction = 'incoming' THEN 1 ELSE 0 END
    )
    ON CONFLICT (merchant_id, date)
    DO UPDATE SET
        total_media_messages = media_analytics_summary.total_media_messages + 1,
        images_received = media_analytics_summary.images_received + 
            CASE WHEN NEW.media_type = 'image' AND NEW.direction = 'incoming' THEN 1 ELSE 0 END,
        videos_received = media_analytics_summary.videos_received + 
            CASE WHEN NEW.media_type = 'video' AND NEW.direction = 'incoming' THEN 1 ELSE 0 END,
        documents_received = media_analytics_summary.documents_received + 
            CASE WHEN NEW.media_type = 'document' AND NEW.direction = 'incoming' THEN 1 ELSE 0 END;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for media_messages
DROP TRIGGER IF EXISTS trigger_update_media_analytics ON media_messages;
CREATE TRIGGER trigger_update_media_analytics
    AFTER INSERT ON media_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_media_analytics();

-- Create function to update template usage analytics
CREATE OR REPLACE FUNCTION update_template_usage()
RETURNS TRIGGER AS $$
BEGIN
    -- Update last_used_at when template is used
    UPDATE media_templates
    SET 
        last_used_at = NOW(),
        updated_at = NOW()
    WHERE id = NEW.template_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for template usage
DROP TRIGGER IF EXISTS trigger_update_template_usage ON media_responses;
CREATE TRIGGER trigger_update_template_usage
    AFTER INSERT ON media_responses
    FOR EACH ROW
    WHEN (NEW.template_id IS NOT NULL)
    EXECUTE FUNCTION update_template_usage();

-- Create function to calculate media engagement scores
CREATE OR REPLACE FUNCTION calculate_media_engagement_score(
    total_media_messages INTEGER,
    responses_sent INTEGER,
    product_inquiries INTEGER,
    last_activity_date TIMESTAMP WITH TIME ZONE
) RETURNS DECIMAL(5,2) AS $$
DECLARE
    base_score DECIMAL(5,2) := 0;
    response_bonus DECIMAL(5,2) := 0;
    inquiry_bonus DECIMAL(5,2) := 0;
    recency_multiplier DECIMAL(5,2) := 1;
BEGIN
    -- Base score from media activity (max 40 points)
    base_score := LEAST(total_media_messages * 5, 40);
    
    -- Response bonus (max 30 points)
    IF total_media_messages > 0 THEN
        response_bonus := (responses_sent::DECIMAL / total_media_messages) * 30;
    END IF;
    
    -- Product inquiry bonus (max 20 points)
    inquiry_bonus := LEAST(product_inquiries * 10, 20);
    
    -- Recency multiplier
    IF last_activity_date > NOW() - INTERVAL '7 days' THEN
        recency_multiplier := 1.0;
    ELSIF last_activity_date > NOW() - INTERVAL '30 days' THEN
        recency_multiplier := 0.8;
    ELSE
        recency_multiplier := 0.6;
    END IF;
    
    RETURN LEAST((base_score + response_bonus + inquiry_bonus) * recency_multiplier, 100);
END;
$$ LANGUAGE plpgsql;

-- Create function to update daily media analytics summary
CREATE OR REPLACE FUNCTION update_daily_media_analytics()
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER := 0;
    merchant_record RECORD;
BEGIN
    FOR merchant_record IN 
        SELECT DISTINCT merchant_id FROM media_messages 
        WHERE DATE(created_at) = CURRENT_DATE
    LOOP
        INSERT INTO media_analytics_summary (
            merchant_id,
            date,
            total_media_messages,
            images_received,
            videos_received,
            documents_received,
            media_responses_sent,
            product_inquiries_from_media,
            average_response_time_minutes,
            media_conversion_rate
        )
        SELECT 
            merchant_record.merchant_id,
            CURRENT_DATE,
            COUNT(*),
            COUNT(CASE WHEN media_type = 'image' AND direction = 'incoming' THEN 1 END),
            COUNT(CASE WHEN media_type = 'video' AND direction = 'incoming' THEN 1 END),
            COUNT(CASE WHEN media_type = 'document' AND direction = 'incoming' THEN 1 END),
            COUNT(CASE WHEN mr.response_type IS NOT NULL THEN 1 END),
            COUNT(CASE WHEN ma.is_product_inquiry THEN 1 END),
            AVG(mr.response_time_seconds / 60.0),
            CASE 
                WHEN COUNT(CASE WHEN direction = 'incoming' THEN 1 END) > 0 THEN
                    (COUNT(CASE WHEN ma.is_product_inquiry THEN 1 END)::DECIMAL / 
                     COUNT(CASE WHEN direction = 'incoming' THEN 1 END)) * 100
                ELSE 0 
            END
        FROM media_messages mm
        LEFT JOIN media_responses mr ON mm.media_id = mr.media_id
        LEFT JOIN media_analysis ma ON mm.media_id = ma.media_id
        WHERE mm.merchant_id = merchant_record.merchant_id
        AND DATE(mm.created_at) = CURRENT_DATE
        GROUP BY mm.merchant_id
        ON CONFLICT (merchant_id, date)
        DO UPDATE SET
            total_media_messages = EXCLUDED.total_media_messages,
            images_received = EXCLUDED.images_received,
            videos_received = EXCLUDED.videos_received,
            documents_received = EXCLUDED.documents_received,
            media_responses_sent = EXCLUDED.media_responses_sent,
            product_inquiries_from_media = EXCLUDED.product_inquiries_from_media,
            average_response_time_minutes = EXCLUDED.average_response_time_minutes,
            media_conversion_rate = EXCLUDED.media_conversion_rate;
        
        updated_count := updated_count + 1;
    END LOOP;
    
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Add performance indexes for complex queries
CREATE INDEX IF NOT EXISTS idx_media_messages_merchant_date_type ON media_messages(merchant_id, DATE(created_at), media_type);
CREATE INDEX IF NOT EXISTS idx_media_analysis_merchant_inquiry ON media_analysis(merchant_id, is_product_inquiry) WHERE is_product_inquiry = TRUE;
CREATE INDEX IF NOT EXISTS idx_media_responses_merchant_date ON media_responses(merchant_id, DATE(created_at));

-- Add comments for documentation
COMMENT ON TABLE media_messages IS 'Tracks all media content (images, videos, documents) exchanged in Instagram conversations';
COMMENT ON TABLE media_analysis IS 'AI analysis results for media content including object detection and sentiment analysis';
COMMENT ON TABLE media_templates IS 'Reusable media templates for marketing and customer engagement';
COMMENT ON TABLE media_responses IS 'Automated responses generated for media messages';
COMMENT ON TABLE media_analytics_summary IS 'Daily aggregated analytics for media engagement and performance';

-- Insert default media templates for merchants with Instagram credentials
INSERT INTO media_templates (merchant_id, name, category, media_type, template_url, description)
SELECT 
    id as merchant_id,
    'ترحيب بالعملاء',
    'greeting',
    'image',
    'https://placeholder.example.com/welcome.jpg',
    'صورة ترحيب للعملاء الجدد'
FROM merchants 
WHERE id IN (SELECT merchant_id FROM merchant_credentials WHERE instagram_token_encrypted IS NOT NULL)
ON CONFLICT DO NOTHING;

INSERT INTO media_templates (merchant_id, name, category, media_type, template_url, description)
SELECT 
    id as merchant_id,
    'عرض المنتجات',
    'product',
    'image',
    'https://placeholder.example.com/products.jpg',
    'صورة عرض المنتجات'
FROM merchants 
WHERE id IN (SELECT merchant_id FROM merchant_credentials WHERE instagram_token_encrypted IS NOT NULL)
ON CONFLICT DO NOTHING;

INSERT INTO media_templates (merchant_id, name, category, media_type, template_url, description)
SELECT 
    id as merchant_id,
    'شكر العملاء',
    'thanks',
    'image',
    'https://placeholder.example.com/thanks.jpg',
    'صورة شكر للعملاء'
FROM merchants 
WHERE id IN (SELECT merchant_id FROM merchant_credentials WHERE instagram_token_encrypted IS NOT NULL)
ON CONFLICT DO NOTHING;

-- Migration completion log
INSERT INTO audit_logs (action, entity_type, details, success)
VALUES (
    'MIGRATION_EXECUTED',
    'DATABASE_SCHEMA',
    '{"migration": "009_instagram_media_infrastructure", "description": "Added Instagram Media-rich conversations support"}',
    TRUE
);