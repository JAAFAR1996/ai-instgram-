import { Pool } from 'pg';
import fs from 'fs';

const pool = new Pool({
  connectionString: 'postgresql://ai_instgram_user:rTAH6gFMveMhoSrFu3l9FmrqGYd1ZFdw@dpg-d2f0pije5dus73bi4ac0-a.frankfurt-postgres.render.com/ai_instgram?sslmode=require'
});

async function setupDynamicTables() {
  try {
    console.log('🚀 Setting up dynamic tables...');
    
    // Read SQL file
    const sql = fs.readFileSync('create-dynamic-tables.sql', 'utf8');
    
    // Execute SQL
    await pool.query(sql);
    
    console.log('✅ Dynamic tables created successfully!');
    
    // Verify tables were created
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name LIKE 'dynamic_%'
      ORDER BY table_name
    `);
    
    console.log('📋 Dynamic tables created:');
    tables.rows.forEach(row => console.log('  -', row.table_name));
    
    // Check data
    const templates = await pool.query(`
      SELECT COUNT(*) as count FROM dynamic_response_templates
    `);
    console.log('📝 Response templates:', templates.rows[0].count);
    
    const settings = await pool.query(`
      SELECT COUNT(*) as count FROM dynamic_ai_settings
    `);
    console.log('⚙️ AI settings:', settings.rows[0].count);
    
    const defaults = await pool.query(`
      SELECT COUNT(*) as count FROM dynamic_defaults
    `);
    console.log('🔧 Defaults:', defaults.rows[0].count);
    
    const errors = await pool.query(`
      SELECT COUNT(*) as count FROM dynamic_error_messages
    `);
    console.log('❌ Error messages:', errors.rows[0].count);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

setupDynamicTables();
