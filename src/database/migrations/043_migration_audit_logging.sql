-- ===============================================
-- Migration Audit Logging Enhancement
-- Comprehensive audit trail for all migration activities
-- Migration: 043_migration_audit_logging.sql
-- ===============================================

-- 1. Create enhanced migration audit table
CREATE TABLE IF NOT EXISTS migration_audit_logs (
    id SERIAL PRIMARY KEY,
    migration_version VARCHAR(255) NOT NULL,
    migration_name TEXT NOT NULL,
    operation_type VARCHAR(50) NOT NULL, -- START, COMPLETE, ROLLBACK, FAIL
    status VARCHAR(50) NOT NULL, -- RUNNING, SUCCESS, FAILED, ROLLED_BACK
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    duration_ms BIGINT,
    executed_by VARCHAR(255) NOT NULL DEFAULT current_user,
    executor_ip INET,
    executor_application TEXT,
    execution_context JSONB,
    sql_statements TEXT[],
    error_message TEXT,
    error_details JSONB,
    rollback_reason TEXT,
    pre_migration_checksum VARCHAR(64),
    post_migration_checksum VARCHAR(64),
    affected_tables TEXT[],
    affected_functions TEXT[],
    schema_changes JSONB,
    performance_metrics JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for migration audit logs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_migration_audit_logs_version 
    ON migration_audit_logs (migration_version);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_migration_audit_logs_status_time 
    ON migration_audit_logs (status, started_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_migration_audit_logs_executed_by 
    ON migration_audit_logs (executed_by, started_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_migration_audit_logs_operation 
    ON migration_audit_logs (operation_type, started_at DESC);

-- 2. Create function to log migration start
CREATE OR REPLACE FUNCTION log_migration_start(
    p_migration_version VARCHAR(255),
    p_migration_name TEXT,
    p_sql_statements TEXT[] DEFAULT NULL,
    p_execution_context JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    audit_id UUID;
    client_info JSONB;
BEGIN
    -- Generate audit session ID
    audit_id := gen_random_uuid();
    
    -- Collect client connection information
    client_info := jsonb_build_object(
        'application_name', current_setting('application_name', true),
        'client_addr', inet_client_addr(),
        'client_port', inet_client_port(),
        'server_version', version(),
        'current_database', current_database(),
        'session_user', session_user,
        'current_user', current_user,
        'transaction_timestamp', transaction_timestamp(),
        'statement_timestamp', statement_timestamp(),
        'clock_timestamp', clock_timestamp(),
        'backend_pid', pg_backend_pid(),
        'session_id', audit_id
    );
    
    -- Insert migration start log
    INSERT INTO migration_audit_logs (
        migration_version,
        migration_name,
        operation_type,
        status,
        started_at,
        executed_by,
        executor_ip,
        executor_application,
        execution_context,
        sql_statements,
        pre_migration_checksum
    ) VALUES (
        p_migration_version,
        p_migration_name,
        'START',
        'RUNNING',
        NOW(),
        current_user,
        inet_client_addr(),
        current_setting('application_name', true),
        COALESCE(p_execution_context, '{}'::jsonb) || client_info,
        p_sql_statements,
        -- Generate checksum of current schema state
        md5(
            array_to_string(
                ARRAY(
                    SELECT schemaname || '.' || tablename || ':' || 
                           COALESCE(obj_description(c.oid), '') 
                    FROM pg_tables t
                    JOIN pg_class c ON c.relname = t.tablename
                    WHERE schemaname = 'public'
                    ORDER BY tablename
                ), 
                ','
            )
        )
    );
    
    -- Log to audit_logs as well
    INSERT INTO audit_logs (
        entity_type, entity_id, action, performed_by,
        details, created_at
    ) VALUES (
        'MIGRATION_START',
        p_migration_version,
        'EXECUTE',
        current_user,
        jsonb_build_object(
            'migration_name', p_migration_name,
            'audit_session_id', audit_id,
            'client_info', client_info,
            'sql_statement_count', COALESCE(array_length(p_sql_statements, 1), 0)
        ),
        NOW()
    );
    
    RETURN audit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create function to log migration completion
CREATE OR REPLACE FUNCTION log_migration_completion(
    p_migration_version VARCHAR(255),
    p_status VARCHAR(50), -- SUCCESS, FAILED
    p_error_message TEXT DEFAULT NULL,
    p_error_details JSONB DEFAULT NULL,
    p_affected_tables TEXT[] DEFAULT NULL,
    p_affected_functions TEXT[] DEFAULT NULL,
    p_schema_changes JSONB DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    start_time TIMESTAMPTZ;
    duration_ms BIGINT;
    performance_metrics JSONB;
BEGIN
    -- Get the start time from the most recent start log
    SELECT started_at INTO start_time
    FROM migration_audit_logs
    WHERE migration_version = p_migration_version
    AND operation_type = 'START'
    ORDER BY started_at DESC
    LIMIT 1;
    
    -- Calculate duration
    duration_ms := EXTRACT(epoch FROM (NOW() - start_time)) * 1000;
    
    -- Collect performance metrics
    performance_metrics := jsonb_build_object(
        'duration_ms', duration_ms,
        'completion_time', NOW(),
        'memory_context', current_setting('work_mem', true),
        'lock_timeout', current_setting('lock_timeout', true),
        'statement_timeout', current_setting('statement_timeout', true),
        'affected_table_count', COALESCE(array_length(p_affected_tables, 1), 0),
        'affected_function_count', COALESCE(array_length(p_affected_functions, 1), 0)
    );
    
    -- Update migration audit log
    UPDATE migration_audit_logs
    SET 
        operation_type = 'COMPLETE',
        status = p_status,
        completed_at = NOW(),
        duration_ms = duration_ms,
        error_message = p_error_message,
        error_details = p_error_details,
        affected_tables = p_affected_tables,
        affected_functions = p_affected_functions,
        schema_changes = p_schema_changes,
        performance_metrics = performance_metrics,
        post_migration_checksum = md5(
            array_to_string(
                ARRAY(
                    SELECT schemaname || '.' || tablename || ':' || 
                           COALESCE(obj_description(c.oid), '') 
                    FROM pg_tables t
                    JOIN pg_class c ON c.relname = t.tablename
                    WHERE schemaname = 'public'
                    ORDER BY tablename
                ), 
                ','
            )
        ),
        updated_at = NOW()
    WHERE migration_version = p_migration_version
    AND operation_type = 'START'
    AND status = 'RUNNING';
    
    -- Log completion to audit_logs
    INSERT INTO audit_logs (
        entity_type, entity_id, action, performed_by,
        details, created_at
    ) VALUES (
        'MIGRATION_' || p_status,
        p_migration_version,
        'COMPLETE',
        current_user,
        jsonb_build_object(
            'status', p_status,
            'duration_ms', duration_ms,
            'affected_tables', p_affected_tables,
            'affected_functions', p_affected_functions,
            'performance_metrics', performance_metrics,
            'error_message', p_error_message
        ),
        NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create function to analyze migration patterns
CREATE OR REPLACE FUNCTION analyze_migration_patterns()
RETURNS TABLE(
    pattern_type TEXT,
    metric_name TEXT,
    metric_value NUMERIC,
    details TEXT,
    risk_assessment TEXT
) AS $$
BEGIN
    -- Migration success rate analysis
    RETURN QUERY
    WITH success_analysis AS (
        SELECT 
            COUNT(*) as total_migrations,
            COUNT(*) FILTER (WHERE status = 'SUCCESS') as successful_migrations,
            COUNT(*) FILTER (WHERE status = 'FAILED') as failed_migrations,
            ROUND(
                (COUNT(*) FILTER (WHERE status = 'SUCCESS')::NUMERIC / COUNT(*)) * 100, 
                2
            ) as success_rate
        FROM migration_audit_logs
        WHERE operation_type = 'COMPLETE'
        AND started_at > NOW() - INTERVAL '30 days'
    )
    SELECT 
        'SUCCESS_RATE'::TEXT,
        'MIGRATION_SUCCESS_PERCENTAGE'::TEXT,
        sa.success_rate,
        ('Total: ' || sa.total_migrations || ', Success: ' || sa.successful_migrations || ', Failed: ' || sa.failed_migrations)::TEXT,
        CASE 
            WHEN sa.success_rate >= 95 THEN 'LOW_RISK'
            WHEN sa.success_rate >= 80 THEN 'MEDIUM_RISK'
            ELSE 'HIGH_RISK'
        END::TEXT
    FROM success_analysis sa;
    
    -- Average migration duration analysis
    RETURN QUERY
    WITH duration_analysis AS (
        SELECT 
            ROUND(AVG(duration_ms)::NUMERIC, 2) as avg_duration_ms,
            ROUND(MAX(duration_ms)::NUMERIC, 2) as max_duration_ms,
            COUNT(*) as completed_migrations
        FROM migration_audit_logs
        WHERE operation_type = 'COMPLETE'
        AND status = 'SUCCESS'
        AND started_at > NOW() - INTERVAL '30 days'
        AND duration_ms IS NOT NULL
    )
    SELECT 
        'PERFORMANCE'::TEXT,
        'AVERAGE_DURATION_MS'::TEXT,
        da.avg_duration_ms,
        ('Avg: ' || da.avg_duration_ms || 'ms, Max: ' || da.max_duration_ms || 'ms, Count: ' || da.completed_migrations)::TEXT,
        CASE 
            WHEN da.avg_duration_ms <= 5000 THEN 'LOW_RISK'  -- Under 5 seconds
            WHEN da.avg_duration_ms <= 30000 THEN 'MEDIUM_RISK'  -- Under 30 seconds
            ELSE 'HIGH_RISK'  -- Over 30 seconds
        END::TEXT
    FROM duration_analysis da;
    
    -- Migration frequency analysis
    RETURN QUERY
    WITH frequency_analysis AS (
        SELECT 
            COUNT(*) as migrations_last_7_days
        FROM migration_audit_logs
        WHERE started_at > NOW() - INTERVAL '7 days'
    )
    SELECT 
        'FREQUENCY'::TEXT,
        'MIGRATIONS_PER_WEEK'::TEXT,
        fa.migrations_last_7_days::NUMERIC,
        ('Migrations in last 7 days: ' || fa.migrations_last_7_days)::TEXT,
        CASE 
            WHEN fa.migrations_last_7_days <= 5 THEN 'LOW_RISK'
            WHEN fa.migrations_last_7_days <= 15 THEN 'MEDIUM_RISK'
            ELSE 'HIGH_RISK'  -- Very frequent migrations may indicate instability
        END::TEXT
    FROM frequency_analysis fa;
    
    -- Error pattern analysis
    RETURN QUERY
    WITH error_analysis AS (
        SELECT 
            COUNT(DISTINCT error_message) as unique_error_types,
            COUNT(*) as total_errors
        FROM migration_audit_logs
        WHERE status = 'FAILED'
        AND started_at > NOW() - INTERVAL '30 days'
    )
    SELECT 
        'ERROR_PATTERNS'::TEXT,
        'UNIQUE_ERROR_TYPES'::TEXT,
        ea.unique_error_types::NUMERIC,
        ('Total errors: ' || ea.total_errors || ', Unique types: ' || ea.unique_error_types)::TEXT,
        CASE 
            WHEN ea.unique_error_types = 0 THEN 'LOW_RISK'
            WHEN ea.unique_error_types <= 3 THEN 'MEDIUM_RISK'
            ELSE 'HIGH_RISK'  -- Many different error types indicate systematic issues
        END::TEXT
    FROM error_analysis ea;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Create migration audit report function
CREATE OR REPLACE FUNCTION generate_migration_audit_report(
    p_days_back INTEGER DEFAULT 30
)
RETURNS TABLE(
    report_section TEXT,
    migration_version TEXT,
    migration_name TEXT,
    status TEXT,
    duration_ms BIGINT,
    executed_by TEXT,
    started_at TIMESTAMPTZ,
    error_summary TEXT,
    risk_indicators TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    WITH migration_summary AS (
        SELECT 
            mal.migration_version,
            mal.migration_name,
            mal.status,
            mal.duration_ms,
            mal.executed_by,
            mal.started_at,
            mal.error_message,
            mal.performance_metrics,
            -- Risk indicators
            CASE 
                WHEN mal.duration_ms > 60000 THEN ARRAY['LONG_DURATION']
                ELSE ARRAY[]::TEXT[]
            END ||
            CASE 
                WHEN mal.status = 'FAILED' THEN ARRAY['FAILED_EXECUTION']
                ELSE ARRAY[]::TEXT[]
            END ||
            CASE 
                WHEN mal.error_message IS NOT NULL THEN ARRAY['HAS_ERRORS']
                ELSE ARRAY[]::TEXT[]
            END as risk_indicators
        FROM migration_audit_logs mal
        WHERE mal.started_at > NOW() - (p_days_back || ' days')::INTERVAL
        AND mal.operation_type = 'COMPLETE'
        ORDER BY mal.started_at DESC
    )
    SELECT 
        'MIGRATION_HISTORY'::TEXT,
        ms.migration_version,
        ms.migration_name,
        ms.status,
        ms.duration_ms,
        ms.executed_by,
        ms.started_at,
        COALESCE(SUBSTRING(ms.error_message, 1, 100), 'No errors')::TEXT,
        ms.risk_indicators
    FROM migration_summary ms;
    
    -- Add pattern analysis
    RETURN QUERY
    SELECT 
        'PATTERN_ANALYSIS'::TEXT,
        ap.pattern_type || '_' || ap.metric_name,
        ap.details,
        ap.risk_assessment,
        ap.metric_value::BIGINT,
        'system_analysis'::TEXT,
        NOW(),
        ap.details,
        CASE 
            WHEN ap.risk_assessment = 'HIGH_RISK' THEN ARRAY['HIGH_RISK_PATTERN']
            WHEN ap.risk_assessment = 'MEDIUM_RISK' THEN ARRAY['MEDIUM_RISK_PATTERN']
            ELSE ARRAY['LOW_RISK_PATTERN']
        END
    FROM analyze_migration_patterns() ap;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Create migration security audit function
CREATE OR REPLACE FUNCTION audit_migration_security()
RETURNS TABLE(
    security_aspect TEXT,
    finding TEXT,
    severity TEXT,
    recommendation TEXT
) AS $$
BEGIN
    -- Check for migrations run by unexpected users
    RETURN QUERY
    WITH user_analysis AS (
        SELECT 
            executed_by,
            COUNT(*) as migration_count
        FROM migration_audit_logs
        WHERE started_at > NOW() - INTERVAL '30 days'
        GROUP BY executed_by
    )
    SELECT 
        'UNAUTHORIZED_USERS'::TEXT,
        ('User ' || ua.executed_by || ' ran ' || ua.migration_count || ' migrations')::TEXT,
        CASE 
            WHEN ua.executed_by NOT IN ('postgres', 'migration_user', 'admin') THEN 'HIGH'
            ELSE 'INFO'
        END::TEXT,
        CASE 
            WHEN ua.executed_by NOT IN ('postgres', 'migration_user', 'admin') THEN 'Review migration execution permissions'
            ELSE 'Migration user appears authorized'
        END::TEXT
    FROM user_analysis ua;
    
    -- Check for migrations with suspicious patterns
    RETURN QUERY
    SELECT 
        'SUSPICIOUS_PATTERNS'::TEXT,
        ('Migration ' || migration_version || ' contains ' || array_length(sql_statements, 1) || ' statements')::TEXT,
        CASE 
            WHEN array_length(sql_statements, 1) > 100 THEN 'HIGH'
            WHEN array_length(sql_statements, 1) > 50 THEN 'MEDIUM'
            ELSE 'LOW'
        END::TEXT,
        CASE 
            WHEN array_length(sql_statements, 1) > 100 THEN 'Review large migration for complexity'
            ELSE 'Migration size appears normal'
        END::TEXT
    FROM migration_audit_logs
    WHERE started_at > NOW() - INTERVAL '30 days'
    AND sql_statements IS NOT NULL
    AND array_length(sql_statements, 1) > 10;
    
    -- Check for failed migrations that might indicate attacks
    RETURN QUERY
    SELECT 
        'FAILED_MIGRATIONS'::TEXT,
        ('Migration ' || migration_version || ' failed: ' || COALESCE(SUBSTRING(error_message, 1, 50), 'Unknown error'))::TEXT,
        CASE 
            WHEN error_message ILIKE '%permission denied%' OR error_message ILIKE '%access denied%' THEN 'HIGH'
            WHEN error_message ILIKE '%syntax error%' THEN 'MEDIUM'
            ELSE 'LOW'
        END::TEXT,
        'Investigate failed migration for potential security issues'::TEXT
    FROM migration_audit_logs
    WHERE status = 'FAILED'
    AND started_at > NOW() - INTERVAL '7 days'
    LIMIT 10;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Create migration audit dashboard view
CREATE OR REPLACE VIEW migration_audit_dashboard AS
WITH audit_metrics AS (
    SELECT 
        COUNT(*) FILTER (WHERE started_at > NOW() - INTERVAL '24 hours') as migrations_24h,
        COUNT(*) FILTER (WHERE started_at > NOW() - INTERVAL '7 days') as migrations_7d,
        COUNT(*) FILTER (WHERE started_at > NOW() - INTERVAL '30 days') as migrations_30d,
        COUNT(*) FILTER (WHERE status = 'SUCCESS' AND started_at > NOW() - INTERVAL '30 days') as successful_30d,
        COUNT(*) FILTER (WHERE status = 'FAILED' AND started_at > NOW() - INTERVAL '30 days') as failed_30d,
        ROUND(AVG(duration_ms) FILTER (WHERE status = 'SUCCESS' AND started_at > NOW() - INTERVAL '30 days'), 2) as avg_duration_ms,
        MAX(duration_ms) FILTER (WHERE status = 'SUCCESS' AND started_at > NOW() - INTERVAL '30 days') as max_duration_ms,
        COUNT(DISTINCT executed_by) FILTER (WHERE started_at > NOW() - INTERVAL '30 days') as unique_executors
    FROM migration_audit_logs
    WHERE operation_type = 'COMPLETE'
)
SELECT 
    'RECENT_ACTIVITY' as metric_category,
    migrations_24h as last_24h,
    migrations_7d as last_7d,
    migrations_30d as last_30d,
    CASE 
        WHEN migrations_30d > 0 THEN ROUND((successful_30d::NUMERIC / migrations_30d) * 100, 1)
        ELSE 0
    END as success_rate_pct,
    avg_duration_ms,
    max_duration_ms,
    unique_executors
FROM audit_metrics;

-- 8. Grant permissions on audit functions
GRANT EXECUTE ON FUNCTION log_migration_start(VARCHAR(255), TEXT, TEXT[], JSONB) TO postgres;
GRANT EXECUTE ON FUNCTION log_migration_completion(VARCHAR(255), VARCHAR(50), TEXT, JSONB, TEXT[], TEXT[], JSONB) TO postgres;
GRANT EXECUTE ON FUNCTION analyze_migration_patterns() TO app_user, postgres;
GRANT EXECUTE ON FUNCTION generate_migration_audit_report(INTEGER) TO app_user, postgres;
GRANT EXECUTE ON FUNCTION audit_migration_security() TO app_user, postgres;
GRANT SELECT ON migration_audit_logs TO app_user, postgres;
GRANT INSERT ON migration_audit_logs TO postgres;
GRANT UPDATE ON migration_audit_logs TO postgres;
GRANT SELECT ON migration_audit_dashboard TO app_user, postgres;

-- 9. Update production migration runner to use audit logging
DO $$
BEGIN
    -- This is informational - the actual migration runner script needs to be updated
    INSERT INTO audit_logs (
        entity_type, entity_id, action, performed_by,
        details, created_at
    ) VALUES (
        'MIGRATION_AUDIT_SETUP',
        '043_migration_audit_logging.sql',
        'CONFIGURE',
        current_user,
        jsonb_build_object(
            'message', 'Migration audit logging system configured',
            'recommendation', 'Update migration runner scripts to call log_migration_start() and log_migration_completion()',
            'functions_created', ARRAY[
                'log_migration_start',
                'log_migration_completion', 
                'analyze_migration_patterns',
                'generate_migration_audit_report',
                'audit_migration_security'
            ]
        ),
        NOW()
    );
END $$;

-- 10. Demonstrate audit logging for this migration
DO $$
DECLARE
    audit_session_id UUID;
BEGIN
    -- Log start of this migration
    audit_session_id := log_migration_start(
        '043_migration_audit_logging.sql',
        'Migration Audit Logging Enhancement',
        ARRAY[
            'CREATE TABLE migration_audit_logs',
            'CREATE FUNCTION log_migration_start',
            'CREATE FUNCTION log_migration_completion',
            'CREATE FUNCTION analyze_migration_patterns',
            'CREATE FUNCTION generate_migration_audit_report',
            'CREATE FUNCTION audit_migration_security',
            'CREATE VIEW migration_audit_dashboard'
        ],
        jsonb_build_object(
            'migration_type', 'AUDIT_ENHANCEMENT',
            'affects_security', true,
            'adds_monitoring', true
        )
    );
    
    RAISE NOTICE '🔍 Migration audit session started: %', audit_session_id;
    
    -- Log successful completion
    PERFORM log_migration_completion(
        '043_migration_audit_logging.sql',
        'SUCCESS',
        NULL, -- no error
        NULL, -- no error details
        ARRAY['migration_audit_logs'], -- affected tables
        ARRAY[
            'log_migration_start',
            'log_migration_completion',
            'analyze_migration_patterns',
            'generate_migration_audit_report',
            'audit_migration_security'
        ], -- affected functions
        jsonb_build_object(
            'tables_added', 1,
            'functions_added', 5,
            'views_added', 1,
            'indexes_added', 4
        )
    );
    
    RAISE NOTICE '✅ Migration audit logging completed successfully';
END $$;

-- 11. Add migration tracking to schema_migrations
INSERT INTO schema_migrations (version, applied_at, success, description)
VALUES (
    '043_migration_audit_logging.sql', 
    NOW(), 
    TRUE,
    'Comprehensive migration audit logging and monitoring system'
)
ON CONFLICT (version) DO UPDATE SET 
    applied_at = NOW(),
    success = TRUE,
    description = EXCLUDED.description;

-- 12. Final audit logging summary
DO $$
DECLARE
    audit_summary RECORD;
    dashboard_data RECORD;
BEGIN
    RAISE NOTICE '🔍 Migration Audit Logging System Summary:';
    
    -- Show dashboard metrics
    FOR dashboard_data IN SELECT * FROM migration_audit_dashboard
    LOOP
        RAISE NOTICE '   📊 Recent Activity:';
        RAISE NOTICE '      Last 24h: % migrations', dashboard_data.last_24h;
        RAISE NOTICE '      Last 7d: % migrations', dashboard_data.last_7d;
        RAISE NOTICE '      Last 30d: % migrations', dashboard_data.last_30d;
        RAISE NOTICE '      Success Rate: %.1f%%', dashboard_data.success_rate_pct;
        RAISE NOTICE '      Avg Duration: %ms', COALESCE(dashboard_data.avg_duration_ms, 0);
        RAISE NOTICE '      Unique Executors: %', dashboard_data.unique_executors;
    END LOOP;
    
    -- Show security audit summary
    RAISE NOTICE '   🔒 Security Audit:';
    FOR audit_summary IN 
        SELECT severity, COUNT(*) as count
        FROM audit_migration_security()
        GROUP BY severity
        ORDER BY 
            CASE severity 
                WHEN 'HIGH' THEN 1 
                WHEN 'MEDIUM' THEN 2 
                WHEN 'LOW' THEN 3 
                ELSE 4 
            END
    LOOP
        RAISE NOTICE '      %: % findings', audit_summary.severity, audit_summary.count;
    END LOOP;
    
    RAISE NOTICE '✅ Migration audit logging system is now active';
    RAISE NOTICE '📚 Functions available:';
    RAISE NOTICE '   • log_migration_start() - Log migration initiation';
    RAISE NOTICE '   • log_migration_completion() - Log migration completion';
    RAISE NOTICE '   • generate_migration_audit_report() - Generate audit reports';
    RAISE NOTICE '   • audit_migration_security() - Security audit';
    RAISE NOTICE '📊 View migration_audit_dashboard for real-time metrics';
    RAISE NOTICE '🔧 Update migration runners to call audit functions';
END $$;