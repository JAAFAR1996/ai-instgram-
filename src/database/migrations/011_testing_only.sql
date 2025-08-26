-- ===============================================
-- 🚫 TESTING ONLY - DO NOT RUN IN PRODUCTION
-- Instagram Testing Infrastructure Migration  
-- This file should be excluded from production builds
-- ===============================================

-- Production safety check
DO $$
BEGIN
    IF current_setting('app.environment', true) = 'production' THEN
        RAISE EXCEPTION 'Testing migrations cannot be executed in production environment';
    END IF;
END $$;

-- Additional safety check for common production indicators
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_settings 
        WHERE name = 'shared_preload_libraries' 
        AND setting LIKE '%pg_stat_statements%'
        AND current_database() NOT LIKE '%test%'
        AND current_database() NOT LIKE '%dev%'
    ) THEN
        RAISE EXCEPTION 'This appears to be a production database - testing migrations blocked';
    END IF;
END $$;

-- Create test_results table for storing individual test scenario results
CREATE TABLE IF NOT EXISTS test_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    scenario_id VARCHAR(255) NOT NULL,
    scenario_name VARCHAR(255),
    category VARCHAR(50) NOT NULL CHECK (category IN ('unit', 'integration', 'e2e', 'performance', 'security')),
    component VARCHAR(255),
    status VARCHAR(20) NOT NULL CHECK (status IN ('passed', 'failed', 'skipped', 'error')),
    execution_time INTEGER NOT NULL, -- milliseconds
    errors JSONB DEFAULT '[]',
    details JSONB DEFAULT '{}',
    performance_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for test_results
CREATE INDEX IF NOT EXISTS idx_test_results_merchant ON test_results(merchant_id);
CREATE INDEX IF NOT EXISTS idx_test_results_scenario ON test_results(scenario_id);
CREATE INDEX IF NOT EXISTS idx_test_results_category ON test_results(category);
CREATE INDEX IF NOT EXISTS idx_test_results_status ON test_results(status);
CREATE INDEX IF NOT EXISTS idx_test_results_created ON test_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_results_merchant_status ON test_results(merchant_id, status);

-- Create test_execution_reports table for aggregated test reports
CREATE TABLE IF NOT EXISTS test_execution_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    execution_id VARCHAR(255) UNIQUE,
    total_scenarios INTEGER NOT NULL,
    passed INTEGER NOT NULL,
    failed INTEGER NOT NULL,
    skipped INTEGER DEFAULT 0,
    errors INTEGER DEFAULT 0,
    execution_time INTEGER NOT NULL, -- milliseconds
    success_rate DECIMAL(5,2) NOT NULL,
    suite_reports JSONB NOT NULL DEFAULT '[]',
    coverage_data JSONB DEFAULT '{}',
    recommendations JSONB DEFAULT '[]',
    triggered_by VARCHAR(255), -- 'manual', 'ci/cd', 'scheduled'
    environment VARCHAR(50) DEFAULT 'development',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for test_execution_reports
CREATE INDEX IF NOT EXISTS idx_test_execution_merchant ON test_execution_reports(merchant_id);
CREATE INDEX IF NOT EXISTS idx_test_execution_success_rate ON test_execution_reports(success_rate DESC);
CREATE INDEX IF NOT EXISTS idx_test_execution_created ON test_execution_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_test_execution_environment ON test_execution_reports(environment);

-- Create performance_test_results table for performance testing metrics
CREATE TABLE IF NOT EXISTS performance_test_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    test_name VARCHAR(255),
    total_requests INTEGER NOT NULL,
    successful_requests INTEGER NOT NULL,
    failed_requests INTEGER NOT NULL,
    average_response_time DECIMAL(10,2) NOT NULL, -- milliseconds
    max_response_time DECIMAL(10,2) NOT NULL,
    min_response_time DECIMAL(10,2) NOT NULL,
    throughput DECIMAL(10,2) NOT NULL, -- requests per second
    error_rate DECIMAL(5,2) NOT NULL,
    memory_peak_usage BIGINT, -- bytes
    cpu_peak_usage DECIMAL(5,2), -- percentage
    concurrent_users INTEGER,
    test_duration INTEGER, -- seconds
    recommendations JSONB DEFAULT '[]',
    performance_profile JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance_test_results
