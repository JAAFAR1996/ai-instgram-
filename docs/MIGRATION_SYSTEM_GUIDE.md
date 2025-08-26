# 🚀 Migration System Guide - Production Ready

## 📋 Overview

This guide documents the production-ready migration system for the AI Sales Platform. The system has been completely refactored to ensure reliability, consistency, and maintainability.

## 🔧 System Architecture

### Migration Tracking
- **Primary Table**: `schema_migrations` - Unified tracking for all migrations
- **Legacy Tables**: `migrations`, `_migrations` (deprecated, data migrated)
- **Functions**: Built-in functions for migration management

### File Structure
```
src/database/
├── migrations/           # Production migrations (001-035)
├── test-migrations/      # Test-only migrations (988-991)
├── migrate.ts           # Migration runner
├── migrate.test.ts      # Migration tests
├── validate-migrations.ts # Validation script
└── ensurePageMapping.ts # Page mapping utility
```

## 📊 Migration Sequence

### ✅ Fixed Sequence (001-035)
```
001_initial_schema.sql                    ✅ Core schema
002_analytics_views.sql                   ✅ Analytics infrastructure  
003_products_search_optimization.sql      ✅ Search optimization
004_webhook_infrastructure.sql            ✅ Webhook system
005_message_logs_enhancements.sql         ✅ Message logging
006_cross_platform_infrastructure.sql     ✅ Multi-platform support
007_webhook_idempotency.sql               ✅ Idempotency
008_instagram_stories_infrastructure.sql  ✅ Instagram stories
009_instagram_comments_infrastructure.sql ✅ Instagram comments
010_instagram_media_infrastructure.sql    ✅ Instagram media
011_instagram_testing_infrastructure.sql  ✅ Instagram testing
012_analytics_events_table.sql            ✅ Analytics events
013_add_utility_messages_tables.sql       ✅ Utility messages
014_queue_jobs.sql                        ✅ Job queue system
015_enable_rls.sql                        ✅ Row Level Security
016_webhook_status_normalization.sql      ✅ Webhook status
017_fix_platform_case_sensitivity.sql     ✅ Platform fixes
018_webhook_events_idempotency.sql        ✅ Event idempotency
019_merchant_instagram_mapping_composite_key.sql ✅ Mapping
020_comprehensive_rls_enhancement.sql     ✅ RLS enhancement
021_conversation_unique_index.sql         ✅ Index optimization
022_pkce_verifiers_fallback.sql           ✅ PKCE fallback
023_add_business_account_id_to_merchant_credentials.sql ✅ Business accounts
024_unique_index_merchant_credentials.sql ✅ Credential indexes
025_implement_rls_policies.sql            ✅ RLS policies
026_job_spool_table.sql                   ✅ Job spooling
027_add_ai_config_to_merchants.sql        ✅ AI configuration
028_add_missing_columns.sql               ✅ Missing columns
029_fix_whatsapp_number_nullable.sql      ✅ WhatsApp fixes
030_add_missing_tables.sql                ✅ Missing tables
032_unify_migration_tracking.sql          ✅ Unified tracking
033_add_rls_functions.sql                 ✅ RLS functions
034_fix_whatsapp_number_constraints.sql   ✅ WhatsApp constraints
035_migration_validation_final.sql        ✅ System validation
```

### 🧪 Test Migrations (Moved to test-migrations/)
```
988_instagram_tables.sql      # Test Instagram tables
990_test_concurrent.sql       # Concurrent migration tests
991_test_performance.sql      # Performance tests
```

## 🔐 Security Features

### Row Level Security (RLS)
- **Functions**: `current_merchant_id()`, `is_admin_user()`
- **Context Management**: Session-based merchant isolation
- **Admin Bypass**: Controlled admin access for system operations

### Migration Security
- **Checksums**: SHA256 validation of migration files
- **Execution Tracking**: Complete audit trail of migrations
- **Rollback Protection**: Safe rollback mechanisms

## 🛠️ Usage

### Running Migrations
```bash
# Run all pending migrations
npm run migrate

# Run specific migration
npm run migrate:file 032_unify_migration_tracking.sql

# Check migration status
npm run migrate:status

# Validate migrations
npm run validate:migrations
```

### Validation Commands
```bash
# Validate migration files
node src/database/validate-migrations.ts

# Check system integrity
psql -c "SELECT * FROM migration_system_status;"

# Get migration summary
psql -c "SELECT * FROM get_migration_summary();"
```

## 📈 Monitoring

### Migration Status Views
```sql
-- Check all migrations
SELECT * FROM schema_migrations ORDER BY applied_at;

-- Check failed migrations
SELECT * FROM schema_migrations WHERE success = FALSE;

-- Get migration statistics
SELECT * FROM get_migration_summary();

-- Validate system integrity
SELECT * FROM migration_system_status;
```

