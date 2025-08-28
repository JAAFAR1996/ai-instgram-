#!/usr/bin/env node

/**
 * Quick ManyChat Setup
 * إعداد سريع لجداول ManyChat مع التحقق من الحالة
 */

console.log('🚀 ManyChat Quick Setup Started');
console.log('===============================\n');

// استيراد scripts الأخرى
const { checkManyChatStatus } = require('./check-manychat-status.js');
const { runManyhatMigration } = require('./execute-manychat-migration.js');

async function quickSetup() {
  try {
    // 1. فحص الحالة الحالية
    console.log('📋 Step 1: Checking current status...\n');
    await checkManyChatStatus();
    
    console.log('\n' + '='.repeat(50));
    console.log('🔧 Step 2: Running migration...\n');
    
    // 2. تشغيل الـ migration
    await runManyhatMigration();
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ Step 3: Final verification...\n');
    
    // 3. فحص نهائي
    await checkManyChatStatus();
    
    console.log('\n🎉 ManyChat setup completed successfully!');
    console.log('💡 Next steps:');
    console.log('   1. Add MANYCHAT_API_KEY to environment variables');
    console.log('   2. Restart your application');
    console.log('   3. Test Instagram → ManyChat integration');
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    console.log('\n🔧 Troubleshooting:');
    console.log('   1. Check DATABASE_URL is correct');
    console.log('   2. Ensure database is accessible');
    console.log('   3. Check database permissions');
    process.exit(1);
  }
}

// تشغيل الإعداد السريع
if (require.main === module) {
  quickSetup().catch(console.error);
}

module.exports = { quickSetup };