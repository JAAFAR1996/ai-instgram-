-- ===============================================
-- Platform Assessment - Production-Safe Comprehensive Analysis
-- المرحلة 1: تقييم الوضع الحالي والتخطيط (محسّن للإنتاج)
-- Migration: 052_platform_assessment_optimized.sql
-- ===============================================

-- 🛡️ إعدادات الحماية والأداء
SET statement_timeout = '300s';    -- 5 دقائق كحد أقصى
SET lock_timeout = '30s';          -- منع blocking طويل
SET work_mem = '256MB';            -- ذاكرة محسنة للعمليات
SET maintenance_work_mem = '1GB';  -- ذاكرة محسنة للصيانة

-- 📝 تسجيل بداية التحليل
DO $$
BEGIN
    RAISE NOTICE '🚀 بدء تحليل Platform Values - النسخة المحسنة للإنتاج';
    RAISE NOTICE 'وقت البداية: %', CURRENT_TIMESTAMP;
    RAISE NOTICE 'إعدادات الحماية: timeout=300s, lock_timeout=30s';
END $$;

-- A. إنشاء البنية التحتية للتحليل بأمان
CREATE TABLE IF NOT EXISTS platform_assessment_results (
    id SERIAL PRIMARY KEY,
    analysis_session_id UUID DEFAULT gen_random_uuid(),
    table_name VARCHAR(100) NOT NULL,
    platform_value VARCHAR(50),
    record_count INTEGER DEFAULT 0,
    percentage DECIMAL(5,2) DEFAULT 0,
    last_updated TIMESTAMP,
    has_null_platforms BOOLEAN DEFAULT FALSE,
    case_variations TEXT[],
    analysis_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT uk_platform_analysis UNIQUE (analysis_session_id, table_name, platform_value)
);

CREATE INDEX IF NOT EXISTS idx_platform_assessment_session 
ON platform_assessment_results (analysis_session_id, analysis_timestamp);

-- B. دالة محسنة للتحليل الآمن
CREATE OR REPLACE FUNCTION analyze_platform_tables_safe()
RETURNS TABLE (
    session_id UUID,
    total_tables_analyzed INTEGER,
    total_records_processed BIGINT,
    critical_issues_found INTEGER,
    execution_time_ms INTEGER
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    table_record RECORD;
    current_session_id UUID := gen_random_uuid();
    tables_processed INTEGER := 0;
    total_records BIGINT := 0;
    critical_issues INTEGER := 0;
    start_time TIMESTAMP := CURRENT_TIMESTAMP;
    table_start_time TIMESTAMP;
    table_records INTEGER;
    max_processing_time CONSTANT INTERVAL := '4 minutes'; -- احتياطي للـ timeout
BEGIN
    RAISE NOTICE '📊 بدء جلسة التحليل: %', current_session_id;
    
    -- تحديد الجداول المراد تحليلها (مع تقدير الحجم)
    FOR table_record IN 
        SELECT 
            t.table_name,
            COALESCE(s.n_tup_ins + s.n_tup_upd, 0) as estimated_rows
        FROM information_schema.tables t
        JOIN information_schema.columns c ON t.table_name = c.table_name
        LEFT JOIN pg_stat_user_tables s ON s.relname = t.table_name
        WHERE c.column_name = 'platform' 
        AND t.table_schema = 'public'
        AND t.table_type = 'BASE TABLE'
        ORDER BY estimated_rows DESC -- تحليل الجداول الكبيرة أولاً
    LOOP
        -- فحص الوقت المتبقي
        IF CURRENT_TIMESTAMP - start_time > max_processing_time THEN
            RAISE WARNING '⏰ توقف التحليل: تجاوز الحد الزمني المسموح';
            EXIT;
        END IF;
        
        table_start_time := CURRENT_TIMESTAMP;
        table_records := 0;
        
        BEGIN
            -- تحليل آمن مع معالجة الأخطاء
            EXECUTE format('
                INSERT INTO platform_assessment_results 
                (analysis_session_id, table_name, platform_value, record_count, 
                 has_null_platforms, case_variations, last_updated)
                SELECT 
                    $1,
                    %L,
                    COALESCE(platform, ''NULL''),
                    COUNT(*),
                    (platform IS NULL),
                    CASE 
                        WHEN platform IS NOT NULL 
                        THEN ARRAY[platform] 
                        ELSE NULL 
                    END,
                    MAX(COALESCE(updated_at, created_at, CURRENT_TIMESTAMP))
                FROM %I 
                GROUP BY platform
                HAVING COUNT(*) > 0', -- تجنب النتائج الفارغة
                table_record.table_name, table_record.table_name
            ) USING current_session_id;
            
            -- حساب إجمالي السجلات لهذا الجدول
            EXECUTE format('SELECT COUNT(*) FROM %I', table_record.table_name) 
            INTO table_records;
            
            total_records := total_records + table_records;
            tables_processed := tables_processed + 1;
            
            RAISE NOTICE '✅ تم تحليل جدول % - السجلات: % - الوقت: %ms', 
                table_record.table_name, 
                table_records,
                EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - table_start_time)) * 1000;
                
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING '⚠️ خطأ في تحليل جدول %: %', table_record.table_name, SQLERRM;
            critical_issues := critical_issues + 1;
            CONTINUE;
        END;
        
        -- استراحة قصيرة لتجنب إجهاد النظام
        IF tables_processed % 5 = 0 THEN
            PERFORM pg_sleep(0.1); -- 100ms استراحة
        END IF;
    END LOOP;

    -- حساب النسب المئوية
    UPDATE platform_assessment_results 
    SET percentage = (record_count * 100.0) / (
        SELECT SUM(record_count) 
        FROM platform_assessment_results p2 
        WHERE p2.analysis_session_id = current_session_id
        AND p2.table_name = platform_assessment_results.table_name
    )
    WHERE analysis_session_id = current_session_id;

    -- إرجاع النتائج
    session_id := current_session_id;
    total_tables_analyzed := tables_processed;
    total_records_processed := total_records;
    critical_issues_found := critical_issues;
    execution_time_ms := EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - start_time)) * 1000;
    
    RETURN NEXT;