### Logging
- **Migration Execution**: Complete audit trail
- **Error Tracking**: Detailed error logging with rollback
- **Performance Monitoring**: Execution time tracking

## 🔄 Rollback Procedures

### Safe Rollback
```sql
-- Rollback last migration
SELECT rollback_last_migration();

-- Rollback specific migration
SELECT rollback_migration('032_unify_migration_tracking.sql');

-- Check rollback status
SELECT * FROM schema_migrations WHERE success = FALSE;
```

### Emergency Procedures
```bash
# Restore from backup
pg_restore backup/migrations_original/

# Reset migration system
npm run migrate:reset

# Validate after rollback
npm run validate:migrations
```

## 🚨 Troubleshooting

### Common Issues

#### 1. Duplicate Migration Numbers
```bash
# Check for duplicates
node src/database/validate-migrations.ts

# Fix duplicates
npm run migrate:fix-duplicates
```

#### 2. Missing RLS Functions
```sql
-- Check function existence
SELECT proname FROM pg_proc WHERE proname IN ('current_merchant_id', 'is_admin_user');

-- Recreate functions
\i src/database/migrations/033_add_rls_functions.sql
```

#### 3. Constraint Conflicts
```sql
-- Check constraint status
SELECT constraint_name, table_name 
FROM information_schema.check_constraints 
WHERE table_name = 'merchants';

-- Fix constraints
\i src/database/migrations/034_fix_whatsapp_number_constraints.sql
```

### Error Recovery
```bash
# Check error logs
tail -f logs/migration.log

# Reset failed migration
npm run migrate:reset-failed

# Validate system
npm run validate:migrations
```

## 📋 Best Practices

### Development
1. **Always validate** migrations before committing
2. **Use descriptive names** for migration files
3. **Test rollbacks** before production deployment
4. **Document changes** in migration comments

### Production
1. **Backup database** before running migrations
2. **Run in maintenance window** for major changes
3. **Monitor execution** and performance
4. **Validate after deployment**

### Testing
1. **Use test database** for migration testing
2. **Test rollback procedures** regularly
3. **Validate constraints** after migrations
4. **Check RLS policies** are working correctly

## 🔧 Configuration

### Environment Variables
```bash
# Database connection
DATABASE_URL=postgresql://user:pass@localhost/db

# Migration settings
MIGRATION_TIMEOUT=300000  # 5 minutes
MIGRATION_RETRY_ATTEMPTS=3
MIGRATION_VALIDATE_CHECKSUMS=true
```

### Migration Settings
```typescript
// src/database/migrate.ts
const MIGRATION_CONFIG = {
  timeout: 300000,
  retryAttempts: 3,
  validateChecksums: true,
  enableRollback: true,
  logLevel: 'info'
};
```

## 📊 Performance

### Optimization Features
- **Parallel Execution**: Safe parallel migration execution
- **Index Management**: Automatic index creation and optimization
- **Constraint Validation**: Efficient constraint checking
- **Transaction Management**: Optimized transaction handling

### Monitoring Metrics
- **Execution Time**: Track migration performance
- **Success Rate**: Monitor migration reliability
- **Resource Usage**: Monitor database impact
- **Error Frequency**: Track and resolve issues

## 🎯 Future Enhancements

### Planned Features
- **Zero-downtime migrations**: Blue-green deployment support
- **Automated testing**: Integration with CI/CD pipeline
- **Performance optimization**: Advanced indexing strategies
- **Enhanced monitoring**: Real-time migration dashboard

### Migration Patterns
- **Schema evolution**: Safe schema changes
- **Data migration**: Efficient data transformation
- **Rollback strategies**: Advanced rollback mechanisms
- **Validation rules**: Comprehensive validation framework

---

## ✅ Production Readiness Checklist

- [x] **Migration sequence fixed** (001-035)
- [x] **Test files separated** (moved to test-migrations/)
- [x] **RLS functions implemented** (current_merchant_id, is_admin_user)
- [x] **Tracking unified** (schema_migrations table)
- [x] **Constraints resolved** (whatsapp_number conflicts)
- [x] **Validation system** (comprehensive validation)
- [x] **Documentation complete** (this guide)
- [x] **Rollback procedures** (safe rollback mechanisms)
- [x] **Monitoring tools** (status views and functions)
- [x] **Security hardened** (RLS and access controls)

**Status**: ✅ **PRODUCTION READY**

---

*Last updated: $(date)*
*Version: 1.0.0*
*Migration System: Production Ready*
