#!/usr/bin/env node
/**
 * ===============================================
 * Database Inspector Script
 * فحص شامل لقاعدة البيانات وإخراج جميع المعلومات
 * ===============================================
 */

import { Client } from 'pg';

// Database connection
const DATABASE_URL = 'postgresql://ai_instgram_user:rTAH6gFMveMhoSrFu3l9FmrqGYd1ZFdw@dpg-d2f0pije5dus73bi4ac0-a.oregon-postgres.render.com/ai_instgram';

async function inspectDatabase() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('✅ متصل بقاعدة البيانات بنجاح');
    console.log('=' .repeat(80));
    
    // 1. معلومات عامة عن قاعدة البيانات
    console.log('\n📊 معلومات عامة عن قاعدة البيانات');
    console.log('-'.repeat(50));
    
    const dbInfo = await client.query(`
      SELECT 
        current_database() as database_name,
        version() as postgresql_version,
        current_user as connected_user,
        inet_server_addr() as server_ip,
        inet_server_port() as server_port,
        pg_database_size(current_database()) as database_size_bytes,
        pg_size_pretty(pg_database_size(current_database())) as database_size_human
    `);
    
    console.table(dbInfo.rows);

    // 2. قائمة جميع الجداول
    console.log('\n📋 قائمة جميع الجداول');
    console.log('-'.repeat(50));
    
    const tables = await client.query(`
      SELECT 
        schemaname as schema,
        tablename as table_name,
        tableowner as owner,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
        pg_stat_get_tuples_returned(c.oid) as rows_read,
        pg_stat_get_tuples_fetched(c.oid) as rows_fetched,
        pg_stat_get_tuples_inserted(c.oid) as rows_inserted,
        pg_stat_get_tuples_updated(c.oid) as rows_updated,
        pg_stat_get_tuples_deleted(c.oid) as rows_deleted
      FROM pg_tables t
      JOIN pg_class c ON c.relname = t.tablename
      WHERE schemaname NOT IN ('information_schema', 'pg_catalog')
      ORDER BY schemaname, tablename
    `);
    
    console.table(tables.rows);

    // 3. تفاصيل كل جدول (الأعمدة والفهارس)
    console.log('\n🔍 تفاصيل الجداول والأعمدة');
    console.log('-'.repeat(50));
    
    for (const table of tables.rows) {
      console.log(`\n📄 الجدول: ${table.schema}.${table.table_name}`);
      console.log(`📏 الحجم: ${table.size}`);
      
      // الأعمدة
      const columns = await client.query(`
        SELECT 
          column_name,
          data_type,
          is_nullable,
          column_default,
          character_maximum_length,
          numeric_precision,
          numeric_scale
        FROM information_schema.columns 
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
      `, [table.schema, table.table_name]);
      
      console.log('الأعمدة:');
      console.table(columns.rows);
      
      // الفهارس
      const indexes = await client.query(`
        SELECT 
          indexname as index_name,
          indexdef as definition
        FROM pg_indexes 
        WHERE schemaname = $1 AND tablename = $2
        ORDER BY indexname
      `, [table.schema, table.table_name]);
      
      if (indexes.rows.length > 0) {
        console.log('الفهارس:');
        console.table(indexes.rows);
      }
      
      // عدد السجلات الفعلي
      try {
        const count = await client.query(`SELECT COUNT(*) as row_count FROM ${table.schema}.${table.table_name}`);
        console.log(`📊 عدد السجلات: ${count.rows[0].row_count}`);
      } catch (error) {
        console.log(`❌ لا يمكن عد السجلات: ${error.message}`);
      }
      
      console.log('═'.repeat(60));
    }

    // 4. الـ Views
    console.log('\n👁️ المشاهد (Views)');
    console.log('-'.repeat(50));
    
    const views = await client.query(`
      SELECT 
        schemaname as schema,
        viewname as view_name,
        viewowner as owner,
        definition
      FROM pg_views 
      WHERE schemaname NOT IN ('information_schema', 'pg_catalog')
      ORDER BY schemaname, viewname
    `);
    
    if (views.rows.length > 0) {
      console.table(views.rows);
    } else {
      console.log('لا توجد مشاهد مخصصة');
    }

    // 5. الدوال المخصصة
    console.log('\n⚙️ الدوال المخصصة');
    console.log('-'.repeat(50));
    
    const functions = await client.query(`
      SELECT 
        n.nspname as schema,
        p.proname as function_name,
        pg_get_function_identity_arguments(p.oid) as arguments,
        t.typname as return_type,
        l.lanname as language,
        CASE 
          WHEN p.proisstrict THEN 'STRICT'
          ELSE 'NOT STRICT'
        END as strictness,
        CASE 
          WHEN p.provolatile = 'i' THEN 'IMMUTABLE'
          WHEN p.provolatile = 's' THEN 'STABLE'  
          ELSE 'VOLATILE'
        END as volatility
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      JOIN pg_type t ON p.prorettype = t.oid
      JOIN pg_language l ON p.prolang = l.oid
      WHERE n.nspname NOT IN ('information_schema', 'pg_catalog')
      ORDER BY n.nspname, p.proname
    `);
    
    if (functions.rows.length > 0) {
      console.table(functions.rows);
    } else {
      console.log('لا توجد دوال مخصصة');
    }

    // 6. المشغلات (Triggers)
    console.log('\n🔫 المشغلات (Triggers)');
    console.log('-'.repeat(50));
    
    const triggers = await client.query(`
      SELECT 
        n.nspname as schema,
        c.relname as table_name,
        t.tgname as trigger_name,
        p.proname as function_name,
        CASE 
          WHEN t.tgtype & 2 = 2 THEN 'BEFORE'
          WHEN t.tgtype & 64 = 64 THEN 'INSTEAD OF'
          ELSE 'AFTER'
        END as timing,
        CASE 
          WHEN t.tgtype & 4 = 4 THEN 'INSERT'
          WHEN t.tgtype & 8 = 8 THEN 'DELETE'
          WHEN t.tgtype & 16 = 16 THEN 'UPDATE'
          ELSE 'OTHER'
        END as event
      FROM pg_trigger t
      JOIN pg_class c ON t.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      LEFT JOIN pg_proc p ON t.tgfoid = p.oid
      WHERE n.nspname NOT IN ('information_schema', 'pg_catalog')
        AND NOT t.tgisinternal
      ORDER BY n.nspname, c.relname, t.tgname
    `);
    
    if (triggers.rows.length > 0) {
      console.table(triggers.rows);
    } else {
      console.log('لا توجد مشغلات مخصصة');
    }

    // 7. الصلاحيات والأدوار
    console.log('\n🔐 الصلاحيات والأدوار');
    console.log('-'.repeat(50));
    
    const roles = await client.query(`
      SELECT 
        rolname as role_name,
        rolsuper as is_superuser,
        rolinherit as can_inherit,
        rolcreaterole as can_create_roles,
        rolcreatedb as can_create_databases,
        rolcanlogin as can_login,
        rolconnlimit as connection_limit,
        rolvaliduntil as valid_until
      FROM pg_roles
      WHERE rolname NOT LIKE 'pg_%'
      ORDER BY rolname
    `);
    
    console.table(roles.rows);

    // 8. حالة الاتصالات النشطة
    console.log('\n🔗 الاتصالات النشطة');
    console.log('-'.repeat(50));
    
    const connections = await client.query(`
      SELECT 
        datname as database,
        usename as username,
        client_addr as client_ip,
        state,
        query_start,
        state_change,
        CASE 
          WHEN state = 'active' THEN query
          ELSE '<idle>'
        END as current_query
      FROM pg_stat_activity
      WHERE datname = current_database()
      ORDER BY query_start DESC
    `);
    
    console.table(connections.rows);

    // 9. إحصائيات الجداول
    console.log('\n📈 إحصائيات الجداول');
    console.log('-'.repeat(50));
    
    const tableStats = await client.query(`
      SELECT 
        schemaname as schema,
        tablename as table_name,
        n_tup_ins as inserts,
        n_tup_upd as updates,
        n_tup_del as deletes,
        n_live_tup as live_rows,
        n_dead_tup as dead_rows,
        last_vacuum,
        last_autovacuum,
        last_analyze,
        last_autoanalyze
      FROM pg_stat_user_tables
      ORDER BY schemaname, tablename
    `);
    
    if (tableStats.rows.length > 0) {
      console.table(tableStats.rows);
    }

    // 10. الفهارس غير المستخدمة
    console.log('\n🗂️ الفهارس غير المستخدمة');
    console.log('-'.repeat(50));
    
    const unusedIndexes = await client.query(`
      SELECT 
        schemaname as schema,
        tablename as table_name,
        indexname as index_name,
        idx_tup_read as index_reads,
        idx_tup_fetch as index_fetches,
        pg_size_pretty(pg_relation_size(indexrelname::regclass)) as index_size
      FROM pg_stat_user_indexes
      WHERE idx_tup_read = 0 AND idx_tup_fetch = 0
      ORDER BY pg_relation_size(indexrelname::regclass) DESC
    `);
    
    if (unusedIndexes.rows.length > 0) {
      console.table(unusedIndexes.rows);
      console.log('⚠️ هذه الفهارس لم يتم استخدامها وقد تستحق المراجعة');
    } else {
      console.log('✅ جميع الفهارس مستخدمة');
    }

    // 11. حالة الـ Extensions
    console.log('\n🧩 الإضافات المثبتة (Extensions)');
    console.log('-'.repeat(50));
    
    const extensions = await client.query(`
      SELECT 
        extname as extension_name,
        extversion as version,
        nspname as schema,
        extrelocatable as is_relocatable
      FROM pg_extension e
      JOIN pg_namespace n ON e.extnamespace = n.oid
      ORDER BY extname
    `);
    
    console.table(extensions.rows);

    // 12. المشاكل المحتملة
    console.log('\n⚠️ المشاكل المحتملة');
    console.log('-'.repeat(50));
    
    // جداول بدون Primary Key
    const tablesWithoutPK = await client.query(`
      SELECT DISTINCT
        t.table_schema as schema,
        t.table_name
      FROM information_schema.tables t
      LEFT JOIN information_schema.key_column_usage k 
        ON t.table_name = k.table_name 
        AND t.table_schema = k.table_schema
        AND k.constraint_name LIKE '%_pkey'
      WHERE t.table_type = 'BASE TABLE'
        AND t.table_schema NOT IN ('information_schema', 'pg_catalog')
        AND k.table_name IS NULL
      ORDER BY t.table_schema, t.table_name
    `);
    
    if (tablesWithoutPK.rows.length > 0) {
      console.log('❌ جداول بدون Primary Key:');
      console.table(tablesWithoutPK.rows);
    }
    
    // جداول كبيرة الحجم
    const largeTables = await client.query(`
      SELECT 
        schemaname as schema,
        tablename as table_name,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
        pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) as indexes_size
      FROM pg_tables 
      WHERE schemaname NOT IN ('information_schema', 'pg_catalog')
        AND pg_total_relation_size(schemaname||'.'||tablename) > 10 * 1024 * 1024  -- أكبر من 10MB
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
    `);
    
    if (largeTables.rows.length > 0) {
      console.log('\n📊 الجداول الكبيرة (أكبر من 10MB):');
      console.table(largeTables.rows);
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ تم الانتهاء من فحص قاعدة البيانات بنجاح');
    
  } catch (error) {
    console.error('❌ خطأ في فحص قاعدة البيانات:', error.message);
    if (error.code) {
      console.error(`كود الخطأ: ${error.code}`);
    }
    if (error.detail) {
      console.error(`تفاصيل الخطأ: ${error.detail}`);
    }
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 تم قطع الاتصال مع قاعدة البيانات');
  }
}

// تشغيل السكربت
inspectDatabase().catch(error => {
  console.error('❌ خطأ عام:', error);
  process.exit(1);
});