CREATE INDEX IF NOT EXISTS idx_performance_test_merchant ON performance_test_results(merchant_id);
CREATE INDEX IF NOT EXISTS idx_performance_test_throughput ON performance_test_results(throughput DESC);
CREATE INDEX IF NOT EXISTS idx_performance_test_error_rate ON performance_test_results(error_rate ASC);
CREATE INDEX IF NOT EXISTS idx_performance_test_created ON performance_test_results(created_at DESC);

-- Create api_validation_results table for API health monitoring
CREATE TABLE IF NOT EXISTS api_validation_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    validation_type VARCHAR(100) DEFAULT 'full_validation',
    api_health VARCHAR(20) NOT NULL CHECK (api_health IN ('healthy', 'degraded', 'unhealthy')),
    endpoint_tests JSONB NOT NULL DEFAULT '[]',
    webhook_validation JSONB NOT NULL DEFAULT '{}',
    rate_limit_status JSONB NOT NULL DEFAULT '{}',
    credentials_status VARCHAR(20) DEFAULT 'valid' CHECK (credentials_status IN ('valid', 'invalid', 'expired', 'unknown')),
    connectivity_status VARCHAR(20) DEFAULT 'connected' CHECK (connectivity_status IN ('connected', 'disconnected', 'timeout')),
    security_checks JSONB DEFAULT '{}',
    recommendations JSONB DEFAULT '[]',
    issues_detected JSONB DEFAULT '[]',
    response_times JSONB DEFAULT '{}', -- Response times for different endpoints
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for api_validation_results
CREATE INDEX IF NOT EXISTS idx_api_validation_merchant ON api_validation_results(merchant_id);
CREATE INDEX IF NOT EXISTS idx_api_validation_health ON api_validation_results(api_health);
CREATE INDEX IF NOT EXISTS idx_api_validation_created ON api_validation_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_validation_credentials ON api_validation_results(credentials_status);

-- Create test_schedules table for automated testing schedules
CREATE TABLE IF NOT EXISTS test_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    schedule_name VARCHAR(255) NOT NULL,
    test_suites JSONB NOT NULL DEFAULT '[]', -- Array of test suite IDs to run
    cron_expression VARCHAR(100) NOT NULL, -- Cron format for scheduling
    is_active BOOLEAN DEFAULT TRUE,
    last_execution TIMESTAMP WITH TIME ZONE,
    next_execution TIMESTAMP WITH TIME ZONE,
    execution_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    average_duration DECIMAL(10,2), -- Average execution time in seconds
    notification_settings JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for test_schedules
