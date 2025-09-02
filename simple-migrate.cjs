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
    
    // Create migrations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    // Check existing
    const { rows } = await client.query(`
      SELECT filename FROM migrations WHERE filename IN ('077_proactive_messaging.sql', '078_prediction_tables.sql')
    `);
    
    const applied = rows.map(r => r.filename);
    console.log('Applied:', applied);
    
    // 077
    if (!applied.includes('077_proactive_messaging.sql')) {
      console.log('🔄 Running 077...');
      const sql = fs.readFileSync('src/database/migrations/077_proactive_messaging.sql', 'utf8');
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO migrations (filename) VALUES ($1)', ['077_proactive_messaging.sql']);
      await client.query('COMMIT');
      console.log('✅ 077 done');
    }
    
    // 078
    if (!applied.includes('078_prediction_tables.sql')) {
      console.log('🔄 Running 078...');
      const sql = fs.readFileSync('src/database/migrations/078_prediction_tables.sql', 'utf8');
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO migrations (filename) VALUES ($1)', ['078_prediction_tables.sql']);
      await client.query('COMMIT');
      console.log('✅ 078 done');
    }
    
    console.log('🎉 Done!');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Error:', e.message);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
