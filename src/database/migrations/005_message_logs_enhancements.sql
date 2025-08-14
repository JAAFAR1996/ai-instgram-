-- Message Logs Enhancements for Instagram Integration
-- Add AI-related and Instagram-specific columns

-- Add AI-related columns
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS ai_confidence DECIMAL(3,2);
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS ai_intent VARCHAR(50);
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS processing_time_ms INTEGER;
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_message_logs_ai_confidence ON message_logs (ai_confidence);
CREATE INDEX IF NOT EXISTS idx_message_logs_ai_intent ON message_logs (ai_intent);
CREATE INDEX IF NOT EXISTS idx_message_logs_metadata ON message_logs USING GIN (metadata);

-- Add comments for documentation
COMMENT ON COLUMN message_logs.ai_confidence IS 'AI confidence score (0.00-1.00) for generated responses';
COMMENT ON COLUMN message_logs.ai_intent IS 'Detected customer intent from AI analysis';
COMMENT ON COLUMN message_logs.processing_time_ms IS 'Time taken to process message in milliseconds';
COMMENT ON COLUMN message_logs.metadata IS 'Additional metadata (media info, quick replies, etc.)';

-- Update message_logs table constraints for Instagram message types (if not already updated)
ALTER TABLE message_logs DROP CONSTRAINT IF EXISTS message_logs_message_type_check;

ALTER TABLE message_logs ADD CONSTRAINT message_logs_message_type_check 
CHECK (message_type IN (
  'TEXT', 
  'IMAGE', 
  'VIDEO', 
  'AUDIO', 
  'DOCUMENT', 
  'STICKER', 
  'LOCATION', 
  'CONTACT',
  'STORY_REPLY',
  'STORY_MENTION', 
  'COMMENT',
  'TEMPLATE'
));

-- Add delivery status constraint if not exists
ALTER TABLE message_logs DROP CONSTRAINT IF EXISTS message_logs_delivery_status_check;

ALTER TABLE message_logs ADD CONSTRAINT message_logs_delivery_status_check 
CHECK (delivery_status IN (
  'PENDING',
  'SENT', 
  'DELIVERED',
  'READ',
  'FAILED',
  'EXPIRED'
));

-- Create view for AI message analytics
CREATE OR REPLACE VIEW ai_message_analytics AS
SELECT 
  m.id as merchant_id,
  m.business_name,
  c.platform,
  ml.ai_intent,
  COUNT(*) as message_count,
  AVG(ml.ai_confidence) as avg_confidence,
  AVG(ml.processing_time_ms) as avg_processing_time,
  COUNT(CASE WHEN ml.delivery_status = 'DELIVERED' THEN 1 END) as delivered_count,
  COUNT(CASE WHEN ml.delivery_status = 'READ' THEN 1 END) as read_count,
  ROUND(
    COUNT(CASE WHEN ml.delivery_status IN ('DELIVERED', 'READ') THEN 1 END)::numeric / 
    COUNT(*)::numeric * 100, 2
  ) as delivery_success_rate
FROM merchants m
JOIN conversations c ON m.id = c.merchant_id
JOIN message_logs ml ON c.id = ml.conversation_id
WHERE ml.direction = 'OUTGOING'
AND ml.ai_processed = true
GROUP BY m.id, m.business_name, c.platform, ml.ai_intent;

-- Create view for Instagram message statistics
CREATE OR REPLACE VIEW instagram_message_stats AS
SELECT 
  m.id as merchant_id,
  m.business_name,
  COUNT(*) as total_messages,
  COUNT(CASE WHEN ml.direction = 'OUTGOING' THEN 1 END) as sent_messages,
  COUNT(CASE WHEN ml.direction = 'INCOMING' THEN 1 END) as received_messages,
  COUNT(DISTINCT c.customer_instagram) as unique_customers,
  COUNT(CASE WHEN ml.message_type = 'TEXT' THEN 1 END) as text_messages,
  COUNT(CASE WHEN ml.message_type IN ('IMAGE', 'VIDEO', 'AUDIO') THEN 1 END) as media_messages,
  COUNT(CASE WHEN ml.message_type = 'TEMPLATE' THEN 1 END) as template_messages,
  COUNT(CASE WHEN ml.message_type IN ('STORY_REPLY', 'STORY_MENTION') THEN 1 END) as story_interactions,
  COUNT(CASE WHEN ml.message_type = 'COMMENT' THEN 1 END) as comment_interactions,
  AVG(LENGTH(ml.content)) as avg_message_length,
  MAX(ml.created_at) as last_message_at
FROM merchants m
JOIN conversations c ON m.id = c.merchant_id
JOIN message_logs ml ON c.id = ml.conversation_id
WHERE c.platform = 'INSTAGRAM'
GROUP BY m.id, m.business_name;

-- Create function to get message window status with Instagram support
CREATE OR REPLACE FUNCTION get_instagram_message_window_status(
  p_merchant_id UUID,
  p_customer_instagram VARCHAR(100)
)
RETURNS TABLE(
  can_send BOOLEAN,
  window_expires_at TIMESTAMPTZ,
  time_remaining_hours INTEGER,
  message_count INTEGER,
  response_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    mw.window_expires_at > NOW() as can_send,
    mw.window_expires_at,
    GREATEST(0, EXTRACT(EPOCH FROM (mw.window_expires_at - NOW()))/3600)::INTEGER as time_remaining_hours,
    mw.message_count_in_window,
    mw.merchant_response_count
  FROM message_windows mw
  WHERE mw.merchant_id = p_merchant_id
  AND mw.customer_instagram = p_customer_instagram
  AND mw.platform = 'INSTAGRAM'
  ORDER BY mw.updated_at DESC
  LIMIT 1;
  
  -- If no window found, return default values
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::TIMESTAMPTZ, 0, 0, 0;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create function to update message delivery status
CREATE OR REPLACE FUNCTION update_message_delivery_status(
  p_platform_message_id VARCHAR(255),
  p_new_status VARCHAR(20)
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE message_logs 
  SET 
    delivery_status = p_new_status,
    updated_at = NOW()
  WHERE platform_message_id = p_platform_message_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Insert migration record
INSERT INTO migrations (name, filename) 
VALUES ('Message Logs Enhancements for Instagram', '005_message_logs_enhancements.sql');