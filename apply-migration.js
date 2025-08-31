#!/usr/bin/env node
/**
 * Apply database migrations on production
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function applyMigration() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  try {
    await client.connect();
    console.log('📡 Connected to database');

    // Read migration file
    const migrationPath = path.join(__dirname, 'src/database/migrations/006_add_instagram_username_to_manychat.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('🔄 Applying migration: 006_add_instagram_username_to_manychat.sql');
    
    await client.query(migrationSQL);
    
    console.log('✅ Migration applied successfully!');

    // Verify the column was added
    const result = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'manychat_subscribers' 
      AND column_name = 'instagram_username'
    `);

    if (result.rows.length > 0) {
      console.log('✅ Column instagram_username verified in manychat_subscribers table');
    } else {
      console.error('❌ Column not found after migration');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

applyMigration();