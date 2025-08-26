/**
 * ===============================================
 * Migration 034: Fix WhatsApp Number Constraints
 * ===============================================
 * 
 * This migration resolves the constraint conflicts for whatsapp_number:
 * - 001_initial_schema.sql: NOT NULL constraint
 * - 029_fix_whatsapp_number_nullable.sql: Makes it NULLABLE
 * 
 * This migration ensures consistency and proper constraint handling.
 */

-- First, check current state of whatsapp_number column
DO $$
DECLARE
    is_nullable BOOLEAN;
BEGIN
    -- Check if whatsapp_number is currently nullable
    SELECT is_nullable = 'YES' 
    INTO is_nullable
    FROM information_schema.columns 
    WHERE table_name = 'merchants' 
    AND column_name = 'whatsapp_number';
    
    -- If it's NOT NULL, make it nullable (as intended by 029)
    IF NOT is_nullable THEN
        ALTER TABLE merchants ALTER COLUMN whatsapp_number DROP NOT NULL;
        RAISE NOTICE 'Made whatsapp_number nullable';
    ELSE
        RAISE NOTICE 'whatsapp_number is already nullable';
    END IF;
END $$;

-- Add check constraint to ensure at least one contact method is provided
ALTER TABLE merchants DROP CONSTRAINT IF EXISTS check_merchant_contact_method;
ALTER TABLE merchants ADD CONSTRAINT check_merchant_contact_method 
CHECK (
    whatsapp_number IS NOT NULL OR 
    email IS NOT NULL OR 
    phone IS NOT NULL
);

-- Add validation for whatsapp_number format when not null
ALTER TABLE merchants DROP CONSTRAINT IF EXISTS check_whatsapp_number_format;
ALTER TABLE merchants ADD CONSTRAINT check_whatsapp_number_format 
CHECK (
    whatsapp_number IS NULL OR 
    (whatsapp_number ~ '^\+[1-9]\d{1,14}$' AND LENGTH(whatsapp_number) <= 20)
);

-- Update existing records to ensure they have at least one contact method
UPDATE merchants 
SET email = COALESCE(email, 'contact@merchant.local')
WHERE whatsapp_number IS NULL 
  AND email IS NULL 
  AND phone IS NULL;

-- Add index for whatsapp_number lookups (only for non-null values)
CREATE INDEX IF NOT EXISTS idx_merchants_whatsapp_number_not_null 
ON merchants(whatsapp_number) 
WHERE whatsapp_number IS NOT NULL;

-- Create function to validate and format whatsapp numbers
CREATE OR REPLACE FUNCTION format_whatsapp_number(input_number TEXT)
RETURNS TEXT AS $$
DECLARE
    cleaned_number TEXT;
    formatted_number TEXT;
BEGIN
    -- Remove all non-digit characters except +
    cleaned_number := REGEXP_REPLACE(input_number, '[^0-9+]', '', 'g');
    
    -- Ensure it starts with +
    IF cleaned_number NOT LIKE '+%' THEN
        cleaned_number := '+' || cleaned_number;
    END IF;
    
    -- Validate format
    IF cleaned_number ~ '^\+[1-9]\d{1,14}$' THEN
        formatted_number := cleaned_number;
    ELSE
        RAISE EXCEPTION 'Invalid WhatsApp number format: %. Expected format: +1234567890', input_number;
    END IF;
    
    RETURN formatted_number;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create function to set whatsapp_number with validation
CREATE OR REPLACE FUNCTION set_merchant_whatsapp_number(
    merchant_id UUID,
    whatsapp_number TEXT
)
RETURNS VOID AS $$
DECLARE
    formatted_number TEXT;
BEGIN
    -- Format and validate the number
    IF whatsapp_number IS NOT NULL THEN
        formatted_number := format_whatsapp_number(whatsapp_number);
    END IF;
    
    -- Update the merchant
    UPDATE merchants 
    SET whatsapp_number = formatted_number,
        updated_at = NOW()
    WHERE id = merchant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Merchant with ID % not found', merchant_id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION format_whatsapp_number(TEXT) TO app_user;
GRANT EXECUTE ON FUNCTION set_merchant_whatsapp_number(UUID, TEXT) TO app_user;

-- Add comments for documentation
COMMENT ON COLUMN merchants.whatsapp_number IS 'WhatsApp phone number in international format (e.g., +1234567890). Optional if other contact methods are provided.';
COMMENT ON CONSTRAINT check_merchant_contact_method ON merchants IS 'Ensures merchant has at least one contact method (whatsapp, email, or phone)';
COMMENT ON CONSTRAINT check_whatsapp_number_format ON merchants IS 'Validates WhatsApp number format when provided';
COMMENT ON FUNCTION format_whatsapp_number(TEXT) IS 'Formats and validates WhatsApp number to international format';
COMMENT ON FUNCTION set_merchant_whatsapp_number(UUID, TEXT) IS 'Sets merchant WhatsApp number with validation';

-- Insert migration record
INSERT INTO schema_migrations (version, applied_at, success)
VALUES ('034_fix_whatsapp_number_constraints.sql', NOW(), TRUE)
ON CONFLICT (version) DO NOTHING;
