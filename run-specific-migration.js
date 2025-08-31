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
    
    // Check if constraint already exists
    const existingConstraint = await client.query(`
      SELECT constraint_name 
      FROM information_schema.table_constraints 
      WHERE table_name = 'manychat_subscribers' 
      AND constraint_name = 'uk_manychat_subscribers_merchant_instagram_username'
    `);
    
    if (existingConstraint.rows.length > 0) {
      console.log('✅ Constraint uk_manychat_subscribers_merchant_instagram_username already exists');
      return;
    }
    
    // Read and execute the constraint fix
    const migrationSQL = readFileSync('fix-manychat-constraint.sql', 'utf8');
    
    console.log('🔄 Executing constraint fix - Adding unique constraint...');
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
    console.log('✅ Constraint fix completed successfully!');
    
    // Verify the constraint was added
    const constraintCheck = await client.query(`
      SELECT constraint_name 
      FROM information_schema.table_constraints 
      WHERE table_name = 'manychat_subscribers' 
      AND constraint_name = 'uk_manychat_subscribers_merchant_instagram_username'
    `);
    
    if (constraintCheck.rows.length > 0) {
      console.log('✅ Unique constraint successfully added!');
    } else {
      console.log('❌ Unique constraint not found after migration');
    }
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error.message);
  } finally {
    await client.end();
  }
}

runSpecificMigration().catch(console.error);