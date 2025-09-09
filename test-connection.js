console.log('Testing connection...');

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: 'postgresql://ai_instgram_user:rTAH6gFMveMhoSrFu3l9FmrqGYd1ZFdw@dpg-d2f0pije5dus73bi4ac0-a.frankfurt-postgres.render.com/ai_instgram?sslmode=require'
});

async function test() {
  try {
    console.log('Connecting to database...');
    const result = await pool.query('SELECT NOW()');
    console.log('✅ Connected successfully!');
    console.log('Current time:', result.rows[0].now);
    
    // Check merchants table
    const merchants = await pool.query('SELECT COUNT(*) FROM merchants');
    console.log('Merchants count:', merchants.rows[0].count);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

test();
