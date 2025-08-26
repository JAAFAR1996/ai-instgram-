-- Production Hotfix: Add missing columns and audit_logs table
-- Date: 2025-08-26

BEGIN;

-- الخطوة 1: إضافة الأعمدة المفقودة في message_logs
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS ai_confidence DECIMAL(3,2);
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS ai_intent VARCHAR(50);
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS processing_time_ms INTEGER;
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS metadata JSONB;

-- إضافة الفهارس للأعمدة الجديدة
CREATE INDEX IF NOT EXISTS idx_message_logs_ai_confidence ON message_logs (ai_confidence);
CREATE INDEX IF NOT EXISTS idx_message_logs_ai_intent ON message_logs (ai_intent);
CREATE INDEX IF NOT EXISTS idx_message_logs_metadata ON message_logs USING GIN (metadata);

-- الخطوة 2: إنشاء جدول audit_logs (بناءً على اقتراحك مع تعديلات للتوافق)
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(255),
    action VARCHAR(50) NOT NULL,
    performed_by VARCHAR(100) NOT NULL,
    details JSONB DEFAULT '{}',
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    table_name VARCHAR(100),
    operation VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- إنشاء الفهارس المطلوبة
CREATE INDEX IF NOT EXISTS idx_audit_logs_merchant_id ON audit_logs (merchant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type ON audit_logs (entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_operation ON audit_logs (table_name, operation);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action);

-- تفعيل RLS على audit_logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- إضافة سياسة RLS
DROP POLICY IF EXISTS "audit_logs_tenant_isolation" ON audit_logs;
CREATE POLICY "audit_logs_tenant_isolation" ON audit_logs
  FOR ALL 
  USING (
    merchant_id::text = current_setting('app.current_merchant_id', true)
    OR merchant_id IS NULL 
    OR current_setting('app.admin_mode', true) = 'true'
  );

COMMIT;

-- التحقق من النجاح
SELECT 'Hotfix applied successfully: audit_logs table and missing columns created' as result;
SELECT column_name FROM information_schema.columns WHERE table_name = 'message_logs' AND column_name IN ('ai_confidence', 'ai_intent', 'processing_time_ms', 'metadata');
SELECT table_name FROM information_schema.tables WHERE table_name = 'audit_logs';