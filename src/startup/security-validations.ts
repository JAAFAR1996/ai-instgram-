/**
 * Startup Security Validations
 * Critical security checks that must pass before system starts
 */

import { getConfig } from '../config/environment.js';
import { getDatabase } from '../database/connection.js';
import { getLogger } from '../services/logger.js';

const logger = getLogger({ component: 'SecurityValidations' });

export interface SecurityValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

export async function runStartupSecurityValidations(): Promise<SecurityValidationResult> {
  const result: SecurityValidationResult = {
    passed: true,
    errors: [],
    warnings: []
  };

  logger.info('Starting security validation checks...');

  // 1. Environment Variables Validation
  await validateEnvironmentVariables(result);

  // 2. Database Security Configuration
  await validateDatabaseSecurity(result);

  // 3. Redis Security Configuration  
  await validateRedisSecurity(result);

  // 4. Encryption Keys Validation
  await validateEncryptionKeys(result);

  // 5. RLS Policies Validation
  await validateRLSPolicies(result);

  // 6. Network Security Validation
  await validateNetworkSecurity(result);

  if (result.errors.length > 0) {
    result.passed = false;
    logger.error({ errors: result.errors }, 'Security validation failed - system will not start');
  } else {
    logger.info('Security validation passed', { warnings: result.warnings });
  }

  return result;
}

async function validateEnvironmentVariables(result: SecurityValidationResult) {
  const config = getConfig();
  
  // Required secure environment variables
  const requiredSecureVars = [
    'DB_PASSWORD',
    'REDIS_URL', 
    'JWT_SECRET',
    'ENCRYPTION_KEY'
  ];

  for (const varName of requiredSecureVars) {
    const value = process.env[varName];
    if (!value) {
      result.errors.push(`Missing required environment variable: ${varName}`);
    } else if (value.length < 16) {
      result.errors.push(`Environment variable ${varName} is too short (minimum 16 characters)`);
    }
  }

  // Check if running in production with development settings
  if (process.env.NODE_ENV === 'production') {
    if (process.env.DB_NAME?.includes('dev') || process.env.DB_NAME?.includes('test')) {
      result.errors.push('Production environment using development/test database');
    }
    
    if (process.env.JWT_SECRET === 'development_secret') {
      result.errors.push('Production environment using development JWT secret');
    }

    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length < 32) {
      result.errors.push('Production environment requires strong encryption key (32+ characters)');
    }
  }

  // Check for debug flags in production
  if (process.env.NODE_ENV === 'production') {
    const debugVars = ['DEBUG', 'VERBOSE_LOGGING', 'DISABLE_AUTH'];
    for (const debugVar of debugVars) {
      if (process.env[debugVar] === 'true' || process.env[debugVar] === '1') {
        result.warnings.push(`Debug variable ${debugVar} is enabled in production`);
      }
    }
  }
}

async function validateDatabaseSecurity(result: SecurityValidationResult) {
  try {
    const db = getDatabase();
    const sql = db.getSQL();

    // Check SSL mode
    const sslResult = await sql`SHOW ssl`;
    if (!sslResult[0]?.ssl || sslResult[0].ssl === 'off') {
      if (process.env.NODE_ENV === 'production') {
        result.errors.push('Database SSL is disabled in production environment');
      } else {
        result.warnings.push('Database SSL is disabled');
      }
    }

    // Check RLS is enabled on tenant tables
    const rlsResult = await sql`
      SELECT schemaname, tablename, rowsecurity, enable_row_security
      FROM pg_tables t
      JOIN pg_class c ON c.relname = t.tablename
      LEFT JOIN pg_rowsecurity rs ON rs.rlsschemaname = t.schemaname AND rs.rlstablename = t.tablename
      WHERE t.schemaname = 'public' 
      AND t.tablename IN ('conversations', 'messages', 'merchants', 'orders', 'products')
    `;

    for (const table of rlsResult) {
      if (!table.rowsecurity) {
        result.errors.push(`RLS not enabled on critical table: ${table.tablename}`);
      }
    }

    // Check for weak database passwords in connection string
    const dbUrl = process.env.DATABASE_URL || '';
    if (dbUrl.includes('password=123') || dbUrl.includes('password=admin')) {
      result.errors.push('Weak database password detected in connection string');
    }

  } catch (error) {
    result.errors.push(`Database security validation failed: ${error.message}`);
  }
}

