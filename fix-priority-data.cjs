#!/usr/bin/env node

/**
 * Fix existing priority constraint data
 */

const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://ai_instgram_user:rTAH6gFMveMhoSrFu3l9FmrqGYd1ZFdw@dpg-d2f0pije5dus73bi4ac0-a.frankfurt-postgres.render.com/ai_instgram';

console.log('🔧 Fixing Priority Constraint Data');
console.log('====================================\n');

async function fixPriorityData() {
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

    // 1. Check current invalid data
    console.log('🔍 Checking for invalid priority values...');
    const invalidData = await client.query(`
      SELECT priority, COUNT(*) as count
      FROM manual_followup_queue 
      WHERE priority NOT IN ('low', 'normal', 'high', 'urgent')
      GROUP BY priority
    `);
    
    if (invalidData.rows.length === 0) {
      console.log('✅ No invalid priority values found');
    } else {
      console.log('❌ Found invalid priority values:');
      invalidData.rows.forEach(row => {
        console.log(`  - "${row.priority}": ${row.count} records`);
      });

      // 2. Update invalid values
      console.log('\n🔧 Updating invalid priority values...');
      
      const updates = await client.query(`
        UPDATE manual_followup_queue 
        SET priority = CASE 
          WHEN UPPER(priority) = 'LOW' THEN 'low'
          WHEN UPPER(priority) = 'MEDIUM' THEN 'normal' 
          WHEN UPPER(priority) = 'NORMAL' THEN 'normal'
          WHEN UPPER(priority) = 'HIGH' THEN 'high'
          WHEN UPPER(priority) = 'URGENT' THEN 'urgent'
          ELSE 'normal'
        END
        WHERE priority NOT IN ('low', 'normal', 'high', 'urgent')
        RETURNING id, priority
      `);
      
      console.log(`✅ Updated ${updates.rows.length} records`);
      
      if (updates.rows.length > 0) {
        console.log('Updated records:');
        updates.rows.forEach(row => {
          console.log(`  - ID ${row.id}: ${row.priority}`);
        });
      }
    }

    // 3. Verify final state
    console.log('\n🔍 Final verification...');
    const finalCheck = await client.query(`
      SELECT priority, COUNT(*) as count
      FROM manual_followup_queue 
      GROUP BY priority
      ORDER BY priority
    `);
    
    console.log('Final priority distribution:');
    finalCheck.rows.forEach(row => {
      console.log(`  - ${row.priority}: ${row.count} records`);
    });
    
    console.log('\n🎉 Priority data fix completed successfully!');

  } catch (error) {
    console.error('\n❌ Fix failed:', error.message);
    
    if (error.message.includes('violates check constraint')) {
      console.log('ℹ️  This error indicates constraint is working correctly');
      console.log('💡 Run this script to fix existing data first');
    }
    
    console.error('\n📝 Full error details:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n🔚 Database connection closed');
  }
}

fixPriorityData().catch(console.error);