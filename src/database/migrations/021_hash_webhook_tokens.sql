BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE merchant_credentials
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'instagram';

-- Set platform based on existing credential data
UPDATE merchant_credentials
SET platform = 'whatsapp'
WHERE whatsapp_token_encrypted IS NOT NULL;

UPDATE merchant_credentials
SET platform = 'instagram'
WHERE whatsapp_token_encrypted IS NULL;

-- Hash existing webhook verification tokens
UPDATE merchant_credentials
SET webhook_verify_token = encode(digest(webhook_verify_token::bytea, 'sha256'), 'hex')
WHERE webhook_verify_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_merchant_credentials_platform_token
  ON merchant_credentials(platform, webhook_verify_token);

ALTER TABLE merchant_credentials
  ADD CONSTRAINT uq_merchant_credentials_merchant_platform
  UNIQUE (merchant_id, platform);

COMMENT ON COLUMN merchant_credentials.webhook_verify_token IS 'SHA-256 hash of webhook verification token';
COMMENT ON COLUMN merchant_credentials.platform IS 'Credential platform (instagram or whatsapp)';

COMMIT;