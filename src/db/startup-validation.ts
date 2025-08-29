/**
 * Startup validation for database connection
 * يتحقق من DATABASE_URL عند بدء التشغيل لتجنب runtime errors
 */

import { validateDatabaseUrl, testDatabaseConnection } from './validate-database-url.js';
import { getLogger } from '../services/logger.js';

const log = getLogger({ component: 'startup-validation' });

export interface StartupValidationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate database configuration at startup
 */
export async function validateDatabaseAtStartup(): Promise<StartupValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  log.info('🔍 Starting database validation at startup...');

  try {
    // 1. Check if DATABASE_URL exists
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      errors.push('DATABASE_URL environment variable is missing');
      return { success: false, errors, warnings };
    }

    // 2. Validate URL format
    const validation = validateDatabaseUrl(databaseUrl);
    if (!validation.isValid) {
      errors.push(`DATABASE_URL format invalid: ${validation.error}`);
      return { success: false, errors, warnings };
    }

    log.info('✅ DATABASE_URL format validation passed', validation.details);

    // 3. Test actual connection
    log.info('🔗 Testing database connection...');
    const connectionTest = await testDatabaseConnection(databaseUrl);
    
    if (!connectionTest.success) {
      errors.push(`Database connection test failed: ${connectionTest.error}`);
      return { success: false, errors, warnings };
    }

    log.info('✅ Database connection test successful');

    // 4. Additional validations for production
    if (process.env.NODE_ENV === 'production') {
      const details = validation.details!;
      
      // Check for production best practices
      if (details.port === 5432) {
        warnings.push('Using default PostgreSQL port (5432) in production');
      }

      if (!details.hasPassword) {
        errors.push('Database password is required in production');
      }

      if (details.host === 'localhost' || details.host === '127.0.0.1') {
        warnings.push('Using localhost database in production environment');
      }
    }

    // Success
    log.info('✅ All database startup validations passed', {
      host: validation.details?.host,
      database: validation.details?.database,
      warnings: warnings.length
    });

    return { success: true, errors, warnings };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('❌ Database startup validation failed with exception', {
      error: errorMessage
    });
    
    errors.push(`Unexpected validation error: ${errorMessage}`);
    return { success: false, errors, warnings };
  }
}

/**
 * Log validation results with appropriate levels
 */
export function logValidationResults(result: StartupValidationResult): void {
  if (result.success) {
    log.info('✅ Database startup validation PASSED');
    
    // Log warnings if any
    for (const warning of result.warnings) {
      log.warn(`⚠️ Database warning: ${warning}`);
    }
  } else {
    log.error('❌ Database startup validation FAILED');
    
    // Log all errors
    for (const error of result.errors) {
      log.error(`💥 Database error: ${error}`);
    }
  }
}

/**
 * Validate and exit if critical errors
 */
export async function validateOrExit(): Promise<void> {
  const result = await validateDatabaseAtStartup();
  logValidationResults(result);

  if (!result.success) {
    log.error('🚨 Critical database validation errors detected. Exiting...');
    process.exit(1);
  }

  // Log successful validation
  log.info('🎉 Database is ready for connections');
}