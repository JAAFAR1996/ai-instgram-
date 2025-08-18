-- إنشاء الجداول المفقودة
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    details JSONB,
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID,
    platform VARCHAR(20) NOT NULL,
    event_type VARCHAR(50),
    event_id VARCHAR(255) UNIQUE,
    status VARCHAR(20) DEFAULT 'RECEIVED',
    details JSONB,
    processed_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_platform_event UNIQUE(platform, event_id)
);

-- إنشاء فهارس للأداء
CREATE INDEX IF NOT EXISTS idx_audit_logs_merchant_id ON audit_logs(merchant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_merchant_id ON webhook_logs(merchant_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_event_id ON webhook_logs(event_id);

-- تنظيف البيانات القديمة (دالة)
CREATE OR REPLACE FUNCTION cleanup_old_webhook_logs()
RETURNS void AS $$
BEGIN
    DELETE FROM webhook_logs WHERE processed_at < NOW() - INTERVAL '30 days';
    DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '90 days';
END;
$$ LANGUAGE plpgsql;