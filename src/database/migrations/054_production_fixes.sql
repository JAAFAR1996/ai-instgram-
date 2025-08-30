-- ===============================================
-- Production Fixes Migration
-- Creates missing tables for Instagram ManyChat Bridge
-- ===============================================

-- Create messages table for message window tracking
CREATE TABLE IF NOT EXISTS messages (
    id SERIAL PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    recipient_id TEXT,
    platform TEXT NOT NULL CHECK (platform IN ('instagram', 'whatsapp', 'facebook')),
    message_type TEXT DEFAULT 'text',
    content TEXT,
    status TEXT DEFAULT 'sent' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create message_followups table for scheduling expired messages
CREATE TABLE IF NOT EXISTS message_followups (
    id SERIAL PRIMARY KEY,
    merchant_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    message TEXT NOT NULL,
    interaction_type TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('instagram', 'whatsapp', 'facebook')),
    scheduled_for TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed', 'cancelled')),
    retry_count INTEGER DEFAULT 0,
    last_retry_at TIMESTAMP,
    error_message TEXT
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_messages_merchant_sender_platform ON messages(merchant_id, sender_id, platform);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_platform_status ON messages(platform, status);

CREATE INDEX IF NOT EXISTS idx_message_followups_merchant_customer ON message_followups(merchant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_message_followups_scheduled_for ON message_followups(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_message_followups_status ON message_followups(status);
CREATE INDEX IF NOT EXISTS idx_message_followups_platform ON message_followups(platform);

-- Add table comments
COMMENT ON TABLE messages IS 'Stores all messages for tracking message windows and interaction history';
COMMENT ON COLUMN messages.sender_id IS 'ID of the message sender (customer/user)';
COMMENT ON COLUMN messages.recipient_id IS 'ID of the message recipient (merchant/business)';
COMMENT ON COLUMN messages.platform IS 'Platform where message was sent (instagram, whatsapp, facebook)';

COMMENT ON TABLE message_followups IS 'Stores messages scheduled for follow-up delivery when message window expires';
COMMENT ON COLUMN message_followups.customer_id IS 'Instagram/social media customer ID';
COMMENT ON COLUMN message_followups.interaction_type IS 'Type of interaction: dm, comment, story_reply, story_mention';
COMMENT ON COLUMN message_followups.scheduled_for IS 'When to attempt delivery (usually 24+ hours after original)';
COMMENT ON COLUMN message_followups.retry_count IS 'Number of retry attempts made';

-- Insert sample data to test the schema (will be removed in production)
-- This helps verify the tables work correctly
INSERT INTO messages (merchant_id, sender_id, platform, content, status) 
VALUES ('test-merchant', 'test-sender', 'instagram', 'Test message for schema validation', 'sent')
ON CONFLICT DO NOTHING;

-- Clean up test data immediately
DELETE FROM messages WHERE merchant_id = 'test-merchant' AND sender_id = 'test-sender';