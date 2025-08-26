-- ===============================================
-- Enhanced SSL/TLS Configuration Migration
-- Implements secure connection encryption and validation
-- Migration: 041_enhance_ssl_tls.sql
-- ===============================================

-- 1. Create SSL/TLS configuration validation function
CREATE OR REPLACE FUNCTION validate_ssl_configuration()
RETURNS TABLE(
    component TEXT,
    setting_name TEXT,
    current_value TEXT,
    is_secure BOOLEAN,
    recommendation TEXT
) AS $$
BEGIN
    -- Database SSL settings
    RETURN QUERY SELECT 
        'DATABASE'::TEXT,
        'ssl'::TEXT,
        current_setting('ssl', true),
        current_setting('ssl', true) = 'on',
        CASE 
            WHEN current_setting('ssl', true) = 'on' THEN 'SSL is properly enabled'
            ELSE 'Enable SSL for database connections'
        END;
    
    RETURN QUERY SELECT 
        'DATABASE'::TEXT,
        'ssl_ciphers'::TEXT,
        COALESCE(current_setting('ssl_ciphers', true), 'default'),
        current_setting('ssl_ciphers', true) IS NOT NULL 
        AND NOT current_setting('ssl_ciphers', true) ~ '(RC4|MD5|3DES)',
        CASE 
            WHEN current_setting('ssl_ciphers', true) ~ '(RC4|MD5|3DES)' THEN 'Remove weak ciphers from configuration'
            WHEN current_setting('ssl_ciphers', true) IS NULL THEN 'Configure secure cipher suites'
            ELSE 'SSL ciphers appear secure'
        END;
        
    RETURN QUERY SELECT 
        'DATABASE'::TEXT,
        'ssl_min_protocol_version'::TEXT,
        COALESCE(current_setting('ssl_min_protocol_version', true), 'not_set'),
        current_setting('ssl_min_protocol_version', true) >= 'TLSv1.2',
        CASE 
            WHEN current_setting('ssl_min_protocol_version', true) < 'TLSv1.2' THEN 'Upgrade minimum TLS version to 1.2+'
            WHEN current_setting('ssl_min_protocol_version', true) IS NULL THEN 'Set minimum TLS version to 1.2+'
            ELSE 'TLS minimum version is secure'
        END;
        
    -- Connection encryption settings
    RETURN QUERY SELECT 
        'CONNECTION'::TEXT,
        'password_encryption'::TEXT,
        current_setting('password_encryption', true),
        current_setting('password_encryption', true) = 'scram-sha-256',
        CASE 
            WHEN current_setting('password_encryption', true) = 'scram-sha-256' THEN 'Using secure password encryption'
            ELSE 'Upgrade to SCRAM-SHA-256 password encryption'
        END;
        
    -- Log connections setting
    RETURN QUERY SELECT 
        'LOGGING'::TEXT,
        'log_connections'::TEXT,
        current_setting('log_connections', true),
        current_setting('log_connections', true) = 'on',
        CASE 
            WHEN current_setting('log_connections', true) = 'on' THEN 'Connection logging enabled'
            ELSE 'Enable connection logging for security monitoring'
        END;
        
    -- Log disconnections setting  
    RETURN QUERY SELECT 
        'LOGGING'::TEXT,
        'log_disconnections'::TEXT,
        current_setting('log_disconnections', true),
        current_setting('log_disconnections', true) = 'on',
        CASE 
            WHEN current_setting('log_disconnections', true) = 'on' THEN 'Disconnection logging enabled'
            ELSE 'Enable disconnection logging for security monitoring'
        END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create function to enforce secure connection requirements
CREATE OR REPLACE FUNCTION enforce_secure_connections()
RETURNS TABLE(
    action TEXT,
    result TEXT,
    details TEXT
) AS $$
DECLARE
    secure_role_exists BOOLEAN;
BEGIN
    -- Check if secure connection roles exist
    SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = 'secure_app_user') 
    INTO secure_role_exists;
    
    -- Create secure application role if it doesn't exist
    IF NOT secure_role_exists THEN
        BEGIN
            CREATE ROLE secure_app_user WITH LOGIN;
            ALTER ROLE secure_app_user CONNECTION LIMIT 10;
            
            -- Grant necessary permissions
            GRANT app_user TO secure_app_user;
            GRANT USAGE ON SCHEMA public TO secure_app_user;
            
            RETURN QUERY SELECT 
                'CREATE_SECURE_ROLE'::TEXT,
                'SUCCESS'::TEXT,
                'Created secure_app_user role with connection limits'::TEXT;
        EXCEPTION WHEN OTHERS THEN
            RETURN QUERY SELECT 
                'CREATE_SECURE_ROLE'::TEXT,
                'FAILED'::TEXT,
                ('Failed to create secure role: ' || SQLERRM)::TEXT;
        END;
    ELSE
        RETURN QUERY SELECT 
            'CREATE_SECURE_ROLE'::TEXT,
            'EXISTS'::TEXT,
            'Secure role already exists'::TEXT;
    END IF;
    
    -- Update pg_hba.conf recommendations (informational - requires manual action)
    RETURN QUERY SELECT 
        'PG_HBA_RECOMMENDATION'::TEXT,
        'MANUAL_ACTION'::TEXT,
        'Add "hostssl" entries to pg_hba.conf to require SSL connections'::TEXT;
        
    RETURN QUERY SELECT 
        'SSL_CERTIFICATE_CHECK'::TEXT,
        'INFO'::TEXT,
        'Ensure SSL certificates are valid and not self-signed in production'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create connection security monitoring function
