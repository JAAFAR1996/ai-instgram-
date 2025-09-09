-- ===============================================
-- Cleanup Unused Tables Script
-- حذف الجداول غير المستخدمة
-- ===============================================

-- Drop WhatsApp related tables
DROP TABLE IF EXISTS platform_switches CASCADE;
DROP TABLE IF EXISTS unified_customer_profiles CASCADE;
DROP TABLE IF EXISTS customer_journey_events CASCADE;
DROP TABLE IF EXISTS conversation_merges CASCADE;

-- Drop advanced analytics tables
DROP TABLE IF EXISTS customer_insights_cache CASCADE;
DROP TABLE IF EXISTS size_issue_tracking CASCADE;
DROP TABLE IF EXISTS churn_prediction_tracking CASCADE;
DROP TABLE IF EXISTS quality_metrics CASCADE;

-- Drop ManyChat tables
DROP TABLE IF EXISTS manychat_logs CASCADE;
DROP TABLE IF EXISTS manychat_subscribers CASCADE;
DROP TABLE IF EXISTS manychat_flows CASCADE;
DROP TABLE IF EXISTS manychat_webhooks CASCADE;

-- Drop Instagram advanced tables
DROP TABLE IF EXISTS instagram_story_interactions CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS message_followups CASCADE;

-- Drop webhook events table (not used)
DROP TABLE IF EXISTS webhook_events CASCADE;
DROP TABLE IF EXISTS service_errors CASCADE;

-- Drop views
DROP VIEW IF EXISTS cross_platform_customer_analytics CASCADE;
DROP VIEW IF EXISTS platform_switch_analytics CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS set_isi_window_expiry() CASCADE;
DROP FUNCTION IF EXISTS get_instagram_message_window_status(uuid, text) CASCADE;

-- Clean up conversations table - remove WhatsApp references
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_platform_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_platform_check 
  CHECK (platform IN ('INSTAGRAM'));

-- Clean up orders table - remove WhatsApp references  
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_source_check;
ALTER TABLE orders ADD CONSTRAINT orders_order_source_check 
  CHECK (order_source IN ('INSTAGRAM', 'MANUAL', 'WEBSITE'));

-- Clean up message_logs table - remove WhatsApp references
ALTER TABLE message_logs DROP CONSTRAINT IF EXISTS message_logs_platform_check;
ALTER TABLE message_logs ADD CONSTRAINT message_logs_platform_check 
  CHECK (platform IN ('INSTAGRAM'));

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Cleanup completed successfully: Removed unused tables and WhatsApp references';
    RAISE NOTICE 'Remaining tables: merchants, products, conversations, message_logs, orders, audit_logs';
END $$;
