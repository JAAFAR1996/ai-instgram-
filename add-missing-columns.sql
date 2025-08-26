-- Add missing columns to message_logs table
BEGIN;

-- Add ai_confidence column
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS ai_confidence DECIMAL(3,2);

-- Add ai_intent column  
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS ai_intent VARCHAR(50);

-- Add processing_time_ms column
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS processing_time_ms INTEGER;

-- Add metadata column
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id uuid REFERENCES merchants(id) ON DELETE CASCADE,
    user_id VARCHAR(100),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(255),
    details JSONB,
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_message_logs_ai_confidence ON message_logs (ai_confidence);
CREATE INDEX IF NOT EXISTS idx_message_logs_ai_intent ON message_logs (ai_intent);
CREATE INDEX IF NOT EXISTS idx_message_logs_metadata ON message_logs USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_audit_logs_merchant ON audit_logs (merchant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at DESC);

-- Enable RLS on audit_logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Add RLS policy
DROP POLICY IF EXISTS "audit_logs_tenant_isolation" ON audit_logs;
CREATE POLICY "audit_logs_tenant_isolation" ON audit_logs
  FOR ALL 
  USING (
    merchant_id::text = current_setting('app.current_merchant_id', true)
    OR merchant_id IS NULL 
    OR current_setting('app.admin_mode', true) = 'true'
  );

COMMIT;

SELECT 'Missing columns and audit_logs table added successfully' as result;