#!/usr/bin/env node

/**
 * Fix job_spool constraint to use lowercase priority values
 */

const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://ai_instgram_user:rTAH6gFMveMhoSrFu3l9FmrqGYd1ZFdw@dpg-d2f0pije5dus73bi4ac0-a.frankfurt-postgres.render.com/ai_instgram';

console.log('🔧 Fixing job_spool Priority Constraint');
console.log('=====================================\n');

async function fixJobSpoolConstraint() {
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

    // 1. Check current constraint
    console.log('🔍 Checking current constraint...');
    const constraintCheck = await client.query(`
      SELECT conname 
      FROM pg_constraint 
      WHERE conrelid = 'job_spool'::regclass 
      AND conname = 'valid_priority'
    `);
    
    if (constraintCheck.rows.length > 0) {
      console.log('📋 Found constraint:', constraintCheck.rows[0].conname);
    } else {
      console.log('❌ No valid_priority constraint found');
    }

    // 2. Check current data
    console.log('\n🔍 Checking current priority values...');
    const dataCheck = await client.query(`
      SELECT priority, COUNT(*) as count
      FROM job_spool 
      GROUP BY priority
      ORDER BY priority
    `);
    
    console.log('Current priority distribution:');
    dataCheck.rows.forEach(row => {
      console.log(`  - ${row.priority}: ${row.count} records`);
    });

    // 3. Drop the old constraint
    console.log('\n🗑️ Dropping old constraint...');
    await client.query('ALTER TABLE job_spool DROP CONSTRAINT IF EXISTS valid_priority');
    console.log('✅ Old constraint dropped');

    // 4. Update existing data
    console.log('\n🔧 Updating priority values...');
    const updateResult = await client.query(`
      UPDATE job_spool SET priority = CASE 
        WHEN UPPER(priority) = 'LOW' THEN 'low'
        WHEN UPPER(priority) = 'NORMAL' THEN 'normal' 
        WHEN UPPER(priority) = 'HIGH' THEN 'high'
        WHEN UPPER(priority) = 'CRITICAL' THEN 'urgent'
        ELSE 'normal'
      END
      WHERE priority NOT IN ('low', 'normal', 'high', 'urgent')
    `);
    
    console.log(`✅ Updated ${updateResult.rowCount} records`);

    // 5. Add new constraint
    console.log('\n🔗 Adding new constraint...');
    await client.query(`
      ALTER TABLE job_spool ADD CONSTRAINT valid_priority 
        CHECK (priority IN ('low', 'normal', 'high', 'urgent'))
    `);
    console.log('✅ New constraint added');

    // 6. Final verification
    console.log('\n🔍 Final verification...');
    const finalCheck = await client.query(`
      SELECT priority, COUNT(*) as count
      FROM job_spool 
      GROUP BY priority
      ORDER BY priority
    `);
    
    console.log('Final priority distribution:');
    finalCheck.rows.forEach(row => {
      console.log(`  - ${row.priority}: ${row.count} records`);
    });
    
    console.log('\n🎉 job_spool constraint fix completed successfully!');

  } catch (error) {
    console.error('\n❌ Fix failed:', error.message);
    console.error('\n📝 Full error details:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔚 Database connection closed');
  }
}

fixJobSpoolConstraint().catch(console.error);