async function validateRedisSecurity(result: SecurityValidationResult) {
  const redisUrl = process.env.REDIS_URL;
  
  if (!redisUrl) {
    result.warnings.push('Redis URL not configured - some features will be unavailable');
    return;
  }

  // Check for weak Redis authentication
  if (redisUrl.includes('redis://localhost') && !redisUrl.includes('@')) {
    result.warnings.push('Redis connection appears to have no authentication');
  }

  // Check for production Redis security
  if (process.env.NODE_ENV === 'production') {
    if (!redisUrl.includes('rediss://') && !redisUrl.includes('ssl=true')) {
      result.warnings.push('Redis connection not using SSL in production');
    }
  }
}

async function validateEncryptionKeys(result: SecurityValidationResult) {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  
  if (!encryptionKey) {
    result.errors.push('ENCRYPTION_KEY environment variable is required');
    return;
  }

  // Check key strength
  if (encryptionKey.length < 32) {
    result.errors.push('Encryption key must be at least 32 characters long');
  }

  // Check for weak patterns
  const weakPatterns = [
    /^(.)\1+$/, // All same character
    /123456/,   // Sequential numbers
    /abcdef/,   // Sequential letters
    /qwerty/i   // Common keyboard patterns
  ];

  for (const pattern of weakPatterns) {
    if (pattern.test(encryptionKey)) {
      result.errors.push('Encryption key contains weak patterns');
      break;
    }
  }

  // Test encryption functionality
  try {
    const { encrypt, decrypt } = await import('../services/encryption.js');
    const testData = 'security_validation_test';
    const encrypted = encrypt(testData);
    const decrypted = decrypt(encrypted);
    
    if (decrypted !== testData) {
      result.errors.push('Encryption/decryption test failed');
    }
  } catch (error) {
    result.errors.push(`Encryption validation failed: ${error.message}`);
  }
}

async function validateRLSPolicies(result: SecurityValidationResult) {
  try {
    const db = getDatabase();
    const sql = db.getSQL();

    // Check that RLS policies exist for tenant isolation
    const policies = await sql`
      SELECT schemaname, tablename, policyname, cmd, roles
      FROM pg_policies 
      WHERE schemaname = 'public'
      AND tablename IN ('conversations', 'messages', 'merchants', 'orders', 'products')
    `;

    const criticalTables = ['conversations', 'messages', 'merchants', 'orders', 'products'];
    const tablesWithPolicies = new Set(policies.map(p => p.tablename));

    for (const table of criticalTables) {
      if (!tablesWithPolicies.has(table)) {
        result.errors.push(`No RLS policies found for critical table: ${table}`);
      }
    }

    // Check for policies that use current_setting for tenant isolation
    const tenantPolicies = policies.filter(p => 
      p.policyname?.includes('tenant') || 
      String(p.cmd).includes('current_setting')
    );

    if (tenantPolicies.length === 0) {
      result.errors.push('No tenant isolation RLS policies found');
    }

  } catch (error) {
    result.errors.push(`RLS policy validation failed: ${error.message}`);
  }
}

async function validateNetworkSecurity(result: SecurityValidationResult) {
  const config = getConfig();

  // Check CORS configuration
  if (process.env.NODE_ENV === 'production') {
    const allowedOrigins = process.env.CORS_ORIGINS;
    if (!allowedOrigins || allowedOrigins === '*') {
      result.warnings.push('CORS allows all origins in production - should be restricted');
    }
  }

  // Check for insecure protocols
  const webhookUrl = process.env.WEBHOOK_URL;
  if (webhookUrl && !webhookUrl.startsWith('https://')) {
    if (process.env.NODE_ENV === 'production') {
      result.errors.push('Webhook URL must use HTTPS in production');
    } else {
      result.warnings.push('Webhook URL not using HTTPS');
    }
  }

  // Check API rate limiting configuration
  if (!process.env.RATE_LIMIT_WINDOW || !process.env.RATE_LIMIT_MAX) {
    result.warnings.push('Rate limiting not configured - may be vulnerable to abuse');
  }
}

export default runStartupSecurityValidations;