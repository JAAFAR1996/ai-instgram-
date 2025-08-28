#!/usr/bin/env node

/**
 * ManyChat Status Checker
 * فحص حالة جداول وإعدادات ManyChat
 */

import pkg from 'pg';
const { Client } = pkg;

// قراءة DATABASE_URL من البيئة
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://ai_instgram_user:your_password@dpg-d2f0pije5dus73bi4ac0-a.frankfurt-postgres.render.com/ai_instgram';

async function checkManyChatStatus() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('🔄 Connecting to database...');
    await client.connect();
    console.log('✅ Connected to database\n');

    // 1. فحص الجداول المطلوبة
    console.log('📋 Checking Required Tables:');
    const requiredTables = [
      'manychat_logs',
      'manychat_subscribers', 
      'manychat_flows',
      'manychat_webhooks',
      'manual_followup_queue'
    ];

    for (const tableName of requiredTables) {
      const result = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = $1
      `, [tableName]);

      if (result.rows.length > 0) {
        console.log(`  ✅ ${tableName}`);
      } else {
        console.log(`  ❌ ${tableName} (MISSING)`);
      }
    }

    // 2. فحص عمود manychat_config في merchants
    console.log('\n🏪 Checking merchants table:');
    const merchantConfigCheck = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'merchants' 
      AND column_name = 'manychat_config'
    `);

    if (merchantConfigCheck.rows.length > 0) {
      const col = merchantConfigCheck.rows[0];
      console.log(`  ✅ manychat_config (${col.data_type}, default: ${col.column_default})`);
    } else {
      console.log('  ❌ manychat_config column (MISSING)');
    }

    // 3. فحص الـ indexes
    console.log('\n🔍 Checking Indexes:');
    const indexCheck = await client.query(`
      SELECT 
        indexname,
        tablename
      FROM pg_indexes 
      WHERE tablename LIKE 'manychat_%'
      ORDER BY tablename, indexname
    `);

    if (indexCheck.rows.length > 0) {
      indexCheck.rows.forEach(row => {
        console.log(`  ✅ ${row.tablename}.${row.indexname}`);
      });
    } else {
      console.log('  ❌ No ManyChat indexes found');
    }

    // 4. فحص الـ constraints
    console.log('\n🔒 Checking Constraints:');
    const constraintCheck = await client.query(`
      SELECT 
        table_name,
        constraint_name,
        constraint_type
      FROM information_schema.table_constraints 
      WHERE table_name LIKE 'manychat_%'
      AND constraint_type IN ('UNIQUE', 'CHECK', 'FOREIGN KEY')
      ORDER BY table_name, constraint_type, constraint_name
    `);

    if (constraintCheck.rows.length > 0) {
      constraintCheck.rows.forEach(row => {
        console.log(`  ✅ ${row.table_name}.${row.constraint_name} (${row.constraint_type})`);
      });
    } else {
      console.log('  ❌ No ManyChat constraints found');
    }

    // 5. فحص الـ triggers
    console.log('\n⚡ Checking Triggers:');
    const triggerCheck = await client.query(`
      SELECT 
        trigger_name,
        event_object_table,
        event_manipulation
      FROM information_schema.triggers 
      WHERE event_object_table LIKE 'manychat_%'
      ORDER BY event_object_table, trigger_name
    `);

    if (triggerCheck.rows.length > 0) {
      triggerCheck.rows.forEach(row => {
        console.log(`  ✅ ${row.event_object_table}.${row.trigger_name} (${row.event_manipulation})`);
      });
    } else {
      console.log('  ❌ No ManyChat triggers found');
    }

    // 6. فحص migration log
    console.log('\n📜 Checking Migration Log:');
    try {
      const migrationLogCheck = await client.query(`
        SELECT 
          migration_name,
          migration_version,
          applied_at,
          status
        FROM migration_logs 
        WHERE migration_name = '053_manychat_integration'
        ORDER BY applied_at DESC
        LIMIT 1
      `);

      if (migrationLogCheck.rows.length > 0) {
        const log = migrationLogCheck.rows[0];
        console.log(`  ✅ Migration 053 logged: ${log.status} at ${log.applied_at}`);
      } else {
        console.log('  ❌ Migration 053 not found in logs');
      }
    } catch (error) {
      console.log('  ❌ migration_logs table not found');
    }

    // 7. تقييم الحالة العامة
    console.log('\n🎯 Overall Status:');
    const allTablesExist = await client.query(`
      SELECT COUNT(*) as count
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('manychat_logs', 'manychat_subscribers', 'manychat_flows', 'manychat_webhooks', 'manual_followup_queue')
    `);

    const tableCount = parseInt(allTablesExist.rows[0].count);
    
    if (tableCount === 5) {
      console.log('  🎉 All ManyChat tables are present');
      console.log('  ✅ ManyChat integration is READY');
    } else if (tableCount > 0) {
      console.log(`  ⚠️  Partial setup: ${tableCount}/5 tables exist`);
      console.log('  🔧 Run migration to complete setup');
    } else {
      console.log('  ❌ ManyChat integration NOT CONFIGURED');
      console.log('  🚀 Run: node execute-manychat-migration.js');
    }

  } catch (error) {
    console.error('❌ Status check failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔚 Database connection closed');
  }
}

// تشغيل الفحص
checkManyChatStatus().catch(console.error);

export { checkManyChatStatus };