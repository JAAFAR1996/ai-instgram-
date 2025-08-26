# 🏗️ Production Architecture Guide - AI Sales Platform

## 📋 Table of Contents

1. [Overview](#overview)
2. [Architecture Problems Solved](#architecture-problems-solved)
3. [Migration System](#migration-system)
4. [Database Management](#database-management)
5. [Error Handling](#error-handling)
6. [Production Workflow](#production-workflow)
7. [Monitoring & Maintenance](#monitoring--maintenance)
8. [Security Considerations](#security-considerations)
9. [Troubleshooting](#troubleshooting)

## 🎯 Overview

This guide provides comprehensive documentation for the production-ready architecture of the AI Sales Platform, addressing critical architectural issues and providing robust solutions for enterprise deployment.

## ❌ Architecture Problems Solved

### 1. **Schema Drift Issues**
- **Problem**: Inconsistent database schema across environments
- **Solution**: Unified migration tracking system with dependency resolution
- **Impact**: Prevents data corruption and ensures consistency

### 2. **Migration System Conflicts**
- **Problem**: Multiple migration tracking tables (`migrations`, `_migrations`, `schema_migrations`)
- **Solution**: Consolidated to single `schema_migrations` table
- **Impact**: Eliminates confusion and tracking inconsistencies

### 3. **Weak Error Handling**
- **Problem**: Loss of error context and poor debugging capabilities
- **Solution**: Enhanced error handler with full context preservation
- **Impact**: Better debugging, monitoring, and user experience

### 4. **Data Integrity Issues**
- **Problem**: Duplicate conversations and orphaned records
- **Solution**: Comprehensive data cleanup tools
- **Impact**: Maintains data quality and prevents business logic errors

## 🚀 Migration System

### Production Migration Runner

```bash
# Run migrations safely
node scripts/production-migration-runner.js

# Validate migrations without executing
node scripts/production-migration-runner.js --validate-only

# Dry run to see what would be executed
node scripts/production-migration-runner.js --dry-run

# Force execution (use with caution)
node scripts/production-migration-runner.js --force
```

### Features
- ✅ **Dependency Resolution**: Ensures migrations run in correct order
- ✅ **Checksum Verification**: Validates migration file integrity
- ✅ **Rollback Support**: Safe rollback capabilities
- ✅ **Production Safety**: Prevents dangerous operations in production
- ✅ **Comprehensive Logging**: Detailed execution logs
- ✅ **Error Recovery**: Graceful handling of migration failures

### Migration Categories
- **CORE**: Essential schema and tables
- **SECURITY**: RLS policies and authentication
- **PERFORMANCE**: Indexes and optimizations
- **WEBHOOK**: Webhook infrastructure
- **INSTAGRAM**: Instagram-specific features
- **ANALYTICS**: Reporting and analytics
- **FIXES**: Bug fixes and corrections

## 🗄️ Database Management

### Database Diagnosis Tool

```bash
# Comprehensive database health check
node scripts/database-diagnosis.js
```

**Checks Performed:**
- Migration tracking system consistency
- Schema drift detection
- Missing indexes and constraints
- Data integrity validation
- Performance analysis
- Security audit

### Data Cleanup Tool

```bash
# Analyze duplicates without making changes
node scripts/data-cleanup.js --dry-run

# Perform actual cleanup (creates backup first)
node scripts/data-cleanup.js
```

**Cleanup Operations:**
- Remove duplicate Instagram conversations
- Remove duplicate WhatsApp conversations
- Clean up orphaned messages
- Handle invalid merchant references
- Validate cleanup results

## 🛡️ Error Handling

### Enhanced Error Handler

```typescript
import { withErrorHandling, handleDatabaseError } from './services/enhanced-error-handler.js';

// Graceful error handling with context
const result = await withErrorHandling(
  async () => {
    // Your operation here
    return await databaseOperation();
  },
  {
    component: 'conversation-service',
    operation: 'create-conversation',
    userId: 'user123',
    merchantId: 'merchant456'
  },
  {
    severity: 'HIGH',
    category: 'DATABASE',
    userMessage: 'Failed to create conversation'
  }
);

// Database-specific error handling
try {
  await databaseQuery();
} catch (error) {
  const enhancedError = handleDatabaseError(error, {
    component: 'database',
    operation: 'query-execution'
  });
  // Error is automatically logged with full context
}
```

### Error Categories
- **DATABASE**: Database connection and query errors
- **VALIDATION**: Input validation errors
- **AUTHENTICATION**: Authentication and authorization errors
- **NETWORK**: Network and external API errors
- **BUSINESS_LOGIC**: Application logic errors
- **SYSTEM**: System-level errors

### Error Severity Levels
- **LOW**: Informational errors, no action required
- **MEDIUM**: Warnings, monitor for patterns
- **HIGH**: Requires attention, may affect functionality
- **CRITICAL**: Immediate action required, system impact

## 🔄 Production Workflow

### Pre-Deployment Checklist

1. **Database Health Check**
   ```bash
   node scripts/database-diagnosis.js
   ```

2. **Data Cleanup (if needed)**
   ```bash
   node scripts/data-cleanup.js --dry-run
   node scripts/data-cleanup.js
   ```

3. **Migration Validation**
   ```bash
   node scripts/production-migration-runner.js --validate-only
   ```

4. **Environment Validation**
   ```bash
   # Check all required environment variables
   node -e "require('./src/startup/security-validations.js').assertEnvStrict()"
   ```

### Deployment Process

1. **Backup Database**
   ```bash
   pg_dump $DATABASE_URL > backup-$(date +%Y%m%d-%H%M%S).sql
   ```

2. **Run Migrations**
   ```bash
   node scripts/production-migration-runner.js
   ```

3. **Deploy Application**
   ```bash
   # Application will start without running migrations
   npm start
   ```

4. **Health Check**
   ```bash
   curl http://localhost:3000/health
   ```

### Post-Deployment Verification

1. **Check Migration Status**
   ```sql
   SELECT version, success, applied_at 
   FROM schema_migrations 
   ORDER BY applied_at DESC 
   LIMIT 10;
   ```

2. **Verify Data Integrity**
   ```bash
   node scripts/database-diagnosis.js
   ```

3. **Monitor Error Rates**
   ```bash
   # Check application logs for error patterns
   tail -f logs/application.log | grep ERROR
   ```

## 📊 Monitoring & Maintenance

### Regular Maintenance Tasks

#### Daily
- Check error logs for patterns
- Monitor database performance
- Verify webhook delivery rates

#### Weekly
- Run database diagnosis
- Review error statistics
- Check migration status

#### Monthly
- Perform data cleanup
- Review and optimize indexes
- Update security policies

### Monitoring Endpoints

```bash
# Health check
GET /health

# Detailed health status
GET /healthz

# System metrics
GET /metrics

# Error statistics
GET /admin/errors

# Migration status
GET /admin/migrations
```

### Alert Configuration

Set up alerts for:
- High error rates (>10 errors/minute)
- Database connection failures
- Migration failures
- Webhook delivery failures
- Memory usage >80%
- Disk usage >85%

## 🔒 Security Considerations

### Database Security
- **RLS Policies**: All tables have Row Level Security enabled
- **Connection Encryption**: SSL/TLS for all database connections
- **Credential Management**: Secure environment variable handling
- **Access Control**: Minimal required permissions for application user

### Application Security
- **Input Validation**: Comprehensive validation for all inputs
- **Error Sanitization**: No sensitive data in error messages
- **Rate Limiting**: Protection against abuse
- **Authentication**: JWT-based authentication with proper validation

### Migration Security
- **Checksum Verification**: Ensures migration file integrity
- **Production Safety**: Prevents dangerous operations in production
- **Audit Trail**: Complete logging of all migration operations
- **Rollback Capability**: Safe rollback procedures

## 🔧 Troubleshooting

### Common Issues

#### Migration Failures
```bash
# Check migration status
SELECT * FROM schema_migrations WHERE success = FALSE;

# View detailed error logs
tail -f logs/migration.log

# Validate migration files
node scripts/production-migration-runner.js --validate-only
```

#### Database Connection Issues
```bash
# Test database connection
node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query('SELECT 1').then(() => console.log('✅ Connected')).catch(console.error);
"
```

#### Data Integrity Issues
```bash
# Run comprehensive diagnosis
node scripts/database-diagnosis.js

# Check for duplicates
SELECT merchant_id, customer_instagram, COUNT(*) 
FROM conversations 
WHERE customer_instagram IS NOT NULL 
GROUP BY merchant_id, customer_instagram 
HAVING COUNT(*) > 1;
```

### Error Recovery

#### Migration Rollback
```bash
# Manual rollback (if needed)
psql $DATABASE_URL -c "
DELETE FROM schema_migrations WHERE version = 'failed_migration.sql';
"
```

#### Data Recovery
```bash
# Restore from backup
psql $DATABASE_URL < backup-YYYYMMDD-HHMMSS.sql
```

#### Application Recovery
```bash
# Restart application
pm2 restart ai-sales-platform

# Check logs
pm2 logs ai-sales-platform
```

## 📈 Performance Optimization

### Database Optimization
- **Index Strategy**: Composite indexes for common query patterns
- **Query Optimization**: Regular query performance analysis
- **Connection Pooling**: Optimized pool settings for production load
- **Partitioning**: Large tables partitioned by date

### Application Optimization
- **Caching**: Redis-based caching for frequently accessed data
- **Async Processing**: Background job processing for heavy operations
- **Load Balancing**: Horizontal scaling capabilities
- **CDN Integration**: Static asset delivery optimization

## 🚀 Scaling Considerations

### Horizontal Scaling
- **Stateless Design**: Application can scale horizontally
- **Database Sharding**: Multi-tenant architecture supports sharding
- **Load Balancing**: Multiple application instances
- **Microservices**: Modular architecture for service decomposition

### Vertical Scaling
- **Resource Monitoring**: CPU, memory, and disk usage tracking
- **Auto-scaling**: Cloud provider auto-scaling groups
- **Performance Tuning**: Database and application optimization
- **Capacity Planning**: Regular capacity assessment

## 📚 Additional Resources

### Documentation
- [Migration System Documentation](./docs/migration-system.md)
- [Error Handling Guide](./docs/error-handling.md)
- [Database Schema Documentation](./docs/database-schema.md)
- [API Documentation](./docs/api.md)

### Tools
- [Production Migration Runner](./scripts/production-migration-runner.js)
- [Database Diagnosis Tool](./scripts/database-diagnosis.js)
- [Data Cleanup Tool](./scripts/data-cleanup.js)
- [Enhanced Error Handler](./src/services/enhanced-error-handler.ts)

### Monitoring
- [Health Check Endpoints](./src/routes/admin.ts)
- [Error Statistics](./src/services/enhanced-error-handler.ts)
- [Performance Metrics](./src/services/telemetry.ts)

---

## 🎉 Conclusion

This production architecture provides:
- ✅ **Reliability**: Robust error handling and recovery
- ✅ **Scalability**: Horizontal and vertical scaling support
- ✅ **Security**: Comprehensive security measures
- ✅ **Maintainability**: Clear documentation and tools
- ✅ **Monitoring**: Complete observability and alerting
- ✅ **Performance**: Optimized for production workloads

The system is now ready for enterprise deployment with confidence in its stability, security, and maintainability.
