import { Client } from 'pg';
import { readFileSync } from 'fs';

async function runSpecificMigration() {
  const client = new Client({
    connectionString: "postgresql://ai_instgram_user:rTAH6gFMveMhoSrFu3l9FmrqGYd1ZFdw@dpg-d2f0pije5dus73bi4ac0-a.frankfurt-postgres.render.com/ai_instgram?sslmode=require",
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔗 Connecting to database...');
    await client.connect();
    
    // Check if migration already exists
    const existingMigration = await client.query(`
      SELECT * FROM migrations 
      WHERE filename = '023_add_business_account_id_to_merchant_credentials.sql'
    `);
    
    if (existingMigration.rows.length > 0) {
      console.log('✅ Migration 023 already executed');
      return;
    }
    
    // Read and execute the migration
    const migrationSQL = readFileSync('src/database/migrations/023_add_business_account_id_to_merchant_credentials.sql', 'utf8');
    
    console.log('🔄 Executing migration 023...');
    await client.query('BEGIN');
    
    // Split SQL commands and execute individually
    const commands = migrationSQL.split(';').filter(cmd => cmd.trim());
    
    for (const command of commands) {
      if (command.trim()) {
        console.log(`Executing: ${command.trim().substring(0, 50)}...`);
        await client.query(command);
      }
    }
    
    await client.query('COMMIT');
    console.log('✅ Migration 023 completed successfully!');
    
    // Verify the column was added
    const columnCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'merchant_credentials' 
      AND column_name = 'business_account_id'
    `);
    
    if (columnCheck.rows.length > 0) {
      console.log('✅ business_account_id column successfully added!');
    } else {
      console.log('❌ business_account_id column not found after migration');
    }
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error.message);
  } finally {
    await client.end();
  }
}

runSpecificMigration().catch(console.error);