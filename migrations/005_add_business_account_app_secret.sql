BEGIN;
ALTER TABLE merchant_credentials
  ADD COLUMN IF NOT EXISTS business_account_id TEXT,
  ADD COLUMN IF NOT EXISTS app_secret TEXT;
COMMIT;