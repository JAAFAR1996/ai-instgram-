-- ===============================================
-- Advanced Migration Monitoring System
-- 💾 Stage 4: Risk Management - Real-time migration monitoring
-- Migration: 049_migration_monitoring.sql
-- ===============================================

-- 💾 1. Create migration monitoring events table
CREATE TABLE IF NOT EXISTS migration_monitoring_events (
    id SERIAL PRIMARY KEY,
    event_id UUID DEFAULT gen_random_uuid(),
    migration_version VARCHAR(255) NOT NULL,
    event_type VARCHAR(100) NOT NULL CHECK (event_type IN (
        'migration_started', 'migration_completed', 'migration_failed',
        'backup_created', 'backup_failed', 'rollback_initiated',
        'rollback_completed', 'health_check_failed', 'performance_degradation',
        'connection_limit_reached', 'deadlock_detected', 'timeout_exceeded'
    )),
    event_severity VARCHAR(20) DEFAULT 'info' CHECK (event_severity IN ('info', 'warning', 'error', 'critical')),
    event_message TEXT NOT NULL,
    event_details JSONB,
    source_component VARCHAR(100) DEFAULT 'migration_system',
    correlation_id UUID,
    parent_event_id UUID REFERENCES migration_monitoring_events(event_id),
    event_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at TIMESTAMP,
    acknowledged_by VARCHAR(255),
    resolution_notes TEXT,
    metrics JSONB,
    alert_sent BOOLEAN DEFAULT false
);