END $$;

-- C. دالة لعرض تقرير موجز آمن
CREATE OR REPLACE FUNCTION get_platform_analysis_summary(p_session_id UUID DEFAULT NULL)
RETURNS TABLE (
    table_name TEXT,
    total_records BIGINT,
    platform_breakdown JSONB,
    issues_detected TEXT[],
    recommendations TEXT[]
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    target_session_id UUID;
    tbl_record RECORD;
    platform_data JSONB;
    issues TEXT[] := ARRAY[]::TEXT[];
    recommendations TEXT[] := ARRAY[]::TEXT[];
BEGIN
    -- استخدام آخر جلسة إذا لم تحدد
    IF p_session_id IS NULL THEN
        SELECT analysis_session_id INTO target_session_id
        FROM platform_assessment_results 
        ORDER BY analysis_timestamp DESC 
        LIMIT 1;
    ELSE
        target_session_id := p_session_id;
    END IF;
    
    IF target_session_id IS NULL THEN
        RAISE NOTICE '⚠️ لا توجد بيانات تحليل متاحة';
        RETURN;
    END IF;
    
    -- تجميع البيانات لكل جدول
    FOR tbl_record IN 
        SELECT DISTINCT r.table_name as tname
        FROM platform_assessment_results r
        WHERE r.analysis_session_id = target_session_id
        ORDER BY r.table_name
    LOOP
        issues := ARRAY[]::TEXT[];
        recommendations := ARRAY[]::TEXT[];
        
        -- بناء تفصيل platform values
        SELECT jsonb_object_agg(
            platform_value, 
            jsonb_build_object(
                'count', record_count,
                'percentage', percentage,
                'has_nulls', has_null_platforms
            )
        ) INTO platform_data
        FROM platform_assessment_results
        WHERE analysis_session_id = target_session_id
        AND table_name = tbl_record.tname;
        
        -- فحص المشاكل
        IF EXISTS(
            SELECT 1 FROM platform_assessment_results 
            WHERE analysis_session_id = target_session_id
            AND table_name = tbl_record.tname 
            AND platform_value = 'NULL'
        ) THEN
            issues := issues || 'قيم NULL موجودة';
            recommendations := recommendations || 'تحديد قيمة افتراضية للمنصة';
        END IF;
        
        -- فحص تنوع الحالة
        IF (
            SELECT COUNT(DISTINCT LOWER(platform_value)) 
            FROM platform_assessment_results 
            WHERE analysis_session_id = target_session_id
            AND table_name = tbl_record.tname 
            AND platform_value != 'NULL'
        ) < (
            SELECT COUNT(DISTINCT platform_value) 
            FROM platform_assessment_results 
            WHERE analysis_session_id = target_session_id
            AND table_name = tbl_record.tname 
            AND platform_value != 'NULL'
        ) THEN
            issues := issues || 'مشكلة في حالة الأحرف (Case Sensitivity)';
            recommendations := recommendations || 'توحيد حالة الأحرف للمنصات';
        END IF;
        
        SELECT SUM(record_count) INTO total_records
        FROM platform_assessment_results
        WHERE analysis_session_id = target_session_id
        AND table_name = tbl_record.tname;
        
        table_name := tbl_record.tname;
        platform_breakdown := platform_data;
        issues_detected := issues;
        
        RETURN NEXT;
    END LOOP;
END $$;

-- D. View مبسط للمراقبة اليومية
CREATE OR REPLACE VIEW platform_health_monitor AS
WITH latest_analysis AS (
    SELECT DISTINCT ON (table_name) 
        table_name,
        analysis_session_id,
        analysis_timestamp,
        SUM(record_count) OVER (PARTITION BY table_name, analysis_session_id) as total_records,
        COUNT(CASE WHEN platform_value = 'NULL' THEN 1 END) 
            OVER (PARTITION BY table_name, analysis_session_id) as null_count
    FROM platform_assessment_results
    WHERE analysis_timestamp > CURRENT_TIMESTAMP - INTERVAL '7 days'
    ORDER BY table_name, analysis_timestamp DESC
)
SELECT 
    table_name,
    total_records,
    null_count,
    CASE 
        WHEN null_count = 0 THEN 'صحي'
        WHEN null_count > total_records * 0.1 THEN 'يحتاج انتباه'
        ELSE 'مقبول'
    END as health_status,
    analysis_timestamp as last_checked
FROM latest_analysis;

-- E. إعداد المراقبة والتنبيهات
CREATE TABLE IF NOT EXISTS platform_monitoring_alerts (
    id SERIAL PRIMARY KEY,
    alert_type VARCHAR(50) NOT NULL,
    table_name VARCHAR(100),
    severity_level VARCHAR(20) DEFAULT 'medium', -- low, medium, high, critical
    message TEXT NOT NULL,
    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP,
    assigned_to VARCHAR(100),
    
    CONSTRAINT chk_severity CHECK (severity_level IN ('low', 'medium', 'high', 'critical'))
);

-- F. دالة للتشغيل اليدوي الآمن
CREATE OR REPLACE FUNCTION run_platform_assessment()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result JSONB;
    analysis_result RECORD;
BEGIN
    RAISE NOTICE '🔍 تشغيل تحليل Platform Assessment...';
    
    -- تشغيل التحليل
    SELECT * FROM analyze_platform_tables_safe() INTO analysis_result;
    
    -- بناء النتيجة
    result := jsonb_build_object(
        'success', true,
        'session_id', analysis_result.session_id,
        'summary', jsonb_build_object(
            'tables_analyzed', analysis_result.total_tables_analyzed,
            'records_processed', analysis_result.total_records_processed,
            'issues_found', analysis_result.critical_issues_found,
            'execution_time_ms', analysis_result.execution_time_ms
        ),
        'next_steps', ARRAY[
            'مراجعة النتائج باستخدام get_platform_analysis_summary()',
            'فحص platform_health_monitor للحصول على الحالة الصحية',
            'التخطيط للمرحلة التالية بناء على النتائج'
        ],
        'executed_at', CURRENT_TIMESTAMP
    );
    
    RAISE NOTICE '✅ تم التحليل بنجاح - الجلسة: %', analysis_result.session_id;
    RAISE NOTICE 'لعرض النتائج: SELECT * FROM get_platform_analysis_summary(''%'')', 
        analysis_result.session_id;
    
    RETURN result;
END $$;

-- G. تسجيل في نظام Migration
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'schema_migrations') THEN
        INSERT INTO schema_migrations (version, applied_at, success, migration_type) VALUES
            ('052_platform_assessment_optimized.sql', CURRENT_TIMESTAMP, true, 'assessment')
        ON CONFLICT (version) DO NOTHING;
    END IF;
END $$;

-- إعادة تعيين إعدادات Database
RESET statement_timeout;
RESET lock_timeout;
RESET work_mem;
RESET maintenance_work_mem;

-- 📋 تعليقات التوثيق
COMMENT ON FUNCTION analyze_platform_tables_safe() IS 'تحليل آمن لجداول المنصات مع حماية من timeout والأخطاء';
COMMENT ON FUNCTION get_platform_analysis_summary(UUID) IS 'تقرير موجز لنتائج تحليل المنصات';
COMMENT ON FUNCTION run_platform_assessment() IS 'نقطة دخول آمنة لتشغيل تحليل المنصات';
COMMENT ON VIEW platform_health_monitor IS 'مراقب صحي مبسط لحالة بيانات المنصات';

-- 🎯 تعليمات الاستخدام
DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '📖 طريقة الاستخدام:';
    RAISE NOTICE '1. تشغيل التحليل: SELECT run_platform_assessment();';
    RAISE NOTICE '2. عرض النتائج: SELECT * FROM get_platform_analysis_summary();';
    RAISE NOTICE '3. مراقبة الصحة: SELECT * FROM platform_health_monitor;';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️ ملاحظة: يُفضل التشغيل في maintenance window';
END $$;