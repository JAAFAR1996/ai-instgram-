-- Migration 023: Add business_account_id to merchant_credentials
ALTER TABLE merchant_credentials
  ADD COLUMN IF NOT EXISTS business_account_id TEXT;

INSERT INTO migrations (name, filename) VALUES (
  'Add business_account_id to merchant_credentials',
  '023_add_business_account_id_to_merchant_credentials.sql'
);