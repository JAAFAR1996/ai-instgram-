/**
 * ===============================================
 * Startup Validation - Critical System Checks
 * Validates all systems before application starts
 * ===============================================
 */

import { getConfig, EnvironmentValidationError } from '../config/environment.js';
import { getDatabase } from '../database/connection.js';
import { GRAPH_API_BASE_URL } from '../config/graph-api.js';

export interface ValidationResult {
  success: boolean;
  service: string;
  message: string;
  duration: number;
  details?: any;
}

export interface StartupValidationReport {
  overallSuccess: boolean;
  totalDuration: number;
  results: ValidationResult[];
  criticalErrors: string[];
}

/**
 * Run comprehensive startup validation
 */
export async function runStartupValidation(): Promise<StartupValidationReport> {
  console.log('🔍 Running startup validation checks...');
  const startTime = Date.now();
  
  const results: ValidationResult[] = [];
  const criticalErrors: string[] = [];

  // 1. Environment Configuration Validation
  const envResult = await validateEnvironmentConfiguration();
  results.push(envResult);
  if (!envResult.success) {
    criticalErrors.push(envResult.message);
  }

  // 2. Database Connection Validation
  const dbResult = await validateDatabaseConnection();
  results.push(dbResult);
  if (!dbResult.success) {
    criticalErrors.push(dbResult.message);
  }

  // 3. Database Schema Validation
  const schemaResult = await validateDatabaseSchema();
  results.push(schemaResult);
  if (!schemaResult.success) {
    criticalErrors.push(schemaResult.message);
  }

  // 4. External Service Connectivity
  const servicesResult = await validateExternalServices();
  results.push(servicesResult);
  if (!servicesResult.success) {
    // Non-critical - log warning but don't block startup
    console.warn(`⚠️ External services check: ${servicesResult.message}`);
  }

  // 5. Security Configuration Validation
  const securityResult = await validateSecurityConfiguration();
  results.push(securityResult);
  if (!securityResult.success) {
    criticalErrors.push(securityResult.message);
  }

  const totalDuration = Date.now() - startTime;
  const overallSuccess = criticalErrors.length === 0;

  const report: StartupValidationReport = {
    overallSuccess,
    totalDuration,
    results,
    criticalErrors
  };

  // Log results
  logValidationReport(report);

  return report;
}

/**
 * Validate environment configuration
 */
async function validateEnvironmentConfiguration(): Promise<ValidationResult> {
  const startTime = Date.now();
  
  try {
    // First, validate required environment variables exist
    const requiredEnvVars = [
      'META_APP_ID',
      'IG_APP_SECRET', 
      'GRAPH_API_VERSION',
      'ENCRYPTION_KEY',
      'DATABASE_URL',
      'REDIS_URL',
      'OPENAI_API_KEY',
      'IG_VERIFY_TOKEN',
      'REDIRECT_URI'
    ];

    const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingEnvVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
    }

    // Check for placeholder values that shouldn't be in production
    const placeholderChecks = [
      { var: 'IG_APP_SECRET', value: process.env.IG_APP_SECRET, placeholder: 'your_app_secret_here' },
      { var: 'OPENAI_API_KEY', value: process.env.OPENAI_API_KEY, placeholder: 'sk-your_openai_api_key_here' },
      { var: 'ENCRYPTION_KEY', value: process.env.ENCRYPTION_KEY, placeholder: 'your_32_character_encryption_key_here' },
      { var: 'IG_VERIFY_TOKEN', value: process.env.IG_VERIFY_TOKEN, placeholder: 'your_webhook_verify_token_here' }
    ];

    const placeholderLeaks = placeholderChecks.filter(check => 
      check.value && check.value.includes(check.placeholder)
    );

    if (placeholderLeaks.length > 0) {
      throw new Error(`Placeholder values detected in production: ${placeholderLeaks.map(p => p.var).join(', ')}`);
    }

    const config = getConfig();
    
    // Additional runtime validations
    const validations = [
      {
        check: config.ai.maxTokens > 0 && config.ai.maxTokens <= 4000,
        error: 'AI max tokens must be between 1 and 4000'
      },
      {
        check: config.ai.temperature >= 0 && config.ai.temperature <= 2,
        error: 'AI temperature must be between 0 and 2'
      },
      {
        check: config.database.maxConnections > 0 && config.database.maxConnections <= 100,
        error: 'Database max connections must be between 1 and 100'
      },
      {
        check: config.security.rateLimitMax > 0,
        error: 'Rate limit max must be greater than 0'
      }
    ];

    for (const validation of validations) {
      if (!validation.check) {
        throw new Error(validation.error);
      }
    }

    return {
      success: true,
      service: 'Environment Configuration',
      message: 'All environment variables validated successfully',
      duration: Date.now() - startTime,
      details: {
        environment: config.environment,
        aiModel: config.ai.model,
        databaseHost: config.database.host,
        corsOrigins: config.security.corsOrigins.length
      }
    };
  } catch (error) {
    return {
      success: false,
      service: 'Environment Configuration',
      message: error instanceof Error ? error.message : 'Environment validation failed',
      duration: Date.now() - startTime
    };
  }
}

