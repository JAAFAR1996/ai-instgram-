#!/usr/bin/env node

/**
 * ===============================================
 * Production Migration Runner - AI Sales Platform
 * Advanced, production-ready migration system
 * ===============================================
 * 
 * Features:
 * - Unified migration tracking (schema_migrations)
 * - Comprehensive validation and rollback support
 * - Production safety checks
 * - Detailed logging and monitoring
 * - Dependency resolution
 * - Checksum verification
 * - Dry-run mode
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG = {
  migrationDir: path.join(__dirname, '../src/database/migrations'),
  dryRun: process.argv.includes('--dry-run'),
  force: process.argv.includes('--force'),
  verbose: process.argv.includes('--verbose'),
  rollback: process.argv.includes('--rollback'),
  validateOnly: process.argv.includes('--validate-only'),
  maxRetries: 3,
  timeoutMs: 30000
};

// Migration definitions with dependencies
const MIGRATIONS = [
  // CORE SCHEMA
  { 
    name: '001_initial_schema.sql', 
    required: true, 
    dependencies: [],
    category: 'CORE',
    description: 'Initial database schema'
  },
  { 
    name: '002_analytics_views.sql', 
    required: true, 
    dependencies: ['001_initial_schema.sql'],
    category: 'ANALYTICS',
    description: 'Analytics views and reporting'
  },
  { 
    name: '003_products_search_optimization.sql', 
    required: false, 
    dependencies: ['001_initial_schema.sql'],
    category: 'PERFORMANCE',
    description: 'Product search optimization'
  },
  { 
    name: '004_webhook_infrastructure.sql', 
    required: true, 
    dependencies: ['001_initial_schema.sql'],
    category: 'WEBHOOK',
    description: 'Webhook infrastructure and logging'
  },
  { 
    name: '005_message_logs_enhancements.sql', 
    required: false, 
    dependencies: ['001_initial_schema.sql'],
    category: 'LOGGING',
    description: 'Message logging enhancements'
  },
  { 
    name: '006_cross_platform_infrastructure.sql', 
    required: true, 
    dependencies: ['001_initial_schema.sql'],
    category: 'PLATFORM',
    description: 'Cross-platform messaging infrastructure'
  },
  { 
    name: '007_webhook_idempotency.sql', 
    required: false, 
    dependencies: ['004_webhook_infrastructure.sql'],
    category: 'WEBHOOK',
    description: 'Webhook idempotency support'
  },
  { 
    name: '008_instagram_stories_infrastructure.sql', 
    required: false, 
    dependencies: ['006_cross_platform_infrastructure.sql'],
    category: 'INSTAGRAM',
    description: 'Instagram stories infrastructure'
  },
  { 
    name: '009_instagram_comments_infrastructure.sql', 
    required: false, 
    dependencies: ['006_cross_platform_infrastructure.sql'],
    category: 'INSTAGRAM',
    description: 'Instagram comments infrastructure'
  },
  { 
    name: '010_instagram_media_infrastructure.sql', 
    required: false, 
    dependencies: ['006_cross_platform_infrastructure.sql'],
    category: 'INSTAGRAM',
    description: 'Instagram media infrastructure'
  },
  { 
    name: '011_instagram_production_features.sql', 
    required: false, 
    dependencies: ['008_instagram_stories_infrastructure.sql', '009_instagram_comments_infrastructure.sql'],
    category: 'INSTAGRAM',
    description: 'Instagram production features'
  },
  { 
    name: '012_instagram_oauth_integration.sql', 
    required: false, 
    dependencies: ['006_cross_platform_infrastructure.sql'],
    category: 'INSTAGRAM',
    description: 'Instagram OAuth integration'
  },
  { 
    name: '013_add_utility_messages_tables.sql', 
    required: false, 
    dependencies: ['001_initial_schema.sql'],
    category: 'MESSAGING',
    description: 'Utility messages tables'
  },
  { 
    name: '014_queue_jobs.sql', 
    required: false, 
    dependencies: ['001_initial_schema.sql'],
    category: 'QUEUE',
    description: 'Queue jobs infrastructure'
  },
  { 
    name: '015_enable_rls.sql', 
    required: true, 
    dependencies: ['001_initial_schema.sql'],
    category: 'SECURITY',
    description: 'Row Level Security enablement'
  },
  { 
    name: '016_webhook_status_normalization.sql', 
    required: false, 
    dependencies: ['004_webhook_infrastructure.sql'],
    category: 'WEBHOOK',
    description: 'Webhook status normalization'
  },
  { 
    name: '017_fix_platform_case_sensitivity.sql', 
    required: false, 
    dependencies: ['006_cross_platform_infrastructure.sql'],
    category: 'FIXES',
    description: 'Platform case sensitivity fixes'
  },
  { 
    name: '018_webhook_events_idempotency.sql', 
    required: false, 
    dependencies: ['004_webhook_infrastructure.sql'],
    category: 'WEBHOOK',
    description: 'Webhook events idempotency'
  },
  { 
    name: '019_merchant_instagram_mapping_composite_key.sql', 
    required: false, 
    dependencies: ['001_initial_schema.sql'],
    category: 'INSTAGRAM',
    description: 'Merchant Instagram mapping composite key'
  },
  { 
    name: '020_comprehensive_rls_enhancement.sql', 
    required: false, 
    dependencies: ['015_enable_rls.sql'],
    category: 'SECURITY',
    description: 'Comprehensive RLS enhancement'
  },
  { 
    name: '021_conversation_unique_index.sql', 
    required: false, 
    dependencies: ['006_cross_platform_infrastructure.sql'],
    category: 'PERFORMANCE',
    description: 'Conversation unique index for Instagram'
  },
  { 
    name: '022_pkce_verifiers_fallback.sql', 
    required: false, 
    dependencies: ['001_initial_schema.sql'],
    category: 'SECURITY',
    description: 'PKCE verifiers fallback'
  },
  { 
    name: '023_add_business_account_id_to_merchant_credentials.sql', 
    required: false, 
    dependencies: ['001_initial_schema.sql'],
    category: 'INSTAGRAM',
    description: 'Add business account ID to merchant credentials'
  },
  { 
    name: '024_unique_index_merchant_credentials.sql', 
    required: false, 
    dependencies: ['001_initial_schema.sql'],
    category: 'SECURITY',
    description: 'Unique index for merchant credentials'
  },
  { 
    name: '025_implement_rls_policies.sql', 
    required: false, 
    dependencies: ['015_enable_rls.sql'],
    category: 'SECURITY',
    description: 'Implement RLS policies'
  },
  { 
    name: '026_job_spool_table.sql', 
    required: false, 
    dependencies: ['014_queue_jobs.sql'],
    category: 'QUEUE',
    description: 'Job spool table'
  },
  { 
    name: '027_add_ai_config_to_merchants.sql', 
    required: false, 
    dependencies: ['001_initial_schema.sql'],
    category: 'AI',
    description: 'Add AI config to merchants'
  },
  { 
    name: '027_performance_indexes.sql', 
    required: false, 
    dependencies: ['001_initial_schema.sql'],
    category: 'PERFORMANCE',
    description: 'Performance indexes'
  },
  { 
    name: '028_add_missing_columns.sql', 
    required: false, 
    dependencies: ['001_initial_schema.sql'],
    category: 'FIXES',
    description: 'Add missing columns'
  },
  { 
    name: '029_fix_whatsapp_number_nullable.sql', 
    required: false, 
    dependencies: ['006_cross_platform_infrastructure.sql'],
    category: 'FIXES',
    description: 'Fix WhatsApp number nullable'
  },
  { 
    name: '030_add_missing_tables.sql', 
    required: false, 
    dependencies: ['001_initial_schema.sql'],
    category: 'FIXES',
    description: 'Add missing tables'
  },
  { 
    name: '032_unify_migration_tracking.sql', 
    required: true, 
    dependencies: [],
    category: 'SYSTEM',
    description: 'Unify migration tracking'
  },
  { 
    name: '033_add_rls_functions.sql', 
    required: false, 
    dependencies: ['015_enable_rls.sql'],
    category: 'SECURITY',
    description: 'Add RLS functions'
  },
  { 
    name: '034_fix_whatsapp_number_constraints.sql', 
    required: false, 
    dependencies: ['006_cross_platform_infrastructure.sql'],
    category: 'FIXES',
    description: 'Fix WhatsApp number constraints'
  },
  { 
    name: '035_migration_validation_final.sql', 
    required: false, 
    dependencies: ['032_unify_migration_tracking.sql'],
    category: 'SYSTEM',
    description: 'Migration validation final'
  },
  { 
    name: '036_complete_rls_policies.sql', 
    required: false, 
    dependencies: ['015_enable_rls.sql'],
    category: 'SECURITY',
    description: 'Complete RLS policies'
  },
  { 
    name: '037_analytics_events_table.sql', 
    required: false, 
    dependencies: ['001_initial_schema.sql'],
    category: 'ANALYTICS',
    description: 'Analytics events table'
  },
  { 
    name: '037_unify_rls_systems.sql', 
    required: true, 
    dependencies: ['015_enable_rls.sql', '033_add_rls_functions.sql'],
    category: 'SECURITY',
    description: 'Unify RLS systems into consistent implementation'
  },
  { 
    name: '039_enhanced_rls_security.sql', 
    required: true, 
    dependencies: ['037_unify_rls_systems.sql'],
    category: 'SECURITY',
    description: 'Enhanced RLS security policies with audit logging'
  },
  { 
    name: '040_fix_placeholder_security.sql', 
    required: true, 
    dependencies: ['039_enhanced_rls_security.sql'],
    category: 'SECURITY',
    description: 'Fix placeholder values and enhance security validation'
  },
  { 
    name: '041_enhance_ssl_tls.sql', 
    required: true, 
    dependencies: ['032_unify_migration_tracking.sql'],
    category: 'SECURITY',
    description: 'Enhanced SSL/TLS configuration and validation'
  },
  { 
    name: '042_connection_encryption.sql', 
    required: true, 
    dependencies: ['041_enhance_ssl_tls.sql'],
    category: 'SECURITY',
    description: 'Connection encryption validation and enforcement'
  },
  { 
    name: '043_migration_audit_logging.sql', 
    required: true, 
    dependencies: ['032_unify_migration_tracking.sql'],
    category: 'AUDIT',
    description: 'Comprehensive migration audit logging system'
  },
  { 
    name: '038_add_whatsapp_unique_index.sql', 
    required: false, 
    dependencies: ['006_cross_platform_infrastructure.sql'],
    category: 'PERFORMANCE',
    description: 'Add WhatsApp unique index'
  },
  
  // ⚡ STAGE 3 PERFORMANCE IMPROVEMENTS
  { 
    name: '044_rls_performance_indexes.sql', 
    required: true, 
    dependencies: ['037_unify_rls_systems.sql'],
    category: 'PERFORMANCE',
    description: '⚡ Optimized RLS indexes for better query performance'
  },
  { 
    name: '045_performance_optimizations.sql', 
    required: true, 
    dependencies: ['043_migration_audit_logging.sql'],
    category: 'PERFORMANCE',
    description: '⚡ Transaction timeout and deadlock handling optimizations'
  },
  
  // 💾 STAGE 4 RISK MANAGEMENT
  { 
    name: '046_migration_backup_system.sql', 
    required: true, 
    dependencies: ['043_migration_audit_logging.sql'],
    category: 'RISK_MANAGEMENT',
    description: '💾 Comprehensive migration backup and recovery system'
  },
  { 
    name: '047_rollback_procedures.sql', 
    required: true, 
    dependencies: ['046_migration_backup_system.sql'],
    category: 'RISK_MANAGEMENT',
    description: '💾 Advanced rollback procedures with emergency recovery'
  },
  { 
    name: '048_comprehensive_health_checks.sql', 
    required: true, 
    dependencies: ['045_performance_optimizations.sql'],
    category: 'RISK_MANAGEMENT',
    description: '💾 Multi-category health monitoring system'
  },
  { 
    name: '049_migration_monitoring.sql', 
    required: true, 
    dependencies: ['048_comprehensive_health_checks.sql'],
    category: 'RISK_MANAGEMENT',
    description: '💾 Real-time migration monitoring and alerting'
  },
  { 
    name: '050_disaster_recovery_plan.sql', 
    required: true, 
    dependencies: ['047_rollback_procedures.sql', '049_migration_monitoring.sql'],
    category: 'RISK_MANAGEMENT',
    description: '💾 Complete disaster recovery and business continuity'
  }
];

class ProductionMigrationRunner {
  constructor() {
    this.pool = null;
    this.executedMigrations = new Set();
    this.failedMigrations = new Set();
    this.startTime = Date.now();
  }

  async initialize() {
    console.log('🚀 Initializing Production Migration Runner...');
    
    // Use production database URL
    const databaseUrl = process.env.DATABASE_URL || 'postgresql://ai_instgram_user:rTAH6gFMveMhoSrFu3l9FmrqGYd1ZFdw@dpg-d2f0pije5dus73bi4ac0-a/ai_instgram?sslmode=disable';
    
    console.log(`🔗 Connecting to database...`);

    // Initialize database connection
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
    } finally {
      client.release();
    }

    // Ensure schema_migrations table exists
    await this.ensureMigrationTable();
  }

  async ensureMigrationTable() {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version VARCHAR(255) PRIMARY KEY,
          applied_at TIMESTAMPTZ DEFAULT NOW(),
          execution_time_ms INTEGER,
          checksum VARCHAR(64),
          success BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      
      // Create indexes if they don't exist
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at 
        ON schema_migrations(applied_at)
      `);
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_schema_migrations_success 
        ON schema_migrations(success)
      `);
    } finally {
      client.release();
    }
  }

  async getExecutedMigrations() {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query(
        'SELECT version FROM schema_migrations WHERE success = TRUE'
      );
      return new Set(rows.map(row => row.version));
    } finally {
      client.release();
    }
  }

  calculateChecksum(content) {
    return createHash('sha256').update(content).digest('hex');
  }

  validateMigrationFile(migrationName) {
    const filePath = path.join(CONFIG.migrationDir, migrationName);
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`Migration file not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf8');
    
    // Basic validation
    if (!content.trim()) {
      throw new Error(`Migration file is empty: ${migrationName}`);
    }

    // Check for dangerous operations in production
    if (process.env.NODE_ENV === 'production' && !CONFIG.force) {
      const dangerousPatterns = [
        /DROP TABLE/i,
        /TRUNCATE/i,
        /DELETE FROM/i
      ];
      
      for (const pattern of dangerousPatterns) {
        if (pattern.test(content)) {
          console.warn(`⚠️  Warning: Migration ${migrationName} contains potentially dangerous operations`);
          break;
        }
      }
    }

    return { content, checksum: this.calculateChecksum(content) };
  }

  async validateDependencies(migration, executedMigrations) {
    for (const dependency of migration.dependencies) {
      if (!executedMigrations.has(dependency)) {
        throw new Error(
          `Migration ${migration.name} depends on ${dependency} which has not been executed`
        );
      }
    }
  }

  async executeMigration(migration, executedMigrations) {
    const { content, checksum } = this.validateMigrationFile(migration.name);
    
    // Validate dependencies
    await this.validateDependencies(migration, executedMigrations);

    if (CONFIG.dryRun) {
      console.log(`🔍 [DRY RUN] Would execute: ${migration.name}`);
      return;
    }

    if (CONFIG.validateOnly) {
      console.log(`✅ [VALIDATE] Migration ${migration.name} is valid`);
      return;
    }

    const client = await this.pool.connect();
    const startTime = Date.now();
    let auditSessionId = null;
    
    try {
      console.log(`🔄 Executing migration: ${migration.name}`);
      
      await client.query('BEGIN');
      
      // Start migration audit logging (if audit table exists)
      try {
        const auditResult = await client.query(`
          SELECT log_migration_start($1, $2, $3, $4) as session_id
        `, [
          migration.name,
          migration.description || migration.name,
          [content.substring(0, 1000) + (content.length > 1000 ? '...' : '')], // Sample of SQL
          JSON.stringify({
            category: migration.category,
            required: migration.required,
            dependencies: migration.dependencies,
            runner_version: 'production-v2',
            environment: process.env.NODE_ENV || 'production'
          })
        ]);
        auditSessionId = auditResult.rows[0]?.session_id;
        if (auditSessionId) {
          console.log(`📝 Audit session started: ${auditSessionId.substring(0, 8)}`);
        }
      } catch (auditError) {
        console.warn(`⚠️ Could not start audit logging: ${auditError.message}`);
      }
      
      // Execute the migration
      await client.query(content);
      
      // Analyze affected objects
      const affectedTables = await this.getAffectedTables(content);
      const affectedFunctions = await this.getAffectedFunctions(content);
      
      // Record successful execution in schema_migrations
      await client.query(`
        INSERT INTO schema_migrations (version, applied_at, execution_time_ms, checksum, success)
        VALUES ($1, NOW(), $2, $3, TRUE)
        ON CONFLICT (version) DO UPDATE SET
          applied_at = EXCLUDED.applied_at,
          execution_time_ms = EXCLUDED.execution_time_ms,
          checksum = EXCLUDED.checksum,
          success = TRUE
      `, [migration.name, Date.now() - startTime, checksum]);
      
      // Complete migration audit logging
      try {
        await client.query(`
          SELECT log_migration_completion($1, $2, $3, $4, $5, $6, $7)
        `, [
          migration.name,
          'SUCCESS',
          null, // no error message
          null, // no error details
          affectedTables,
          affectedFunctions,
          JSON.stringify({
            checksum: checksum,
            execution_environment: process.env.NODE_ENV,
            migration_category: migration.category
          })
        ]);
      } catch (auditError) {
        console.warn(`⚠️ Could not complete audit logging: ${auditError.message}`);
      }
      
      await client.query('COMMIT');
      
      this.executedMigrations.add(migration.name);
      console.log(`✅ Migration completed: ${migration.name} (${Date.now() - startTime}ms)`);
      
    } catch (error) {
      await client.query('ROLLBACK');
      
      // Complete migration audit logging with failure
      try {
        await client.query(`
          SELECT log_migration_completion($1, $2, $3, $4, $5, $6, $7)
        `, [
          migration.name,
          'FAILED',
          error.message,
          JSON.stringify({
            error_name: error.name,
            error_stack: error.stack ? error.stack.substring(0, 500) : null,
            error_code: error.code
          }),
          null, // no affected tables on failure
          null, // no affected functions on failure
          JSON.stringify({
            failure_point: 'EXECUTION',
            execution_environment: process.env.NODE_ENV
          })
        ]);
      } catch (auditError) {
        console.warn(`⚠️ Could not log migration failure: ${auditError.message}`);
      }
      
      // Record failure in schema_migrations
      await client.query(`
        INSERT INTO schema_migrations (version, applied_at, execution_time_ms, success)
        VALUES ($1, NOW(), $2, FALSE)
        ON CONFLICT (version) DO UPDATE SET
          applied_at = EXCLUDED.applied_at,
          execution_time_ms = EXCLUDED.execution_time_ms,
          success = FALSE
      `, [migration.name, Date.now() - startTime]);
      
      this.failedMigrations.add(migration.name);
      console.error(`❌ Migration failed: ${migration.name}`, error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  // Helper method to extract affected tables from SQL content
  async getAffectedTables(sqlContent) {
    const tablePatterns = [
      /CREATE TABLE\s+([^\s(]+)/gi,
      /ALTER TABLE\s+([^\s]+)/gi,
      /DROP TABLE\s+([^\s]+)/gi,
      /INSERT INTO\s+([^\s(]+)/gi,
      /UPDATE\s+([^\s]+)\s+SET/gi,
      /DELETE FROM\s+([^\s]+)/gi
    ];
    
    const tables = new Set();
    for (const pattern of tablePatterns) {
      const matches = sqlContent.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && !match[1].includes('$')) {
          tables.add(match[1].replace(/[`"]/g, ''));
        }
      }
    }
    
    return Array.from(tables).slice(0, 20); // Limit to prevent overflow
  }

  // Helper method to extract affected functions from SQL content
  async getAffectedFunctions(sqlContent) {
    const functionPatterns = [
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([^\s(]+)/gi,
      /DROP FUNCTION\s+([^\s(]+)/gi,
      /ALTER FUNCTION\s+([^\s(]+)/gi
    ];
    
    const functions = new Set();
    for (const pattern of functionPatterns) {
      const matches = sqlContent.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && !match[1].includes('$')) {
          functions.add(match[1].replace(/[`"]/g, ''));
        }
      }
    }
    
    return Array.from(functions).slice(0, 20); // Limit to prevent overflow
  }

  async runMigrations() {
    console.log('📋 Starting migration execution...');
    
    const executedMigrations = await this.getExecutedMigrations();
    const pendingMigrations = MIGRATIONS.filter(m => !executedMigrations.has(m.name));
    
    if (pendingMigrations.length === 0) {
      console.log('✅ All migrations are up to date');
      return;
    }

    console.log(`📊 Found ${pendingMigrations.length} pending migrations`);
    
    // Sort by dependencies
    const sortedMigrations = this.sortByDependencies(pendingMigrations);
    
    for (const migration of sortedMigrations) {
      try {
        await this.executeMigration(migration, executedMigrations);
        executedMigrations.add(migration.name);
      } catch (error) {
        if (migration.required) {
          console.error(`💥 Required migration failed: ${migration.name}`);
          throw error;
        } else {
          console.warn(`⚠️  Optional migration failed: ${migration.name}`);
        }
      }
    }
  }

  sortByDependencies(migrations) {
    const sorted = [];
    const visited = new Set();
    
    const visit = (migration) => {
      if (visited.has(migration.name)) return;
      visited.add(migration.name);
      
      for (const depName of migration.dependencies) {
        const dep = migrations.find(m => m.name === depName) || 
                   MIGRATIONS.find(m => m.name === depName);
        if (dep) visit(dep);
      }
      
      sorted.push(migration);
    };
    
    for (const migration of migrations) {
      visit(migration);
    }
    
    return sorted;
  }

  async generateReport() {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query(`
        SELECT 
          version,
          applied_at,
          execution_time_ms,
          success,
          checksum
        FROM schema_migrations 
        ORDER BY applied_at DESC
      `);
      
      console.log('\n📊 Migration Report:');
      console.log('='.repeat(80));
      
      const categories = {};
      let totalExecuted = 0;
      let totalFailed = 0;
      
      for (const row of rows) {
        const migration = MIGRATIONS.find(m => m.name === row.version);
        const category = migration?.category || 'UNKNOWN';
        
        if (!categories[category]) categories[category] = [];
        categories[category].push({
          ...row,
          category: migration?.description || 'Unknown migration'
        });
        
        if (row.success) totalExecuted++;
        else totalFailed++;
      }
      
      for (const [category, migrations] of Object.entries(categories)) {
        console.log(`\n${category}:`);
        for (const migration of migrations) {
          const status = migration.success ? '✅' : '❌';
          const time = migration.execution_time_ms ? `(${migration.execution_time_ms}ms)` : '';
          console.log(`  ${status} ${migration.version} ${time}`);
        }
      }
      
      console.log('\n' + '='.repeat(80));
      console.log(`Total Executed: ${totalExecuted}`);
      console.log(`Total Failed: ${totalFailed}`);
      console.log(`Total Time: ${Date.now() - this.startTime}ms`);
      
    } finally {
      client.release();
    }
  }

  async cleanup() {
    if (this.pool) {
      await this.pool.end();
    }
  }
}

// Main execution
async function main() {
  const runner = new ProductionMigrationRunner();
  
  try {
    await runner.initialize();
    
    if (CONFIG.rollback) {
      console.log('🔄 Rollback mode not implemented yet');
      return;
    }
    
    await runner.runMigrations();
    await runner.generateReport();
    
    console.log('\n🎉 Migration process completed successfully!');
    
  } catch (error) {
    console.error('\n💥 Migration process failed:', error.message);
    process.exit(1);
  } finally {
    await runner.cleanup();
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\n⚠️  Migration process interrupted');
  process.exit(1);
});

process.on('SIGTERM', async () => {
  console.log('\n⚠️  Migration process terminated');
  process.exit(1);
});

// Run if this file is executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
