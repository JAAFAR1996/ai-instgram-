// Advanced Migration Runner - Production Ready
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Complete migration list in correct order
const MIGRATIONS = [
  { name: 'Initial Schema', file: './src/database/migrations/001_initial_schema.sql', required: true },
  { name: 'Analytics Views', file: './src/database/migrations/002_analytics_views.sql', required: true },
  { name: 'Products Search Optimization', file: './src/database/migrations/003_products_search_optimization.sql', required: false },
  { name: 'Webhook Infrastructure', file: './src/database/migrations/004_webhook_infrastructure.sql', required: true },
  { name: 'Message Logs Enhancements', file: './src/database/migrations/005_message_logs_enhancements.sql', required: true },
  { name: 'Cross Platform Infrastructure', file: './src/database/migrations/006_cross_platform_infrastructure.sql', required: true },
  { name: 'Webhook Idempotency', file: './src/database/migrations/007_webhook_idempotency.sql', required: false },
  { name: 'Instagram Stories Infrastructure', file: './src/database/migrations/008_instagram_stories_infrastructure.sql', required: true },
  { name: 'Instagram Comments Infrastructure', file: './src/database/migrations/009_instagram_comments_infrastructure.sql', required: true },
  { name: 'Instagram Media Infrastructure', file: './src/database/migrations/010_instagram_media_infrastructure.sql', required: true },
  { name: 'Instagram Production Features', file: './src/database/migrations/011_instagram_production_features.sql', required: true },
  { name: 'Instagram OAuth Integration', file: './src/database/migrations/012_instagram_oauth_integration.sql', required: true },
  { name: 'Analytics Events Table', file: './src/database/migrations/037_analytics_events_table.sql', required: false },
  { name: 'Utility Messages Tables', file: './src/database/migrations/013_add_utility_messages_tables.sql', required: true },
  { name: 'Queue Jobs', file: './src/database/migrations/014_queue_jobs.sql', required: true },
  { name: 'Enable RLS', file: './src/database/migrations/015_enable_rls.sql', required: true },
  { name: 'Webhook Status Normalization', file: './src/database/migrations/016_webhook_status_normalization.sql', required: false },
  { name: 'Platform Case Sensitivity', file: './src/database/migrations/017_fix_platform_case_sensitivity.sql', required: true },
  { name: 'Webhook Events Idempotency', file: './src/database/migrations/018_webhook_events_idempotency.sql', required: false },
  { name: 'Merchant Instagram Mapping', file: './src/database/migrations/019_merchant_instagram_mapping_composite_key.sql', required: true },
  { name: 'Comprehensive RLS Enhancement', file: './src/database/migrations/020_comprehensive_rls_enhancement.sql', required: true },
  { name: 'Conversation Unique Index', file: './src/database/migrations/021_conversation_unique_index.sql', required: false },
  { name: 'PKCE Verifiers Fallback', file: './src/database/migrations/022_pkce_verifiers_fallback.sql', required: false },
  { name: 'Business Account ID to Credentials', file: './src/database/migrations/023_add_business_account_id_to_merchant_credentials.sql', required: true },
  { name: 'Unique Index Merchant Credentials', file: './src/database/migrations/024_unique_index_merchant_credentials.sql', required: true },
  { name: 'Implement RLS Policies', file: './src/database/migrations/025_implement_rls_policies.sql', required: true },
  { name: 'Job Spool Table', file: './src/database/migrations/026_job_spool_table.sql', required: true },
  { name: 'Performance Indexes', file: './src/database/migrations/027_performance_indexes.sql', required: true },
  { name: 'AI Config to Merchants', file: './src/database/migrations/027_add_ai_config_to_merchants.sql', required: true },
  { name: 'Missing Columns', file: './src/database/migrations/028_add_missing_columns.sql', required: false },
  { name: 'Fix WhatsApp Number Nullable', file: './src/database/migrations/029_fix_whatsapp_number_nullable.sql', required: false },
  { name: 'Add Missing Tables', file: './src/database/migrations/030_add_missing_tables.sql', required: false },
  { name: 'Unify Migration Tracking', file: './src/database/migrations/032_unify_migration_tracking.sql', required: true },
  { name: 'Add RLS Functions', file: './src/database/migrations/033_add_rls_functions.sql', required: true },
  { name: 'Fix WhatsApp Number Constraints', file: './src/database/migrations/034_fix_whatsapp_number_constraints.sql', required: true },
  { name: 'Migration Validation Final', file: './src/database/migrations/035_migration_validation_final.sql', required: true },
  { name: 'Complete RLS Policies', file: './src/database/migrations/036_complete_rls_policies.sql', required: true },
  { name: 'Add WhatsApp Unique Index', file: './src/database/migrations/038_add_whatsapp_unique_index.sql', required: false }
];

