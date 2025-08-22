// Simple Migration Runner
import { Client } from 'pg';
import { readFileSync } from 'fs';

async function runMigrations() {
  const dbPassword = process.env.DB_PASSWORD;
  if (!dbPassword) {
    console.error('❌ DB_PASSWORD environment variable is required.');
    console.error('Please set DB_PASSWORD before running migrations.');
    process.exit(1);
  }

  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'ai_sales_dev',
    user: process.env.DB_USER || 'postgres',
    password: dbPassword,
    ssl: process.env.DB_HOST && process.env.DB_HOST.includes('render.com') ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔗 Connecting to PostgreSQL...');
    await client.connect();
    console.log('✅ Connected successfully!');
    
    // Run initial schema migration (skip if tables exist)
    console.log('📋 Checking for existing schema...');
    
    const existingTables = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'merchants'
    `);
    
    if (existingTables.rows.length === 0) {
      console.log('📋 Running migration: Initial Schema...');
      const migrationSQL = readFileSync('./src/database/migrations/001_initial_schema.sql', 'utf-8');
      await client.query(migrationSQL);
      console.log('✅ Initial schema migration completed');
    } else {
      console.log('✅ Initial schema already exists, skipping...');
    }
    
    // Run migrations one by one with error handling
    const migrations = [
      { name: 'Analytics Views', file: './src/database/migrations/002_analytics_views.sql' },
      { name: 'Unique Index', file: './src/database/migrations/024_unique_index_merchant_credentials.sql' },
      { name: 'RLS Policies', file: './src/database/migrations/025_implement_rls_policies.sql' },
      { name: 'Job Spool Table', file: './src/database/migrations/026_job_spool_table.sql' }
    ];

    for (const migration of migrations) {
      try {
        console.log(`📋 Running migration: ${migration.name}...`);
        const sql = readFileSync(migration.file, 'utf-8');
        await client.query(sql);
        console.log(`✅ ${migration.name} migration completed`);
      } catch (error) {
        if (error.message.includes('already exists') || error.message.includes('duplicate')) {
          console.log(`⚠️ ${migration.name} already exists, skipping...`);
        } else {
          console.warn(`⚠️ ${migration.name} migration error (continuing):`, error.message);
        }
      }
    }
    
    // Check tables
    console.log('🔍 Checking created tables...');
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    console.log('📋 Created tables:');
    tablesResult.rows.forEach(row => {
      console.log(`   ✅ ${row.table_name}`);
    });
    
    // Check views
    const viewsResult = await client.query(`
      SELECT table_name 
      FROM information_schema.views 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    console.log('📊 Created views:');
    viewsResult.rows.forEach(row => {
      console.log(`   ✅ ${row.table_name}`);
    });
    
    console.log('🎉 All migrations completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations();