import { Client } from 'pg';

async function checkTables() {
  const client = new Client({
    connectionString: "postgresql://ai_instgram_user:rTAH6gFMveMhoSrFu3l9FmrqGYd1ZFdw@dpg-d2f0pije5dus73bi4ac0-a.frankfurt-postgres.render.com/ai_instgram?sslmode=require",
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔗 Connecting to database...');
    await client.connect();
    
    // Get all tables
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    
    console.log('\n📋 Tables in database:');
    console.log('========================');
    tablesResult.rows.forEach((row, index) => {
      console.log(`${index + 1}. ${row.table_name}`);
    });
    
    // Check migrations table
    const migrationsResult = await client.query(`
      SELECT name, filename, executed_at 
      FROM migrations 
      ORDER BY executed_at DESC 
      LIMIT 10;
    `);
    
    console.log('\n🔄 Recent Migrations:');
    console.log('=====================');
    migrationsResult.rows.forEach((row, index) => {
      console.log(`${index + 1}. ${row.name} (${row.filename})`);
      console.log(`   Executed: ${row.executed_at}`);
    });
    
    // Check specific tables structure
    const importantTables = ['merchants', 'merchant_credentials', 'conversations', 'queue_jobs'];
    
    for (const tableName of importantTables) {
      try {
        const columnsResult = await client.query(`
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns 
          WHERE table_name = $1 
          ORDER BY ordinal_position;
        `, [tableName]);
        
        console.log(`\n🗂️  Table: ${tableName}`);
        console.log('─'.repeat(40));
        columnsResult.rows.forEach(col => {
          console.log(`  ${col.column_name} (${col.data_type}${col.is_nullable === 'YES' ? ', nullable' : ''})`);
        });
      } catch (error) {
        console.log(`❌ Table ${tableName} not found or error: ${error.message}`);
      }
    }
    
    console.log('\n✅ Database check completed!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

checkTables().catch(console.error);