#!/usr/bin/env node

/**
 * Fix priority column defaults to use lowercase
 */

const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://ai_instgram_user:rTAH6gFMveMhoSrFu3l9FmrqGYd1ZFdw@dpg-d2f0pije5dus73bi4ac0-a.frankfurt-postgres.render.com/ai_instgram';

console.log('🔧 Fixing Priority Column Defaults');
console.log('==================================\n');

async function fixPriorityDefaults() {
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

    // Fix job_spool default (NORMAL -> normal)
    console.log('🔧 Fixing job_spool default value...');
    await client.query("ALTER TABLE job_spool ALTER COLUMN priority SET DEFAULT 'normal'");
    console.log('✅ job_spool default updated to lowercase\n');

    // Check current defaults
    console.log('🔍 Checking current column defaults...');
    const defaults = await client.query(`
      SELECT table_name, column_name, column_default
      FROM information_schema.columns 
      WHERE column_name = 'priority' 
      AND table_schema = 'public'
      ORDER BY table_name
    `);
    
    console.log('Current priority column defaults:');
    defaults.rows.forEach(row => {
      console.log(`  - ${row.table_name}.${row.column_name}: ${row.column_default}`);
    });
    
    console.log('\n🎉 Priority defaults fixed successfully!');

  } catch (error) {
    console.error('\n❌ Fix failed:', error.message);
    console.error('\n📝 Full error details:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔚 Database connection closed');
  }
}

fixPriorityDefaults().catch(console.error);