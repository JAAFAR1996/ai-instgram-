#!/usr/bin/env node

/**
 * ManyChat Migration Executor
 * تشغيل migration جداول ManyChat في قاعدة البيانات
 */

import pkg from 'pg';
const { Client } = pkg;
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// قراءة DATABASE_URL من البيئة أو استخدام default
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://ai_instgram_user:your_password@dpg-d2f0pije5dus73bi4ac0-a.frankfurt-postgres.render.com/ai_instgram';

async function runManyhatMigration() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('🔄 Connecting to database...');
    await client.connect();
    console.log('✅ Connected to database');

    // قراءة ملف migration
    const migrationPath = path.join(__dirname, 'src/database/migrations/053_manychat_integration.sql');
    
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found: ${migrationPath}`);
    }

    console.log('📖 Reading migration file...');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('🚀 Executing ManyChat migration...');
    await client.query(migrationSQL);
    console.log('✅ ManyChat migration completed successfully!');

    // التحقق من الجداول المنشأة
    console.log('🔍 Verifying created tables...');
    const tableCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE 'manychat_%'
      ORDER BY table_name
    `);

    console.log('📋 ManyChat Tables Created:');
    tableCheck.rows.forEach(row => {
      console.log(`  ✅ ${row.table_name}`);
    });

    // التحقق من جدول manual_followup_queue
    const followupCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'manual_followup_queue'
    `);

    if (followupCheck.rows.length > 0) {
      console.log('  ✅ manual_followup_queue');
    } else {
      console.log('  ❌ manual_followup_queue (missing)');
    }

    // التحقق من عمود manychat_config في merchants
    const merchantConfigCheck = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'merchants' 
      AND column_name = 'manychat_config'
    `);

    if (merchantConfigCheck.rows.length > 0) {
      console.log('  ✅ merchants.manychat_config column added');
    } else {
      console.log('  ❌ merchants.manychat_config column (missing)');
    }

    console.log('\n🎉 ManyChat integration migration completed successfully!');
    console.log('💡 You can now restart your application to use ManyChat features.');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    
    if (error.message.includes('already exists')) {
      console.log('ℹ️  Some tables may already exist. This is normal.');
    } else if (error.message.includes('permission denied')) {
      console.error('🔒 Permission error. Make sure you have write access to the database.');
    } else {
      console.error('📝 Full error:', error);
    }
    
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔚 Database connection closed');
  }
}

// تشغيل الـ migration
runManyhatMigration().catch(console.error);

export { runManyhatMigration };