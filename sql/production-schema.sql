-- ===============================================
-- Production Database Schema for Instagram AI Sales
-- تخزين مشفّر وقابل للتجديد
-- ===============================================

-- Extension for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===============================================
-- Instagram Accounts Table
-- ===============================================
CREATE TABLE ig_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL,          -- ربط مع merchants
  ig_user_id TEXT NOT NULL UNIQUE,    -- من /me
  username TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX idx_ig_accounts_merchant_id ON ig_accounts(merchant_id);
CREATE INDEX idx_ig_accounts_ig_user_id ON ig_accounts(ig_user_id);

-- ===============================================
-- Instagram Tokens Table (Encrypted Storage)
-- ===============================================
CREATE TABLE ig_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ig_account_id UUID REFERENCES ig_accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('short','long')),
  access_token_enc BYTEA NOT NULL,    -- مشفَّر AES-GCM
  expires_at TIMESTAMPTZ,             -- للـ long-lived (≈60 يوم)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for token management
CREATE INDEX idx_ig_tokens_account_id ON ig_tokens(ig_account_id);
CREATE INDEX idx_ig_tokens_kind ON ig_tokens(kind);
CREATE INDEX idx_ig_tokens_expires_at ON ig_tokens(expires_at);

-- ===============================================
-- Instagram Webhook Log
-- ===============================================
CREATE TABLE ig_webhook_log (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  body JSONB NOT NULL,
  signature_valid BOOLEAN NOT NULL DEFAULT false,
  processed BOOLEAN NOT NULL DEFAULT false,
  received_at TIMESTAMPTZ DEFAULT now()
);

-- Index for webhook processing
CREATE INDEX idx_ig_webhook_log_event_type ON ig_webhook_log(event_type);
CREATE INDEX idx_ig_webhook_log_received_at ON ig_webhook_log(received_at);
CREATE INDEX idx_ig_webhook_log_processed ON ig_webhook_log(processed);

-- ===============================================
-- Instagram Conversations (24h Window Tracking)
-- ===============================================
CREATE TABLE ig_conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ig_account_id UUID REFERENCES ig_accounts(id) ON DELETE CASCADE,
  customer_igsid TEXT NOT NULL,       -- IGSID للمستلم
  last_incoming_at TIMESTAMPTZ,       -- آخر رسالة واردة (للنافذة 24h)
  last_outgoing_at TIMESTAMPTZ,       -- آخر رسالة صادرة
  message_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Unique constraint for conversation tracking
CREATE UNIQUE INDEX idx_ig_conversations_unique ON ig_conversations(ig_account_id, customer_igsid);
CREATE INDEX idx_ig_conversations_last_incoming ON ig_conversations(last_incoming_at);

-- ===============================================
-- Instagram Messages Log
-- ===============================================
CREATE TABLE ig_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES ig_conversations(id) ON DELETE CASCADE,
  message_id TEXT,                    -- Instagram message ID
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  content TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT now(),
  delivered BOOLEAN DEFAULT false,
  failed BOOLEAN DEFAULT false,
  error_details JSONB
);

-- Index for message tracking
CREATE INDEX idx_ig_messages_conversation_id ON ig_messages(conversation_id);
CREATE INDEX idx_ig_messages_direction ON ig_messages(direction);
CREATE INDEX idx_ig_messages_sent_at ON ig_messages(sent_at);

-- ===============================================
-- Token Refresh Schedule
-- ===============================================
CREATE TABLE ig_token_refresh_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ig_account_id UUID REFERENCES ig_accounts(id) ON DELETE CASCADE,
  old_expires_at TIMESTAMPTZ,
  new_expires_at TIMESTAMPTZ,
  refresh_success BOOLEAN NOT NULL,
  error_details JSONB,
  refreshed_at TIMESTAMPTZ DEFAULT now()
);

-- Index for refresh monitoring
CREATE INDEX idx_ig_token_refresh_log_account_id ON ig_token_refresh_log(ig_account_id);
CREATE INDEX idx_ig_token_refresh_log_refreshed_at ON ig_token_refresh_log(refreshed_at);

