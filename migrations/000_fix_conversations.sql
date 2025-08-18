BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID,
  customer_id VARCHAR(255),
  platform VARCHAR(50) DEFAULT 'instagram',
  status VARCHAR(50) DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- أضف الأعمدة إن كانت ناقصة
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS customer_id VARCHAR(255);
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS platform VARCHAR(50) DEFAULT 'instagram';
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_conversations_customer_id ON conversations(customer_id);

COMMIT;