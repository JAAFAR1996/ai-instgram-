-- ===============================================
-- Connection Encryption Enhancement Migration
-- Validates and enforces encrypted connections
-- Migration: 042_connection_encryption.sql
-- ===============================================

-- 1. Create connection encryption validation function
CREATE OR REPLACE FUNCTION validate_connection_encryption()
RETURNS TABLE(
    connection_aspect TEXT,
    current_status TEXT,
    is_secure BOOLEAN,
    risk_level TEXT,
    recommendation TEXT
) AS $$
BEGIN
    -- Check if SSL is enabled globally
    RETURN QUERY SELECT 
        'GLOBAL_SSL_SETTING'::TEXT,
        current_setting('ssl', true),
        current_setting('ssl', true) = 'on',
        CASE 
            WHEN current_setting('ssl', true) = 'on' THEN 'LOW'
            ELSE 'CRITICAL'
        END,
        CASE 
            WHEN current_setting('ssl', true) = 'on' THEN 'SSL is properly enabled'
            ELSE 'Enable SSL in postgresql.conf: ssl = on'
        END;
    
    -- Check active connections encryption status
    RETURN QUERY
    WITH ssl_stats AS (
        SELECT 
            COUNT(*) as total_connections,
            COUNT(*) FILTER (WHERE ssl = true) as ssl_connections,
            COUNT(*) FILTER (WHERE ssl = false) as unencrypted_connections
        FROM pg_stat_ssl 
        JOIN pg_stat_activity ON pg_stat_ssl.pid = pg_stat_activity.pid
        WHERE pg_stat_activity.state = 'active'
        AND pg_stat_activity.pid != pg_backend_pid()
    )
    SELECT 
        'ACTIVE_CONNECTIONS'::TEXT,
        (ssl_stats.ssl_connections || '/' || ssl_stats.total_connections || ' encrypted'),
        ssl_stats.unencrypted_connections = 0,
        CASE 
            WHEN ssl_stats.unencrypted_connections = 0 THEN 'LOW'
            WHEN ssl_stats.unencrypted_connections < ssl_stats.total_connections / 2 THEN 'MEDIUM'
            ELSE 'HIGH'
        END,
        CASE 
            WHEN ssl_stats.unencrypted_connections = 0 THEN 'All active connections are encrypted'
            ELSE 'Some connections are unencrypted - enforce SSL requirements'
        END
    FROM ssl_stats;
    
    -- Check SSL certificate configuration
    RETURN QUERY SELECT 
        'SSL_CERTIFICATE'::TEXT,
        COALESCE(current_setting('ssl_cert_file', true), 'not_configured'),
        current_setting('ssl_cert_file', true) IS NOT NULL 
        AND current_setting('ssl_cert_file', true) != '',
        CASE 
            WHEN current_setting('ssl_cert_file', true) IS NOT NULL THEN 'LOW'
            ELSE 'HIGH'
        END,
        CASE 
            WHEN current_setting('ssl_cert_file', true) IS NOT NULL THEN 'SSL certificate configured'
            ELSE 'Configure SSL certificate file (ssl_cert_file)'
        END;
    
    -- Check SSL private key configuration
    RETURN QUERY SELECT 
        'SSL_PRIVATE_KEY'::TEXT,
        COALESCE(current_setting('ssl_key_file', true), 'not_configured'),
        current_setting('ssl_key_file', true) IS NOT NULL 
        AND current_setting('ssl_key_file', true) != '',
        CASE 
            WHEN current_setting('ssl_key_file', true) IS NOT NULL THEN 'LOW'
            ELSE 'HIGH'
        END,
        CASE 
            WHEN current_setting('ssl_key_file', true) IS NOT NULL THEN 'SSL private key configured'
            ELSE 'Configure SSL private key file (ssl_key_file)'
        END;
    
    -- Check password encryption method
    RETURN QUERY SELECT 
        'PASSWORD_ENCRYPTION'::TEXT,
        current_setting('password_encryption', true),
        current_setting('password_encryption', true) IN ('scram-sha-256', 'md5'),
        CASE 
            WHEN current_setting('password_encryption', true) = 'scram-sha-256' THEN 'LOW'
            WHEN current_setting('password_encryption', true) = 'md5' THEN 'MEDIUM'
            ELSE 'HIGH'
        END,
        CASE 
            WHEN current_setting('password_encryption', true) = 'scram-sha-256' THEN 'Using secure SCRAM-SHA-256 encryption'
            WHEN current_setting('password_encryption', true) = 'md5' THEN 'Consider upgrading to SCRAM-SHA-256'
            ELSE 'Configure secure password encryption method'
        END;
    
    -- Check TLS version configuration
    RETURN QUERY SELECT 
        'TLS_VERSION'::TEXT,
        COALESCE(current_setting('ssl_min_protocol_version', true), 'default'),
        COALESCE(current_setting('ssl_min_protocol_version', true), '') >= 'TLSv1.2',
        CASE 
            WHEN COALESCE(current_setting('ssl_min_protocol_version', true), '') >= 'TLSv1.3' THEN 'LOW'
            WHEN COALESCE(current_setting('ssl_min_protocol_version', true), '') >= 'TLSv1.2' THEN 'MEDIUM'
            ELSE 'HIGH'
        END,
        CASE 
            WHEN COALESCE(current_setting('ssl_min_protocol_version', true), '') >= 'TLSv1.3' THEN 'Using modern TLS 1.3'
            WHEN COALESCE(current_setting('ssl_min_protocol_version', true), '') >= 'TLSv1.2' THEN 'Using secure TLS 1.2+'
            ELSE 'Set minimum TLS version to 1.2 or higher'
        END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create function to analyze connection security patterns