-- Add indexes for monitoring queries
CREATE INDEX IF NOT EXISTS idx_monitoring_events_migration 
ON migration_monitoring_events (migration_version, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_monitoring_events_type_severity 
ON migration_monitoring_events (event_type, event_severity, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_monitoring_events_unacknowledged 
ON migration_monitoring_events (event_timestamp DESC) 
WHERE acknowledged_at IS NULL AND event_severity IN ('error', 'critical');

CREATE INDEX IF NOT EXISTS idx_monitoring_events_correlation 
ON migration_monitoring_events (correlation_id, event_timestamp DESC) 
WHERE correlation_id IS NOT NULL;

-- 💾 2. Create migration metrics tracking table
CREATE TABLE IF NOT EXISTS migration_metrics (
    id SERIAL PRIMARY KEY,
    migration_version VARCHAR(255) NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    metric_value NUMERIC NOT NULL,
    metric_unit VARCHAR(50),
    metric_type VARCHAR(50) DEFAULT 'gauge' CHECK (metric_type IN ('gauge', 'counter', 'histogram', 'timing')),
    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    context JSONB
);

-- Add index for metrics queries
CREATE INDEX IF NOT EXISTS idx_migration_metrics_migration_metric 
ON migration_metrics (migration_version, metric_name, recorded_at DESC);

-- 💾 3. Create real-time monitoring function
CREATE OR REPLACE FUNCTION log_migration_event(
    p_migration_version VARCHAR(255),
    p_event_type VARCHAR(100),
    p_event_severity VARCHAR(20) DEFAULT 'info',
    p_event_message TEXT DEFAULT '',
    p_event_details JSONB DEFAULT NULL,
    p_correlation_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    event_uuid UUID;
    should_alert BOOLEAN := false;
BEGIN
    event_uuid := gen_random_uuid();
    
    -- Determine if alert should be sent
    should_alert := p_event_severity IN ('error', 'critical') OR 
                   p_event_type IN ('migration_failed', 'rollback_initiated', 'health_check_failed');
    
    -- Insert monitoring event
    INSERT INTO migration_monitoring_events (
        event_id,
        migration_version,
        event_type,
        event_severity,
        event_message,
        event_details,
        correlation_id,
        alert_sent
    ) VALUES (
        event_uuid,
        p_migration_version,
        p_event_type,
        p_event_severity,
        p_event_message,
        p_event_details,
        p_correlation_id,
        should_alert
    );
    
    -- Log to audit table as well
    INSERT INTO migration_audit_logs (
        migration_version,
        description,
        execution_status,
        metadata
    ) VALUES (
        p_migration_version,
        format('[%s] %s: %s', UPPER(p_event_severity), p_event_type, p_event_message),
        CASE p_event_severity 
            WHEN 'critical' THEN 'CRITICAL'
            WHEN 'error' THEN 'FAILED'
            WHEN 'warning' THEN 'WARNING'
            ELSE 'SUCCESS'
        END,
        jsonb_build_object(
            'monitoring_event_id', event_uuid,
            'event_type', p_event_type,
            'severity', p_event_severity,
            'correlation_id', p_correlation_id
        ) || COALESCE(p_event_details, '{}'::jsonb)
    );
    
    RETURN event_uuid;
END;
$$;

-- 💾 4. Create metrics recording function
CREATE OR REPLACE FUNCTION record_migration_metric(
    p_migration_version VARCHAR(255),
    p_metric_name VARCHAR(100),
    p_metric_value NUMERIC,
    p_metric_unit VARCHAR(50) DEFAULT NULL,
    p_metric_type VARCHAR(50) DEFAULT 'gauge',
    p_context JSONB DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO migration_metrics (
        migration_version,
        metric_name,
        metric_value,
        metric_unit,
        metric_type,
        context
    ) VALUES (
        p_migration_version,
        p_metric_name,
        p_metric_value,
        p_metric_unit,
        p_metric_type,
        p_context
    );
    
    -- Check for threshold violations
    IF p_metric_name = 'duration_seconds' AND p_metric_value > 1800 THEN -- 30 minutes
        PERFORM log_migration_event(
            p_migration_version,
            'timeout_exceeded',
            'warning',
            format('Migration duration exceeded 30 minutes: %s seconds', p_metric_value),
            jsonb_build_object('duration_seconds', p_metric_value)
        );
    END IF;
    
    IF p_metric_name = 'memory_usage_mb' AND p_metric_value > 2048 THEN -- 2GB
        PERFORM log_migration_event(
            p_migration_version,
            'performance_degradation',
            'warning',
            format('High memory usage detected: %s MB', p_metric_value),
            jsonb_build_object('memory_usage_mb', p_metric_value)
        );
    END IF;
END;
$$;

-- 💾 5. Create monitoring dashboard function
CREATE OR REPLACE FUNCTION get_migration_monitoring_dashboard(
    p_time_window INTERVAL DEFAULT INTERVAL '24 hours'
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    dashboard_data JSONB;
    time_cutoff TIMESTAMP;
BEGIN
    time_cutoff := CURRENT_TIMESTAMP - p_time_window;
    
    SELECT jsonb_build_object(
        'dashboard_generated_at', CURRENT_TIMESTAMP,
        'time_window_hours', EXTRACT(HOURS FROM p_time_window),
        'summary', jsonb_build_object(
            'total_events', (
                SELECT COUNT(*) FROM migration_monitoring_events 
                WHERE event_timestamp >= time_cutoff
            ),
            'critical_events', (
                SELECT COUNT(*) FROM migration_monitoring_events 
                WHERE event_timestamp >= time_cutoff AND event_severity = 'critical'
            ),
            'error_events', (
                SELECT COUNT(*) FROM migration_monitoring_events 
                WHERE event_timestamp >= time_cutoff AND event_severity = 'error'
            ),
            'warning_events', (
                SELECT COUNT(*) FROM migration_monitoring_events 
                WHERE event_timestamp >= time_cutoff AND event_severity = 'warning'
            ),
            'unacknowledged_alerts', (
                SELECT COUNT(*) FROM migration_monitoring_events 
                WHERE event_timestamp >= time_cutoff 
                AND acknowledged_at IS NULL 
                AND event_severity IN ('error', 'critical')
            )
        ),
        'recent_migrations', (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'migration_version', migration_version,
                    'event_count', event_count,
                    'last_event', last_event,
                    'has_errors', has_errors
                )
            )
            FROM (
                SELECT 
                    migration_version,
                    COUNT(*) as event_count,
                    MAX(event_timestamp) as last_event,
                    bool_or(event_severity IN ('error', 'critical')) as has_errors
                FROM migration_monitoring_events 
                WHERE event_timestamp >= time_cutoff
                GROUP BY migration_version
                ORDER BY MAX(event_timestamp) DESC
                LIMIT 10
            ) recent
        ),
        'event_types', (
            SELECT jsonb_object_agg(event_type, event_count)
            FROM (
                SELECT event_type, COUNT(*) as event_count
                FROM migration_monitoring_events 
                WHERE event_timestamp >= time_cutoff
                GROUP BY event_type
            ) types
        ),
        'performance_metrics', (
            SELECT jsonb_build_object(
                'avg_migration_duration', COALESCE(AVG(metric_value), 0),
                'max_migration_duration', COALESCE(MAX(metric_value), 0),
                'avg_memory_usage', COALESCE(
                    AVG(CASE WHEN metric_name = 'memory_usage_mb' THEN metric_value END), 0
                ),
                'total_migrations_monitored', COUNT(DISTINCT migration_version)
            )
            FROM migration_metrics 
            WHERE recorded_at >= time_cutoff
        ),
        'system_health', (
            SELECT jsonb_build_object(
                'active_connections', (
                    SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active'
                ),
                'database_size_mb', (
                    SELECT ROUND(pg_database_size(current_database()) / 1024.0 / 1024.0, 2)
                ),
                'cache_hit_ratio', (
                    SELECT ROUND(
                        (sum(blks_hit) / NULLIF(sum(blks_hit + blks_read), 0) * 100)::NUMERIC, 2
                    )
                    FROM pg_stat_database WHERE datname = current_database()
                )
            )
        )
    ) INTO dashboard_data;
    
    RETURN dashboard_data;
END;
$$;

-- 💾 6. Create alert generation function
CREATE OR REPLACE FUNCTION generate_migration_alerts()
RETURNS TABLE (
    alert_id UUID,
    migration_version VARCHAR(255),
    alert_type VARCHAR(100),
    alert_severity VARCHAR(20),
    alert_message TEXT,
    event_count BIGINT,
    first_occurrence TIMESTAMP,
    last_occurrence TIMESTAMP,
    recommended_actions TEXT[]
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH alert_summary AS (
        SELECT 
            gen_random_uuid() as alert_id,
            mme.migration_version,
            mme.event_type as alert_type,
            mme.event_severity as alert_severity,
            CASE 
                WHEN COUNT(*) > 1 THEN 
                    format('%s (occurred %s times)', 
                           MAX(mme.event_message), COUNT(*))
                ELSE MAX(mme.event_message)
            END as alert_message,
            COUNT(*) as event_count,
            MIN(mme.event_timestamp) as first_occurrence,
            MAX(mme.event_timestamp) as last_occurrence
        FROM migration_monitoring_events mme
        WHERE mme.event_timestamp > CURRENT_TIMESTAMP - INTERVAL '1 hour'
        AND mme.acknowledged_at IS NULL
        AND mme.event_severity IN ('warning', 'error', 'critical')
        GROUP BY mme.migration_version, mme.event_type, mme.event_severity
    )
    SELECT 
        a.*,
        CASE a.alert_type
            WHEN 'migration_failed' THEN 
                ARRAY['Review migration logs', 'Check database state', 'Consider rollback']
            WHEN 'backup_failed' THEN 
                ARRAY['Check backup storage', 'Verify permissions', 'Retry backup creation']
            WHEN 'health_check_failed' THEN 
                ARRAY['Run diagnostic queries', 'Check system resources', 'Review recent changes']
            WHEN 'performance_degradation' THEN 
                ARRAY['Monitor system resources', 'Check query performance', 'Consider optimization']
            ELSE 
                ARRAY['Review system logs', 'Contact system administrator']
        END as recommended_actions
    FROM alert_summary a
    ORDER BY 
        CASE a.alert_severity 
            WHEN 'critical' THEN 1 
            WHEN 'error' THEN 2 
            WHEN 'warning' THEN 3 
            ELSE 4 
        END,
        a.last_occurrence DESC;
END;
$$;

-- 💾 7. Create monitoring triggers for automatic event logging
CREATE OR REPLACE FUNCTION auto_log_migration_events()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    correlation_uuid UUID;
BEGIN
    correlation_uuid := gen_random_uuid();
    
    -- Log migration start
    IF TG_OP = 'INSERT' AND NEW.execution_status = 'STARTED' THEN
        PERFORM log_migration_event(
            NEW.migration_version,
            'migration_started',
            'info',
            format('Migration %s started', NEW.migration_version),
            jsonb_build_object(
                'migration_version', NEW.migration_version,
                'started_at', NEW.started_at
            ),
            correlation_uuid
        );
    END IF;
    
    -- Log migration completion/failure
    IF TG_OP = 'UPDATE' AND OLD.execution_status = 'STARTED' AND NEW.execution_status != 'STARTED' THEN
        PERFORM log_migration_event(
            NEW.migration_version,
            CASE NEW.execution_status 
                WHEN 'SUCCESS' THEN 'migration_completed'
                WHEN 'FAILED' THEN 'migration_failed'
                ELSE 'migration_completed'
            END,
            CASE NEW.execution_status 
                WHEN 'SUCCESS' THEN 'info'
                WHEN 'FAILED' THEN 'error'
                WHEN 'CRITICAL' THEN 'critical'
                ELSE 'warning'
            END,
            format('Migration %s %s', NEW.migration_version, LOWER(NEW.execution_status)),
            jsonb_build_object(
                'migration_version', NEW.migration_version,
                'execution_status', NEW.execution_status,
                'started_at', NEW.started_at,
                'completed_at', NEW.completed_at,
                'duration_seconds', EXTRACT(EPOCH FROM (NEW.completed_at - NEW.started_at))
            ),
            correlation_uuid
        );
        
        -- Record timing metric
        IF NEW.completed_at IS NOT NULL AND NEW.started_at IS NOT NULL THEN
            PERFORM record_migration_metric(
                NEW.migration_version,
                'duration_seconds',
                EXTRACT(EPOCH FROM (NEW.completed_at - NEW.started_at)),
                'seconds',
                'timing'
            );
        END IF;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$;

-- Create trigger for automatic event logging
DROP TRIGGER IF EXISTS trigger_auto_log_migration_events ON migration_audit_logs;
CREATE TRIGGER trigger_auto_log_migration_events
    AFTER INSERT OR UPDATE ON migration_audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION auto_log_migration_events();

-- 💾 8. Create monitoring views
CREATE OR REPLACE VIEW migration_monitoring_summary AS
SELECT 
    migration_version,
    COUNT(*) as total_events,
    COUNT(*) FILTER (WHERE event_severity = 'critical') as critical_events,
    COUNT(*) FILTER (WHERE event_severity = 'error') as error_events,
    COUNT(*) FILTER (WHERE event_severity = 'warning') as warning_events,
    COUNT(*) FILTER (WHERE acknowledged_at IS NULL AND event_severity IN ('error', 'critical')) as unacknowledged_alerts,
    MIN(event_timestamp) as first_event,
    MAX(event_timestamp) as last_event,
    MAX(event_timestamp) FILTER (WHERE event_type = 'migration_started') as migration_started_at,
    MAX(event_timestamp) FILTER (WHERE event_type IN ('migration_completed', 'migration_failed')) as migration_ended_at
FROM migration_monitoring_events
WHERE event_timestamp > CURRENT_TIMESTAMP - INTERVAL '7 days'
GROUP BY migration_version
ORDER BY MAX(event_timestamp) DESC;

-- 💾 9. Create cleanup function for old monitoring data
CREATE OR REPLACE FUNCTION cleanup_monitoring_data(
    p_retention_days INTEGER DEFAULT 90
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    deleted_events INTEGER;
    deleted_metrics INTEGER;
    cutoff_date TIMESTAMP;
BEGIN
    cutoff_date := CURRENT_TIMESTAMP - (p_retention_days || ' days')::INTERVAL;
    
    -- Delete old monitoring events (keep acknowledged critical events longer)
    DELETE FROM migration_monitoring_events 
    WHERE event_timestamp < cutoff_date
    AND NOT (event_severity = 'critical' AND acknowledged_at IS NOT NULL);
    
    GET DIAGNOSTICS deleted_events = ROW_COUNT;
    
    -- Delete old metrics
    DELETE FROM migration_metrics 
    WHERE recorded_at < cutoff_date;
    
    GET DIAGNOSTICS deleted_metrics = ROW_COUNT;
    
    -- Log cleanup activity
    PERFORM log_migration_event(
        'SYSTEM_CLEANUP',
        'monitoring_cleanup',
        'info',
        format('Cleaned up %s events and %s metrics older than %s days', 
               deleted_events, deleted_metrics, p_retention_days),
        jsonb_build_object(
            'deleted_events', deleted_events,
            'deleted_metrics', deleted_metrics,
            'retention_days', p_retention_days,
            'cutoff_date', cutoff_date
        )
    );
    
    RETURN deleted_events + deleted_metrics;
END;
$$;

-- 💾 10. Log successful migration
INSERT INTO migration_audit_logs (
    migration_version,
    description,
    execution_status,
    affected_tables,
    performance_impact,
    started_at,
    completed_at
) VALUES (
    '049_migration_monitoring.sql',
    'Implemented comprehensive migration monitoring system with real-time events and metrics',
    'SUCCESS',
    ARRAY['migration_monitoring_events', 'migration_metrics', 'monitoring functions'],
    'LOW - Monitoring system ready for comprehensive migration oversight',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

COMMENT ON TABLE migration_monitoring_events IS 'Real-time migration monitoring events and alerts';
COMMENT ON TABLE migration_metrics IS 'Performance metrics tracking for migrations';
COMMENT ON FUNCTION log_migration_event(VARCHAR, VARCHAR, VARCHAR, TEXT, JSONB, UUID) IS 'Logs migration events with automatic alerting';
COMMENT ON FUNCTION get_migration_monitoring_dashboard(INTERVAL) IS 'Provides comprehensive monitoring dashboard data';
COMMENT ON VIEW migration_monitoring_summary IS 'Summary view of migration events by migration version';