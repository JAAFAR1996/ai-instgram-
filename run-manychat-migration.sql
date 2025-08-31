-- ===============================================
-- ManyChat Migration Runner
-- تشغيل migration ManyChat مباشرة
-- ===============================================

-- تشغيل migration 053_manychat_integration.sql
\i src/database/migrations/053_manychat_integration.sql

-- التحقق من إنشاء الجداول
SELECT 
    table_name,
    column_name,
    data_type
FROM information_schema.columns 
WHERE table_name IN ('manychat_logs', 'manychat_subscribers', 'manychat_flows', 'manychat_webhooks')
ORDER BY table_name, ordinal_position;

-- التحقق من البيانات
SELECT COUNT(*) as manychat_logs_count FROM manychat_logs;
SELECT COUNT(*) as manychat_subscribers_count FROM manychat_subscribers;
SELECT COUNT(*) as manychat_flows_count FROM manychat_flows;
SELECT COUNT(*) as manychat_webhooks_count FROM manychat_webhooks;

-- التحقق من الـ indexes
SELECT 
    indexname,
    tablename,
    indexdef
FROM pg_indexes 
WHERE tablename LIKE 'manychat_%'
ORDER BY tablename, indexname;

-- التحقق من الـ RLS policies
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename LIKE 'manychat_%'
ORDER BY tablename, policyname;

-- التحقق من الـ triggers
SELECT 
    trigger_name,
    event_manipulation,
    event_object_table,
    action_statement
FROM information_schema.triggers 
WHERE event_object_table LIKE 'manychat_%'
ORDER BY event_object_table, trigger_name;

-- رسالة نجاح
SELECT 'ManyChat migration completed successfully!' as status;