CREATE OR REPLACE FUNCTION analyze_connection_patterns()
RETURNS TABLE(
    pattern_type TEXT,
    count BIGINT,
    percentage NUMERIC,
    security_impact TEXT,
    recommendations TEXT[]
) AS $$
DECLARE
    total_connections BIGINT;
    recommendations_array TEXT[];
BEGIN
    -- Get total connection count
    SELECT COUNT(*) INTO total_connections
    FROM pg_stat_activity 
    WHERE state = 'active' AND pid != pg_backend_pid();
    
    IF total_connections = 0 THEN
        RETURN QUERY SELECT 
            'NO_ACTIVE_CONNECTIONS'::TEXT,
            0::BIGINT,
            0::NUMERIC,
            'No security impact'::TEXT,
            ARRAY[]::TEXT[];
        RETURN;
    END IF;
    
    -- Analyze SSL connection patterns
    RETURN QUERY
    WITH connection_analysis AS (
        SELECT 
            CASE 
                WHEN ssl.ssl = true THEN 'SSL_ENCRYPTED'
                ELSE 'UNENCRYPTED'
            END as pattern,
            COUNT(*) as conn_count,
            ROUND((COUNT(*)::NUMERIC / total_connections) * 100, 2) as pct
        FROM pg_stat_ssl ssl
        JOIN pg_stat_activity act ON ssl.pid = act.pid
        WHERE act.state = 'active' AND act.pid != pg_backend_pid()
        GROUP BY ssl.ssl
    )
    SELECT 
        ca.pattern,
        ca.conn_count,
        ca.pct,
        CASE 
            WHEN ca.pattern = 'SSL_ENCRYPTED' THEN 'Positive - connections are secure'
            ELSE 'High Risk - unencrypted data transmission'
        END,
        CASE 
            WHEN ca.pattern = 'SSL_ENCRYPTED' THEN ARRAY['Continue monitoring SSL usage']
            ELSE ARRAY[
                'Configure SSL certificates', 
                'Update pg_hba.conf to require hostssl',
                'Update client connection strings to require SSL'
            ]
        END
    FROM connection_analysis ca;
    
    -- Analyze application connection patterns
    RETURN QUERY
    WITH app_analysis AS (
        SELECT 
            COALESCE(application_name, 'unknown') as app_name,
            COUNT(*) as conn_count,
            ROUND((COUNT(*)::NUMERIC / total_connections) * 100, 2) as pct,
            COUNT(*) FILTER (WHERE ssl.ssl = true) as ssl_count
        FROM pg_stat_activity act
        LEFT JOIN pg_stat_ssl ssl ON act.pid = ssl.pid
        WHERE act.state = 'active' AND act.pid != pg_backend_pid()
        GROUP BY application_name
        HAVING COUNT(*) > 0
    )
    SELECT 
        ('APPLICATION_' || UPPER(REPLACE(aa.app_name, '-', '_')))::TEXT,
        aa.conn_count,
        aa.pct,
        CASE 
            WHEN aa.ssl_count = aa.conn_count THEN 'Secure - all connections encrypted'
            WHEN aa.ssl_count > 0 THEN 'Mixed - some connections unencrypted'
            ELSE 'Insecure - no encrypted connections'
        END,
        CASE 
            WHEN aa.ssl_count = aa.conn_count THEN ARRAY['Maintain current security standards']
            ELSE ARRAY[
                'Ensure application connection strings use SSL',
                'Verify SSL configuration in application settings'
            ]
        END
    FROM app_analysis aa;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create function to enforce connection encryption policies
