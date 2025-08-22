/**
 * Migration 029: Fix whatsapp_number nullable constraint
 * Makes whatsapp_number nullable for testing and optional merchants
 */

-- Make whatsapp_number nullable (remove NOT NULL constraint)
ALTER TABLE merchants 
ALTER COLUMN whatsapp_number DROP NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN merchants.whatsapp_number IS 'WhatsApp phone number for merchant (optional for testing)';