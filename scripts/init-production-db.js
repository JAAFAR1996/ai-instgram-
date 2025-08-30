#!/usr/bin/env node

/**
 * Production Database Initialization Script
 * Applies missing database schema for ManyChat Instagram integration
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Database configuration from environment
const dbConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

async function initializeDatabase() {
  const pool = new Pool(dbConfig);
  
  try {
    console.log('🔄 Initializing production database...');
    
    // Test connection
    const client = await pool.connect();
    console.log('✅ Database connection established');
    
    // Read migration file
    const migrationPath = path.join(__dirname, '../src/database/migrations/054_production_fixes.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('📖 Reading migration file: 054_production_fixes.sql');
    
    // Execute migration
    await client.query(migrationSQL);
    console.log('✅ Migration executed successfully');
    
    // Verify tables exist
    const tablesQuery = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('messages', 'message_followups')
      ORDER BY table_name;
    `;
    
    const result = await client.query(tablesQuery);
    console.log('📋 Created tables:');
    result.rows.forEach(row => {
      console.log(`   ✅ ${row.table_name}`);
    });
    
    // Check indexes
    const indexQuery = `
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename IN ('messages', 'message_followups')
      AND schemaname = 'public'
      ORDER BY indexname;
    `;
    
    const indexResult = await client.query(indexQuery);
    console.log('📊 Created indexes:');
    indexResult.rows.forEach(row => {
      console.log(`   ✅ ${row.indexname}`);
    });
    
    client.release();
    console.log('🎉 Database initialization completed successfully!');
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail
    });
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Validate environment
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is required');
  process.exit(1);
}

// Run initialization
console.log('🚀 Starting production database initialization...');
console.log('🔗 Database URL:', process.env.DATABASE_URL?.substring(0, 30) + '...');
initializeDatabase();