CREATE OR REPLACE FUNCTION enforce_encryption_policies()
RETURNS TABLE(
    policy_name TEXT,
    action_taken TEXT,
    result TEXT,
    details TEXT
) AS $$
DECLARE
    policy_result TEXT;
BEGIN
    -- Create SSL-only access policy
    BEGIN
        -- Note: This is informational as pg_hba.conf changes require server restart
        RETURN QUERY SELECT 
            'PG_HBA_SSL_ENFORCEMENT'::TEXT,
            'RECOMMENDATION'::TEXT,
            'MANUAL_ACTION_REQUIRED'::TEXT,
            'Add "hostssl" entries to pg_hba.conf and remove "host" entries for production'::TEXT;
    END;
    
    -- Create database-level SSL requirement function
    BEGIN
        CREATE OR REPLACE FUNCTION require_ssl_connection()
        RETURNS TRIGGER AS $trigger$
        BEGIN
            -- Check if connection is using SSL
            IF NOT COALESCE(pg_ssl_is_used(), false) THEN
                RAISE EXCEPTION 'SSL connection required. Please connect using SSL encryption.'
                    USING HINT = 'Add sslmode=require to your connection string';
            END IF;
            RETURN NULL;
        END;
        $trigger$ LANGUAGE plpgsql SECURITY DEFINER;
        
        policy_result := 'SUCCESS';
    EXCEPTION WHEN OTHERS THEN
        policy_result := 'FAILED: ' || SQLERRM;
    END;
    
    RETURN QUERY SELECT 
        'SSL_CONNECTION_TRIGGER'::TEXT,
        'CREATE_FUNCTION'::TEXT,
        policy_result,
        'Created function to validate SSL connections'::TEXT;
    
    -- Create audit function for unencrypted connections
    BEGIN
        CREATE OR REPLACE FUNCTION audit_unencrypted_connections()
        RETURNS void AS $audit$
        DECLARE
            unencrypted_count INTEGER;
        BEGIN
            SELECT COUNT(*) INTO unencrypted_count
            FROM pg_stat_ssl ssl
            JOIN pg_stat_activity act ON ssl.pid = act.pid
            WHERE act.state = 'active' 
            AND act.pid != pg_backend_pid()
            AND ssl.ssl = false;
            
            IF unencrypted_count > 0 THEN
                INSERT INTO audit_logs (
                    entity_type, entity_id, action, performed_by,
                    details, created_at
                ) VALUES (
                    'UNENCRYPTED_CONNECTIONS',
                    'security_audit',
                    'DETECTED',
                    current_user,
                    jsonb_build_object(
                        'unencrypted_connections', unencrypted_count,
                        'timestamp', NOW(),
                        'risk_level', 'HIGH'
                    ),
                    NOW()
                );
            END IF;
        END;
        $audit$ LANGUAGE plpgsql SECURITY DEFINER;
        
        policy_result := 'SUCCESS';
    EXCEPTION WHEN OTHERS THEN
        policy_result := 'FAILED: ' || SQLERRM;
    END;
    
    RETURN QUERY SELECT 
        'UNENCRYPTED_AUDIT_FUNCTION'::TEXT,
        'CREATE_FUNCTION'::TEXT,
        policy_result,
        'Created function to audit unencrypted connections'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create comprehensive connection security report
