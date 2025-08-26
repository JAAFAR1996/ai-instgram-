-- Create merchant_service_status table
BEGIN;

-- Create merchant_service_status table
CREATE TABLE IF NOT EXISTS merchant_service_status (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    service_name VARCHAR(100) NOT NULL,
    enabled BOOLEAN DEFAULT true,
    configuration JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT merchant_service_status_service_check CHECK (service_name IN (
        'AI_RESPONSES',
        'INSTAGRAM_MESSAGING', 
        'WHATSAPP_MESSAGING',
        'AUTO_REPLY',
        'CONVERSATION_TRACKING',
        'ANALYTICS',
        'NOTIFICATIONS'
    )),
    
    -- Unique constraint per merchant/service
    CONSTRAINT merchant_service_status_unique UNIQUE (merchant_id, service_name)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_merchant_service_status_merchant ON merchant_service_status (merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_service_status_service ON merchant_service_status (service_name);
CREATE INDEX IF NOT EXISTS idx_merchant_service_status_enabled ON merchant_service_status (enabled);

-- Enable RLS
ALTER TABLE merchant_service_status ENABLE ROW LEVEL SECURITY;

-- Add RLS policies
DROP POLICY IF EXISTS "merchant_service_status_tenant_isolation" ON merchant_service_status;
CREATE POLICY "merchant_service_status_tenant_isolation" ON merchant_service_status
  FOR ALL 
  USING (
    merchant_id::text = current_setting('app.current_merchant_id', true)
    OR current_setting('app.admin_mode', true) = 'true'
  );

-- Insert default services for existing merchant
DO $$
DECLARE
    existing_merchant_id UUID;
BEGIN
    -- Get the existing merchant ID
    SELECT id INTO existing_merchant_id FROM merchants LIMIT 1;
    
    IF existing_merchant_id IS NOT NULL THEN
        -- Insert default services
        INSERT INTO merchant_service_status (merchant_id, service_name, enabled) VALUES 
            (existing_merchant_id, 'AI_RESPONSES', true),
            (existing_merchant_id, 'INSTAGRAM_MESSAGING', true),
            (existing_merchant_id, 'AUTO_REPLY', true),
            (existing_merchant_id, 'CONVERSATION_TRACKING', true),
            (existing_merchant_id, 'ANALYTICS', true),
            (existing_merchant_id, 'NOTIFICATIONS', true)
        ON CONFLICT (merchant_id, service_name) DO UPDATE SET
            updated_at = NOW(),
            enabled = true;
            
        RAISE NOTICE 'Service status configured for merchant: %', existing_merchant_id;
    END IF;
END $$;

COMMIT;

SELECT 'merchant_service_status table created successfully' as result;