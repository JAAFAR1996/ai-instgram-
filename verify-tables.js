import { Client } from 'pg';

async function verifyTables() {
  const client = new Client({
    connectionString: "postgresql://ai_instgram_user:rTAH6gFMveMhoSrFu3l9FmrqGYd1ZFdw@dpg-d2f0pije5dus73bi4ac0-a.frankfurt-postgres.render.com/ai_instgram?sslmode=require",
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔗 Connecting to database...');
    await client.connect();
    
    // Check merchant_credentials table structure
    const merchantCredentialsColumns = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'merchant_credentials' 
      ORDER BY ordinal_position;
    `);
    
    console.log('\n🗂️  Updated merchant_credentials table:');
    console.log('═'.repeat(50));
    merchantCredentialsColumns.rows.forEach((col, index) => {
      const nullable = col.is_nullable === 'YES' ? ' (nullable)' : '';
      const newField = col.column_name === 'business_account_id' ? ' ← NEW!' : '';
      console.log(`${index + 1}. ${col.column_name} (${col.data_type}${nullable})${newField}`);
    });
    
    // Count total tables
    const tableCount = await client.query(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    // Count total migrations
    const migrationCount = await client.query(`
      SELECT COUNT(*) as count FROM migrations
    `);
    
    console.log('\n📊 Database Summary:');
    console.log('═'.repeat(25));
    console.log(`📋 Total Tables: ${tableCount.rows[0].count}`);
    console.log(`🔄 Total Migrations: ${migrationCount.rows[0].count}`);
    
    // Check for critical tables
    const criticalTables = [
      'merchants', 'merchant_credentials', 'conversations', 
      'messages', 'queue_jobs', 'webhook_logs', 'migrations'
    ];
    
    console.log('\n🔍 Critical Tables Check:');
    console.log('═'.repeat(30));
    
    for (const tableName of criticalTables) {
      const tableExists = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = $1
        );
      `, [tableName]);
      
      const status = tableExists.rows[0].exists ? '✅' : '❌';
      console.log(`${status} ${tableName}`);
    }
    
    console.log('\n🎉 Database verification completed!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

verifyTables().catch(console.error);