/**
 * Validate database connection and health
 */
async function validateDatabaseConnection(): Promise<ValidationResult> {
  const startTime = Date.now();
  
  try {
    const db = getDatabase();
    
    // Initialize connection
    await db.connect();
    
    // Run health check
    const health = await db.healthCheck();
    
    if (health.status !== 'healthy') {
      throw new Error(`Database health check failed: ${health.status}`);
    }

    return {
      success: true,
      service: 'Database Connection',
      message: 'Database connection and health check passed',
      duration: Date.now() - startTime,
      details: {
        status: health.status,
        responseTime: health.details.response_time_ms,
        activeConnections: health.details.active_connections,
        databaseSize: health.details.database_size
      }
    };
  } catch (error) {
    return {
      success: false,
      service: 'Database Connection',
      message: error instanceof Error ? error.message : 'Database connection failed',
      duration: Date.now() - startTime
    };
  }
}

/**
 * Validate database schema and required tables
 */
async function validateDatabaseSchema(): Promise<ValidationResult> {
  const startTime = Date.now();
  
  try {
    const db = getDatabase();
    const sql = db.getSQL();

    // Check required tables exist
    const requiredTables = [
      'merchants',
      'conversations',
      'message_logs',
      'merchant_credentials',
      'audit_logs'
    ];

    const existingTables = await sql<{ table_name: string }>`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      AND table_name = ANY(${requiredTables})
    `;

    const existingTableNames = existingTables.map(t => t.table_name);
    const missingTables = requiredTables.filter(table => !existingTableNames.includes(table));

    if (missingTables.length > 0) {
      throw new Error(`Missing required tables: ${missingTables.join(', ')}`);
    }

    // Check required extensions
    const requiredExtensions = ['uuid-ossp'];
    const extensions = await sql<{ extname: string }>`
      SELECT extname 
      FROM pg_extension 
      WHERE extname = ANY(${requiredExtensions})
    `;

    const installedExtensions = extensions.map(ext => ext.extname);
    const missingExtensions = requiredExtensions.filter(ext => !installedExtensions.includes(ext));

    return {
      success: true,
      service: 'Database Schema',
      message: 'Database schema validation passed',
      duration: Date.now() - startTime,
      details: {
        tablesFound: existingTableNames.length,
        requiredTables: requiredTables.length,
        extensionsInstalled: installedExtensions,
        missingExtensions: missingExtensions.length > 0 ? missingExtensions : undefined
      }
    };
  } catch (error) {
    return {
      success: false,
      service: 'Database Schema',
      message: error instanceof Error ? error.message : 'Schema validation failed',
      duration: Date.now() - startTime
    };
  }
}

/**
 * Validate external service connectivity
 */
