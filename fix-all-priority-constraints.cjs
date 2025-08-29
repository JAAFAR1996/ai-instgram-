#!/usr/bin/env node

/**
 * Fix ALL priority constraint mismatches across all tables
 */

const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://ai_instgram_user:rTAH6gFMveMhoSrFu3l9FmrqGYd1ZFdw@dpg-d2f0pije5dus73bi4ac0-a.frankfurt-postgres.render.com/ai_instgram';

console.log('🔧 CRITICAL FIX: Priority Constraints System-Wide');
console.log('==================================================\n');

async function fixAllPriorityConstraints() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('🔄 Connecting to database...');
    await client.connect();
    console.log('✅ Connected to database\n');

    // Read and execute the SQL file
    const fs = require('fs');
    const sqlContent = fs.readFileSync('fix-all-priority-constraints.sql', 'utf8');
    
    console.log('🔧 Executing comprehensive priority constraints fix...');
    await client.query(sqlContent);
    console.log('✅ ALL priority constraints fixed system-wide!\n');

    // Verify no remaining issues
    console.log('🔍 Final verification - checking for any remaining UPPERCASE constraints...');
    const remainingIssues = await client.query(`
      SELECT table_name, column_name, constraint_name
      FROM information_schema.constraint_column_usage ccu
      JOIN information_schema.check_constraints cc ON ccu.constraint_name = cc.constraint_name
      WHERE ccu.column_name = 'priority' 
      AND (cc.check_clause LIKE '%NORMAL%' 
           OR cc.check_clause LIKE '%CRITICAL%' 
           OR cc.check_clause LIKE '%MEDIUM%')
    `);

    if (remainingIssues.rows.length === 0) {
      console.log('✅ SUCCESS: No remaining UPPERCASE priority constraints found!');
    } else {
      console.log('⚠️ WARNING: Some constraints still use UPPERCASE values:');
      remainingIssues.rows.forEach(row => {
        console.log(`  - ${row.table_name}.${row.column_name}: ${row.constraint_name}`);
      });
    }
    
    console.log('\n🎉 Priority constraint fix completed successfully!');
    console.log('🚀 System should now accept lowercase priority values everywhere.');

  } catch (error) {
    console.error('\n❌ Fix failed:', error.message);
    console.error('\n📝 Full error details:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔚 Database connection closed');
  }
}

fixAllPriorityConstraints().catch(console.error);