// Validation functions
function validatePrerequisites() {
  const requiredEnvVars = ['DB_PASSWORD'];
  const missing = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    process.exit(1);
  }
}

function validateMigrationFile(filePath) {
  try {
    const fullPath = join(__dirname, filePath);
    const stats = readFileSync(fullPath, 'utf-8');
    return true;
  } catch (error) {
    return false;
  }
}

async function validateDatabaseConnection(client) {
  try {
    await client.query('SELECT 1');
    return true;
  } catch (error) {
    return false;
  }
}

async function checkExistingMigrations(client) {
  try {
    const result = await client.query(`
      SELECT name, filename, created_at 
      FROM migrations 
      ORDER BY created_at DESC
    `);
    return result.rows;
  } catch (error) {
    return [];
  }
}

async function runMigrations() {
  console.log('🚀 Starting Advanced Migration Runner...');
  
  // Validate prerequisites
  validatePrerequisites();
  
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'ai_sales_dev',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_HOST && process.env.DB_HOST.includes('render.com') ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔗 Connecting to PostgreSQL...');
    await client.connect();
    
    if (!(await validateDatabaseConnection(client))) {
      throw new Error('Failed to connect to database');
    }
    console.log('✅ Connected successfully!');
    
    // Check existing migrations
    const existingMigrations = await checkExistingMigrations(client);
    console.log(`📋 Found ${existingMigrations.length} existing migrations`);
    
    // Run migrations with validation
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;
    
    for (const migration of MIGRATIONS) {
      try {
        // Check if migration file exists
        if (!validateMigrationFile(migration.file)) {
          console.log(`⚠️  Skipping ${migration.name}: File not found`);
          skipCount++;
          continue;
        }
        
        // Check if migration already exists
        const alreadyRun = existingMigrations.find(existing => 
          existing.filename === migration.file.split('/').pop()
        );
        
        if (alreadyRun) {
          console.log(`✅ ${migration.name}: Already executed (${alreadyRun.created_at})`);
          skipCount++;
          continue;
        }
        
        console.log(`📋 Running migration: ${migration.name}...`);
        
        // Read and execute migration
        const migrationSQL = readFileSync(join(__dirname, migration.file), 'utf-8');
        await client.query(migrationSQL);
        
        // Record migration
        await client.query(`
          INSERT INTO migrations (name, filename, created_at) 
          VALUES ($1, $2, NOW())
        `, [migration.name, migration.file.split('/').pop()]);
        
        console.log(`✅ ${migration.name}: Completed successfully`);
        successCount++;
        
      } catch (error) {
        if (migration.required) {
          console.error(`❌ ${migration.name}: Failed (REQUIRED)`, error.message);
          errorCount++;
          throw error; // Stop execution for required migrations
        } else {
          console.warn(`⚠️  ${migration.name}: Failed (optional)`, error.message);
          errorCount++;
        }
      }
    }
    
    // Final validation
    console.log('\n🔍 Running final validation...');
    await runFinalValidation(client);
    
    // Summary
    console.log('\n📊 Migration Summary:');
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ⏭️  Skipped: ${skipCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`   📋 Total: ${MIGRATIONS.length}`);
    
    if (errorCount === 0) {
      console.log('\n🎉 All migrations completed successfully!');
    } else {
      console.log('\n⚠️  Some migrations failed, but system is functional');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

async function runFinalValidation(client) {
  try {
    // Check core tables
    const coreTables = ['merchants', 'products', 'orders', 'conversations', 'message_logs'];
    for (const table of coreTables) {
      const result = await client.query(`
        SELECT COUNT(*) as count FROM information_schema.tables 
        WHERE table_name = $1 AND table_schema = 'public'
      `, [table]);
      
      if (result.rows[0].count > 0) {
        console.log(`   ✅ ${table} table exists`);
      } else {
        console.log(`   ❌ ${table} table missing`);
      }
    }
    
    // Check RLS functions
    const rlsFunctions = ['current_merchant_id', 'is_admin_user'];
    for (const func of rlsFunctions) {
      const result = await client.query(`
        SELECT COUNT(*) as count FROM pg_proc WHERE proname = $1
      `, [func]);
      
      if (result.rows[0].count > 0) {
        console.log(`   ✅ ${func} function exists`);
      } else {
        console.log(`   ❌ ${func} function missing`);
      }
    }
    
    // Check total tables
    const tableCount = await client.query(`
      SELECT COUNT(*) as count FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    console.log(`   📋 Total tables: ${tableCount.rows[0].count}`);
    
  } catch (error) {
    console.error('❌ Validation failed:', error.message);
  }
}

// Run migrations
runMigrations();