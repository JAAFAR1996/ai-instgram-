-- Migration 023: Add business_account_id and platform to merchant_credentials
ALTER TABLE merchant_credentials
  ADD COLUMN IF NOT EXISTS business_account_id TEXT,
  ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'INSTAGRAM' CHECK (platform IN ('INSTAGRAM', 'WHATSAPP'));

-- Update existing records to have INSTAGRAM platform if null
UPDATE merchant_credentials 
SET platform = 'INSTAGRAM' 
WHERE platform IS NULL;

-- Make platform NOT NULL after setting default values
ALTER TABLE merchant_credentials 
  ALTER COLUMN platform SET NOT NULL;

-- Create unique index for ON CONFLICT support
CREATE UNIQUE INDEX IF NOT EXISTS ux_mc_merchant_page
  ON merchant_credentials (merchant_id, instagram_page_id);

INSERT INTO migrations (name, filename) VALUES (
  'Add business_account_id and platform to merchant_credentials',
  '023_add_business_account_id_to_merchant_credentials.sql'
)
ON CONFLICT (name) DO NOTHING;