CREATE OR REPLACE FUNCTION monitor_connection_security()
RETURNS TABLE(
    connection_type TEXT,
    count BIGINT,
    security_status TEXT,
    risk_level TEXT
) AS $$
BEGIN
    -- Monitor current connections by SSL status
    RETURN QUERY
    WITH connection_stats AS (
        SELECT 
            CASE 
                WHEN ssl = true THEN 'SSL_ENCRYPTED'
                ELSE 'UNENCRYPTED'
            END as conn_type,
            COUNT(*) as conn_count
        FROM pg_stat_ssl 
        JOIN pg_stat_activity ON pg_stat_ssl.pid = pg_stat_activity.pid
        WHERE pg_stat_activity.state = 'active'
        GROUP BY ssl
    )
    SELECT 
        cs.conn_type,
        cs.conn_count,
        CASE 
            WHEN cs.conn_type = 'SSL_ENCRYPTED' THEN 'SECURE'
            ELSE 'INSECURE'
        END,
        CASE 
            WHEN cs.conn_type = 'SSL_ENCRYPTED' THEN 'LOW'
            ELSE 'HIGH'
        END
    FROM connection_stats cs;
    
    -- Add summary if no active connections
    IF NOT FOUND THEN
        RETURN QUERY SELECT 
            'NO_ACTIVE_CONNECTIONS'::TEXT,
            0::BIGINT,
            'UNKNOWN'::TEXT,
            'LOW'::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create SSL certificate validation function
CREATE OR REPLACE FUNCTION validate_ssl_certificates()
RETURNS TABLE(
    certificate_aspect TEXT,
    status TEXT,
    expiry_days INTEGER,
    recommendation TEXT
) AS $$
DECLARE
    ssl_cert_file TEXT;
    ssl_key_file TEXT;
BEGIN
    -- Get SSL file paths from configuration
    ssl_cert_file := current_setting('ssl_cert_file', true);
    ssl_key_file := current_setting('ssl_key_file', true);
    
    -- Check if SSL files are configured
    IF ssl_cert_file IS NULL OR ssl_cert_file = '' THEN
        RETURN QUERY SELECT 
            'SSL_CERTIFICATE_FILE'::TEXT,
            'NOT_CONFIGURED'::TEXT,
            NULL::INTEGER,
            'Configure ssl_cert_file parameter'::TEXT;
    ELSE
        RETURN QUERY SELECT 
            'SSL_CERTIFICATE_FILE'::TEXT,
            'CONFIGURED'::TEXT,
            NULL::INTEGER,
            ('Certificate file configured: ' || ssl_cert_file)::TEXT;
    END IF;
    
    IF ssl_key_file IS NULL OR ssl_key_file = '' THEN
        RETURN QUERY SELECT 
            'SSL_PRIVATE_KEY_FILE'::TEXT,
            'NOT_CONFIGURED'::TEXT,
            NULL::INTEGER,
            'Configure ssl_key_file parameter'::TEXT;
    ELSE
        RETURN QUERY SELECT 
            'SSL_PRIVATE_KEY_FILE'::TEXT,
            'CONFIGURED'::TEXT,
            NULL::INTEGER,
            ('Private key file configured: ' || ssl_key_file)::TEXT;
    END IF;
    
    -- Check CA file configuration
    IF current_setting('ssl_ca_file', true) IS NOT NULL THEN
        RETURN QUERY SELECT 
            'SSL_CA_FILE'::TEXT,
            'CONFIGURED'::TEXT,
            NULL::INTEGER,
            'CA file configured for client certificate verification'::TEXT;
    ELSE
        RETURN QUERY SELECT 
            'SSL_CA_FILE'::TEXT,
            'NOT_CONFIGURED'::TEXT,
            NULL::INTEGER,
            'Consider configuring CA file for enhanced security'::TEXT;
    END IF;
    
    -- SSL mode recommendations
    RETURN QUERY SELECT 
        'SSL_MODE_RECOMMENDATION'::TEXT,
        'INFO'::TEXT,
        NULL::INTEGER,
        'Ensure client connections use sslmode=require or sslmode=verify-full'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Create encryption audit trail function
