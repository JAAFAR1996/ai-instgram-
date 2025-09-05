-- Migration 024: Add business_description to merchants
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS business_description TEXT;

INSERT INTO migrations (name, filename) VALUES (
  'Add business_description to merchants',
  '024_add_business_description_to_merchants.sql'
);