-- ===============================================
-- Functions for automatic timestamp updates
-- ===============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_ig_accounts_updated_at BEFORE UPDATE ON ig_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_ig_tokens_updated_at BEFORE UPDATE ON ig_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_ig_conversations_updated_at BEFORE UPDATE ON ig_conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===============================================
-- Views for easier queries
-- ===============================================

-- Active tokens that need refresh soon
CREATE VIEW ig_tokens_needing_refresh AS
SELECT 
  t.id,
  t.ig_account_id,
  a.username,
  t.expires_at,
  (t.expires_at - INTERVAL '7 days') AS refresh_threshold
FROM ig_tokens t
JOIN ig_accounts a ON t.ig_account_id = a.id
WHERE t.kind = 'long'
  AND t.expires_at IS NOT NULL
  AND t.expires_at <= (now() + INTERVAL '7 days');

-- Active conversations within 24h window
CREATE VIEW ig_active_conversations AS
SELECT 
  c.*,
  a.username,
  (c.last_incoming_at > (now() - INTERVAL '24 hours')) AS within_24h_window
FROM ig_conversations c
JOIN ig_accounts a ON c.ig_account_id = a.id
WHERE c.last_incoming_at IS NOT NULL;

-- ===============================================
-- Row-Level Security (RLS) Setup
-- ===============================================
ALTER TABLE ig_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ig_messages ENABLE ROW LEVEL SECURITY;

-- Basic RLS policies (adjust based on your auth system)
CREATE POLICY ig_accounts_tenant_isolation ON ig_accounts
  FOR ALL USING (merchant_id = current_setting('app.current_merchant_id', true)::UUID);

CREATE POLICY ig_tokens_via_accounts ON ig_tokens
  FOR ALL USING (
    ig_account_id IN (
      SELECT id FROM ig_accounts 
      WHERE merchant_id = current_setting('app.current_merchant_id', true)::UUID
    )
  );

-- ===============================================
-- Performance Optimizations
-- ===============================================

-- Partial indexes for active data
CREATE INDEX idx_ig_tokens_active_long ON ig_tokens(ig_account_id, expires_at) 
  WHERE kind = 'long' AND expires_at > now();

CREATE INDEX idx_ig_conversations_active ON ig_conversations(ig_account_id, last_incoming_at) 
  WHERE last_incoming_at > (now() - INTERVAL '24 hours');

-- ===============================================
-- Sample Data Cleanup Jobs (for maintenance)
-- ===============================================

-- Function to clean old webhook logs (keep 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_webhook_logs()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM ig_webhook_log 
  WHERE received_at < (now() - INTERVAL '30 days');
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to clean expired tokens
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM ig_tokens 
  WHERE expires_at IS NOT NULL 
    AND expires_at < (now() - INTERVAL '7 days');
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ===============================================
-- Comments for documentation
-- ===============================================
COMMENT ON TABLE ig_accounts IS 'Instagram business accounts connected via OAuth';
COMMENT ON TABLE ig_tokens IS 'Encrypted Instagram access tokens (short/long-lived)';
COMMENT ON TABLE ig_webhook_log IS 'All Instagram webhook events for debugging';
COMMENT ON TABLE ig_conversations IS 'Customer conversations with 24h window tracking';
COMMENT ON TABLE ig_messages IS 'Individual messages sent/received';
COMMENT ON COLUMN ig_tokens.access_token_enc IS 'AES-GCM encrypted access token';
COMMENT ON COLUMN ig_conversations.last_incoming_at IS 'Critical for 24h messaging window compliance';

-- ===============================================
-- Merchants Table
-- ===============================================
CREATE TABLE IF NOT EXISTS merchants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ===============================================
-- Products Table
-- ===============================================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(12,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ===============================================
-- Conversations Table (General, not IG-specific)
-- ===============================================
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  customer_id UUID,
  channel TEXT NOT NULL, -- e.g. 'instagram', 'whatsapp', 'web'
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ===============================================
-- Message Logs Table (General)
-- ===============================================
CREATE TABLE IF NOT EXISTS message_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID,
  receiver_id UUID,
  message TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT now(),
  delivered BOOLEAN DEFAULT false,
  failed BOOLEAN DEFAULT false,
  error_details JSONB
);

-- ===============================================
-- Audit Logs Table
-- ===============================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  performed_by UUID,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);