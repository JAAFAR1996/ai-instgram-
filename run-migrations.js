// Simple Migration Runner
import { Client } from 'pg';
import { readFileSync } from 'fs';

async function runMigrations() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'ai_sales_dev',
    user: 'teddy',
    password: 'simple123'
  });

  try {
    console.log('🔗 Connecting to PostgreSQL...');
    await client.connect();
    console.log('✅ Connected successfully!');
    
    // Run initial schema migration
    console.log('📋 Running migration: Initial Schema...');
    
    const migrationSQL = readFileSync('./src/database/migrations/001_initial_schema.sql', 'utf-8');
    await client.query(migrationSQL);
    
    console.log('✅ Initial schema migration completed');
    
    // Run analytics views migration
    console.log('📋 Running migration: Analytics Views...');
    
    const analyticsSQL = readFileSync('./src/database/migrations/002_analytics_views.sql', 'utf-8');
    await client.query(analyticsSQL);
    
    console.log('✅ Analytics views migration completed');
    
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