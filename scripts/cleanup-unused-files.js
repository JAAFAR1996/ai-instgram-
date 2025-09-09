#!/usr/bin/env node

/**
 * Cleanup Unused Files Script
 * حذف الملفات غير المستخدمة
 */

import { promises as fs } from 'fs';
import path from 'path';

const UNUSED_FILES = [
  // WhatsApp related files
  'src/services/whatsapp-ai.ts',
  'src/services/whatsapp-message-sender.ts',
  'src/routes/whatsapp-webhooks.ts',
  
  // Advanced analytics files
  'src/services/advanced-analytics.ts',
  'src/services/predictive-analytics.ts',
  'src/services/customer-insights.ts',
  
  // ManyChat files
  'src/services/manychat-bridge.ts',
  'src/services/manychat-webhook-handler.ts',
  
  // Instagram advanced features
  'src/services/instagram-stories-manager.ts',
  'src/services/instagram-interaction-analyzer.ts',
  
  // Cross-platform files
  'src/services/cross-platform-conversation-manager.ts',
  
  // Monitoring files
  'src/services/monitoring.ts',
  
  // Unused migration files
  'src/database/migrations/041_cross_platform_infrastructure.sql',
  'src/database/migrations/053_manychat_integration.sql',
  'src/database/migrations/054_production_fixes.sql',
  'src/database/migrations/055_enforce_username_only.sql',
  'src/database/migrations/056_manychat_username_and_message_windows.sql',
  'src/database/migrations/061_create_quality_metrics.sql',
  'src/database/migrations/078_prediction_tables.sql',
  'src/database/migrations/080_instagram_interactions.sql',
  'src/database/migrations/081_fix_instagram_order_items_returns.sql',
  'src/database/migrations/081_fix_predictive_analytics_schema.sql',
  
  // Unused test files
  'tests/src/whatsapp-integration.test.ts',
  'tests/src/cross-platform.test.ts',
  'tests/src/manychat.test.ts',
  
  // Unused documentation
  'docs/WHATSAPP_INTEGRATION.md',
  'docs/MANYCHAT_SETUP.md',
  'docs/ADVANCED_ANALYTICS.md',
  
  // Unused scripts
  'scripts/setup-manychat.js',
  'scripts/test-whatsapp.js',
  'scripts/analytics-setup.js'
];

const UNUSED_DIRECTORIES = [
  'src/services/analytics',
  'src/services/manychat',
  'src/services/whatsapp',
  'tests/src/whatsapp',
  'tests/src/manychat',
  'docs/advanced'
];

async function cleanupFiles() {
  console.log('🧹 Starting cleanup of unused files...');
  
  let deletedCount = 0;
  let errorCount = 0;
  
  // Delete files
  for (const file of UNUSED_FILES) {
    try {
      await fs.unlink(file);
      console.log(`✅ Deleted: ${file}`);
      deletedCount++;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.log(`❌ Error deleting ${file}: ${error.message}`);
        errorCount++;
      } else {
        console.log(`ℹ️  File not found: ${file}`);
      }
    }
  }
  
  // Delete directories
  for (const dir of UNUSED_DIRECTORIES) {
    try {
      await fs.rmdir(dir, { recursive: true });
      console.log(`✅ Deleted directory: ${dir}`);
      deletedCount++;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.log(`❌ Error deleting directory ${dir}: ${error.message}`);
        errorCount++;
      } else {
        console.log(`ℹ️  Directory not found: ${dir}`);
      }
    }
  }
  
  console.log(`\n📊 Cleanup Summary:`);
  console.log(`✅ Files/Directories deleted: ${deletedCount}`);
  console.log(`❌ Errors: ${errorCount}`);
  console.log(`\n🎉 Cleanup completed!`);
}

// Run cleanup
cleanupFiles().catch(console.error);
