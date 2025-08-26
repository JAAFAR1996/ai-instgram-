-- Migration 041: Create Merchant Instagram Mapping Table
-- Date: 2025-08-26
-- Description: Create mapping between merchants and Instagram business accounts

BEGIN;

-- Create merchant_instagram_mapping table
CREATE TABLE IF NOT EXISTS merchant_instagram_mapping (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    page_id VARCHAR(100) NOT NULL,
    business_account_id VARCHAR(100),
    access_token_encrypted TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint per page
    CONSTRAINT merchant_instagram_mapping_page_unique UNIQUE (page_id)
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_merchant_instagram_mapping_merchant ON merchant_instagram_mapping (merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_instagram_mapping_page ON merchant_instagram_mapping (page_id);
CREATE INDEX IF NOT EXISTS idx_merchant_instagram_mapping_business_account ON merchant_instagram_mapping (business_account_id);
CREATE INDEX IF NOT EXISTS idx_merchant_instagram_mapping_active ON merchant_instagram_mapping (is_active);

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION update_merchant_instagram_mapping_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_merchant_instagram_mapping_updated_at ON merchant_instagram_mapping;
CREATE TRIGGER trigger_merchant_instagram_mapping_updated_at
    BEFORE UPDATE ON merchant_instagram_mapping
    FOR EACH ROW
    EXECUTE FUNCTION update_merchant_instagram_mapping_updated_at();

-- Add comments
COMMENT ON TABLE merchant_instagram_mapping IS 'Maps merchants to their Instagram business accounts';
COMMENT ON COLUMN merchant_instagram_mapping.page_id IS 'Instagram page/business account ID from Meta';
COMMENT ON COLUMN merchant_instagram_mapping.business_account_id IS 'Instagram business account ID';
COMMENT ON COLUMN merchant_instagram_mapping.access_token_encrypted IS 'Encrypted access token for Instagram API';

COMMIT;

-- Log success
\echo 'Migration 041: Merchant Instagram mapping table created ✅'