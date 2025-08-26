-- ===============================================
-- RLS Performance Optimization Indexes
-- ⚡ Stage 3: Performance improvements for RLS queries
-- Migration: 044_rls_performance_indexes.sql
-- ===============================================

-- ⚡ 1. Optimize merchant_id lookups across all RLS-enabled tables
-- These indexes dramatically improve RLS policy evaluation performance

-- Messages table optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_merchant_rls_perf 
ON messages (merchant_id, created_at DESC) 
WHERE merchant_id IS NOT NULL;

-- Conversations table optimization  
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_merchant_rls_perf
ON conversations (merchant_id, updated_at DESC, status)
WHERE merchant_id IS NOT NULL;

-- Templates table optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_templates_merchant_rls_perf
ON templates (merchant_id, is_active, created_at DESC)
WHERE merchant_id IS NOT NULL AND is_active = true;

-- Manual followup queue optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_manual_followup_merchant_rls_perf
ON manual_followup_queue (merchant_id, status, scheduled_at)
WHERE merchant_id IS NOT NULL;

-- ⚡ 2. Composite indexes for common RLS query patterns
-- These indexes support complex WHERE clauses used in business logic

-- Message search and filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_search_rls_perf
ON messages (merchant_id, conversation_id, message_type, created_at DESC)
WHERE merchant_id IS NOT NULL;

-- Conversation management with contact info
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_contact_rls_perf  
ON conversations (merchant_id, contact_phone, status, last_message_at DESC)
WHERE merchant_id IS NOT NULL AND contact_phone IS NOT NULL;

-- ⚡ 3. Instagram-specific RLS optimizations
-- Optimize Instagram webhook and API operations

-- Instagram webhook processing
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_instagram_webhooks_rls_perf
ON instagram_webhook_events (merchant_id, event_type, processed_at, created_at DESC)
WHERE merchant_id IS NOT NULL;

-- Instagram media management  
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_instagram_media_rls_perf
ON instagram_media (merchant_id, media_type, created_at DESC)
WHERE merchant_id IS NOT NULL;

-- Instagram comments with engagement tracking
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_instagram_comments_rls_perf
ON instagram_comments (merchant_id, media_id, is_processed, created_at DESC)
WHERE merchant_id IS NOT NULL;

-- ⚡ 4. Session and authentication optimization  
-- Speed up user context validation

-- User sessions with merchant context
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_merchant_rls_perf
ON user_sessions (user_id, merchant_id, expires_at, is_active)
WHERE merchant_id IS NOT NULL AND is_active = true;

-- ⚡ 5. Audit and logging performance
-- Optimize audit log queries for RLS context

-- Migration audit logs with merchant context
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_migration_audit_merchant_rls_perf
ON migration_audit_logs (merchant_id, migration_version, execution_status, started_at DESC)
WHERE merchant_id IS NOT NULL;

-- System audit logs for security monitoring
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_system_audit_merchant_rls_perf
ON audit_logs (merchant_id, table_name, operation, created_at DESC)
WHERE merchant_id IS NOT NULL;

-- ⚡ 6. Partial indexes for active records
-- Reduce index size and improve performance for active data

-- Active conversations only
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_active_conversations_rls_perf
ON conversations (merchant_id, updated_at DESC, contact_phone)
WHERE merchant_id IS NOT NULL AND status IN ('active', 'pending');

-- Recent messages for performance  
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recent_messages_rls_perf
ON messages (merchant_id, conversation_id, created_at DESC)
WHERE merchant_id IS NOT NULL AND created_at > (CURRENT_TIMESTAMP - INTERVAL '30 days');

-- ⚡ 7. Function-based indexes for computed columns
-- Optimize commonly used expressions in RLS policies

-- Message content search optimization
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_content_search_rls
ON messages USING gin (to_tsvector('english', message_content))
WHERE merchant_id IS NOT NULL AND message_content IS NOT NULL;

-- Phone number normalization for lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_phone_normalized_rls
ON conversations (merchant_id, regexp_replace(contact_phone, '[^0-9+]', '', 'g'))
WHERE merchant_id IS NOT NULL AND contact_phone IS NOT NULL;

-- ⚡ 8. Add statistics targets for better query planning
-- Improve PostgreSQL query planner decisions

-- Update statistics targets for high-cardinality columns
ALTER TABLE messages ALTER COLUMN merchant_id SET STATISTICS 1000;
ALTER TABLE conversations ALTER COLUMN merchant_id SET STATISTICS 1000;
ALTER TABLE templates ALTER COLUMN merchant_id SET STATISTICS 1000;
ALTER TABLE instagram_webhook_events ALTER COLUMN merchant_id SET STATISTICS 1000;

-- ⚡ 9. Create maintenance function for index monitoring
CREATE OR REPLACE FUNCTION monitor_rls_index_usage()
RETURNS TABLE (
    schemaname text,
    tablename text,
    indexname text,
    idx_tup_read bigint,
    idx_tup_fetch bigint,
    idx_scan bigint,
    usage_ratio numeric
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pst.schemaname::text,
        pst.tablename::text,
        psi.indexrelname::text,
        psi.idx_tup_read,
        psi.idx_tup_fetch,
        psi.idx_scan,
        CASE 
            WHEN psi.idx_scan = 0 THEN 0
            ELSE ROUND((psi.idx_tup_fetch::numeric / NULLIF(psi.idx_scan::numeric, 0)) * 100, 2)
        END as usage_ratio
    FROM pg_stat_user_indexes psi
    JOIN pg_stat_user_tables pst ON psi.relid = pst.relid
    WHERE psi.indexrelname LIKE '%rls_perf%'
    ORDER BY psi.idx_scan DESC, usage_ratio DESC;
END;
$$;

-- ⚡ 10. Log successful index creation
INSERT INTO migration_audit_logs (
    migration_version,
    description,
    execution_status,
    affected_tables,
    performance_impact,
    started_at,
    completed_at
) VALUES (
    '044_rls_performance_indexes.sql',
    'Added comprehensive RLS performance optimization indexes',
    'SUCCESS',
    ARRAY['messages', 'conversations', 'templates', 'manual_followup_queue', 'instagram_webhook_events', 'instagram_media', 'instagram_comments', 'user_sessions', 'migration_audit_logs', 'audit_logs'],
    'HIGH - Significant improvement in RLS query performance expected',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- Create index health monitoring view
CREATE OR REPLACE VIEW rls_index_health AS
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch,
    CASE 
        WHEN idx_scan = 0 THEN 'UNUSED'
        WHEN idx_scan < 100 THEN 'LOW_USAGE'
        WHEN idx_scan < 1000 THEN 'MODERATE_USAGE' 
        ELSE 'HIGH_USAGE'
    END as usage_category
FROM monitor_rls_index_usage()
ORDER BY idx_scan DESC;

COMMENT ON VIEW rls_index_health IS 'Monitor RLS index performance and usage patterns';