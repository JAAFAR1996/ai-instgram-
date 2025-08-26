-- ===============================================
-- Comprehensive Health Checks System
-- 💾 Stage 4: Risk Management - Complete system health monitoring
-- Migration: 048_comprehensive_health_checks.sql
-- ===============================================

-- 💾 1. Create health check results table
CREATE TABLE IF NOT EXISTS system_health_checks (
    id SERIAL PRIMARY KEY,
    check_id UUID DEFAULT gen_random_uuid(),
    check_category VARCHAR(100) NOT NULL,
    check_name VARCHAR(255) NOT NULL,
    check_status VARCHAR(20) NOT NULL CHECK (check_status IN ('passed', 'warning', 'failed', 'unknown')),
    check_message TEXT,
    check_details JSONB,
    severity VARCHAR(20) DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    expected_value TEXT,
    actual_value TEXT,
    threshold_config JSONB,
    check_duration INTERVAL,
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '1 hour'),
    remediation_steps TEXT[],
    alert_sent BOOLEAN DEFAULT false
);

-- Add indexes for health check queries
CREATE INDEX IF NOT EXISTS idx_system_health_checks_category 
ON system_health_checks (check_category, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_health_checks_status 
ON system_health_checks (check_status, executed_at DESC) 
WHERE check_status IN ('warning', 'failed');

CREATE INDEX IF NOT EXISTS idx_system_health_checks_active 
ON system_health_checks (executed_at DESC) 
WHERE expires_at > CURRENT_TIMESTAMP;

-- 💾 2. Create database health check function
CREATE OR REPLACE FUNCTION check_database_health()
RETURNS SETOF system_health_checks
LANGUAGE plpgsql
AS $$
DECLARE
    check_start_time TIMESTAMP;
    db_size BIGINT;
    active_connections INTEGER;
    max_connections INTEGER;
    connection_ratio NUMERIC;
    cache_hit_ratio NUMERIC;
    deadlock_count INTEGER;
    temp_files BIGINT;
    checkpoint_avg NUMERIC;
BEGIN
    check_start_time := CURRENT_TIMESTAMP;
    
    -- Database size check
    SELECT pg_database_size(current_database()) INTO db_size;
    
    INSERT INTO system_health_checks (
        check_category, check_name, check_status, check_message, 
        check_details, actual_value, check_duration
    ) VALUES (
        'database', 'database_size', 
        CASE WHEN db_size > 50000000000 THEN 'warning' ELSE 'passed' END,
        format('Database size: %s MB', ROUND(db_size / 1024.0 / 1024.0, 2)),
        jsonb_build_object('size_bytes', db_size, 'size_mb', ROUND(db_size / 1024.0 / 1024.0, 2)),
        ROUND(db_size / 1024.0 / 1024.0, 2)::text || ' MB',
        CURRENT_TIMESTAMP - check_start_time
    );
    
    -- Connection usage check
    SELECT COUNT(*) INTO active_connections FROM pg_stat_activity WHERE state = 'active';
    SELECT setting::integer INTO max_connections FROM pg_settings WHERE name = 'max_connections';
    connection_ratio := (active_connections::NUMERIC / max_connections) * 100;
    
    INSERT INTO system_health_checks (
        check_category, check_name, check_status, check_message,
        check_details, actual_value, expected_value, severity
    ) VALUES (
        'database', 'connection_usage',
        CASE 
            WHEN connection_ratio > 80 THEN 'failed'
            WHEN connection_ratio > 60 THEN 'warning'
            ELSE 'passed'
        END,
        format('Connection usage: %s/%s (%s%%)', active_connections, max_connections, ROUND(connection_ratio, 1)),
        jsonb_build_object(
            'active_connections', active_connections,
            'max_connections', max_connections,
            'usage_percentage', ROUND(connection_ratio, 1)
        ),
        ROUND(connection_ratio, 1)::text || '%',
        '< 60%',
        CASE WHEN connection_ratio > 80 THEN 'high' ELSE 'medium' END
    );
    
    -- Cache hit ratio check
    SELECT ROUND(
        (sum(blks_hit) / NULLIF(sum(blks_hit + blks_read), 0) * 100)::NUMERIC, 2
    ) INTO cache_hit_ratio
    FROM pg_stat_database WHERE datname = current_database();
    
    INSERT INTO system_health_checks (
        check_category, check_name, check_status, check_message,
        check_details, actual_value, expected_value
    ) VALUES (
        'database', 'cache_hit_ratio',
        CASE 
            WHEN cache_hit_ratio < 90 THEN 'warning'
            WHEN cache_hit_ratio < 95 THEN 'passed'
            ELSE 'passed'
        END,
        format('Cache hit ratio: %s%%', COALESCE(cache_hit_ratio, 0)),
        jsonb_build_object('hit_ratio', COALESCE(cache_hit_ratio, 0)),
        COALESCE(cache_hit_ratio, 0)::text || '%',
        '> 95%'
    );
    
    -- Deadlock check
    SELECT COALESCE(deadlocks, 0) INTO deadlock_count
    FROM pg_stat_database WHERE datname = current_database();
    
    INSERT INTO system_health_checks (
        check_category, check_name, check_status, check_message,
        check_details, actual_value, severity
    ) VALUES (
        'database', 'deadlock_count',
        CASE 
            WHEN deadlock_count > 100 THEN 'failed'
            WHEN deadlock_count > 50 THEN 'warning'
            ELSE 'passed'
        END,
        format('Total deadlocks: %s', deadlock_count),
        jsonb_build_object('deadlock_count', deadlock_count),
        deadlock_count::text,
        CASE WHEN deadlock_count > 100 THEN 'high' ELSE 'medium' END
    );
    
    -- Temp files check
    SELECT COALESCE(temp_files, 0) INTO temp_files
    FROM pg_stat_database WHERE datname = current_database();
    
    INSERT INTO system_health_checks (
        check_category, check_name, check_status, check_message,
        check_details, actual_value
    ) VALUES (
        'database', 'temporary_files',
        CASE WHEN temp_files > 1000 THEN 'warning' ELSE 'passed' END,
        format('Temporary files created: %s', temp_files),
        jsonb_build_object('temp_files', temp_files),
        temp_files::text
    );
    
    RETURN QUERY SELECT * FROM system_health_checks 
    WHERE executed_at >= check_start_time;
END;
$$;

-- 💾 3. Create migration system health check
CREATE OR REPLACE FUNCTION check_migration_health()
RETURNS SETOF system_health_checks
LANGUAGE plpgsql
AS $$
DECLARE
    check_start_time TIMESTAMP;
    failed_migrations INTEGER;
    pending_migrations INTEGER;
    recent_failures INTEGER;
    backup_coverage NUMERIC;
    oldest_backup_days INTEGER;
BEGIN
    check_start_time := CURRENT_TIMESTAMP;
    
    -- Failed migrations check
    SELECT COUNT(*) INTO failed_migrations
    FROM migration_audit_logs
    WHERE execution_status = 'FAILED';
    
    INSERT INTO system_health_checks (
        check_category, check_name, check_status, check_message,
        check_details, actual_value, severity,
        remediation_steps
    ) VALUES (
        'migration', 'failed_migrations',
        CASE WHEN failed_migrations > 0 THEN 'failed' ELSE 'passed' END,
        format('Failed migrations: %s', failed_migrations),
        jsonb_build_object('failed_count', failed_migrations),
        failed_migrations::text,
        CASE WHEN failed_migrations > 0 THEN 'high' ELSE 'low' END,
        ARRAY['Review failed migration logs', 'Plan rollback if necessary', 'Fix underlying issues']
    );
    
    -- Recent migration failures
    SELECT COUNT(*) INTO recent_failures
    FROM migration_audit_logs
    WHERE execution_status = 'FAILED'
    AND started_at > CURRENT_TIMESTAMP - INTERVAL '7 days';
    
    INSERT INTO system_health_checks (
        check_category, check_name, check_status, check_message,
        check_details, actual_value
    ) VALUES (
        'migration', 'recent_failures',
        CASE 
            WHEN recent_failures > 3 THEN 'failed'
            WHEN recent_failures > 1 THEN 'warning'
            ELSE 'passed'
        END,
        format('Migration failures in last 7 days: %s', recent_failures),
        jsonb_build_object('recent_failures', recent_failures),
        recent_failures::text
    );
    
    -- Backup coverage check
    SELECT 
        (COUNT(CASE WHEN mb.backup_id IS NOT NULL THEN 1 END)::NUMERIC / 
         NULLIF(COUNT(*), 0) * 100)
    INTO backup_coverage
    FROM migration_audit_logs mal
    LEFT JOIN migration_backups mb ON mal.migration_version = mb.migration_version
        AND mb.backup_type = 'pre_migration'
        AND mb.backup_status = 'completed'
    WHERE mal.execution_status = 'SUCCESS'
    AND mal.started_at > CURRENT_TIMESTAMP - INTERVAL '30 days';
    
    INSERT INTO system_health_checks (
        check_category, check_name, check_status, check_message,
        check_details, actual_value, expected_value
    ) VALUES (
        'migration', 'backup_coverage',
        CASE 
            WHEN backup_coverage < 80 THEN 'warning'
            WHEN backup_coverage < 90 THEN 'passed'
            ELSE 'passed'
        END,
        format('Migration backup coverage: %s%%', ROUND(COALESCE(backup_coverage, 0), 1)),
        jsonb_build_object('backup_coverage_percent', ROUND(COALESCE(backup_coverage, 0), 1)),
        ROUND(COALESCE(backup_coverage, 0), 1)::text || '%',
        '> 90%'
    );
    
    -- Oldest backup age check
    SELECT EXTRACT(DAYS FROM (CURRENT_TIMESTAMP - MIN(backup_timestamp)))::INTEGER 
    INTO oldest_backup_days
    FROM migration_backups 
    WHERE backup_status = 'completed';
    
    INSERT INTO system_health_checks (
        check_category, check_name, check_status, check_message,
        check_details, actual_value
    ) VALUES (
        'migration', 'backup_freshness',
        CASE 
            WHEN oldest_backup_days > 30 THEN 'warning'
            WHEN oldest_backup_days > 7 THEN 'passed'
            ELSE 'passed'
        END,
        format('Oldest backup age: %s days', COALESCE(oldest_backup_days, 0)),
        jsonb_build_object('oldest_backup_days', COALESCE(oldest_backup_days, 0)),
        COALESCE(oldest_backup_days, 0)::text || ' days'
    );
    
    RETURN QUERY SELECT * FROM system_health_checks 
    WHERE executed_at >= check_start_time;
END;
$$;

-- 💾 4. Create security health check
CREATE OR REPLACE FUNCTION check_security_health()
RETURNS SETOF system_health_checks
LANGUAGE plpgsql
AS $$
DECLARE
    check_start_time TIMESTAMP;
    rls_enabled_tables INTEGER;
    total_user_tables INTEGER;
    rls_coverage NUMERIC;
    weak_passwords INTEGER;
    ssl_connections INTEGER;
    total_connections INTEGER;
BEGIN
    check_start_time := CURRENT_TIMESTAMP;
    
    -- RLS coverage check
    SELECT COUNT(*) INTO rls_enabled_tables
    FROM pg_tables t
    JOIN pg_class c ON c.relname = t.tablename
    WHERE t.schemaname = 'public'
    AND c.relrowsecurity = true;
    
    SELECT COUNT(*) INTO total_user_tables
    FROM pg_tables 
    WHERE schemaname = 'public';
    
    rls_coverage := (rls_enabled_tables::NUMERIC / NULLIF(total_user_tables, 0)) * 100;
    
    INSERT INTO system_health_checks (
        check_category, check_name, check_status, check_message,
        check_details, actual_value, expected_value
    ) VALUES (
        'security', 'rls_coverage',
        CASE 
            WHEN rls_coverage < 70 THEN 'warning'
            WHEN rls_coverage < 90 THEN 'passed'
            ELSE 'passed'
        END,
        format('RLS enabled on %s/%s tables (%s%%)', 
               rls_enabled_tables, total_user_tables, ROUND(COALESCE(rls_coverage, 0), 1)),
        jsonb_build_object(
            'rls_enabled_tables', rls_enabled_tables,
            'total_tables', total_user_tables,
            'coverage_percent', ROUND(COALESCE(rls_coverage, 0), 1)
        ),
        ROUND(COALESCE(rls_coverage, 0), 1)::text || '%',
        '> 90%'
    );
    
    -- SSL connection check
    SELECT COUNT(*) INTO ssl_connections
    FROM pg_stat_ssl pss
    JOIN pg_stat_activity psa ON pss.pid = psa.pid
    WHERE pss.ssl = true;
    
    SELECT COUNT(*) INTO total_connections
    FROM pg_stat_activity
    WHERE state IN ('active', 'idle', 'idle in transaction');
    
    INSERT INTO system_health_checks (
        check_category, check_name, check_status, check_message,
        check_details, actual_value, expected_value
    ) VALUES (
        'security', 'ssl_connections',
        CASE 
            WHEN ssl_connections::NUMERIC / NULLIF(total_connections, 0) < 0.8 THEN 'warning'
            ELSE 'passed'
        END,
        format('SSL connections: %s/%s (%s%%)', 
               ssl_connections, total_connections,
               ROUND((ssl_connections::NUMERIC / NULLIF(total_connections, 0)) * 100, 1)),
        jsonb_build_object(
            'ssl_connections', ssl_connections,
            'total_connections', total_connections,
            'ssl_percentage', ROUND((ssl_connections::NUMERIC / NULLIF(total_connections, 0)) * 100, 1)
        ),
        ssl_connections::text,
        '> 80%'
    );
    
    RETURN QUERY SELECT * FROM system_health_checks 
    WHERE executed_at >= check_start_time;
END;
$$;

-- 💾 5. Create performance health check
CREATE OR REPLACE FUNCTION check_performance_health()
RETURNS SETOF system_health_checks
LANGUAGE plpgsql
AS $$
DECLARE
    check_start_time TIMESTAMP;
    slow_queries INTEGER;
    avg_query_time NUMERIC;
    unused_indexes INTEGER;
    bloated_tables INTEGER;
    index_usage NUMERIC;
BEGIN
    check_start_time := CURRENT_TIMESTAMP;
    
    -- Query performance check
    SELECT COALESCE(AVG(mean_time), 0) INTO avg_query_time
    FROM pg_stat_statements
    WHERE calls > 100;
    
    INSERT INTO system_health_checks (
        check_category, check_name, check_status, check_message,
        check_details, actual_value, expected_value
    ) VALUES (
        'performance', 'avg_query_time',
        CASE 
            WHEN avg_query_time > 1000 THEN 'warning'
            WHEN avg_query_time > 500 THEN 'passed'
            ELSE 'passed'
        END,
        format('Average query time: %s ms', ROUND(avg_query_time, 2)),
        jsonb_build_object('avg_query_time_ms', ROUND(avg_query_time, 2)),
        ROUND(avg_query_time, 2)::text || ' ms',
        '< 500 ms'
    );
    
    -- Index usage check
    SELECT COUNT(*) INTO unused_indexes
    FROM pg_stat_user_indexes
    WHERE idx_scan = 0
    AND schemaname = 'public';
    
    INSERT INTO system_health_checks (
        check_category, check_name, check_status, check_message,
        check_details, actual_value,
        remediation_steps
    ) VALUES (
        'performance', 'unused_indexes',
        CASE WHEN unused_indexes > 10 THEN 'warning' ELSE 'passed' END,
        format('Unused indexes: %s', unused_indexes),
        jsonb_build_object('unused_indexes_count', unused_indexes),
        unused_indexes::text,
        ARRAY['Review unused indexes', 'Consider dropping if truly unused', 'Analyze query patterns']
    );
    
    RETURN QUERY SELECT * FROM system_health_checks 
    WHERE executed_at >= check_start_time;
END;
$$;

-- 💾 6. Create comprehensive health check runner
CREATE OR REPLACE FUNCTION run_comprehensive_health_check()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    health_summary JSONB;
    check_start_time TIMESTAMP;
    total_checks INTEGER;
    passed_checks INTEGER;
    warning_checks INTEGER;
    failed_checks INTEGER;
BEGIN
    check_start_time := CURRENT_TIMESTAMP;
    
    -- Clear old health check results (keep last 24 hours)
    DELETE FROM system_health_checks 
    WHERE executed_at < CURRENT_TIMESTAMP - INTERVAL '24 hours';
    
    -- Run all health checks
    PERFORM check_database_health();
    PERFORM check_migration_health();
    PERFORM check_security_health();
    PERFORM check_performance_health();
    
    -- Calculate summary statistics
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE check_status = 'passed'),
        COUNT(*) FILTER (WHERE check_status = 'warning'),
        COUNT(*) FILTER (WHERE check_status = 'failed')
    INTO total_checks, passed_checks, warning_checks, failed_checks
    FROM system_health_checks 
    WHERE executed_at >= check_start_time;
    
    -- Build health summary
    health_summary := jsonb_build_object(
        'overall_status', CASE 
            WHEN failed_checks > 0 THEN 'failed'
            WHEN warning_checks > 0 THEN 'warning'
            ELSE 'passed'
        END,
        'check_timestamp', CURRENT_TIMESTAMP,
        'total_checks', total_checks,
        'passed_checks', passed_checks,
        'warning_checks', warning_checks,
        'failed_checks', failed_checks,
        'success_rate', ROUND((passed_checks::NUMERIC / NULLIF(total_checks, 0)) * 100, 1),
        'check_categories', (
            SELECT jsonb_object_agg(
                check_category,
                jsonb_build_object(
                    'total', COUNT(*),
                    'passed', COUNT(*) FILTER (WHERE check_status = 'passed'),
                    'warning', COUNT(*) FILTER (WHERE check_status = 'warning'),
                    'failed', COUNT(*) FILTER (WHERE check_status = 'failed')
                )
            )
            FROM system_health_checks 
            WHERE executed_at >= check_start_time
            GROUP BY check_category
        ),
        'critical_issues', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'check_name', check_name,
                    'status', check_status,
                    'message', check_message,
                    'severity', severity
                )
            )
            FROM system_health_checks 
            WHERE executed_at >= check_start_time
            AND check_status IN ('failed', 'warning')
            AND severity IN ('high', 'critical')
        )
    );
    
    -- Log health check execution
    INSERT INTO migration_audit_logs (
        migration_version,
        description,
        execution_status,
        metadata
    ) VALUES (
        'SYSTEM_HEALTH_CHECK',
        format('Comprehensive health check completed: %s/%s checks passed', 
               passed_checks, total_checks),
        CASE 
            WHEN failed_checks > 0 THEN 'WARNING'
            ELSE 'SUCCESS'
        END,
        health_summary
    );
    
    RETURN health_summary;