async function validateExternalServices(): Promise<ValidationResult> {
  const startTime = Date.now();
  
  try {
    const config = getConfig();
    const results = [];

    // Test OpenAI API connectivity
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.ai.openaiApiKey}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });

      if (response.ok) {
        results.push({ service: 'OpenAI API', status: 'connected' });
      } else {
        results.push({ service: 'OpenAI API', status: 'error', message: `HTTP ${response.status}` });
      }
    } catch (error) {
      results.push({ 
        service: 'OpenAI API', 
        status: 'error', 
        message: error instanceof Error ? error.message : 'Connection failed' 
      });
    }

    // Test Instagram Graph API (basic check)
    try {
      const response = await fetch(`${GRAPH_API_BASE_URL}/me`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000) // 3 second timeout
      });
      
      // We expect this to fail with 400 (no token), but it confirms connectivity
      if (response.status === 400) {
        results.push({ service: 'Instagram Graph API', status: 'reachable' });
      } else {
        results.push({ service: 'Instagram Graph API', status: 'unexpected', message: `HTTP ${response.status}` });
      }
    } catch (error) {
      results.push({ 
        service: 'Instagram Graph API', 
        status: 'error', 
        message: error instanceof Error ? error.message : 'Connection failed' 
      });
    }

    const hasErrors = results.some(r => r.status === 'error');

    return {
      success: !hasErrors,
      service: 'External Services',
      message: hasErrors ? 'Some external services are unreachable' : 'External service connectivity verified',
      duration: Date.now() - startTime,
      details: results
    };
  } catch (error) {
    return {
      success: false,
      service: 'External Services',
      message: error instanceof Error ? error.message : 'External service validation failed',
      duration: Date.now() - startTime
    };
  }
}

/**
 * Validate security configuration
 */
async function validateSecurityConfiguration(): Promise<ValidationResult> {
  const startTime = Date.now();
  
  try {
    const config = getConfig();
    const issues = [];

    // Production-specific security checks
    if (config.environment === 'production') {
      if (config.security.corsOrigins.includes('*')) {
        issues.push('CORS allows all origins in production');
      }
      
      if (!config.database.ssl) {
        issues.push('Database SSL is disabled in production');
      }
      
      if (config.ai.temperature > 1.0) {
        issues.push('AI temperature is high for production (>1.0)');
      }
    }

    // General security checks
    if (config.security.encryptionKey.length < 32) {
      issues.push('Encryption key is too short (minimum 32 characters)');
    }

    if (config.security.rateLimitMax > 1000) {
      issues.push('Rate limit is very high (>1000 requests)');
    }

    return {
      success: issues.length === 0,
      service: 'Security Configuration',
      message: issues.length === 0 ? 'Security configuration validated' : `Security issues found: ${issues.length}`,
      duration: Date.now() - startTime,
      details: {
        environment: config.environment,
        corsOrigins: config.security.corsOrigins.length,
        sslEnabled: config.database.ssl,
        issues: issues.length > 0 ? issues : undefined
      }
    };
  } catch (error) {
    return {
      success: false,
      service: 'Security Configuration',
      message: error instanceof Error ? error.message : 'Security validation failed',
      duration: Date.now() - startTime
    };
  }
}

/**
 * Log validation report with proper formatting
 */
function logValidationReport(report: StartupValidationReport): void {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 STARTUP VALIDATION REPORT');
  console.log('='.repeat(60));

  report.results.forEach(result => {
    const icon = result.success ? '✅' : '❌';
    const status = result.success ? 'PASS' : 'FAIL';
    console.log(`${icon} ${result.service}: ${status} (${result.duration}ms)`);
    console.log(`   ${result.message}`);
    
    if (result.details) {
      const detailsStr = Object.entries(result.details)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ');
      console.log(`   Details: ${detailsStr}`);
    }
    console.log();
  });

  console.log('='.repeat(60));
  
  if (report.overallSuccess) {
    console.log(`✅ ALL CHECKS PASSED (${report.totalDuration}ms total)`);
    console.log('🚀 Application is ready to start');
  } else {
    console.log(`❌ CRITICAL ERRORS FOUND (${report.criticalErrors.length})`);
    report.criticalErrors.forEach(error => {
      console.log(`   • ${error}`);
    });
    console.log('🛑 Application startup blocked');
  }
  
  console.log('='.repeat(60) + '\n');
}

/**
 * Validate specific merchant configuration
 */
export async function validateMerchantConfig(merchantId: string): Promise<boolean> {
  try {
    const db = getDatabase();
    const sql = db.getSQL();

    // Check if merchant exists and is active
    const [merchant] = await sql<{ id: string; is_active: boolean; business_name: string }>`
      SELECT id, is_active, business_name
      FROM merchants
      WHERE id = ${merchantId}::uuid
    `;

    if (!merchant) {
      console.error(`❌ Merchant not found: ${merchantId}`);
      return false;
    }

    if (!merchant.is_active) {
      console.error(`❌ Merchant is inactive: ${merchantId}`);
      return false;
    }

    console.log(`✅ Merchant validation passed: ${merchant.business_name}`);
    return true;
  } catch (error) {
    console.error(`❌ Merchant validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return false;
  }
}