CREATE OR REPLACE FUNCTION generate_connection_security_report()
RETURNS TABLE(
    report_category TEXT,
    item_name TEXT,
    status TEXT,
    risk_level TEXT,
    current_value TEXT,
    recommendation TEXT
) AS $$
BEGIN
    -- Connection encryption validation
    RETURN QUERY
    SELECT 
        'CONNECTION_ENCRYPTION'::TEXT,
        v.connection_aspect,
        CASE WHEN v.is_secure THEN 'PASS' ELSE 'FAIL' END,
        v.risk_level,
        v.current_status,
        v.recommendation
    FROM validate_connection_encryption() v;
    
    -- Connection patterns analysis
    RETURN QUERY
    WITH pattern_summary AS (
        SELECT 
            p.pattern_type,
            p.security_impact,
            array_to_string(p.recommendations, '; ') as combined_recommendations
        FROM analyze_connection_patterns() p
        WHERE p.count > 0
    )
    SELECT 
        'CONNECTION_PATTERNS'::TEXT,
        ps.pattern_type,
        CASE 
            WHEN ps.security_impact LIKE 'Positive%' THEN 'PASS'
            WHEN ps.security_impact LIKE 'Mixed%' THEN 'WARN'
            ELSE 'FAIL'
        END,
        CASE 
            WHEN ps.security_impact LIKE 'Positive%' THEN 'LOW'
            WHEN ps.security_impact LIKE 'Mixed%' THEN 'MEDIUM'
            ELSE 'HIGH'
        END,
        ps.security_impact,
        ps.combined_recommendations
    FROM pattern_summary ps;
    
    -- Policy enforcement status
    RETURN QUERY
    SELECT 
        'POLICY_ENFORCEMENT'::TEXT,
        e.policy_name,
        e.result,
        CASE 
            WHEN e.result = 'SUCCESS' THEN 'LOW'
            WHEN e.result LIKE 'MANUAL%' THEN 'MEDIUM'
            ELSE 'HIGH'
        END,
        e.action_taken,
        e.details
    FROM enforce_encryption_policies() e;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Create connection security dashboard view
CREATE OR REPLACE VIEW connection_security_dashboard AS
WITH security_metrics AS (
    SELECT 
        'ENCRYPTION_COMPLIANCE' as metric_name,
        COUNT(*) as total_checks,
        COUNT(*) FILTER (WHERE is_secure = true) as passed_checks,
        ROUND(
            (COUNT(*) FILTER (WHERE is_secure = true)::NUMERIC / COUNT(*)) * 100,
            1
        ) as compliance_percentage
    FROM validate_connection_encryption()
    WHERE connection_aspect != 'ACTIVE_CONNECTIONS'
    
    UNION ALL
    
    SELECT 
        'CONNECTION_ENCRYPTION' as metric_name,
        SUM(count)::INTEGER as total_checks,
        SUM(count) FILTER (WHERE pattern_type = 'SSL_ENCRYPTED')::INTEGER as passed_checks,
        CASE 
            WHEN SUM(count) > 0 THEN
                ROUND(
                    (SUM(count) FILTER (WHERE pattern_type = 'SSL_ENCRYPTED')::NUMERIC / SUM(count)) * 100,
                    1
                )
            ELSE 0
        END as compliance_percentage
    FROM analyze_connection_patterns()
    WHERE pattern_type IN ('SSL_ENCRYPTED', 'UNENCRYPTED')
)
SELECT 
    metric_name,
    total_checks,
    passed_checks,
    compliance_percentage,
    CASE 
        WHEN compliance_percentage >= 95 THEN 'EXCELLENT'
        WHEN compliance_percentage >= 80 THEN 'GOOD'
        WHEN compliance_percentage >= 60 THEN 'FAIR'
        ELSE 'POOR'
    END as security_grade
FROM security_metrics;

-- 6. Grant permissions on new functions
GRANT EXECUTE ON FUNCTION validate_connection_encryption() TO app_user, postgres;
GRANT EXECUTE ON FUNCTION analyze_connection_patterns() TO app_user, postgres;
GRANT EXECUTE ON FUNCTION enforce_encryption_policies() TO postgres; -- Admin only
GRANT EXECUTE ON FUNCTION generate_connection_security_report() TO app_user, postgres;
GRANT EXECUTE ON FUNCTION require_ssl_connection() TO app_user, postgres;
GRANT EXECUTE ON FUNCTION audit_unencrypted_connections() TO app_user, postgres;
GRANT SELECT ON connection_security_dashboard TO app_user, postgres;