END;
$$;

-- 💾 7. Create health monitoring view
CREATE OR REPLACE VIEW health_dashboard AS
SELECT 
    'System Health' as category,
    (
        SELECT jsonb_build_object(
            'last_check', MAX(executed_at),
            'total_checks', COUNT(*),
            'passed_checks', COUNT(*) FILTER (WHERE check_status = 'passed'),
            'warning_checks', COUNT(*) FILTER (WHERE check_status = 'warning'),
            'failed_checks', COUNT(*) FILTER (WHERE check_status = 'failed'),
            'critical_issues', COUNT(*) FILTER (WHERE check_status = 'failed' AND severity = 'critical'),
            'categories', jsonb_object_agg(
                check_category,
                COUNT(*)
            )
        )
        FROM system_health_checks 
        WHERE executed_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'
    ) as metrics,
    CURRENT_TIMESTAMP as last_updated;

-- 💾 8. Create health alert function
CREATE OR REPLACE FUNCTION generate_health_alerts()
RETURNS TABLE (
    alert_level text,
    alert_message text,
    affected_systems text[],
    recommended_actions text[]
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        CASE 
            WHEN severity = 'critical' THEN 'CRITICAL'
            WHEN severity = 'high' THEN 'HIGH'
            WHEN check_status = 'failed' THEN 'MEDIUM'
            ELSE 'LOW'
        END as alert_level,
        format('%s: %s', check_name, check_message) as alert_message,
        ARRAY[check_category] as affected_systems,
        COALESCE(remediation_steps, ARRAY['Review system logs', 'Contact system administrator']) as recommended_actions
    FROM system_health_checks
    WHERE executed_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'
    AND check_status IN ('failed', 'warning')
    ORDER BY 
        CASE severity 
            WHEN 'critical' THEN 1 
            WHEN 'high' THEN 2 
            WHEN 'medium' THEN 3 
            ELSE 4 
        END,
        executed_at DESC;
END;
$$;

-- 💾 9. Log successful migration
INSERT INTO migration_audit_logs (
    migration_version,
    description,
    execution_status,
    affected_tables,
    performance_impact,
    started_at,
    completed_at
) VALUES (
    '048_comprehensive_health_checks.sql',
    'Implemented comprehensive health monitoring system with multi-category checks',
    'SUCCESS',
    ARRAY['system_health_checks', 'health monitoring functions'],
    'LOW - Health monitoring system ready for proactive issue detection',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

COMMENT ON TABLE system_health_checks IS 'Comprehensive system health monitoring and alerting';
COMMENT ON FUNCTION run_comprehensive_health_check() IS 'Executes all health checks and provides summary';
COMMENT ON FUNCTION generate_health_alerts() IS 'Generates actionable alerts based on health check results';
COMMENT ON VIEW health_dashboard IS 'Real-time system health status dashboard';