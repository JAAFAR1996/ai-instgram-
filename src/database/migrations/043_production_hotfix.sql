-- Migration 043: Production Hotfix - Add missing columns and tables
-- Date: 2025-08-26
-- Description: Fix missing ai_confidence column and audit_logs table

BEGIN;

-- Add missing AI columns to message_logs if they don't exist
DO $$
BEGIN
    -- Add ai_confidence column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'message_logs' AND column_name = 'ai_confidence') THEN
        ALTER TABLE message_logs ADD COLUMN ai_confidence DECIMAL(3,2);
        CREATE INDEX idx_message_logs_ai_confidence ON message_logs (ai_confidence);
        COMMENT ON COLUMN message_logs.ai_confidence IS 'AI confidence score (0.00-1.00) for generated responses';
    END IF;

    -- Add ai_intent column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'message_logs' AND column_name = 'ai_intent') THEN
        ALTER TABLE message_logs ADD COLUMN ai_intent VARCHAR(50);
        CREATE INDEX idx_message_logs_ai_intent ON message_logs (ai_intent);
        COMMENT ON COLUMN message_logs.ai_intent IS 'Detected customer intent from AI analysis';
    END IF;

    -- Add processing_time_ms column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'message_logs' AND column_name = 'processing_time_ms') THEN
        ALTER TABLE message_logs ADD COLUMN processing_time_ms INTEGER;
        COMMENT ON COLUMN message_logs.processing_time_ms IS 'Time taken to process message in milliseconds';
    END IF;

    -- Add metadata column
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'message_logs' AND column_name = 'metadata') THEN
        ALTER TABLE message_logs ADD COLUMN metadata JSONB;
        CREATE INDEX idx_message_logs_metadata ON message_logs USING GIN (metadata);
        COMMENT ON COLUMN message_logs.metadata IS 'Additional metadata (media info, quick replies, etc.)';
    END IF;
END
$$;

-- Create audit_logs table if it doesn't exist
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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT audit_logs_action_check CHECK (action IN (
        'CREATE', 'READ', 'UPDATE', 'DELETE',
        'LOGIN', 'LOGOUT', 'WEBHOOK_RECEIVED',
        'MESSAGE_SENT', 'MESSAGE_RECEIVED',
        'INSTAGRAM_AUTH', 'WHATSAPP_AUTH',
        'API_CALL', 'SYSTEM_EVENT'
    ))
);

-- Add indexes for audit_logs if they don't exist
CREATE INDEX IF NOT EXISTS idx_audit_logs_merchant ON audit_logs (merchant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_success ON audit_logs (success);

-- Enable RLS on audit_logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Add RLS policies for audit_logs
DROP POLICY IF EXISTS "audit_logs_tenant_isolation" ON audit_logs;
CREATE POLICY "audit_logs_tenant_isolation" ON audit_logs
  FOR ALL 
  USING (
    merchant_id::text = current_setting('app.current_merchant_id', true)
    OR merchant_id IS NULL 
    OR current_setting('app.admin_mode', true) = 'true'
  );

COMMIT;

-- Log success
\echo 'Migration 043: Production hotfix applied ✅'