CREATE OR REPLACE FUNCTION create_encryption_audit_trail()
RETURNS TRIGGER AS $$
BEGIN
    -- Log encryption-related configuration changes
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        INSERT INTO audit_logs (
            entity_type, entity_id, action, performed_by,
            details, created_at
        ) VALUES (
            'ENCRYPTION_CONFIG',
            TG_TABLE_NAME,
            TG_OP,
            current_user,
            jsonb_build_object(
                'table', TG_TABLE_NAME,
                'ssl_enabled', current_setting('ssl', true) = 'on',
                'connection_encrypted', 
                    CASE 
                        WHEN pg_ssl_is_used() THEN true 
                        ELSE false 
                    END,
                'password_encryption', current_setting('password_encryption', true),
                'timestamp', NOW()
            ),
            NOW()
        );
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Create comprehensive SSL/TLS security report
CREATE OR REPLACE FUNCTION generate_ssl_security_report()
RETURNS TABLE(
    report_section TEXT,
    item TEXT,
    status TEXT,
    risk_level TEXT,
    details TEXT,
    action_required TEXT
) AS $$
BEGIN
    -- SSL Configuration Analysis
    RETURN QUERY
    SELECT 
        'SSL_CONFIGURATION'::TEXT,
        s.setting_name,
        CASE WHEN s.is_secure THEN 'PASS' ELSE 'FAIL' END,
        CASE 
            WHEN s.setting_name IN ('ssl', 'ssl_min_protocol_version') AND NOT s.is_secure THEN 'HIGH'
            WHEN NOT s.is_secure THEN 'MEDIUM'
            ELSE 'LOW'
        END,
        s.current_value,
        s.recommendation
    FROM validate_ssl_configuration() s;
    
    -- Connection Security Analysis
    RETURN QUERY
    SELECT 
        'CONNECTION_SECURITY'::TEXT,
        m.connection_type,
        m.security_status,
        m.risk_level,
        ('Active connections: ' || m.count)::TEXT,
        CASE 
            WHEN m.connection_type = 'UNENCRYPTED' THEN 'Enforce SSL connections'
            ELSE 'Continue monitoring'
        END
    FROM monitor_connection_security() m;
    
    -- Certificate Validation
    RETURN QUERY
    SELECT 
        'CERTIFICATE_VALIDATION'::TEXT,
        c.certificate_aspect,
        c.status,
        CASE 
            WHEN c.status = 'NOT_CONFIGURED' THEN 'HIGH'
            ELSE 'LOW'
        END,
        COALESCE('Expiry days: ' || c.expiry_days::TEXT, 'N/A'),
        c.recommendation
    FROM validate_ssl_certificates() c;
    
    -- Security Enforcement Status
    RETURN QUERY
    SELECT 
        'SECURITY_ENFORCEMENT'::TEXT,
        e.action,
        e.result,
        CASE 
            WHEN e.result = 'FAILED' THEN 'HIGH'
            WHEN e.result = 'MANUAL_ACTION' THEN 'MEDIUM'
            ELSE 'LOW'
        END,
        e.details,
        CASE 
            WHEN e.result = 'FAILED' THEN 'Resolve configuration issues'
            WHEN e.result = 'MANUAL_ACTION' THEN 'Complete manual configuration'
            ELSE 'No action required'
        END
    FROM enforce_secure_connections() e;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Create SSL/TLS monitoring view
CREATE OR REPLACE VIEW ssl_security_dashboard AS
SELECT 
    'SSL_CONFIGURATION' as metric_category,
    COUNT(*) as total_checks,
    COUNT(*) FILTER (WHERE is_secure = true) as passed_checks,
    COUNT(*) FILTER (WHERE is_secure = false) as failed_checks,
    ROUND(
        (COUNT(*) FILTER (WHERE is_secure = true)::NUMERIC / COUNT(*)) * 100, 
        2
    ) as security_score_pct
FROM validate_ssl_configuration()
UNION ALL
SELECT 
    'CONNECTION_ENCRYPTION' as metric_category,
    SUM(count)::INTEGER as total_checks,
    SUM(count) FILTER (WHERE security_status = 'SECURE')::INTEGER as passed_checks,
    SUM(count) FILTER (WHERE security_status = 'INSECURE')::INTEGER as failed_checks,
    CASE 
        WHEN SUM(count) > 0 THEN
            ROUND(
                (SUM(count) FILTER (WHERE security_status = 'SECURE')::NUMERIC / SUM(count)) * 100, 
                2
            )
        ELSE 0
    END as security_score_pct
FROM monitor_connection_security();

