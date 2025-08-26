-- Migration 040: Create Message Windows Table and Functions
-- Date: 2025-08-26
-- Description: Create message_windows table and related functions for WhatsApp 24h window management

BEGIN;

-- Create message_windows table
CREATE TABLE IF NOT EXISTS message_windows (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    customer_phone VARCHAR(20),
    customer_instagram VARCHAR(100),
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('whatsapp', 'instagram')),
    window_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    message_count_in_window INTEGER DEFAULT 0,
    merchant_response_count INTEGER DEFAULT 0,
    is_expired BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure at least one customer identifier is provided
    CONSTRAINT message_windows_customer_check 
        CHECK ((customer_phone IS NOT NULL) OR (customer_instagram IS NOT NULL)),
    
    -- Unique constraint per merchant/customer/platform
    CONSTRAINT message_windows_unique_customer 
        UNIQUE (merchant_id, platform, customer_phone, customer_instagram)
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_message_windows_merchant ON message_windows (merchant_id);
CREATE INDEX IF NOT EXISTS idx_message_windows_platform ON message_windows (platform);
CREATE INDEX IF NOT EXISTS idx_message_windows_expires ON message_windows (window_expires_at);
CREATE INDEX IF NOT EXISTS idx_message_windows_customer_phone ON message_windows (customer_phone) WHERE customer_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_windows_customer_instagram ON message_windows (customer_instagram) WHERE customer_instagram IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_windows_expired ON message_windows (is_expired, window_expires_at);

-- Create function to check message window status
CREATE OR REPLACE FUNCTION check_message_window(
    p_merchant_id uuid,
    p_customer_phone varchar DEFAULT NULL,
    p_customer_instagram varchar DEFAULT NULL,
    p_platform varchar DEFAULT 'whatsapp'
)
RETURNS TABLE (
    can_send_message boolean,
    window_expires_at timestamp with time zone,
    time_remaining_minutes integer,
    message_count_in_window integer,
    merchant_response_count integer
) AS $$
DECLARE
    window_record RECORD;
    remaining_minutes integer;
BEGIN
    -- Find existing window
    SELECT * INTO window_record
    FROM message_windows mw
    WHERE mw.merchant_id = p_merchant_id
    AND mw.platform = p_platform
    AND (
        (p_customer_phone IS NOT NULL AND mw.customer_phone = p_customer_phone) OR
        (p_customer_instagram IS NOT NULL AND mw.customer_instagram = p_customer_instagram)
    );
    
    IF NOT FOUND THEN
        -- No window exists
        RETURN QUERY SELECT false, NULL::timestamp with time zone, NULL::integer, 0, 0;
        RETURN;
    END IF;
    
    -- Calculate remaining time
    remaining_minutes := EXTRACT(EPOCH FROM (window_record.window_expires_at - NOW())) / 60;
    
    -- Check if window is still active
    IF window_record.window_expires_at > NOW() THEN
        RETURN QUERY SELECT 
            true,
            window_record.window_expires_at,
            GREATEST(0, remaining_minutes::integer),
            window_record.message_count_in_window,
            window_record.merchant_response_count;
    ELSE
        -- Window expired
        RETURN QUERY SELECT 
            false,
            window_record.window_expires_at,
            0,
            window_record.message_count_in_window,
            window_record.merchant_response_count;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Create function to update/create message window
CREATE OR REPLACE FUNCTION update_message_window(
    p_merchant_id uuid,
    p_customer_phone varchar DEFAULT NULL,
    p_customer_instagram varchar DEFAULT NULL,
    p_platform varchar DEFAULT 'whatsapp',
    p_message_id uuid DEFAULT NULL
)
RETURNS void AS $$
DECLARE
    window_duration interval := INTERVAL '24 hours';
BEGIN
    -- Insert or update message window
    INSERT INTO message_windows (
        merchant_id,
        customer_phone,
        customer_instagram,
        platform,
        window_expires_at,
        message_count_in_window,
        created_at,
        updated_at
    )
    VALUES (
        p_merchant_id,
        p_customer_phone,
        p_customer_instagram,
        p_platform,
        NOW() + window_duration,
        1,
        NOW(),
        NOW()
    )
    ON CONFLICT (merchant_id, platform, customer_phone, customer_instagram)
    DO UPDATE SET
        window_expires_at = NOW() + window_duration,
        message_count_in_window = message_windows.message_count_in_window + 1,
        is_expired = FALSE,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION update_message_windows_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_message_windows_updated_at ON message_windows;
CREATE TRIGGER trigger_message_windows_updated_at
    BEFORE UPDATE ON message_windows
    FOR EACH ROW
    EXECUTE FUNCTION update_message_windows_updated_at();

-- Add comments
COMMENT ON TABLE message_windows IS 'Manages WhatsApp 24-hour customer service windows and Instagram messaging windows';
COMMENT ON COLUMN message_windows.window_expires_at IS 'When the messaging window expires (24h from last customer message)';
COMMENT ON COLUMN message_windows.message_count_in_window IS 'Number of customer messages in current window';
COMMENT ON COLUMN message_windows.merchant_response_count IS 'Number of merchant responses in current window';

-- Test the functions
DO $$
BEGIN
    -- Test function exists
    PERFORM check_message_window(
        uuid_generate_v4(),
        '+1234567890',
        NULL,
        'whatsapp'
    );
    
    RAISE NOTICE 'Message windows table and functions created successfully';
END $$;

COMMIT;

-- Log success
\echo 'Migration 040: Message windows table and functions created ✅'