-- تشغيل المايجريشن المطلوبة للإنتاج
-- يجب تشغيل هذا على قاعدة البيانات في Render

-- إنشاء جدول audit_logs إذا لم يكن موجود
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    details JSONB,
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    performed_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- إنشاء جدول webhook_logs إذا لم يكن موجود
CREATE TABLE IF NOT EXISTS webhook_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    merchant_id UUID,
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('INSTAGRAM', 'WHATSAPP')),
    event_type VARCHAR(50) NOT NULL,
    event_id VARCHAR(255) UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'SUCCESS', 'ERROR', 'PENDING')),
    details JSONB,
    processed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- إنشاء الفهارس
CREATE INDEX IF NOT EXISTS idx_audit_logs_merchant_id ON audit_logs(merchant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_merchant_platform ON webhook_logs (merchant_id, platform);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_event_id ON webhook_logs(event_id);

-- إنشاء دالة التنظيف
CREATE OR REPLACE FUNCTION cleanup_old_webhook_logs()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM webhook_logs WHERE processed_at < NOW() - INTERVAL '30 days';
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '90 days';
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;