#!/usr/bin/env node

/**
 * ===============================================
 * Comprehensive Migration Runner for Staging
 * Runs all migrations systematically
 * ===============================================
 */

import { Client } from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

async function runAllMigrations() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'ai_sales_dev',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password'
  });

  try {
    console.log('🚀 Starting comprehensive migration run...');
    console.log('🔗 Connecting to PostgreSQL...');
    await client.connect();
    console.log('✅ Connected successfully!');
    
    // Create migrations table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        filename VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    // Get all migration files
    const migrationsDir = './src/database/migrations';
    const migrationFiles = readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql') && !file.endsWith('.rollback.sql'))
      .sort();
    
    console.log(`📋 Found ${migrationFiles.length} migration files`);
    
    // Check which migrations have already been executed
    const executedResult = await client.query('SELECT filename FROM migrations ORDER BY id');
    const executedMigrations = new Set(executedResult.rows.map(row => row.filename));
    
    const pendingMigrations = migrationFiles.filter(file => !executedMigrations.has(file));
    
    if (pendingMigrations.length === 0) {
      console.log('✅ No pending migrations found');
      return;
    }
    
    console.log(`📋 Running ${pendingMigrations.length} pending migrations...`);
    
    // Run each pending migration
    for (const filename of pendingMigrations) {
      const migrationName = filename.replace(/^\d+_/, '').replace(/\.sql$/, '').replace(/_/g, ' ');
      console.log(`📄 Running migration: ${migrationName}`);
      
      try {
        const filepath = join(migrationsDir, filename);
        const migrationSQL = readFileSync(filepath, 'utf-8');
        
        // Begin transaction
        await client.query('BEGIN');
        
        try {
          // Execute migration SQL
          await client.query(migrationSQL);
          
          // Record migration in database (if not already recorded in SQL)
          if (!migrationSQL.includes('INSERT INTO migrations')) {
            await client.query(
              'INSERT INTO migrations (name, filename) VALUES ($1, $2)', 
              [migrationName, filename]
            );
          }
          
          // Commit transaction
          await client.query('COMMIT');
          console.log(`✅ Migration completed: ${migrationName}`);
        } catch (error) {
          // Rollback on error
          await client.query('ROLLBACK');
          throw error;
        }
      } catch (error) {
        console.error(`❌ Migration failed: ${migrationName}`, error.message);
        throw error;
      }
    }
    
    // Final status check
    console.log('🔍 Checking final database state...');
    
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    
    const viewsResult = await client.query(`
      SELECT table_name 
      FROM information_schema.views 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    console.log(`📊 Database State Summary:`);
    console.log(`   Tables: ${tablesResult.rows.length}`);
    console.log(`   Views: ${viewsResult.rows.length}`);
    console.log(`   Migrations: ${migrationFiles.length}`);
    
    // Check RLS status
    const rlsResult = await client.query(`
      SELECT tablename, rowsecurity 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND rowsecurity = true
    `);
    
    console.log(`   RLS Enabled Tables: ${rlsResult.rows.length}`);
    rlsResult.rows.forEach(row => {
      console.log(`     ✅ ${row.tablename}`);
    });
    
    console.log('🎉 All migrations completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runAllMigrations().catch(console.error);