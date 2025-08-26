-- Create merchant_credentials table
BEGIN;

-- Create merchant_credentials table
CREATE TABLE IF NOT EXISTS merchant_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    instagram_page_id VARCHAR(100),
    instagram_business_account_id VARCHAR(100),
    business_account_id VARCHAR(100),
    instagram_token_encrypted TEXT,
    app_secret TEXT,
    webhook_verify_token VARCHAR(100),
    platform VARCHAR(20) DEFAULT 'instagram',
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT merchant_credentials_platform_check CHECK (platform IN ('instagram', 'whatsapp', 'facebook')),
    
    -- Unique constraints
    CONSTRAINT merchant_credentials_merchant_page_unique UNIQUE (merchant_id, instagram_page_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_merchant_credentials_merchant ON merchant_credentials (merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_credentials_page ON merchant_credentials (instagram_page_id);
CREATE INDEX IF NOT EXISTS idx_merchant_credentials_business_account ON merchant_credentials (business_account_id);
CREATE INDEX IF NOT EXISTS idx_merchant_credentials_active ON merchant_credentials (is_active);

-- Enable RLS
ALTER TABLE merchant_credentials ENABLE ROW LEVEL SECURITY;

-- Add RLS policies
DROP POLICY IF EXISTS "merchant_credentials_tenant_isolation" ON merchant_credentials;
CREATE POLICY "merchant_credentials_tenant_isolation" ON merchant_credentials
  FOR ALL 
  USING (
    merchant_id::text = current_setting('app.current_merchant_id', true)
    OR current_setting('app.admin_mode', true) = 'true'
  );

-- Insert test data for existing merchant
DO $$
DECLARE
    existing_merchant_id UUID;
BEGIN
    -- Get the existing merchant ID
    SELECT id INTO existing_merchant_id FROM merchants LIMIT 1;
    
    IF existing_merchant_id IS NOT NULL THEN
        -- Insert credentials for Instagram page
        INSERT INTO merchant_credentials (
            merchant_id,
            instagram_page_id,
            instagram_business_account_id,
            business_account_id,
            platform,
            is_active
        ) VALUES (
            existing_merchant_id,
            '17841405545604018',
            '17841405545604018',
            '17841405545604018',
            'instagram',
            true
        ) ON CONFLICT (merchant_id, instagram_page_id) DO UPDATE SET
            updated_at = NOW(),
            is_active = true;
            
        RAISE NOTICE 'Merchant credentials created for merchant: %', existing_merchant_id;
    END IF;
END $$;

COMMIT;

SELECT 'merchant_credentials table created successfully' as result;