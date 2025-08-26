// Migration Cleanup and Organization Tool
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATIONS_DIR = join(__dirname, 'src', 'database', 'migrations');
const TEST_DIR = join(MIGRATIONS_DIR, 'test');

// Migration categories
const CATEGORIES = {
  CORE: ['001_initial_schema.sql', '002_analytics_views.sql'],
  WEBHOOK: ['004_webhook_infrastructure.sql', '007_webhook_idempotency.sql', '016_webhook_status_normalization.sql', '018_webhook_events_idempotency.sql'],
  INSTAGRAM: ['008_instagram_stories_infrastructure.sql', '009_instagram_comments_infrastructure.sql', '010_instagram_media_infrastructure.sql', '011_instagram_production_features.sql', '012_instagram_oauth_integration.sql'],
  SECURITY: ['015_enable_rls.sql', '020_comprehensive_rls_enhancement.sql', '025_implement_rls_policies.sql', '033_add_rls_functions.sql', '036_complete_rls_policies.sql'],
  PERFORMANCE: ['003_products_search_optimization.sql', '027_performance_indexes.sql'],
  UTILITY: ['005_message_logs_enhancements.sql', '006_cross_platform_infrastructure.sql', '013_add_utility_messages_tables.sql', '014_queue_jobs.sql', '026_job_spool_table.sql'],
  FIXES: ['017_fix_platform_case_sensitivity.sql', '019_merchant_instagram_mapping_composite_key.sql', '021_conversation_unique_index.sql', '022_pkce_verifiers_fallback.sql', '023_add_business_account_id_to_merchant_credentials.sql', '024_unique_index_merchant_credentials.sql', '027_add_ai_config_to_merchants.sql', '028_add_missing_columns.sql', '029_fix_whatsapp_number_nullable.sql', '030_add_missing_tables.sql', '032_unify_migration_tracking.sql', '034_fix_whatsapp_number_constraints.sql', '035_migration_validation_final.sql', '037_analytics_events_table.sql', '038_add_whatsapp_unique_index.sql']
};

function getMigrationFiles() {
  try {
    return fs.readdirSync(MIGRATIONS_DIR)
      .filter(file => file.endsWith('.sql'))
      .filter(file => !file.startsWith('.'))
      .sort();
  } catch (error) {
    console.error('Error reading migrations directory:', error.message);
    return [];
  }
}

function categorizeMigration(filename) {
  for (const [category, files] of Object.entries(CATEGORIES)) {
    if (files.includes(filename)) {
      return category;
    }
  }
  return 'UNCATEGORIZED';
}

function validateMigrationFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // Basic validation checks
    const checks = {
      hasHeader: content.includes('-- Migration') || content.includes('-- ==============================================='),
      hasValidSQL: content.includes('CREATE') || content.includes('ALTER') || content.includes('INSERT'),
      hasComments: content.includes('--') || content.includes('/*'),
      fileSize: content.length > 100
    };
    
    return {
      valid: Object.values(checks).every(check => check),
      checks
    };
  } catch (error) {
    return { valid: false, checks: {}, error: error.message };
  }
}

function generateMigrationReport() {
  console.log('🔍 Generating Migration Report...\n');
  
  const files = getMigrationFiles();
  const report = {
    total: files.length,
    categories: {},
    issues: [],
    recommendations: []
  };
  
  console.log(`📊 Total Migration Files: ${files.length}\n`);
  
  // Categorize and validate each file
  files.forEach(filename => {
    const category = categorizeMigration(filename);
    const filePath = join(MIGRATIONS_DIR, filename);
    const validation = validateMigrationFile(filePath);
    
    if (!report.categories[category]) {
      report.categories[category] = [];
    }
    
    report.categories[category].push({
      filename,
      valid: validation.valid,
      checks: validation.checks
    });
    
    if (!validation.valid) {
      report.issues.push({
        filename,
        category,
        validation
      });
    }
  });
  
  // Display categorized results
  Object.entries(report.categories).forEach(([category, files]) => {
    console.log(`📁 ${category} (${files.length} files):`);
    files.forEach(file => {
      const status = file.valid ? '✅' : '❌';
      console.log(`   ${status} ${file.filename}`);
    });
    console.log('');
  });
  
  // Display issues
  if (report.issues.length > 0) {
    console.log('⚠️  Issues Found:');
    report.issues.forEach(issue => {
      console.log(`   ❌ ${issue.filename} (${issue.category})`);
      if (issue.validation.error) {
        console.log(`      Error: ${issue.validation.error}`);
      }
    });
    console.log('');
  }
  
  // Generate recommendations
  if (report.categories.UNCATEGORIZED) {
    report.recommendations.push('Add uncategorized migrations to appropriate categories');
  }
  
  if (report.issues.length > 0) {
    report.recommendations.push('Fix validation issues in problematic migration files');
  }
  
  if (report.recommendations.length > 0) {
    console.log('💡 Recommendations:');
    report.recommendations.forEach(rec => {
      console.log(`   • ${rec}`);
    });
    console.log('');
  }
  
  return report;
}

