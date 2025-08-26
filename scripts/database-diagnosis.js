#!/usr/bin/env node

/**
 * ===============================================
 * Database Diagnosis Tool - AI Sales Platform
 * Comprehensive database health and architecture analysis
 * ===============================================
 * 
 * Features:
 * - Schema drift detection
 * - Migration tracking analysis
 * - Index consistency checks
 * - Data integrity validation
 * - Performance analysis
 * - Security audit
 */

import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DatabaseDiagnosis {
  constructor() {
    this.pool = null;
    this.report = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      issues: [],
      warnings: [],
      recommendations: [],
      statistics: {}
    };
  }

  async initialize() {
    console.log('🔍 Initializing Database Diagnosis...');
    
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('sslmode=require') ? {
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
      } : false,
      max: 3,
      min: 1,
      idleTimeoutMillis: 30000,
    });

    // Test connection
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
      console.log('✅ Database connection established');
    } finally {
      client.release();
    }
  }

  async checkMigrationTracking() {
    console.log('\n📋 Checking Migration Tracking Systems...');
    
    const client = await this.pool.connect();
    try {
      // Check for multiple migration tables
      const { rows: tables } = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_name IN ('migrations', '_migrations', 'schema_migrations')
        AND table_schema = 'public'
      `);

      if (tables.length > 1) {
        this.report.issues.push({
          category: 'MIGRATION_TRACKING',
          severity: 'HIGH',
          message: `Multiple migration tracking tables found: ${tables.map(t => t.table_name).join(', ')}`,
          recommendation: 'Consolidate to schema_migrations table only'
        });
      }

      // Check schema_migrations table structure
      if (tables.some(t => t.table_name === 'schema_migrations')) {
        const { rows: columns } = await client.query(`
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns 
          WHERE table_name = 'schema_migrations'
          ORDER BY ordinal_position
        `);

        const expectedColumns = [
          'version', 'applied_at', 'execution_time_ms', 'checksum', 'success', 'created_at'
        ];

        const missingColumns = expectedColumns.filter(col => 
          !columns.some(c => c.column_name === col)
        );

        if (missingColumns.length > 0) {
          this.report.warnings.push({
            category: 'MIGRATION_TRACKING',
            message: `schema_migrations table missing columns: ${missingColumns.join(', ')}`,
            recommendation: 'Run migration 032_unify_migration_tracking.sql'
          });
        }
      }

      // Check migration status
      const { rows: migrations } = await client.query(`
        SELECT version, success, applied_at, execution_time_ms
        FROM schema_migrations 
        ORDER BY applied_at DESC
        LIMIT 10
      `);

      this.report.statistics.migrations = {
        total: migrations.length,
        successful: migrations.filter(m => m.success).length,
        failed: migrations.filter(m => !m.success).length,
        recent: migrations.slice(0, 5)
      };

    } finally {
      client.release();
    }
  }

  async checkSchemaDrift() {
    console.log('\n🏗️  Checking Schema Drift...');
    
    const client = await this.pool.connect();
    try {
      // Check for missing unique indexes on conversations table
      const { rows: indexes } = await client.query(`
        SELECT indexname, indexdef 
        FROM pg_indexes 
        WHERE tablename = 'conversations' 
        AND indexname LIKE '%unique%'
      `);

      const expectedIndexes = [
        'uq_conversations_merchant_instagram_platform',
        'uq_conversations_merchant_phone_platform'
      ];

      const missingIndexes = expectedIndexes.filter(expected => 
        !indexes.some(idx => idx.indexname === expected)
      );

      if (missingIndexes.length > 0) {
        this.report.issues.push({
          category: 'SCHEMA_DRIFT',
          severity: 'HIGH',
          message: `Missing unique indexes on conversations table: ${missingIndexes.join(', ')}`,
          recommendation: 'Run migrations 021 and 038 to create missing indexes'
        });
      }

      // Check for duplicate conversations (data integrity)
      const { rows: duplicates } = await client.query(`
        SELECT 
          merchant_id, 
          customer_instagram, 
          platform, 
          COUNT(*) as count
        FROM conversations 
        WHERE customer_instagram IS NOT NULL 
        GROUP BY merchant_id, customer_instagram, platform 
        HAVING COUNT(*) > 1
        LIMIT 5
      `);

      if (duplicates.length > 0) {
        this.report.issues.push({
          category: 'DATA_INTEGRITY',
          severity: 'CRITICAL',
          message: `Found ${duplicates.length} sets of duplicate conversations`,
          details: duplicates,
          recommendation: 'Clean up duplicate data before applying unique constraints'
        });
      }

      // Check WhatsApp duplicates
      const { rows: whatsappDuplicates } = await client.query(`
        SELECT 
          merchant_id, 
          customer_phone, 
          platform, 
          COUNT(*) as count
        FROM conversations 
        WHERE customer_phone IS NOT NULL 
        GROUP BY merchant_id, customer_phone, platform 
        HAVING COUNT(*) > 1
        LIMIT 5
      `);

      if (whatsappDuplicates.length > 0) {
        this.report.issues.push({
          category: 'DATA_INTEGRITY',
          severity: 'CRITICAL',
          message: `Found ${whatsappDuplicates.length} sets of duplicate WhatsApp conversations`,
          details: whatsappDuplicates,
          recommendation: 'Clean up duplicate data before applying unique constraints'
        });
      }

    } finally {
      client.release();
    }
  }

  async checkTableStructure() {
    console.log('\n📊 Checking Table Structure...');
    
    const client = await this.pool.connect();
    try {
      // Check core tables existence
      const coreTables = [
        'merchants', 'conversations', 'messages', 'webhook_logs', 
        'webhook_subscriptions', 'message_logs'
      ];

      const { rows: existingTables } = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_name = ANY($1)
        AND table_schema = 'public'
      `, [coreTables]);

      const missingTables = coreTables.filter(table => 
        !existingTables.some(t => t.table_name === table)
      );

      if (missingTables.length > 0) {
        this.report.issues.push({
          category: 'TABLE_STRUCTURE',
          severity: 'HIGH',
          message: `Missing core tables: ${missingTables.join(', ')}`,
          recommendation: 'Run initial schema migration'
        });
      }

      // Check RLS policies
      const { rows: rlsTables } = await client.query(`
        SELECT schemaname, tablename, rowsecurity
        FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename IN ('merchants', 'conversations', 'messages', 'webhook_logs')
      `);

      const tablesWithoutRLS = rlsTables.filter(t => !t.rowsecurity);
      if (tablesWithoutRLS.length > 0) {
        this.report.warnings.push({
          category: 'SECURITY',
          message: `Tables without RLS: ${tablesWithoutRLS.map(t => t.tablename).join(', ')}`,
          recommendation: 'Enable RLS for multi-tenant security'
        });
      }

    } finally {
      client.release();
    }
  }

  async checkPerformance() {
    console.log('\n⚡ Checking Performance...');
    
    const client = await this.pool.connect();
    try {
      // Check for missing indexes on frequently queried columns
      const { rows: missingIndexes } = await client.query(`
        SELECT 
          t.table_name,
          c.column_name,
          c.data_type
        FROM information_schema.tables t
        JOIN information_schema.columns c ON t.table_name = c.table_name
        WHERE t.table_schema = 'public'
        AND c.column_name IN ('merchant_id', 'created_at', 'status', 'platform')
        AND NOT EXISTS (
          SELECT 1 FROM pg_indexes 
          WHERE tablename = t.table_name 
          AND indexdef LIKE '%' || c.column_name || '%'
        )
        ORDER BY t.table_name, c.column_name
      `);

      if (missingIndexes.length > 0) {
        this.report.warnings.push({
          category: 'PERFORMANCE',
          message: `Missing indexes on frequently queried columns: ${missingIndexes.length} columns`,
          details: missingIndexes,
          recommendation: 'Add indexes for better query performance'
        });
      }

      // Check table sizes
      const { rows: tableSizes } = await client.query(`
        SELECT 
          schemaname,
          tablename,
          attname,
          n_distinct,
          correlation
        FROM pg_stats 
        WHERE schemaname = 'public'
        AND tablename IN ('conversations', 'messages', 'webhook_logs', 'message_logs')
        ORDER BY tablename, attname
      `);

      this.report.statistics.tableStats = tableSizes;

    } finally {
      client.release();
    }
  }

  async checkDataIntegrity() {
    console.log('\n🔒 Checking Data Integrity...');
    
    const client = await this.pool.connect();
    try {
      // Check for orphaned records
      const { rows: orphanedMessages } = await client.query(`
        SELECT COUNT(*) as count
        FROM messages m
        LEFT JOIN conversations c ON m.conversation_id = c.id
        WHERE c.id IS NULL
      `);

      if (orphanedMessages[0].count > 0) {
        this.report.issues.push({
          category: 'DATA_INTEGRITY',
          severity: 'MEDIUM',
          message: `Found ${orphanedMessages[0].count} orphaned messages`,
          recommendation: 'Clean up orphaned messages or fix foreign key constraints'
        });
      }

      // Check for invalid merchant references
      const { rows: invalidMerchants } = await client.query(`
        SELECT COUNT(*) as count
        FROM conversations c
        LEFT JOIN merchants m ON c.merchant_id = m.id
        WHERE m.id IS NULL
      `);

      if (invalidMerchants[0].count > 0) {
        this.report.issues.push({
          category: 'DATA_INTEGRITY',
          severity: 'HIGH',
          message: `Found ${invalidMerchants[0].count} conversations with invalid merchant references`,
          recommendation: 'Fix merchant references or clean up invalid data'
        });
      }

    } finally {
      client.release();
    }
  }

  async generateRecommendations() {
    console.log('\n💡 Generating Recommendations...');
    
    // Add general recommendations based on findings
    if (this.report.issues.length > 0) {
      this.report.recommendations.push({
        priority: 'HIGH',
        action: 'Run production migration runner',
        command: 'node scripts/production-migration-runner.js --validate-only'
      });
    }

    if (this.report.issues.some(i => i.category === 'SCHEMA_DRIFT')) {
      this.report.recommendations.push({
        priority: 'CRITICAL',
        action: 'Fix schema drift before production deployment',
        command: 'node scripts/production-migration-runner.js --force'
      });
    }

    if (this.report.issues.some(i => i.category === 'DATA_INTEGRITY')) {
      this.report.recommendations.push({
        priority: 'HIGH',
        action: 'Clean up duplicate data',
        command: 'Create data cleanup script'
      });
    }

    this.report.recommendations.push({
      priority: 'MEDIUM',
      action: 'Regular database maintenance',
      command: 'Schedule weekly database health checks'
    });
  }

  async generateReport() {
    console.log('\n📊 Generating Comprehensive Report...');
    
    const reportPath = path.join(__dirname, '../database-diagnosis-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(this.report, null, 2));
    
    console.log('\n' + '='.repeat(80));
    console.log('🔍 DATABASE DIAGNOSIS REPORT');
    console.log('='.repeat(80));
    
    console.log(`\n📅 Timestamp: ${this.report.timestamp}`);
    console.log(`🌍 Environment: ${this.report.environment}`);
    
    if (this.report.issues.length > 0) {
      console.log(`\n❌ ISSUES (${this.report.issues.length}):`);
      this.report.issues.forEach((issue, index) => {
        console.log(`  ${index + 1}. [${issue.severity}] ${issue.message}`);
        if (issue.recommendation) {
          console.log(`     💡 ${issue.recommendation}`);
        }
      });
    }
    
    if (this.report.warnings.length > 0) {
      console.log(`\n⚠️  WARNINGS (${this.report.warnings.length}):`);
      this.report.warnings.forEach((warning, index) => {
        console.log(`  ${index + 1}. ${warning.message}`);
        if (warning.recommendation) {
          console.log(`     💡 ${warning.recommendation}`);
        }
      });
    }
    
    console.log(`\n📈 STATISTICS:`);
    console.log(`  - Migrations: ${this.report.statistics.migrations?.total || 0} total`);
    console.log(`  - Successful: ${this.report.statistics.migrations?.successful || 0}`);
    console.log(`  - Failed: ${this.report.statistics.migrations?.failed || 0}`);
    
    console.log(`\n💡 RECOMMENDATIONS (${this.report.recommendations.length}):`);
    this.report.recommendations.forEach((rec, index) => {
      console.log(`  ${index + 1}. [${rec.priority}] ${rec.action}`);
      console.log(`     🖥️  ${rec.command}`);
    });
    
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
  const diagnosis = new DatabaseDiagnosis();
  
  try {
    await diagnosis.initialize();
    
    await diagnosis.checkMigrationTracking();
    await diagnosis.checkSchemaDrift();
    await diagnosis.checkTableStructure();
    await diagnosis.checkPerformance();
    await diagnosis.checkDataIntegrity();
    await diagnosis.generateRecommendations();
    await diagnosis.generateReport();
    
  } catch (error) {
    console.error('\n💥 Database diagnosis failed:', error.message);
    process.exit(1);
  } finally {
    await diagnosis.cleanup();
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\n⚠️  Diagnosis interrupted');
  process.exit(1);
});

// Run if this file is executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
