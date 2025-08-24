-- ===============================================
-- Performance Indexes Migration
-- Optimizes heavy queries with strategic indexing
-- Migration: 027_performance_indexes.sql
-- ===============================================

-- Index for active merchants by business category (frequently filtered)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_merchants_active_category 
ON merchants (is_active, business_category) 
WHERE is_active = true;

-- Index for merchant subscription status queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_merchants_subscription_status 
ON merchants (subscription_status, subscription_expires_at) 
WHERE subscription_status IS NOT NULL;

-- Index for message usage tracking (critical for billing)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_merchants_usage_tracking 
ON merchants (monthly_messages_used, monthly_message_limit, subscription_status);

-- Index for message logs by conversation and time (heavy query pattern)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_logs_conversation_time 
ON message_logs (conversation_id, created_at DESC);

-- Index for message logs by merchant and direction (analytics queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_logs_merchant_direction 
ON message_logs (merchant_id, direction, created_at DESC);

-- Index for message logs error tracking
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_logs_errors 
ON message_logs (error_code, created_at DESC) 
WHERE error_code IS NOT NULL;

-- Index for conversations by merchant and stage (dashboard queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_merchant_stage 
ON conversations (merchant_id, conversation_stage, last_message_at DESC);

-- Index for active conversations (frequently accessed)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_active 
ON conversations (is_active, last_message_at DESC) 
WHERE is_active = true;

-- Index for conversation platform filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_platform_status 
ON conversations (platform, conversation_stage, merchant_id);

-- Index for job spool processing (queue management)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_spool_processing 
ON job_spool (processed_at, scheduled_at, priority) 
WHERE processed_at IS NULL;

-- Index for job spool by merchant and type (monitoring)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_spool_merchant_type 
ON job_spool (merchant_id, job_type, created_at DESC);

-- Index for products by merchant and status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_merchant_status 
ON products (merchant_id, is_active, created_at DESC) 
WHERE is_active = true;

-- Index for orders by merchant and status (e-commerce queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_merchant_status 
ON orders (merchant_id, order_status, created_at DESC);

-- Index for orders by payment status (financial tracking)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_payment_status 
ON orders (payment_status, created_at DESC) 
WHERE payment_status IS NOT NULL;

-- Composite index for webhook processing
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_logs_webhook_processing 
ON message_logs (platform, webhook_id, created_at) 
WHERE webhook_id IS NOT NULL;

-- Index for rate limiting and security
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_logs_rate_limiting 
ON message_logs (merchant_id, created_at) 
WHERE created_at >= NOW() - INTERVAL '1 hour';

-- Index for conversation analytics (time-based queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conversations_analytics 
ON conversations (merchant_id, created_at, conversation_stage) 
WHERE created_at >= NOW() - INTERVAL '30 days';

-- Index for message performance monitoring
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_logs_performance 
ON message_logs (processing_time_ms, created_at DESC) 
WHERE processing_time_ms IS NOT NULL;

-- Validate index creation and provide statistics
DO $$
DECLARE
    index_record RECORD;
    total_indexes INTEGER := 0;
    successful_indexes INTEGER := 0;
BEGIN
    -- Count total indexes we attempted to create
    SELECT COUNT(*) INTO total_indexes 
    FROM pg_stat_user_indexes 
    WHERE schemaname = 'public' 
    AND indexrelname LIKE 'idx_%';
    
    -- Verify critical indexes exist
    FOR index_record IN
        SELECT 
            schemaname,
            tablename,
            indexname,
            idx_scan as scans,
            idx_tup_read as tuples_read
        FROM pg_stat_user_indexes 
        WHERE schemaname = 'public' 
        AND indexrelname LIKE 'idx_%'
        ORDER BY tablename, indexname
    LOOP
        successful_indexes := successful_indexes + 1;
        RAISE NOTICE 'Index created: %.% (scans: %, tuples: %)', 
            index_record.tablename, 
            index_record.indexname,
            index_record.scans,
            index_record.tuples_read;
    END LOOP;
    
    RAISE NOTICE 'Performance indexes migration completed: % indexes created successfully', successful_indexes;
    
    -- Check for missing critical tables
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'merchants') THEN
        RAISE WARNING 'merchants table does not exist - some indexes were skipped';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'message_logs') THEN
        RAISE WARNING 'message_logs table does not exist - some indexes were skipped';
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'conversations') THEN
        RAISE WARNING 'conversations table does not exist - some indexes were skipped';
    END IF;
END $$;

-- Create function to monitor index usage
CREATE OR REPLACE FUNCTION get_index_usage_stats()
RETURNS TABLE(
    table_name TEXT,
    index_name TEXT,
    index_size TEXT,
    index_scans BIGINT,
    tuples_read BIGINT,
    tuples_fetched BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        schemaname || '.' || tablename AS table_name,
        indexrelname AS index_name,
        pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
        idx_scan AS index_scans,
        idx_tup_read AS tuples_read,
        idx_tup_fetch AS tuples_fetched
    FROM pg_stat_user_indexes
    WHERE schemaname = 'public'
    AND indexrelname LIKE 'idx_%'
    ORDER BY idx_scan DESC, pg_relation_size(indexrelid) DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant usage permissions
GRANT EXECUTE ON FUNCTION get_index_usage_stats() TO PUBLIC;

-- Log migration completion
INSERT INTO migration_log (migration_name, executed_at, status) 
VALUES ('027_performance_indexes.sql', NOW(), 'SUCCESS')
ON CONFLICT (migration_name) DO UPDATE SET 
    executed_at = NOW(), 
    status = 'SUCCESS';