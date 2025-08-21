-- Migration 021: Add business account and app secret to merchant_credentials

ALTER TABLE merchant_credentials
  ADD COLUMN IF NOT EXISTS business_account_id TEXT,
  ADD COLUMN IF NOT EXISTS app_secret TEXT;

INSERT INTO migrations (name, filename) VALUES ('Add business account and app secret to merchant_credentials', '021_add_business_account_app_secret.sql');