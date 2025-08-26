-- Migration 042: Create Audit Logs Table
-- Date: 2025-08-26
-- Description: Create audit_logs table for security and compliance tracking

BEGIN;

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id uuid REFERENCES merchants(id) ON DELETE CASCADE,
    user_id VARCHAR(100),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(255),
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT audit_logs_status_check CHECK (status IN ('SUCCESS', 'FAILED', 'PENDING')),
    CONSTRAINT audit_logs_action_check CHECK (action IN (
        'CREATE', 'READ', 'UPDATE', 'DELETE',
        'LOGIN', 'LOGOUT', 'WEBHOOK_RECEIVED',
        'MESSAGE_SENT', 'MESSAGE_RECEIVED',
        'INSTAGRAM_AUTH', 'WHATSAPP_AUTH',
        'API_CALL', 'SYSTEM_EVENT'
    )),
    CONSTRAINT audit_logs_resource_type_check CHECK (resource_type IN (
        'MERCHANT', 'CONVERSATION', 'MESSAGE', 'PRODUCT', 'ORDER',
        'CREDENTIAL', 'WEBHOOK', 'AUTH_TOKEN', 'SYSTEM'
    ))
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_audit_logs_merchant ON audit_logs (merchant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_status ON audit_logs (status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs (user_id);

-- Create trigger to ensure created_at is not modified
CREATE OR REPLACE FUNCTION protect_audit_logs_created_at()
RETURNS TRIGGER AS $$
BEGIN
    -- Prevent modification of created_at on updates
    IF TG_OP = 'UPDATE' THEN
        NEW.created_at = OLD.created_at;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_protect_audit_logs_created_at ON audit_logs;
CREATE TRIGGER trigger_protect_audit_logs_created_at
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION protect_audit_logs_created_at();

-- Enable RLS (already handled in migration 015)
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Add comments
COMMENT ON TABLE audit_logs IS 'Security audit trail for all system activities';
COMMENT ON COLUMN audit_logs.merchant_id IS 'Merchant context (nullable for system events)';
COMMENT ON COLUMN audit_logs.action IS 'Type of action performed';
COMMENT ON COLUMN audit_logs.resource_type IS 'Type of resource affected';
COMMENT ON COLUMN audit_logs.resource_id IS 'ID of the affected resource';
COMMENT ON COLUMN audit_logs.old_values IS 'Previous values before change';
COMMENT ON COLUMN audit_logs.new_values IS 'New values after change';

COMMIT;

-- Log success
\echo 'Migration 042: Audit logs table created ✅'