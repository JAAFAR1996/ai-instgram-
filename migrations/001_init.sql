-- Initial schema migration
-- Creates core tables for AI Sales Platform

BEGIN;

-- Merchants table (using UUID for production)
CREATE TABLE IF NOT EXISTS merchants (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  whatsapp_phone_number VARCHAR(50),
  instagram_business_account_id VARCHAR(100),
  subscription_status VARCHAR(50) DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Merchant credentials table
CREATE TABLE IF NOT EXISTS merchant_credentials (
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  instagram_page_id VARCHAR(100) PRIMARY KEY,
  instagram_business_account_id VARCHAR(100),
  business_account_id TEXT,
  app_secret TEXT,
  page_access_token TEXT,
  webhook_verify_token VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  customer_id VARCHAR(255) NOT NULL,
  platform VARCHAR(50) NOT NULL,
  status VARCHAR(50) DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_type VARCHAR(50) NOT NULL,
  content TEXT,
  message_type VARCHAR(50),
  platform_message_id VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Webhook logs table for debugging
CREATE TABLE IF NOT EXISTS webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES merchants(id),
  platform VARCHAR(50),
  event_type VARCHAR(100),
  status VARCHAR(50),
  details JSONB,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES merchants(id),
  action VARCHAR(100),
  entity_type VARCHAR(100),
  entity_id VARCHAR(255),
  details JSONB,
  performed_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_conversations_merchant_id ON conversations(merchant_id);
CREATE INDEX IF NOT EXISTS idx_conversations_customer_id ON conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_merchant_id ON webhook_logs(merchant_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_processed_at ON webhook_logs(processed_at);
CREATE INDEX IF NOT EXISTS idx_merchant_credentials_merchant_id ON merchant_credentials(merchant_id);

COMMIT;