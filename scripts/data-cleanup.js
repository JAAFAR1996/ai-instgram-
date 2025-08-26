#!/usr/bin/env node

/**
 * ===============================================
 * Data Cleanup Tool - AI Sales Platform
 * Clean up duplicate data and fix integrity issues
 * ===============================================
 * 
 * Features:
 * - Remove duplicate conversations
 * - Clean up orphaned records
 * - Fix invalid references
 * - Data validation and reporting
 * - Safe cleanup with backup
 */

import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DataCleanup {
  constructor() {
    this.pool = null;
    this.backupPath = path.join(__dirname, '../backups');
    this.cleanupReport = {
      timestamp: new Date().toISOString(),
      operations: [],
      statistics: {},
      errors: []
    };
  }

  async initialize() {
    console.log('🧹 Initializing Data Cleanup Tool...');
    
    // Use production database URL
    const databaseUrl = process.env.DATABASE_URL || 'postgresql://ai_instgram_user:rTAH6gFMveMhoSrFu3l9FmrqGYd1ZFdw@dpg-d2f0pije5dus73bi4ac0-a/ai_instgram?sslmode=disable';
    
    console.log(`🔗 Connecting to database...`);
    
    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes('sslmode=require') ? {
        rejectUnauthorized: false
      } : false,
      max: 5,
      min: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    // Test connection
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
      console.log('✅ Database connection established');
    } catch (error) {
      console.error('❌ Database connection failed:', error.message);
      console.log('💡 Please set DATABASE_URL environment variable or ensure PostgreSQL is running');
      throw error;
    } finally {
      client.release();
    }

    // Ensure backup directory exists
    if (!fs.existsSync(this.backupPath)) {
      fs.mkdirSync(this.backupPath, { recursive: true });
    }
  }

  async createBackup() {
    console.log('\n💾 Creating database backup...');
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(this.backupPath, `backup-${timestamp}.sql`);
    
    // Note: In production, you might want to use pg_dump
    // For now, we'll create a backup of critical data
    const client = await this.pool.connect();
    try {
      const backupData = {
        conversations: await client.query('SELECT * FROM conversations'),
        messages: await client.query('SELECT * FROM messages'),
        webhook_logs: await client.query('SELECT * FROM webhook_logs'),
        timestamp: new Date().toISOString()
      };
      
      fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
      console.log(`✅ Backup created: ${backupFile}`);
      
      this.cleanupReport.backupFile = backupFile;
    } finally {
      client.release();
    }
  }

  async analyzeDuplicates() {
    console.log('\n🔍 Analyzing duplicate data...');
    
    const client = await this.pool.connect();
    try {
      // Instagram duplicates
      const { rows: instagramDuplicates } = await client.query(`
        SELECT 
          merchant_id, 
          customer_instagram, 
          platform, 
          COUNT(*) as count,
          MIN(id) as keep_id,
          ARRAY_AGG(id ORDER BY created_at) as all_ids
        FROM conversations 
        WHERE customer_instagram IS NOT NULL 
        GROUP BY merchant_id, customer_instagram, platform 
        HAVING COUNT(*) > 1
      `);

      // WhatsApp duplicates
      const { rows: whatsappDuplicates } = await client.query(`
        SELECT 
          merchant_id, 
          customer_phone, 
          platform, 
          COUNT(*) as count,
          MIN(id) as keep_id,
          ARRAY_AGG(id ORDER BY created_at) as all_ids
        FROM conversations 
        WHERE customer_phone IS NOT NULL 
        GROUP BY merchant_id, customer_phone, platform 
        HAVING COUNT(*) > 1
      `);

      // Orphaned messages
      const { rows: orphanedMessages } = await client.query(`
        SELECT 
          m.id,
          m.conversation_id,
          m.content,
          m.created_at
        FROM messages m
        LEFT JOIN conversations c ON m.conversation_id = c.id
        WHERE c.id IS NULL
      `);

      // Invalid merchant references
      const { rows: invalidMerchants } = await client.query(`
        SELECT 
          c.id,
          c.merchant_id,
          c.customer_instagram,
          c.customer_phone,
          c.created_at
        FROM conversations c
        LEFT JOIN merchants m ON c.merchant_id = m.id
        WHERE m.id IS NULL
      `);

      this.cleanupReport.statistics = {
        instagramDuplicates: instagramDuplicates.length,
        whatsappDuplicates: whatsappDuplicates.length,
        orphanedMessages: orphanedMessages.length,
        invalidMerchants: invalidMerchants.length,
        totalDuplicates: instagramDuplicates.length + whatsappDuplicates.length
      };

      console.log(`📊 Found ${instagramDuplicates.length} Instagram duplicate sets`);
      console.log(`📊 Found ${whatsappDuplicates.length} WhatsApp duplicate sets`);
      console.log(`📊 Found ${orphanedMessages.length} orphaned messages`);
      console.log(`📊 Found ${invalidMerchants.length} invalid merchant references`);

      return {
        instagramDuplicates,
        whatsappDuplicates,
        orphanedMessages,
        invalidMerchants
      };

    } finally {
      client.release();
    }
  }

  async cleanupInstagramDuplicates(duplicates) {
    if (duplicates.length === 0) return;
    
    console.log('\n🧹 Cleaning up Instagram duplicates...');
    
    const client = await this.pool.connect();
    try {
      for (const duplicate of duplicates) {
        const { merchant_id, customer_instagram, platform, keep_id, all_ids } = duplicate;
        
        // Keep the oldest conversation (keep_id)
        const duplicateIds = all_ids.filter(id => id !== keep_id);
        
        if (duplicateIds.length > 0) {
          // Move messages from duplicate conversations to the kept conversation
          await client.query(`
            UPDATE messages 
            SET conversation_id = $1 
            WHERE conversation_id = ANY($2)
          `, [keep_id, duplicateIds]);
          
          // Delete duplicate conversations
          await client.query(`
            DELETE FROM conversations 
            WHERE id = ANY($1)
          `, [duplicateIds]);
          
          this.cleanupReport.operations.push({
            type: 'INSTAGRAM_DUPLICATE_CLEANUP',
            kept: keep_id,
            removed: duplicateIds,
            count: duplicateIds.length
          });
          
          console.log(`✅ Cleaned up ${duplicateIds.length} Instagram duplicates for ${customer_instagram}`);
        }
      }
    } finally {
      client.release();
    }
  }

  async cleanupWhatsAppDuplicates(duplicates) {
    if (duplicates.length === 0) return;
    
    console.log('\n🧹 Cleaning up WhatsApp duplicates...');
    
    const client = await this.pool.connect();
    try {
      for (const duplicate of duplicates) {
        const { merchant_id, customer_phone, platform, keep_id, all_ids } = duplicate;
        
        // Keep the oldest conversation (keep_id)
        const duplicateIds = all_ids.filter(id => id !== keep_id);
        
        if (duplicateIds.length > 0) {
          // Move messages from duplicate conversations to the kept conversation
          await client.query(`
            UPDATE messages 
            SET conversation_id = $1 
            WHERE conversation_id = ANY($2)
          `, [keep_id, duplicateIds]);
          
          // Delete duplicate conversations
          await client.query(`
            DELETE FROM conversations 
            WHERE id = ANY($1)
          `, [duplicateIds]);
          
          this.cleanupReport.operations.push({
            type: 'WHATSAPP_DUPLICATE_CLEANUP',
            kept: keep_id,
            removed: duplicateIds,
            count: duplicateIds.length
          });
          
          console.log(`✅ Cleaned up ${duplicateIds.length} WhatsApp duplicates for ${customer_phone}`);
        }
      }
    } finally {
      client.release();
    }
  }

  async cleanupOrphanedMessages(orphanedMessages) {
    if (orphanedMessages.length === 0) return;
    
    console.log('\n🧹 Cleaning up orphaned messages...');
    
    const client = await this.pool.connect();
    try {
      const orphanedIds = orphanedMessages.map(m => m.id);
      
      // Delete orphaned messages
      await client.query(`
        DELETE FROM messages 
        WHERE id = ANY($1)
      `, [orphanedIds]);
      
      this.cleanupReport.operations.push({
        type: 'ORPHANED_MESSAGES_CLEANUP',
        removed: orphanedIds,
        count: orphanedIds.length
      });
      
      console.log(`✅ Cleaned up ${orphanedIds.length} orphaned messages`);
    } finally {
      client.release();
    }
  }

  async handleInvalidMerchants(invalidMerchants) {
    if (invalidMerchants.length === 0) return;
    
    console.log('\n⚠️  Handling invalid merchant references...');
    
    const client = await this.pool.connect();
    try {
      // For now, we'll just report them
      // In production, you might want to:
      // 1. Create missing merchants
      // 2. Assign to a default merchant
      // 3. Delete the conversations
      
      this.cleanupReport.operations.push({
        type: 'INVALID_MERCHANT_REPORT',
        conversations: invalidMerchants.map(c => ({
          id: c.id,
          merchant_id: c.merchant_id,
          customer_instagram: c.customer_instagram,
          customer_phone: c.customer_phone
        })),
        count: invalidMerchants.length
      });
      
      console.log(`⚠️  Found ${invalidMerchants.length} conversations with invalid merchant references`);
      console.log('   These need manual review and handling');
    } finally {
      client.release();
    }
  }

  async validateCleanup() {
    console.log('\n✅ Validating cleanup results...');
    
    const client = await this.pool.connect();
    try {
      // Check for remaining duplicates
      const { rows: remainingInstagramDuplicates } = await client.query(`
        SELECT COUNT(*) as count
        FROM (
          SELECT merchant_id, customer_instagram, platform
          FROM conversations 
          WHERE customer_instagram IS NOT NULL 
          GROUP BY merchant_id, customer_instagram, platform 
          HAVING COUNT(*) > 1
        ) duplicates
      `);

      const { rows: remainingWhatsAppDuplicates } = await client.query(`
        SELECT COUNT(*) as count
        FROM (
          SELECT merchant_id, customer_phone, platform
          FROM conversations 
          WHERE customer_phone IS NOT NULL 
          GROUP BY merchant_id, customer_phone, platform 
          HAVING COUNT(*) > 1
        ) duplicates
      `);

      const { rows: remainingOrphanedMessages } = await client.query(`
        SELECT COUNT(*) as count
        FROM messages m
        LEFT JOIN conversations c ON m.conversation_id = c.id
        WHERE c.id IS NULL
      `);

      this.cleanupReport.validation = {
        remainingInstagramDuplicates: remainingInstagramDuplicates[0].count,
        remainingWhatsAppDuplicates: remainingWhatsAppDuplicates[0].count,
        remainingOrphanedMessages: remainingOrphanedMessages[0].count
      };

      console.log(`✅ Remaining Instagram duplicates: ${remainingInstagramDuplicates[0].count}`);
      console.log(`✅ Remaining WhatsApp duplicates: ${remainingWhatsAppDuplicates[0].count}`);
      console.log(`✅ Remaining orphaned messages: ${remainingOrphanedMessages[0].count}`);

    } finally {
      client.release();
    }
  }

  async generateReport() {
    console.log('\n📊 Generating Cleanup Report...');
    
    const reportPath = path.join(__dirname, '../data-cleanup-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(this.cleanupReport, null, 2));
    
    console.log('\n' + '='.repeat(80));
    console.log('🧹 DATA CLEANUP REPORT');
    console.log('='.repeat(80));
    
    console.log(`\n📅 Timestamp: ${this.cleanupReport.timestamp}`);
    console.log(`💾 Backup: ${this.cleanupReport.backupFile}`);
    
    console.log(`\n📈 STATISTICS:`);
    console.log(`  - Instagram duplicates: ${this.cleanupReport.statistics.instagramDuplicates}`);
    console.log(`  - WhatsApp duplicates: ${this.cleanupReport.statistics.whatsappDuplicates}`);
    console.log(`  - Orphaned messages: ${this.cleanupReport.statistics.orphanedMessages}`);
    console.log(`  - Invalid merchants: ${this.cleanupReport.statistics.invalidMerchants}`);
    
    console.log(`\n🔧 OPERATIONS (${this.cleanupReport.operations.length}):`);
    this.cleanupReport.operations.forEach((op, index) => {
      console.log(`  ${index + 1}. ${op.type}: ${op.count} items processed`);
    });
    
    if (this.cleanupReport.validation) {
      console.log(`\n✅ VALIDATION:`);
      console.log(`  - Remaining Instagram duplicates: ${this.cleanupReport.validation.remainingInstagramDuplicates}`);
      console.log(`  - Remaining WhatsApp duplicates: ${this.cleanupReport.validation.remainingWhatsAppDuplicates}`);
      console.log(`  - Remaining orphaned messages: ${this.cleanupReport.validation.remainingOrphanedMessages}`);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log(`📄 Full report saved to: ${reportPath}`);
    console.log('='.repeat(80));
  }

  async cleanup() {
    if (this.pool) {
      await this.pool.end();
    }
  }
}

// Main execution
async function main() {
  const cleanup = new DataCleanup();
  
  try {
    await cleanup.initialize();
    
    // Check if this is a dry run
    const isDryRun = process.argv.includes('--dry-run');
    
    if (!isDryRun) {
      await cleanup.createBackup();
    }
    
    const duplicates = await cleanup.analyzeDuplicates();
    
    if (isDryRun) {
      console.log('\n🔍 DRY RUN MODE - No changes will be made');
      console.log('Run without --dry-run to perform actual cleanup');
    } else {
      await cleanup.cleanupInstagramDuplicates(duplicates.instagramDuplicates);
      await cleanup.cleanupWhatsAppDuplicates(duplicates.whatsappDuplicates);
      await cleanup.cleanupOrphanedMessages(duplicates.orphanedMessages);
      await cleanup.handleInvalidMerchants(duplicates.invalidMerchants);
      await cleanup.validateCleanup();
    }
    
    await cleanup.generateReport();
    
    console.log('\n🎉 Data cleanup process completed!');
    
  } catch (error) {
    console.error('\n💥 Data cleanup failed:', error.message);
    process.exit(1);
  } finally {
    await cleanup.cleanup();
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\n⚠️  Cleanup interrupted');
  process.exit(1);
});

// Export the class for external use
export { DataCleanup };

// Run if this file is executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
