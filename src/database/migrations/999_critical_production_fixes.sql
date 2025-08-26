-- ========================================================
-- CRITICAL PRODUCTION FIX MIGRATION
-- File: 999_critical_production_fixes.sql
-- ========================================================
BEGIN;

-- 1. إنشاء جدول audit_logs الأساسي المفقود
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID,
    entity_type VARCHAR(100) NOT NULL,
    entity_id VARCHAR(255),
    action VARCHAR(50) NOT NULL,
    performed_by VARCHAR(100) NOT NULL,
    details JSONB DEFAULT '{}',
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    table_name VARCHAR(100),
    operation VARCHAR(50),
    execution_time_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. إنشاء جدول merchant_service_status المفقود
CREATE TABLE IF NOT EXISTS merchant_service_status (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    service_name VARCHAR(50) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    last_toggled TIMESTAMPTZ DEFAULT NOW(),
    toggled_by VARCHAR(100) DEFAULT 'system',
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(merchant_id, service_name)
);

-- 3. إضافة الأعمدة المفقودة إلى message_logs
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS ai_confidence DECIMAL(3,2);
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS ai_intent VARCHAR(50);
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS processing_time_ms INTEGER;
ALTER TABLE message_logs ADD COLUMN IF NOT EXISTS metadata JSONB;

-- 4. إضافة الأعمدة المفقودة إلى conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS customer_whatsapp VARCHAR(20);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);

-- 5. إضافة ai_config للـ merchants
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS ai_config JSONB DEFAULT '{"model": "gpt-4o-mini", "temperature": 0.3, "max_tokens": 200}';

-- 6. إصلاح قيود conversation_stage لتشمل جميع القيم المطلوبة
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_conversation_stage_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_conversation_stage_check 
CHECK (conversation_stage IN (
    'GREETING', 'PRODUCT_INQUIRY', 'ORDER_PROCESSING', 'PAYMENT', 'SUPPORT', 
    'COMPLETED', 'ABANDONED', 'ESCALATED', 'FOLLOW_UP', 'CLOSING',
    'AI_RESPONSE', 'WAITING_RESPONSE', 'PROCESSING', 'PENDING', 'ACTIVE',
    'QUEUED', 'FAILED', 'ERROR', 'TIMEOUT', 'RETRY', 'MERGED'
));

-- 7. إنشاء الفهارس المطلوبة
CREATE INDEX IF NOT EXISTS idx_audit_logs_merchant_id ON audit_logs (merchant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type ON audit_logs (entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_execution_time ON audit_logs (execution_time_ms) WHERE execution_time_ms IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_merchant_service_status_merchant ON merchant_service_status (merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_service_status_service ON merchant_service_status (service_name);

CREATE INDEX IF NOT EXISTS idx_message_logs_ai_confidence ON message_logs (ai_confidence);
CREATE INDEX IF NOT EXISTS idx_message_logs_ai_intent ON message_logs (ai_intent);
CREATE INDEX IF NOT EXISTS idx_message_logs_metadata ON message_logs USING GIN (metadata);

CREATE INDEX IF NOT EXISTS idx_conversations_customer_whatsapp ON conversations (customer_whatsapp) WHERE customer_whatsapp IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_customer_name ON conversations (customer_name) WHERE customer_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_merchants_ai_config ON merchants USING GIN (ai_config);

-- 8. إضافة RLS policies للجداول الجديدة
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_tenant_access ON audit_logs;
CREATE POLICY audit_logs_tenant_access ON audit_logs
    FOR ALL
    USING (
        merchant_id IS NULL OR 
        merchant_id::text = current_setting('app.current_merchant_id', true) OR 
        current_setting('app.admin_mode', true) = 'true'
    );

ALTER TABLE merchant_service_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS merchant_service_status_tenant_access ON merchant_service_status;
CREATE POLICY merchant_service_status_tenant_access ON merchant_service_status
    FOR ALL
    USING (
        merchant_id::text = current_setting('app.current_merchant_id', true) OR 
        current_setting('app.admin_mode', true) = 'true'
    );

-- 9. إدراج الإعدادات الافتراضية للخدمات
INSERT INTO merchant_service_status (merchant_id, service_name, enabled)
SELECT 
    m.id as merchant_id,
    service_name,
    true as enabled
FROM merchants m
CROSS JOIN (
    VALUES 
    ('instagram'),
    ('ai_processing'),
    ('auto_reply'),
    ('story_response'),
    ('comment_response'),
    ('dm_processing')
) AS services(service_name)
ON CONFLICT (merchant_id, service_name) DO NOTHING;

-- 10. تحديث البيانات الموجودة
UPDATE conversations 
SET 
    customer_whatsapp = customer_phone,
    customer_name = COALESCE(customer_name, 'Instagram User')
WHERE customer_whatsapp IS NULL AND customer_phone IS NOT NULL;

-- 11. إضافة تعليقات للتوثيق
COMMENT ON TABLE audit_logs IS 'System audit trail for all operations';
COMMENT ON TABLE merchant_service_status IS 'Per-merchant service enable/disable status';
COMMENT ON COLUMN message_logs.ai_confidence IS 'AI confidence score (0.00-1.00)';
COMMENT ON COLUMN message_logs.ai_intent IS 'Detected customer intent';
COMMENT ON COLUMN message_logs.processing_time_ms IS 'Processing time in milliseconds';
COMMENT ON COLUMN conversations.customer_whatsapp IS 'WhatsApp phone number for cross-platform support';
COMMENT ON COLUMN merchants.ai_config IS 'AI model configuration (temperature, model, tokens, etc.)';
COMMENT ON COLUMN audit_logs.execution_time_ms IS 'Execution time for the logged operation in milliseconds';

COMMIT;

-- Test query to verify everything is working
SELECT 'All critical production fixes applied successfully!' as result;