CREATE INDEX IF NOT EXISTS idx_test_schedules_merchant ON test_schedules(merchant_id);
CREATE INDEX IF NOT EXISTS idx_test_schedules_active ON test_schedules(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_test_schedules_next_execution ON test_schedules(next_execution) WHERE is_active = TRUE;

-- Create system_health_metrics table for overall system monitoring
CREATE TABLE IF NOT EXISTS system_health_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    metric_type VARCHAR(100) NOT NULL, -- 'api_health', 'webhook_processing', 'ai_response_time', etc.
    metric_value DECIMAL(10,2) NOT NULL,
    metric_unit VARCHAR(50) NOT NULL, -- 'ms', 'percentage', 'count', etc.
    status VARCHAR(20) DEFAULT 'normal' CHECK (status IN ('normal', 'warning', 'critical')),
    threshold_config JSONB DEFAULT '{}',
    additional_data JSONB DEFAULT '{}',
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for system_health_metrics
CREATE INDEX IF NOT EXISTS idx_system_health_merchant ON system_health_metrics(merchant_id);
CREATE INDEX IF NOT EXISTS idx_system_health_type ON system_health_metrics(metric_type);
CREATE INDEX IF NOT EXISTS idx_system_health_status ON system_health_metrics(status);
CREATE INDEX IF NOT EXISTS idx_system_health_recorded ON system_health_metrics(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_health_merchant_type_time ON system_health_metrics(merchant_id, metric_type, recorded_at DESC);

-- Add testing-related columns to daily_analytics if not exists
ALTER TABLE daily_analytics 
ADD COLUMN IF NOT EXISTS tests_executed INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS tests_passed INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS tests_failed INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS test_success_rate DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS api_health_score DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS webhook_reliability DECIMAL(5,2);

-- Create function to calculate test success metrics
CREATE OR REPLACE FUNCTION calculate_test_success_metrics(
    merchant_uuid UUID,
    target_date DATE DEFAULT CURRENT_DATE
) RETURNS TABLE(
    tests_executed INTEGER,
    tests_passed INTEGER,
    tests_failed INTEGER,
    success_rate DECIMAL(5,2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::INTEGER as tests_executed,
        COUNT(CASE WHEN tr.status = 'passed' THEN 1 END)::INTEGER as tests_passed,
        COUNT(CASE WHEN tr.status IN ('failed', 'error') THEN 1 END)::INTEGER as tests_failed,
        CASE 
            WHEN COUNT(*) > 0 THEN 
                (COUNT(CASE WHEN tr.status = 'passed' THEN 1 END)::DECIMAL / COUNT(*)) * 100
            ELSE 0 
        END as success_rate
    FROM test_results tr
    WHERE tr.merchant_id = merchant_uuid
    AND DATE(tr.created_at) = target_date;
END;
$$ LANGUAGE plpgsql;

-- Create function to update test metrics in daily analytics
CREATE OR REPLACE FUNCTION update_daily_test_metrics()
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER := 0;
    merchant_record RECORD;
    test_metrics RECORD;
BEGIN
    FOR merchant_record IN 
        SELECT DISTINCT merchant_id FROM test_results 
        WHERE DATE(created_at) = CURRENT_DATE
    LOOP
        -- Get test metrics for this merchant
        SELECT * INTO test_metrics 
        FROM calculate_test_success_metrics(merchant_record.merchant_id, CURRENT_DATE);
        
        -- Update daily analytics
        INSERT INTO daily_analytics (
            merchant_id,
            date,
            platform,
            tests_executed,
            tests_passed,
            tests_failed,
            test_success_rate
        ) VALUES (
            merchant_record.merchant_id,
            CURRENT_DATE,
            'INSTAGRAM',
            test_metrics.tests_executed,
            test_metrics.tests_passed,
            test_metrics.tests_failed,
            test_metrics.success_rate
        )
        ON CONFLICT (merchant_id, date, platform)
        DO UPDATE SET
            tests_executed = EXCLUDED.tests_executed,
            tests_passed = EXCLUDED.tests_passed,
            tests_failed = EXCLUDED.tests_failed,
            test_success_rate = EXCLUDED.test_success_rate,
            updated_at = NOW();
        
        updated_count := updated_count + 1;
    END LOOP;
    
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Create function to assess API health score
CREATE OR REPLACE FUNCTION calculate_api_health_score(
    merchant_uuid UUID
) RETURNS DECIMAL(5,2) AS $$
DECLARE
    health_score DECIMAL(5,2) := 100;
    recent_validation RECORD;
    failed_endpoints INTEGER;
    webhook_issues INTEGER;
BEGIN
    -- Get most recent API validation
    SELECT * INTO recent_validation
    FROM api_validation_results
    WHERE merchant_id = merchant_uuid
    ORDER BY created_at DESC
    LIMIT 1;
    
    IF recent_validation IS NULL THEN
        RETURN 0; -- No validation data
    END IF;
    
    -- Deduct points for API health status
    CASE recent_validation.api_health
        WHEN 'unhealthy' THEN health_score := health_score - 50;
        WHEN 'degraded' THEN health_score := health_score - 25;
        ELSE NULL;
    END CASE;
    
    -- Deduct points for failed endpoints
    SELECT COUNT(*) INTO failed_endpoints
    FROM JSONB_ARRAY_ELEMENTS(recent_validation.endpoint_tests) AS endpoint
    WHERE endpoint->>'status' = 'failed';
    
    health_score := health_score - (failed_endpoints * 10);
    
    -- Deduct points for webhook issues
    IF (recent_validation.webhook_validation->>'configured')::BOOLEAN = FALSE THEN
        health_score := health_score - 20;
    END IF;
    
    IF (recent_validation.webhook_validation->>'receiving')::BOOLEAN = FALSE THEN
        health_score := health_score - 15;
    END IF;
    
    -- Deduct points for rate limit issues
    IF recent_validation.rate_limit_status->>'status' = 'critical' THEN
        health_score := health_score - 20;
    ELSIF recent_validation.rate_limit_status->>'status' = 'warning' THEN
        health_score := health_score - 10;
    END IF;
    
    RETURN GREATEST(0, LEAST(100, health_score));
END;
$$ LANGUAGE plpgsql;

-- Create performance monitoring views
CREATE OR REPLACE VIEW test_performance_summary AS
SELECT 
    merchant_id,
    DATE(created_at) as test_date,
    category,
    COUNT(*) as total_tests,
    COUNT(CASE WHEN status = 'passed' THEN 1 END) as passed_tests,
    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_tests,
    AVG(execution_time) as avg_execution_time,
    MAX(execution_time) as max_execution_time,
    MIN(execution_time) as min_execution_time
FROM test_results
GROUP BY merchant_id, DATE(created_at), category
ORDER BY test_date DESC, merchant_id;

CREATE OR REPLACE VIEW api_health_dashboard AS
SELECT 
    avr.merchant_id,
    m.business_name,
    avr.api_health,
    avr.credentials_status,
    avr.connectivity_status,
    (avr.webhook_validation->>'configured')::BOOLEAN as webhook_configured,
    (avr.webhook_validation->>'receiving')::BOOLEAN as webhook_receiving,
    (avr.rate_limit_status->>'remaining')::INTEGER as rate_limit_remaining,
    avr.created_at as last_check,
    calculate_api_health_score(avr.merchant_id) as health_score
FROM api_validation_results avr
JOIN merchants m ON avr.merchant_id = m.id
WHERE avr.id IN (
    SELECT DISTINCT ON (merchant_id) id
    FROM api_validation_results
    ORDER BY merchant_id, created_at DESC
)
ORDER BY health_score DESC;

-- Add comments for documentation
COMMENT ON TABLE test_results IS 'Individual test scenario execution results with detailed metrics - TESTING ONLY';
COMMENT ON TABLE test_execution_reports IS 'Aggregated test suite execution reports and coverage data - TESTING ONLY';
COMMENT ON TABLE performance_test_results IS 'Performance and load testing metrics and recommendations - TESTING ONLY';
COMMENT ON TABLE api_validation_results IS 'API health monitoring and validation results - TESTING ONLY';
COMMENT ON TABLE test_schedules IS 'Automated test execution schedules and configurations - TESTING ONLY';
COMMENT ON TABLE system_health_metrics IS 'Real-time system health monitoring metrics - TESTING ONLY';

-- Migration completion log
INSERT INTO audit_logs (action, entity_type, details, success)
VALUES (
    'MIGRATION_EXECUTED',
    'DATABASE_SCHEMA',
    '{"migration": "011_testing_only", "description": "Added testing infrastructure - DEV/TEST ONLY", "environment": "non-production"}',
    TRUE
);

-- Final safety reminder
DO $$
BEGIN
    RAISE NOTICE '🚫 This migration contains TESTING ONLY tables and should never run in production';
    RAISE NOTICE '✅ Testing infrastructure created successfully for development/test environment';
END $$;