function createMigrationIndex() {
  console.log('📝 Creating Migration Index...\n');
  
  const files = getMigrationFiles();
  const index = {
    generated: new Date().toISOString(),
    total: files.length,
    migrations: []
  };
  
  files.forEach(filename => {
    const category = categorizeMigration(filename);
    const filePath = join(MIGRATIONS_DIR, filename);
    const stats = fs.statSync(filePath);
    const validation = validateMigrationFile(filePath);
    
    index.migrations.push({
      filename,
      category,
      size: stats.size,
      modified: stats.mtime.toISOString(),
      valid: validation.valid,
      required: isRequiredMigration(filename)
    });
  });
  
  // Sort by filename (which includes the number)
  index.migrations.sort((a, b) => a.filename.localeCompare(b.filename));
  
  const indexPath = join(MIGRATIONS_DIR, 'migration-index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  
  console.log(`✅ Migration index created: ${indexPath}`);
  console.log(`📊 Indexed ${index.migrations.length} migrations\n`);
  
  return index;
}

function isRequiredMigration(filename) {
  const requiredFiles = [
    '001_initial_schema.sql',
    '002_analytics_views.sql',
    '004_webhook_infrastructure.sql',
    '005_message_logs_enhancements.sql',
    '006_cross_platform_infrastructure.sql',
    '008_instagram_stories_infrastructure.sql',
    '009_instagram_comments_infrastructure.sql',
    '010_instagram_media_infrastructure.sql',
    '011_instagram_production_features.sql',
    '012_instagram_oauth_integration.sql',
    '013_add_utility_messages_tables.sql',
    '014_queue_jobs.sql',
    '015_enable_rls.sql',
    '017_fix_platform_case_sensitivity.sql',
    '019_merchant_instagram_mapping_composite_key.sql',
    '020_comprehensive_rls_enhancement.sql',
    '023_add_business_account_id_to_merchant_credentials.sql',
    '024_unique_index_merchant_credentials.sql',
    '025_implement_rls_policies.sql',
    '026_job_spool_table.sql',
    '027_performance_indexes.sql',
    '027_add_ai_config_to_merchants.sql',
    '032_unify_migration_tracking.sql',
    '033_add_rls_functions.sql',
    '034_fix_whatsapp_number_constraints.sql',
    '035_migration_validation_final.sql',
    '036_complete_rls_policies.sql'
  ];
  
  return requiredFiles.includes(filename);
}

function cleanupTestFiles() {
  console.log('🧹 Cleaning up test files...\n');
  
  // Ensure test directory exists
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }
  
  const files = getMigrationFiles();
  const testFiles = files.filter(file => 
    file.includes('test') || 
    file.includes('temp') || 
    file.includes('backup') ||
    file.startsWith('999')
  );
  
  if (testFiles.length > 0) {
    console.log(`📁 Moving ${testFiles.length} test files to test directory:`);
    testFiles.forEach(file => {
      const sourcePath = join(MIGRATIONS_DIR, file);
      const destPath = join(TEST_DIR, file);
      
      try {
        fs.renameSync(sourcePath, destPath);
        console.log(`   ✅ Moved: ${file}`);
      } catch (error) {
        console.log(`   ❌ Failed to move: ${file} - ${error.message}`);
      }
    });
  } else {
    console.log('✅ No test files found to clean up');
  }
  
  console.log('');
}

// Main execution
async function main() {
  console.log('🚀 Migration Cleanup and Organization Tool\n');
  
  try {
    // Clean up test files
    cleanupTestFiles();
    
    // Generate report
    const report = generateMigrationReport();
    
    // Create migration index
    const index = createMigrationIndex();
    
    console.log('🎉 Migration cleanup completed successfully!');
    console.log(`📊 Summary:`);
    console.log(`   • Total migrations: ${report.total}`);
    console.log(`   • Categories: ${Object.keys(report.categories).length}`);
    console.log(`   • Issues found: ${report.issues.length}`);
    console.log(`   • Recommendations: ${report.recommendations.length}`);
    
  } catch (error) {
    console.error('❌ Migration cleanup failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export { generateMigrationReport, createMigrationIndex, cleanupTestFiles };
