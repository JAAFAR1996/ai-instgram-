import { Pool } from 'pg';

const pool = new Pool({
  connectionString: 'postgresql://ai_instgram_user:rTAH6gFMveMhoSrFu3l9FmrqGYd1ZFdw@dpg-d2f0pije5dus73bi4ac0-a.frankfurt-postgres.render.com/ai_instgram?sslmode=require'
});

async function checkMerchants() {
  try {
    // Check if merchants table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'merchants'
      );
    `);
    
    console.log('📋 Merchants table exists:', tableCheck.rows[0].exists);
    
    if (tableCheck.rows[0].exists) {
      // Get merchants data
      const merchants = await pool.query(`
        SELECT id, business_name, business_category, merchant_type, currency, ai_config, settings
        FROM merchants 
        LIMIT 5
      `);
      
      console.log('🏪 Merchants found:', merchants.rows.length);
      merchants.rows.forEach((merchant, index) => {
        console.log(`  ${index + 1}. ${merchant.business_name} (${merchant.business_category})`);
        console.log(`     ID: ${merchant.id}`);
        console.log(`     Type: ${merchant.merchant_type}`);
        console.log(`     Currency: ${merchant.currency}`);
        console.log(`     AI Config: ${merchant.ai_config ? 'Yes' : 'No'}`);
        console.log('');
      });
    }
    
    // Check products table
    const productsCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'products'
      );
    `);
    
    console.log('📦 Products table exists:', productsCheck.rows[0].exists);
    
    if (productsCheck.rows[0].exists) {
      const products = await pool.query(`
        SELECT COUNT(*) as count FROM products
      `);
      console.log('📦 Total products:', products.rows[0].count);
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkMerchants();
