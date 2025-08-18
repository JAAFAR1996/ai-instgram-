/**
 * ===============================================
 * Service Control Tables Migration
 * Tables for managing service on/off states per merchant
 * ===============================================
 */

-- Service status tracking table
CREATE TABLE IF NOT EXISTS merchant_service_status (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    service_name VARCHAR(50) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    last_toggled TIMESTAMPTZ DEFAULT NOW(),
    toggled_by VARCHAR(100) DEFAULT 'system',
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure one record per merchant per service
    UNIQUE(merchant_id, service_name)
);

-- Service errors tracking table
CREATE TABLE IF NOT EXISTS service_errors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    service_name VARCHAR(50) NOT NULL,
    error_message TEXT NOT NULL,
    error_context JSONB DEFAULT '{}',
    error_count INTEGER DEFAULT 1,
    last_error_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- One record per merchant per service per day
    UNIQUE(merchant_id, service_name, DATE(created_at))
);

-- Service performance metrics table
CREATE TABLE IF NOT EXISTS service_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    service_name VARCHAR(50) NOT NULL,
    metric_name VARCHAR(50) NOT NULL,
    metric_value DECIMAL(10,2) NOT NULL,
    recorded_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Index for fast queries
    INDEX idx_service_metrics_merchant_service ON service_metrics(merchant_id, service_name, recorded_at)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_merchant_service_status_merchant ON merchant_service_status(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_service_status_service ON merchant_service_status(service_name);
CREATE INDEX IF NOT EXISTS idx_service_errors_merchant_time ON service_errors(merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_errors_service_time ON service_errors(service_name, created_at DESC);

-- Row Level Security
ALTER TABLE merchant_service_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY merchant_service_status_isolation ON merchant_service_status
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id', true)::UUID);

CREATE POLICY service_errors_isolation ON service_errors
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id', true)::UUID);

CREATE POLICY service_metrics_isolation ON service_metrics
    FOR ALL USING (merchant_id = current_setting('app.current_merchant_id', true)::UUID);

-- Insert default service statuses for existing merchants
INSERT INTO merchant_service_status (merchant_id, service_name, enabled)
SELECT 
    m.id,
    service_name,
    CASE 
        WHEN service_name = 'whatsapp' THEN false
        ELSE true 
    END as enabled
FROM merchants m
CROSS JOIN (
    VALUES 
        ('instagram'),
        ('whatsapp'), 
        ('ai_processing'),
        ('auto_reply'),
        ('story_response'),
        ('comment_response'),
        ('dm_processing')
) AS services(service_name)
WHERE NOT EXISTS (
    SELECT 1 FROM merchant_service_status mss 
    WHERE mss.merchant_id = m.id 
    AND mss.service_name = services.service_name
);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_merchant_service_status_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER merchant_service_status_updated_at
    BEFORE UPDATE ON merchant_service_status
    FOR EACH ROW
    EXECUTE FUNCTION update_merchant_service_status_updated_at();

-- Add some useful views
CREATE OR REPLACE VIEW merchant_services_summary AS
SELECT 
    m.id as merchant_id,
    m.business_name,
    COUNT(mss.service_name) as total_services,
    COUNT(CASE WHEN mss.enabled = true THEN 1 END) as enabled_services,
    COUNT(CASE WHEN mss.enabled = false THEN 1 END) as disabled_services,
    MAX(mss.last_toggled) as last_service_change
FROM merchants m
LEFT JOIN merchant_service_status mss ON m.id = mss.merchant_id
GROUP BY m.id, m.business_name;

-- Service health view
CREATE OR REPLACE VIEW service_health_summary AS
SELECT 
    mss.merchant_id,
    mss.service_name,
    mss.enabled,
    mss.last_toggled,
    COALESCE(se.error_count, 0) as error_count_today,
    COALESCE(se.last_error_at, mss.last_toggled) as last_error,
    CASE 
        WHEN NOT mss.enabled THEN 'disabled'
        WHEN COALESCE(se.error_count, 0) > 50 THEN 'critical'
        WHEN COALESCE(se.error_count, 0) > 20 THEN 'warning'
        ELSE 'healthy'
    END as health_status
FROM merchant_service_status mss
LEFT JOIN service_errors se ON (
    se.merchant_id = mss.merchant_id 
    AND se.service_name = mss.service_name
    AND se.created_at::DATE = CURRENT_DATE
);

-- Comments
COMMENT ON TABLE merchant_service_status IS 'Tracks on/off status of services per merchant';
COMMENT ON TABLE service_errors IS 'Tracks service errors for monitoring and auto-disable';
COMMENT ON TABLE service_metrics IS 'Stores performance metrics for services';
COMMENT ON VIEW merchant_services_summary IS 'Summary of service statuses per merchant';
COMMENT ON VIEW service_health_summary IS 'Health status of all services';

-- Grant permissions (adjust as needed for your user)
-- GRANT ALL ON merchant_service_status TO ai_sales_app;
-- GRANT ALL ON service_errors TO ai_sales_app;
-- GRANT ALL ON service_metrics TO ai_sales_app;