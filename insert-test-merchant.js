#!/usr/bin/env node
/**
 * ===============================================
 * Insert Test Merchant Data Script
 * تشغيل SQL لإدراج بيانات التاجر التجريبي
 * ===============================================
 */

const { readFileSync } = require('fs');
const { Pool } = require('pg');
const path = require('path');

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

async function insertTestMerchant() {
  console.log('🚀 Starting test merchant insertion...');
  
  const client = await pool.connect();
  
  try {
    // Read SQL file
    const sqlFile = path.join(__dirname, 'insert_test_merchant.sql');
    const sqlContent = readFileSync(sqlFile, 'utf8');
    
    console.log('📄 SQL file loaded successfully');
    
    // Execute SQL
    console.log('⚡ Executing SQL statements...');
    await client.query(sqlContent);
    
    console.log('✅ Test merchant data inserted successfully!');
    
    // Verify insertion
    console.log('\n🔍 Verifying data insertion...');
    
    const merchantCheck = await client.query(`
      SELECT 
        m.id,
        m.business_name,
        m.instagram_username,
        m.subscription_status,
        m.is_active,
        mc.platform,
        mc.instagram_page_id,
        mc.instagram_business_account_id
      FROM merchants m
      LEFT JOIN merchant_credentials mc ON m.id = mc.merchant_id
      WHERE m.id = $1
    `, ['dd90061a-a1ad-42de-be9b-1c9760d0de02']);
    
    if (merchantCheck.rows.length > 0) {
      const merchant = merchantCheck.rows[0];
      console.log('\n📋 Merchant Data Verified:');
      console.log(`   • ID: ${merchant.id}`);
      console.log(`   • Business Name: ${merchant.business_name}`);
      console.log(`   • Instagram Username: ${merchant.instagram_username}`);
      console.log(`   • Status: ${merchant.subscription_status}`);
      console.log(`   • Active: ${merchant.is_active}`);
      console.log(`   • Platform: ${merchant.platform}`);
      console.log(`   • Instagram Page ID: ${merchant.instagram_page_id}`);
      console.log(`   • Business Account ID: ${merchant.instagram_business_account_id}`);
      
      console.log('\n✅ All data verified successfully!');
      console.log('\n🎯 Next steps:');
      console.log('   1. Test webhook with this Page ID: 17841405545604018');
      console.log('   2. Verify merchant ID resolution in logs');
      console.log('   3. Check AI response generation');
      
    } else {
      console.error('❌ Failed to verify merchant data insertion');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ Error inserting test merchant data:', error.message);
    console.error('\n🔧 Debug info:');
    console.error('   • Check DATABASE_URL environment variable');
    console.error('   • Ensure database is accessible');
    console.error('   • Verify migrations have been run');
    console.error('\n💡 Try running: npm run db:migrate');
    process.exit(1);
  } finally {
    client.release();
  }
}

async function checkDatabaseConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    console.log('✅ Database connection successful');
    client.release();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
}

async function main() {
  console.log('🔧 AI Sales Platform - Test Merchant Setup');
  console.log('==========================================\n');
  
  // Check database connection first
  const dbConnected = await checkDatabaseConnection();
  if (!dbConnected) {
    console.error('\n💡 Please check your DATABASE_URL and try again');
    process.exit(1);
  }
  
  // Insert test merchant data
  await insertTestMerchant();
  
  // Close pool
  await pool.end();
  
  console.log('\n🎉 Test merchant setup completed successfully!');
}

// Handle errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled rejection:', error.message);
  process.exit(1);
});

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Script failed:', error.message);
    process.exit(1);
  });
}

module.exports = { insertTestMerchant };