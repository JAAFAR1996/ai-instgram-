const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  connectionString: "postgresql://ai_instgram_user:rTAH6gFMveMhoSrFu3l9FmrqGYd1ZFdw@dpg-d2f0pije5dus73bi4ac0-a.frankfurt-postgres.render.com/ai_instgram",
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('🚀 Starting...');
    
    // Check existing migrations using the correct table structure
    const { rows } = await client.query(`
      SELECT filename FROM migrations WHERE filename IN ('077_proactive_messaging.sql', '078_prediction_tables.sql')
    `);
    
    const applied = rows.map(r => r.filename);
    console.log('Applied migrations:', applied);
    
    // Apply 077 if needed
    if (!applied.includes('077_proactive_messaging.sql')) {
      console.log('🔄 Running 077_proactive_messaging.sql...');
      const sql = fs.readFileSync('src/database/migrations/077_proactive_messaging.sql', 'utf8');
      await client.query('BEGIN');
      await client.query(sql);
      // Insert with both name and filename to satisfy constraints
      await client.query(
        'INSERT INTO migrations (name, filename) VALUES ($1, $1)', 
        ['077_proactive_messaging.sql']
      );
      await client.query('COMMIT');
      console.log('✅ 077_proactive_messaging.sql completed');
    } else {
      console.log('⏭️ 077_proactive_messaging.sql already applied');
    }
    
    // Apply 078 if needed  
    if (!applied.includes('078_prediction_tables.sql')) {
      console.log('🔄 Running 078_prediction_tables.sql...');
      const sql = fs.readFileSync('src/database/migrations/078_prediction_tables.sql', 'utf8');
      await client.query('BEGIN');
      await client.query(sql);
      // Insert with both name and filename to satisfy constraints
      await client.query(
        'INSERT INTO migrations (name, filename) VALUES ($1, $1)', 
        ['078_prediction_tables.sql']
      );
      await client.query('COMMIT');
      console.log('✅ 078_prediction_tables.sql completed');
    } else {
      console.log('⏭️ 078_prediction_tables.sql already applied');
    }
    
    console.log('🎉 All migrations completed successfully!');
    
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', e.message);
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(console.error);