-- 7. Create scheduled audit job (using pg_cron if available, otherwise manual)
DO $$
BEGIN
    -- Try to schedule audit job if pg_cron is available
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        BEGIN
            PERFORM cron.schedule(
                'audit-unencrypted-connections',
                '*/15 * * * *', -- Every 15 minutes
                'SELECT audit_unencrypted_connections();'
            );
            RAISE NOTICE 'Scheduled unencrypted connection audit every 15 minutes';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not schedule audit job - pg_cron may not be available';
        END;
    ELSE
        RAISE NOTICE 'pg_cron not available - run audit_unencrypted_connections() manually';
    END IF;
END $$;

-- 8. Run immediate connection security assessment
DO $$
DECLARE
    security_report RECORD;
    critical_issues INTEGER := 0;
    high_issues INTEGER := 0;
    recommendations TEXT[] := '{}';
BEGIN
    RAISE NOTICE '🔐 Analyzing connection encryption security...';
    
    FOR security_report IN 
        SELECT * FROM generate_connection_security_report()
        ORDER BY 
            CASE risk_level 
                WHEN 'CRITICAL' THEN 1 
                WHEN 'HIGH' THEN 2 
                WHEN 'MEDIUM' THEN 3 
                ELSE 4 
            END,
            report_category, item_name
    LOOP
        IF security_report.risk_level = 'CRITICAL' THEN
            critical_issues := critical_issues + 1;
            RAISE NOTICE '   🚨 [%] %: % - %', 
                security_report.risk_level,
                security_report.item_name,
                security_report.status,
                security_report.current_value;
            recommendations := array_append(recommendations, security_report.recommendation);
        ELSIF security_report.risk_level = 'HIGH' THEN
            high_issues := high_issues + 1;
            RAISE NOTICE '   ⚠️  [%] %: % - %', 
                security_report.risk_level,
                security_report.item_name,
                security_report.status,
                security_report.current_value;
        ELSIF security_report.status != 'PASS' THEN
            RAISE NOTICE '   ℹ️  [%] %: % - %', 
                security_report.risk_level,
                security_report.item_name,
                security_report.status,
                security_report.current_value;
        END IF;
    END LOOP;
    
    -- Summary and recommendations
    RAISE NOTICE '🔐 Connection Encryption Security Summary:';
    IF critical_issues = 0 AND high_issues = 0 THEN
        RAISE NOTICE '   ✅ Connection encryption configuration appears secure';
    ELSE
        RAISE NOTICE '   ⚠️  Found % critical and % high-risk encryption issues', critical_issues, high_issues;
        
        IF array_length(recommendations, 1) > 0 THEN
            RAISE NOTICE '   📋 Priority recommendations:';
            FOR i IN 1..LEAST(array_length(recommendations, 1), 3) LOOP
                RAISE NOTICE '      • %', recommendations[i];
            END LOOP;
        END IF;
    END IF;
    
    RAISE NOTICE '📊 View connection_security_dashboard for metrics';
    RAISE NOTICE '🔍 Run generate_connection_security_report() for detailed analysis';
    RAISE NOTICE '🔧 Run audit_unencrypted_connections() to monitor connection security';
END $$;

-- 9. Add migration tracking
INSERT INTO schema_migrations (version, applied_at, success, description)
VALUES (
    '042_connection_encryption.sql', 
    NOW(), 
    TRUE,
    'Enhanced connection encryption validation and enforcement'
)
ON CONFLICT (version) DO UPDATE SET 
    applied_at = NOW(),
    success = TRUE,
    description = EXCLUDED.description;

-- 10. Final connection security metrics
DO $$
DECLARE
    dashboard_metric RECORD;
BEGIN
    RAISE NOTICE '🔐 Connection Security Metrics:';
    
    FOR dashboard_metric IN SELECT * FROM connection_security_dashboard
    LOOP
        RAISE NOTICE '   📊 %: %.1f%% compliant (%/%)', 
            dashboard_metric.metric_name,
            dashboard_metric.compliance_percentage,
            dashboard_metric.passed_checks,
            dashboard_metric.total_checks;
        RAISE NOTICE '      Security Grade: %', dashboard_metric.security_grade;
    END LOOP;
    
    RAISE NOTICE '✅ Connection encryption enhancement completed';
    RAISE NOTICE '📚 Next steps: Configure SSL certificates and update pg_hba.conf';
    RAISE NOTICE '🔧 Consider implementing hostssl-only access for production';
END $$;