-- 8. Grant permissions on SSL functions
GRANT EXECUTE ON FUNCTION validate_ssl_configuration() TO app_user, postgres;
GRANT EXECUTE ON FUNCTION enforce_secure_connections() TO postgres; -- Only postgres can modify roles
GRANT EXECUTE ON FUNCTION monitor_connection_security() TO app_user, postgres;
GRANT EXECUTE ON FUNCTION validate_ssl_certificates() TO app_user, postgres;
GRANT EXECUTE ON FUNCTION generate_ssl_security_report() TO app_user, postgres;
GRANT SELECT ON ssl_security_dashboard TO app_user, postgres;

-- 9. Create indexes for SSL audit logs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_encryption_config
    ON audit_logs (entity_type, created_at) 
    WHERE entity_type = 'ENCRYPTION_CONFIG';

-- 10. Apply SSL security hardening recommendations
DO $$
DECLARE
    ssl_report RECORD;
    high_risk_issues INTEGER := 0;
    medium_risk_issues INTEGER := 0;
    recommendations TEXT[] := '{}';
BEGIN
    RAISE NOTICE '🔐 Analyzing SSL/TLS security configuration...';
    
    -- Generate security report
    FOR ssl_report IN 
        SELECT * FROM generate_ssl_security_report()
        ORDER BY 
            CASE risk_level 
                WHEN 'HIGH' THEN 1 
                WHEN 'MEDIUM' THEN 2 
                ELSE 3 
            END
    LOOP
        IF ssl_report.risk_level = 'HIGH' THEN
            high_risk_issues := high_risk_issues + 1;
            RAISE NOTICE '   🚨 [%] %: % - %', 
                ssl_report.risk_level, 
                ssl_report.item, 
                ssl_report.status,
                ssl_report.details;
            recommendations := array_append(recommendations, ssl_report.action_required);
        ELSIF ssl_report.risk_level = 'MEDIUM' THEN
            medium_risk_issues := medium_risk_issues + 1;
            RAISE NOTICE '   ⚠️  [%] %: % - %', 
                ssl_report.risk_level,
                ssl_report.item, 
                ssl_report.status,
                ssl_report.details;
        ELSIF ssl_report.status != 'PASS' THEN
            RAISE NOTICE '   ℹ️  [%] %: % - %', 
                ssl_report.risk_level,
                ssl_report.item, 
                ssl_report.status,
                ssl_report.details;
        END IF;
    END LOOP;
    
    -- Summary
    RAISE NOTICE '🔐 SSL/TLS Security Summary:';
    IF high_risk_issues = 0 AND medium_risk_issues = 0 THEN
        RAISE NOTICE '   ✅ SSL/TLS configuration appears secure';
    ELSE
        RAISE NOTICE '   ⚠️  Found % high-risk and % medium-risk SSL issues', high_risk_issues, medium_risk_issues;
        
        -- Log recommendations
        IF array_length(recommendations, 1) > 0 THEN
            RAISE NOTICE '   📋 Key recommendations:';
            FOR i IN 1..LEAST(array_length(recommendations, 1), 5) LOOP
                RAISE NOTICE '      • %', recommendations[i];
            END LOOP;
        END IF;
    END IF;
    
    RAISE NOTICE '📊 View ssl_security_dashboard for metrics';
    RAISE NOTICE '🔍 Run generate_ssl_security_report() for detailed analysis';
    RAISE NOTICE '🔧 Run enforce_secure_connections() to apply security measures';
END $$;

-- 11. Add migration tracking
INSERT INTO schema_migrations (version, applied_at, success, description)
VALUES (
    '041_enhance_ssl_tls.sql', 
    NOW(), 
    TRUE,
    'Enhanced SSL/TLS configuration and connection security'
)
ON CONFLICT (version) DO UPDATE SET 
    applied_at = NOW(),
    success = TRUE,
    description = EXCLUDED.description;

-- 12. Final SSL/TLS security validation
DO $$
DECLARE
    dashboard_stats RECORD;
BEGIN
    RAISE NOTICE '🔐 Final SSL/TLS Security Status:';
    
    FOR dashboard_stats IN SELECT * FROM ssl_security_dashboard
    LOOP
        RAISE NOTICE '   📊 %: %.1f%% secure (% passed, % failed)', 
            dashboard_stats.metric_category,
            dashboard_stats.security_score_pct,
            dashboard_stats.passed_checks,
            dashboard_stats.failed_checks;
    END LOOP;
    
    RAISE NOTICE '✅ SSL/TLS security enhancement completed';
    RAISE NOTICE '📚 Documentation: Review PostgreSQL SSL documentation for certificate setup';
    RAISE NOTICE '🔧 Next steps: Configure SSL certificates and update pg_hba.conf for hostssl requirements';
END $$;