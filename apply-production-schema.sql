-- ===============================================
-- PRODUCTION SCHEMA FIX - Apply Directly in Render
-- Copy and paste this SQL into Render Database Console
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

-- Verify tables were created
SELECT 'messages table created' as status WHERE EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'messages'
);

SELECT 'message_followups table created' as status WHERE EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'message_followups'
);

-- Show table counts
SELECT 'Tables ready for production' as message;