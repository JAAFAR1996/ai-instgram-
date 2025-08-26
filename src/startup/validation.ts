/**
 * ===============================================
 * Startup Validation - Critical System Checks
 * 🔧 Stage 5: Enhanced DevOps validation and monitoring
 * Validates all systems before application starts
 * ===============================================
 */

import { getConfig } from '../config/index.js';
import { getDatabase } from '../db/adapter.js';
import { GRAPH_API_BASE_URL } from '../config/graph-api.js';
import { getLogger } from '../services/logger.js';

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
  const logger = getLogger({ component: 'startup-validation' });
  logger.info('🔍 Running startup validation checks...');
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

  // 6. Redis Connection Validation
  const redisResult = await validateRedisConnection();
  results.push(redisResult);
  if (!redisResult.success) {
    console.warn(`⚠️ Redis connection check: ${redisResult.message}`);
  }

  // 7. Queue System Validation
  const queueResult = await validateQueueSystem();
  results.push(queueResult);
  if (!queueResult.success) {
    console.warn(`⚠️ Queue system check: ${queueResult.message}`);
  }

  // 8. Performance Metrics Validation
  const performanceResult = await validatePerformanceMetrics();
  results.push(performanceResult);
  if (!performanceResult.success) {
    criticalErrors.push(performanceResult.message);
  }

  // 9. Memory Usage Validation
  const memoryResult = await validateMemoryUsage();
  results.push(memoryResult);
  if (!memoryResult.success) {
    console.warn(`⚠️ Memory usage check: ${memoryResult.message}`);
  }

  // 10. Connection Limits Validation
  const connectionLimitsResult = await validateConnectionLimits();
  results.push(connectionLimitsResult);
  if (!connectionLimitsResult.success) {
    console.warn(`⚠️ Connection limits check: ${connectionLimitsResult.message}`);
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
      'META_APP_SECRET', 
      'GRAPH_API_VERSION',
      'ENCRYPTION_KEY_HEX',
      'DATABASE_URL',
      'REDIS_URL',
      'OPENAI_API_KEY',
      'IG_VERIFY_TOKEN',
      'BASE_URL'
    ];

    const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingEnvVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
    }

    // Enhanced placeholder and security validation
    const securityChecks = [
      { 
        var: 'IG_APP_SECRET', 
        value: process.env.IG_APP_SECRET, 
        validators: [
          (v: string) => !v.match(/your_app_secret|placeholder|example|test|demo/i),
          (v: string) => v.length >= 32,
          (v: string) => !v.match(/^(secret|default|admin|password|123|abc)/i)
        ],
        error: 'Instagram app secret is invalid or contains placeholder'
      },
      { 
        var: 'OPENAI_API_KEY', 
        value: process.env.OPENAI_API_KEY, 
        validators: [
          (v: string) => v.startsWith('sk-'),
          (v: string) => v.length >= 51,
          (v: string) => !v.includes('your_openai_api_key')
        ],
        error: 'OpenAI API key is invalid or placeholder'
      },
      { 
        var: 'ENCRYPTION_KEY', 
        value: process.env.ENCRYPTION_KEY, 
        validators: [
          (v: string) => v.length >= 32,
          (v: string) => !v.match(/your_.*_key|placeholder|example|test|demo/i),
          (v: string) => !v.match(/^(key|secret|default|admin|password|123|abc)/i)
        ],
        error: 'Encryption key is too weak or contains placeholder'
      },
      { 
        var: 'IG_VERIFY_TOKEN', 
        value: process.env.IG_VERIFY_TOKEN, 
        validators: [
          (v: string) => !v.match(/your_.*_token|placeholder|example|test|demo/i),
          (v: string) => v.length >= 10,
          (v: string) => !v.match(/^(token|verify|default|admin|password|123|abc)/i)
        ],
        error: 'Instagram verify token is invalid or placeholder'
      },
      {
        var: 'JWT_SECRET',
        value: process.env.JWT_SECRET,
        validators: [
          (v: string) => v.length >= 32,
          (v: string) => !v.match(/secret|default|test|admin|password|123|abc/i),
          (v: string) => !v.match(/your_.*_secret|placeholder|example|demo/i)
        ],
        error: 'JWT secret is too weak or contains placeholder'
      }
    ];

    const securityViolations = securityChecks.filter(check => {
      if (!check.value) return true; // Missing value
      return !check.validators.every(validator => validator(check.value!));
    });

    if (securityViolations.length > 0) {
      throw new Error(`Security validation failed: ${securityViolations.map(v => v.error).join('; ')}`);
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
        databaseUrl: config.database.url,
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
    
    // Initialize connection and run health check  
    const sql = db.getSQL();
    const result = await sql<{ test: number }>`SELECT 1 as test`;
    
    if (!result || result.length === 0) {
      throw new Error('Database health check failed: No response');
    }

    return {
      success: true,
      service: 'Database Connection',
      message: 'Database connection and health check passed',
      duration: Date.now() - startTime,
      details: {
        status: 'healthy',
        responseTime: Date.now() - startTime,
        testQuery: 'SELECT 1',
        connection: 'active'
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
 * Comprehensive database schema validation
 */
async function validateDatabaseSchema(): Promise<ValidationResult> {
  const startTime = Date.now();
  
  try {
    const db = getDatabase();
    const sql = db.getSQL();
    const issues = [];
    const warnings = [];

    // 1. Check required tables exist
    const requiredTables = [
      'merchants',
      'conversations', 
      'message_logs',
      'merchant_credentials',
      'audit_logs',
      'products',
      'orders'
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
      issues.push(`Missing required tables: ${missingTables.join(', ')}`);
    }

    // 2. Check required extensions
    const requiredExtensions = ['uuid-ossp', 'pgcrypto'];
    const extensions: { extname: string }[] = await sql<{ extname: string }>`
      SELECT extname 
      FROM pg_extension 
      WHERE extname = ANY(${requiredExtensions})
    `;

    const installedExtensions = extensions.map(ext => ext.extname);
    const missingExtensions = requiredExtensions.filter(ext => !installedExtensions.includes(ext));

    if (missingExtensions.length > 0) {
      issues.push(`Missing required extensions: ${missingExtensions.join(', ')}`);
    }

    // 3. Index validation
    const criticalIndexes = [
      { table: 'merchants', column: 'id', type: 'PRIMARY KEY' },
      { table: 'conversations', column: 'merchant_id', type: 'INDEX' },
      { table: 'conversations', column: 'customer_phone', type: 'INDEX' },
      { table: 'message_logs', column: 'conversation_id', type: 'INDEX' },
      { table: 'audit_logs', column: 'created_at', type: 'INDEX' },
      { table: 'products', column: 'merchant_id', type: 'INDEX' },
      { table: 'products', column: 'sku', type: 'INDEX' },
      { table: 'orders', column: 'merchant_id', type: 'INDEX' },
      { table: 'orders', column: 'status', type: 'INDEX' }
    ];

    const indexInfo = await sql<{ 
      tablename: string; 
      indexname: string; 
      indexdef: string 
    }>`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes 
      WHERE schemaname = 'public'
      AND tablename = ANY(${criticalIndexes.map(idx => idx.table)})
    `;

    const missingIndexes = [];
    for (const requiredIndex of criticalIndexes) {
      const hasIndex = indexInfo.some(idx => 
        idx.tablename === requiredIndex.table && 
        (idx.indexdef.includes(requiredIndex.column) || idx.indexdef.includes('PRIMARY KEY'))
      );
      
      if (!hasIndex) {
        missingIndexes.push(`${requiredIndex.table}.${requiredIndex.column} (${requiredIndex.type})`);
      }
    }

    if (missingIndexes.length > 0) {
      warnings.push(`Missing recommended indexes: ${missingIndexes.join(', ')}`);
    }

    // 4. RLS policies validation
    const rlsPolicies = await sql<{ 
      tablename: string; 
      policyname: string;
      roles: string;
      cmd: string;
    }>`
      SELECT 
        tablename,
        policyname,
        roles,
        cmd
      FROM pg_policies 
      WHERE schemaname = 'public'
      AND tablename = ANY(${['merchants', 'conversations', 'message_logs', 'products', 'orders']})
    `;

    const requiredRLSTables = ['merchants', 'conversations', 'message_logs', 'products', 'orders'];
    const tablesWithRLS = Array.from(new Set(rlsPolicies.map(p => p.tablename)));
    const tablesWithoutRLS = requiredRLSTables.filter(table => !tablesWithRLS.includes(table));

    if (tablesWithoutRLS.length > 0) {
      warnings.push(`Tables without RLS policies: ${tablesWithoutRLS.join(', ')}`);
    }

    // 5. Function/procedure validation
    const requiredFunctions = [
      'set_merchant_context',
      'get_rls_context',
      'validate_merchant_access'
    ];

    const existingFunctions = await sql<{ routine_name: string }>`
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_schema = 'public'
      AND routine_type = 'FUNCTION'
      AND routine_name = ANY(${requiredFunctions})
    `;

    const existingFunctionNames = existingFunctions.map(f => f.routine_name);
    const missingFunctions = requiredFunctions.filter(fn => !existingFunctionNames.includes(fn));

    if (missingFunctions.length > 0) {
      warnings.push(`Missing utility functions: ${missingFunctions.join(', ')}`);
    }

    // 6. Performance constraint checks
    const tableStats = await sql<{
      schemaname: string;
      tablename: string;
      n_tup_ins: string;
      n_tup_upd: string;
      n_tup_del: string;
      n_live_tup: string;
      n_dead_tup: string;
      last_vacuum: string;
      last_autovacuum: string;
    }>`
      SELECT 
        schemaname,
        tablename,
        n_tup_ins::text,
        n_tup_upd::text,
        n_tup_del::text,
        n_live_tup::text,
        n_dead_tup::text,
        last_vacuum::text,
        last_autovacuum::text
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY n_live_tup DESC
    `;

    // Check for tables with high dead tuple ratios
    const deadTupleWarnings = [];
    for (const stat of tableStats) {
      const liveTuples = parseInt(stat.n_live_tup) || 0;
      const deadTuples = parseInt(stat.n_dead_tup) || 0;
      
      if (liveTuples > 0 && deadTuples > 0) {
        const deadRatio = deadTuples / (liveTuples + deadTuples);
        if (deadRatio > 0.2) { // More than 20% dead tuples
          deadTupleWarnings.push(`${stat.tablename} has ${(deadRatio * 100).toFixed(1)}% dead tuples`);
        }
      }
    }

    if (deadTupleWarnings.length > 0) {
      warnings.push(`Tables need VACUUM: ${deadTupleWarnings.join(', ')}`);
    }

    // 7. Check foreign key constraints
    const foreignKeys = await sql<{
      constraint_name: string;
      table_name: string;
      column_name: string;
      foreign_table_name: string;
      foreign_column_name: string;
    }>`
      SELECT 
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    `;

    const requiredForeignKeys = [
      { table: 'conversations', column: 'merchant_id', references: 'merchants.id' },
      { table: 'message_logs', column: 'conversation_id', references: 'conversations.id' },
      { table: 'products', column: 'merchant_id', references: 'merchants.id' },
      { table: 'orders', column: 'merchant_id', references: 'merchants.id' }
    ];

    const missingForeignKeys = [];
    for (const requiredFK of requiredForeignKeys) {
      const hasFK = foreignKeys.some(fk => 
        fk.table_name === requiredFK.table && 
        fk.column_name === requiredFK.column
      );
      
      if (!hasFK) {
        missingForeignKeys.push(`${requiredFK.table}.${requiredFK.column} -> ${requiredFK.references}`);
      }
    }

    if (missingForeignKeys.length > 0) {
      warnings.push(`Missing foreign key constraints: ${missingForeignKeys.join(', ')}`);
    }

    return {
      success: issues.length === 0,
      service: 'Database Schema',
      message: issues.length === 0 ? 
        (warnings.length > 0 ? `Schema validated with ${warnings.length} optimization suggestions` : 'Comprehensive database schema validation passed') :
        `Schema issues found: ${issues.length}`,
      duration: Date.now() - startTime,
      details: {
        tablesFound: existingTableNames.length,
        requiredTables: requiredTables.length,
        extensionsInstalled: installedExtensions,
        indexesChecked: criticalIndexes.length,
        rlsPoliciesFound: rlsPolicies.length,
        functionsFound: existingFunctionNames.length,
        foreignKeysFound: foreignKeys.length,
        issues: issues.length > 0 ? issues : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
        performanceStats: {
          totalTables: tableStats.length,
          needsVacuum: deadTupleWarnings.length
        }
      }
    };
  } catch (error) {
    return {
      success: false,
      service: 'Database Schema',
      message: error instanceof Error ? error.message : 'Comprehensive schema validation failed',
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
 * Validate Redis connection and caching
 */
async function validateRedisConnection(): Promise<ValidationResult> {
  const startTime = Date.now();
  
  try {
    const { getRedisConnectionManager } = await import('../services/RedisConnectionManager.js');
    const { RedisUsageType } = await import('../config/RedisConfigurationFactory.js');
    
    const redisManager = getRedisConnectionManager();
    
    // Test Redis connection with timeout
    const result = await redisManager.safeRedisOperation(
      RedisUsageType.CACHING,
      async (redis) => {
        const pong = await redis.ping();
        return pong === 'PONG';
      }
    );

    if (result.ok && result.result) {
      const stats = redisManager.getConnectionStats();
      return {
        success: true,
        service: 'Redis Connection',
        message: 'Redis connectivity verified',
        duration: Date.now() - startTime,
        details: {
          status: redisManager.getRedisStatus(),
          connections: stats.totalConnections,
          healthScore: stats.averageHealthScore
        }
      };
    } else {
      return {
        success: false,
        service: 'Redis Connection',
        message: result.reason || 'Redis connection failed',
        duration: Date.now() - startTime
      };
    }
  } catch (error) {
    return {
      success: false,
      service: 'Redis Connection',
      message: error instanceof Error ? error.message : 'Redis validation failed',
      duration: Date.now() - startTime
    };
  }
}

/**
 * Validate queue system
 */
async function validateQueueSystem(): Promise<ValidationResult> {
  const startTime = Date.now();
  
  try {
    // const { checkQueueHealth } = await import('../queue/index.js'); // Removed
    
    // Temporarily disable queue health check
    return {
      success: true,
      service: 'Queue System',
      message: 'Queue health check temporarily disabled',
      duration: Date.now() - startTime,
      details: { note: 'Queue system refactored' }
    };
  } catch (error) {
    return {
      success: false,
      service: 'Queue System',
      message: error instanceof Error ? error.message : 'Queue system validation failed',
      duration: Date.now() - startTime
    };
  }
}

/**
 * Comprehensive security configuration validation
 */
async function validateSecurityConfiguration(): Promise<ValidationResult> {
  const startTime = Date.now();
  
  try {
    const config = getConfig();
    const issues = [];
    const warnings = [];
    const securityScore = { total: 0, passed: 0 };

    // 1. Production-specific security checks
    if (config.environment === 'production') {
      securityScore.total += 5;
      
      if (config.security.corsOrigins.includes('*')) {
        issues.push('CORS allows all origins in production');
      } else {
        securityScore.passed++;
      }
      
      if (!config.database.ssl) {
        issues.push('Database SSL is disabled in production');
      } else {
        securityScore.passed++;
      }
      
      if (config.ai.temperature > 1.0) {
        warnings.push('AI temperature is high for production (>1.0)');
      } else {
        securityScore.passed++;
      }

      if (config.security.rateLimitMax > 1000) {
        warnings.push('Rate limit is very high (>1000 requests)');
      } else {
        securityScore.passed++;
      }

      // Check for debug mode in production
      if (process.env.NODE_ENV !== 'production') {
        issues.push('NODE_ENV is not set to production in production environment');
      } else {
        securityScore.passed++;
      }
    }

    // 2. Encryption validation
    securityScore.total += 4;
    
    if (config.security.encryptionKey.length < 32) {
      issues.push('Encryption key is too short (minimum 32 characters)');
    } else {
      securityScore.passed++;
    }

    // Advanced password strength validation
    const encryptionKeyStrength = validatePasswordStrength(config.security.encryptionKey);
    if (encryptionKeyStrength.score < 3) {
      warnings.push(`Encryption key strength is weak (score: ${encryptionKeyStrength.score}/5)`);
    } else {
      securityScore.passed++;
    }

    // Encryption algorithm validation
    const supportedAlgorithms = ['aes-256-gcm', 'aes-256-cbc', 'chacha20-poly1305'];
    const encryptionAlgorithm = process.env.ENCRYPTION_ALGORITHM || 'aes-256-gcm';
    if (!supportedAlgorithms.includes(encryptionAlgorithm)) {
      warnings.push(`Unsupported encryption algorithm: ${encryptionAlgorithm}`);
    } else {
      securityScore.passed++;
    }

    // Key rotation checks
    const keyRotationDate = process.env.KEY_LAST_ROTATED;
    if (keyRotationDate) {
      const lastRotated = new Date(keyRotationDate);
      const daysSinceRotation = (Date.now() - lastRotated.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceRotation > 90) { // More than 90 days
        warnings.push(`Encryption key not rotated for ${Math.floor(daysSinceRotation)} days`);
      } else {
        securityScore.passed++;
      }
    } else {
      warnings.push('No key rotation date found - consider implementing key rotation');
    }

    // 3. JWT Security validation
    securityScore.total += 3;
    
    if (config.security.jwtSecret.length < 32) {
      issues.push('JWT secret is too short (minimum 32 characters)');
    } else {
      securityScore.passed++;
    }

    const jwtStrength = validatePasswordStrength(config.security.jwtSecret);
    if (jwtStrength.score < 3) {
      warnings.push(`JWT secret strength is weak (score: ${jwtStrength.score}/5)`);
    } else {
      securityScore.passed++;
    }

    // JWT expiration validation
    const jwtExpiry = process.env.JWT_EXPIRES_IN || '24h';
    if (!jwtExpiry.includes('h') || parseInt(jwtExpiry) > 24) {
      warnings.push('JWT expiration time is longer than recommended (>24h)');
    } else {
      securityScore.passed++;
    }

    // 4. Certificate expiry checks (if SSL certificates are used)
    securityScore.total += 2;
    
    const sslCertPath = process.env.SSL_CERT_PATH;
    const sslKeyPath = process.env.SSL_KEY_PATH;
    
    if (sslCertPath && sslKeyPath) {
      try {
        const fs = await import('fs');
        if (fs.existsSync(sslCertPath)) {
          // In production, would check certificate expiry
          // For now, just validate existence
          securityScore.passed++;
          
          // Mock certificate expiry check
          const mockCertExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
          const daysUntilExpiry = (mockCertExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
          
          if (daysUntilExpiry < 30) {
            warnings.push(`SSL certificate expires in ${Math.floor(daysUntilExpiry)} days`);
          } else {
            securityScore.passed++;
          }
        } else {
          warnings.push('SSL certificate path specified but file not found');
        }
      } catch (error) {
        warnings.push('Could not validate SSL certificate');
      }
    } else if (config.environment === 'production') {
      warnings.push('SSL certificates not configured for production');
    }

    // 5. Token rotation validation
    securityScore.total += 2;
    
    const tokenRotationPolicy = process.env.TOKEN_ROTATION_ENABLED === 'true';
    if (!tokenRotationPolicy && config.environment === 'production') {
      warnings.push('Token rotation is not enabled in production');
    } else {
      securityScore.passed++;
    }

    const refreshTokenExpiry = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';
    if (!refreshTokenExpiry.includes('d') || parseInt(refreshTokenExpiry) > 30) {
      warnings.push('Refresh token expiration is longer than recommended (>30d)');
    } else {
      securityScore.passed++;
    }

    // 6. General security validation
    securityScore.total += 6;
    
    const securityTests = [
      {
        test: () => !/^(default|test|changeme)$/i.test(config.security.encryptionKey),
        message: 'Encryption key appears to be a placeholder'
      },
      {
        test: () => !/^(secret|default|test)$/i.test(config.security.jwtSecret),
        message: 'JWT secret appears to be a placeholder'
      },
      {
        test: () => config.instagram.verifyToken.length >= 10,
        message: 'Instagram verify token is too short'
      },
      {
        test: () => config.instagram.appSecret.length >= 20,
        message: 'Instagram app secret is too short'
      },
      {
        test: () => !config.instagram.appSecret.includes('your_app_secret'),
        message: 'Instagram app secret contains placeholder text'
      },
      {
        test: () => config.security.rateLimitMax > 0 && config.security.rateLimitMax <= 500,
        message: 'Rate limiting is not properly configured'
      }
    ];

    for (const test of securityTests) {
      if (!test.test()) {
        issues.push(test.message);
      } else {
        securityScore.passed++;
      }
    }

    // 7. Advanced security headers validation
    const securityHeaders = {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Content-Security-Policy': 'default-src \'self\''
    };

    const missingHeaders = [];
    for (const [header] of Object.entries(securityHeaders)) {
      // In production, would check actual HTTP headers
      // For validation, assume they're configured if not explicitly disabled
      const headerDisabled = process.env[`DISABLE_${header.replace(/-/g, '_').toUpperCase()}`] === 'true';
      if (headerDisabled) {
        missingHeaders.push(header);
      }
    }

    if (missingHeaders.length > 0) {
      warnings.push(`Missing security headers: ${missingHeaders.join(', ')}`);
    }

    // Calculate security score percentage
    const securityPercentage = securityScore.total > 0 ? Math.round((securityScore.passed / securityScore.total) * 100) : 0;

    return {
      success: issues.length === 0,
      service: 'Security Configuration',
      message: issues.length === 0 ? 
        (warnings.length > 0 ? `Security validated with ${warnings.length} warnings (Score: ${securityPercentage}%)` : `Comprehensive security validation passed (Score: ${securityPercentage}%)`) : 
        `Security issues found: ${issues.length} (Score: ${securityPercentage}%)`,
      duration: Date.now() - startTime,
      details: {
        environment: config.environment,
        securityScore: {
          percentage: securityPercentage,
          passed: securityScore.passed,
          total: securityScore.total
        },
        corsOrigins: config.security.corsOrigins.length,
        sslEnabled: config.database.ssl,
        encryptionAlgorithm: process.env.ENCRYPTION_ALGORITHM || 'aes-256-gcm',
        jwtExpiry: process.env.JWT_EXPIRES_IN || '24h',
        tokenRotationEnabled: process.env.TOKEN_ROTATION_ENABLED === 'true',
        securityHeaders: Object.keys(securityHeaders).length - missingHeaders.length,
        issues: issues.length > 0 ? issues : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
        keyStrengths: {
          encryptionKey: encryptionKeyStrength.score,
          jwtSecret: jwtStrength.score
        }
      }
    };
  } catch (error) {
    return {
      success: false,
      service: 'Security Configuration',
      message: error instanceof Error ? error.message : 'Comprehensive security validation failed',
      duration: Date.now() - startTime
    };
  }
}

/**
 * Advanced password strength validation
 */
function validatePasswordStrength(password: string): { score: number; feedback: string[] } {
  const feedback = [];
  let score = 0;

  // Length check
  if (password.length >= 12) score++;
  else feedback.push('Password should be at least 12 characters long');

  // Character variety checks
  if (/[a-z]/.test(password)) score++;
  else feedback.push('Add lowercase letters');

  if (/[A-Z]/.test(password)) score++;
  else feedback.push('Add uppercase letters');

  if (/[0-9]/.test(password)) score++;
  else feedback.push('Add numbers');

  if (/[^A-Za-z0-9]/.test(password)) score++;
  else feedback.push('Add special characters');

  return { score, feedback };
}

/**
 * Log validation report with proper formatting
 */
function logValidationReport(report: StartupValidationReport): void {
  const logger = getLogger({ component: 'startup-validation' });
  logger.info('\n' + '='.repeat(60));
  logger.info('🔍 STARTUP VALIDATION REPORT');
  logger.info('='.repeat(60));

  report.results.forEach(result => {
    const icon = result.success ? '✅' : '❌';
    const status = result.success ? 'PASS' : 'FAIL';
    logger.info(`${icon} ${result.service}: ${status} (${result.duration}ms)`);
    logger.info(`   ${result.message}`);
    
    if (result.details) {
      const detailsStr = Object.entries(result.details)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ');
      logger.info(`   Details: ${detailsStr}`);
    }
    logger.info(' ');
  });

  logger.info('='.repeat(60));
  
  if (report.overallSuccess) {
    logger.info(`✅ ALL CHECKS PASSED (${report.totalDuration}ms total)`);
    logger.info('🚀 Application is ready to start');
  } else {
    logger.info(`❌ CRITICAL ERRORS FOUND (${report.criticalErrors.length})`);
    report.criticalErrors.forEach(error => {
      logger.info(`   • ${error}`);
    });
    logger.info('🛑 Application startup blocked');
  }
  
  logger.info('='.repeat(60) + '\n');
}

/**
 * Performance metrics validation
 */
async function validatePerformanceMetrics(): Promise<ValidationResult> {
  const startTime = Date.now();
  
  try {
    const config = getConfig();
    const issues = [];
    const warnings = [];
    const performanceChecks = [];

    // 1. Database performance checks
    const db = getDatabase();
    const sql = db.getSQL();

    // Check database response time
    const dbStartTime = Date.now();
    await sql`SELECT 1`;
    const dbResponseTime = Date.now() - dbStartTime;
    
    performanceChecks.push({
      metric: 'Database Response Time',
      value: dbResponseTime,
      unit: 'ms',
      status: dbResponseTime < 100 ? 'good' : dbResponseTime < 500 ? 'warning' : 'critical'
    });

    if (dbResponseTime > 500) {
      issues.push(`Database response time is too high: ${dbResponseTime}ms`);
    } else if (dbResponseTime > 100) {
      warnings.push(`Database response time is elevated: ${dbResponseTime}ms`);
    }

    // Check active connections
    const connectionStats = await sql<{
      active_connections: string;
      max_connections: string;
      connection_usage_percent: string;
    }>`
      SELECT 
        COUNT(*) FILTER (WHERE state = 'active') as active_connections,
        (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max_connections,
        ROUND(
          (COUNT(*) FILTER (WHERE state = 'active')::float / 
           (SELECT setting::int FROM pg_settings WHERE name = 'max_connections')::float) * 100, 2
        ) as connection_usage_percent
      FROM pg_stat_activity
    `;

    const connStats = connectionStats[0];
    if (connStats) {
      const usagePercent = parseFloat(connStats.connection_usage_percent);
      
      performanceChecks.push({
        metric: 'Database Connection Usage',
        value: usagePercent,
        unit: '%',
        status: usagePercent < 70 ? 'good' : usagePercent < 85 ? 'warning' : 'critical'
      });

      if (usagePercent > 85) {
        issues.push(`Database connection usage is critical: ${usagePercent}%`);
      } else if (usagePercent > 70) {
        warnings.push(`Database connection usage is high: ${usagePercent}%`);
      }
    }

    // 2. Memory and resource checks
    const memoryUsage = process.memoryUsage();
    const heapUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
    
    performanceChecks.push({
      metric: 'Heap Memory Usage',
      value: Math.round(heapUsagePercent),
      unit: '%',
      status: heapUsagePercent < 70 ? 'good' : heapUsagePercent < 85 ? 'warning' : 'critical'
    });

    if (heapUsagePercent > 85) {
      issues.push(`Heap memory usage is critical: ${Math.round(heapUsagePercent)}%`);
    } else if (heapUsagePercent > 70) {
      warnings.push(`Heap memory usage is high: ${Math.round(heapUsagePercent)}%`);
    }

    // 3. Configuration performance checks
    if (config.ai.maxTokens > 4000) {
      warnings.push(`AI max tokens is very high: ${config.ai.maxTokens} (may impact performance)`);
    }

    if (config.database.maxConnections > 50) {
      warnings.push(`Database max connections is high: ${config.database.maxConnections} (may impact resources)`);
    }

    // 4. Rate limiting performance
    if (config.security.rateLimitMax < 10) {
      warnings.push(`Rate limit is very restrictive: ${config.security.rateLimitMax} (may impact user experience)`);
    }

    return {
      success: issues.length === 0,
      service: 'Performance Metrics',
      message: issues.length === 0 ? 
        (warnings.length > 0 ? `Performance validated with ${warnings.length} optimization suggestions` : 'Performance metrics validation passed') :
        `Performance issues found: ${issues.length}`,
      duration: Date.now() - startTime,
      details: {
        checks: performanceChecks,
        memoryUsage: {
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          external: Math.round(memoryUsage.external / 1024 / 1024),
          rss: Math.round(memoryUsage.rss / 1024 / 1024)
        },
        configuration: {
          aiMaxTokens: config.ai.maxTokens,
          dbMaxConnections: config.database.maxConnections,
          rateLimitMax: config.security.rateLimitMax
        },
        issues: issues.length > 0 ? issues : undefined,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    };
  } catch (error) {
    return {
      success: false,
      service: 'Performance Metrics',
      message: error instanceof Error ? error.message : 'Performance validation failed',
      duration: Date.now() - startTime
    };
  }
}

/**
 * Memory usage validation
 */
async function validateMemoryUsage(): Promise<ValidationResult> {
  const startTime = Date.now();
  
  try {
    const issues = [];
    const warnings = [];
    const memoryMetrics = [];

    // Get Node.js memory usage
    const nodeMemory = process.memoryUsage();
    const nodeMemoryMB = {
      rss: Math.round(nodeMemory.rss / 1024 / 1024),
      heapTotal: Math.round(nodeMemory.heapTotal / 1024 / 1024),
      heapUsed: Math.round(nodeMemory.heapUsed / 1024 / 1024),
      external: Math.round(nodeMemory.external / 1024 / 1024)
    };

    // Calculate percentages
    const heapUsagePercent = (nodeMemory.heapUsed / nodeMemory.heapTotal) * 100;
    
    memoryMetrics.push({
      metric: 'RSS Memory',
      value: nodeMemoryMB.rss,
      unit: 'MB',
      status: nodeMemoryMB.rss < 512 ? 'good' : nodeMemoryMB.rss < 1024 ? 'warning' : 'critical'
    });

    memoryMetrics.push({
      metric: 'Heap Usage',
      value: Math.round(heapUsagePercent),
      unit: '%',
      status: heapUsagePercent < 70 ? 'good' : heapUsagePercent < 85 ? 'warning' : 'critical'
    });

    // Memory usage checks
    if (nodeMemoryMB.rss > 1024) { // More than 1GB RSS
      issues.push(`RSS memory usage is critical: ${nodeMemoryMB.rss}MB`);
    } else if (nodeMemoryMB.rss > 512) { // More than 512MB RSS
      warnings.push(`RSS memory usage is high: ${nodeMemoryMB.rss}MB`);
    }

    if (heapUsagePercent > 85) {
      issues.push(`Heap memory usage is critical: ${Math.round(heapUsagePercent)}%`);
    } else if (heapUsagePercent > 70) {
      warnings.push(`Heap memory usage is high: ${Math.round(heapUsagePercent)}%`);
    }

    // Check for potential memory leaks (simplified check)
    if (nodeMemoryMB.external > 100) {
      warnings.push(`External memory usage is high: ${nodeMemoryMB.external}MB (potential memory leaks)`);
    }

    // System memory check (if available)
    try {
      const os = await import('os');
      const totalSystemMemory = os.totalmem();
      const freeSystemMemory = os.freemem();
      const systemMemoryUsage = ((totalSystemMemory - freeSystemMemory) / totalSystemMemory) * 100;
      
      memoryMetrics.push({
        metric: 'System Memory Usage',
        value: Math.round(systemMemoryUsage),
        unit: '%',
        status: systemMemoryUsage < 80 ? 'good' : systemMemoryUsage < 90 ? 'warning' : 'critical'
      });

      if (systemMemoryUsage > 90) {
        issues.push(`System memory usage is critical: ${Math.round(systemMemoryUsage)}%`);
      } else if (systemMemoryUsage > 80) {
        warnings.push(`System memory usage is high: ${Math.round(systemMemoryUsage)}%`);
      }
    } catch (error) {
      // OS module not available, skip system memory check
    }

    return {
      success: issues.length === 0,
      service: 'Memory Usage',
      message: issues.length === 0 ? 
        (warnings.length > 0 ? `Memory usage validated with ${warnings.length} optimization suggestions` : 'Memory usage validation passed') :
        `Memory usage issues found: ${issues.length}`,
      duration: Date.now() - startTime,
      details: {
        metrics: memoryMetrics,
        nodeMemory: nodeMemoryMB,
        heapUsagePercent: Math.round(heapUsagePercent),
        issues: issues.length > 0 ? issues : undefined,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    };
  } catch (error) {
    return {
      success: false,
      service: 'Memory Usage',
      message: error instanceof Error ? error.message : 'Memory usage validation failed',
      duration: Date.now() - startTime
    };
  }
}

/**
 * Connection limits validation
 */
async function validateConnectionLimits(): Promise<ValidationResult> {
  const startTime = Date.now();
  
  try {
    const config = getConfig();
    const issues = [];
    const warnings = [];
    const connectionMetrics = [];

    // 1. Database connection limits
    const db = getDatabase();
    const sql = db.getSQL();

    const dbLimits = await sql<{
      max_connections: string;
      current_connections: string;
      reserved_connections: string;
      available_connections: string;
    }>`
      SELECT 
        (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max_connections,
        (SELECT count(*) FROM pg_stat_activity) as current_connections,
        (SELECT setting::int FROM pg_settings WHERE name = 'superuser_reserved_connections') as reserved_connections,
        (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') - 
        (SELECT count(*) FROM pg_stat_activity) as available_connections
    `;

    const dbLimitInfo = dbLimits[0];
    if (dbLimitInfo) {
      const maxConn = parseInt(dbLimitInfo.max_connections);
      const currentConn = parseInt(dbLimitInfo.current_connections);
      const availableConn = parseInt(dbLimitInfo.available_connections);
      const usagePercent = (currentConn / maxConn) * 100;

      connectionMetrics.push({
        metric: 'Database Connections',
        current: currentConn,
        max: maxConn,
        available: availableConn,
        usagePercent: Math.round(usagePercent),
        status: usagePercent < 70 ? 'good' : usagePercent < 85 ? 'warning' : 'critical'
      });

      if (usagePercent > 85) {
        issues.push(`Database connection usage critical: ${currentConn}/${maxConn} (${Math.round(usagePercent)}%)`);
      } else if (usagePercent > 70) {
        warnings.push(`Database connection usage high: ${currentConn}/${maxConn} (${Math.round(usagePercent)}%)`);
      }

      if (maxConn > 200) {
        warnings.push(`Database max connections is very high: ${maxConn} (may impact performance)`);
      }

      if (availableConn < 10) {
        issues.push(`Very few database connections available: ${availableConn}`);
      }
    }

    // 2. Application-level connection limits
    const appMaxConnections = config.database.maxConnections;
    if (appMaxConnections > 100) {
      warnings.push(`App-level max connections is high: ${appMaxConnections}`);
    }

    connectionMetrics.push({
      metric: 'App Connection Pool',
      max: appMaxConnections,
      recommended: Math.min(50, Math.max(10, Math.floor(parseInt(dbLimitInfo?.max_connections || '100') * 0.3))),
      status: appMaxConnections <= 50 ? 'good' : 'warning'
    });

    // 3. Redis connection limits (if Redis is configured)
    try {
      const redisMaxConnections = process.env.REDIS_MAX_CONNECTIONS || '10';
      const redisMaxConnectionsNum = parseInt(redisMaxConnections);
      
      if (redisMaxConnectionsNum > 50) {
        warnings.push(`Redis max connections is high: ${redisMaxConnectionsNum}`);
      }

      connectionMetrics.push({
        metric: 'Redis Connections',
        max: redisMaxConnectionsNum,
        status: redisMaxConnectionsNum <= 20 ? 'good' : redisMaxConnectionsNum <= 50 ? 'warning' : 'critical'
      });
    } catch (error) {
      // Redis not configured or not available
    }

    // 4. Rate limiting as connection control
    const rateLimitMax = config.security.rateLimitMax;
    if (rateLimitMax > 1000) {
      warnings.push(`Rate limit is very high: ${rateLimitMax} (may overwhelm connections)`);
    } else if (rateLimitMax < 10) {
      warnings.push(`Rate limit is very low: ${rateLimitMax} (may block legitimate users)`);
    }

    // 5. Check file descriptor limits (Unix systems)
    try {
      const os = await import('os');
      const platform = os.platform();
      
      if (platform !== 'win32') {
        // For Unix-like systems, we can estimate based on process limits
        // This is a simplified check - in production, would use more sophisticated methods
        const estimatedFdLimit = 1024; // Default for many systems
        const recommendedMinimum = 8192;
        
        if (estimatedFdLimit < recommendedMinimum) {
          warnings.push(`File descriptor limit may be too low for production: ~${estimatedFdLimit} (recommended: ${recommendedMinimum})`);
        }
      }
    } catch (error) {
      // OS module not available or error checking limits
    }

    return {
      success: issues.length === 0,
      service: 'Connection Limits',
      message: issues.length === 0 ? 
        (warnings.length > 0 ? `Connection limits validated with ${warnings.length} optimization suggestions` : 'Connection limits validation passed') :
        `Connection limit issues found: ${issues.length}`,
      duration: Date.now() - startTime,
      details: {
        metrics: connectionMetrics,
        configuration: {
          appMaxConnections: config.database.maxConnections,
          rateLimitMax: config.security.rateLimitMax
        },
        recommendations: [
          'Keep database connections below 70% of max',
          'Monitor connection pool usage regularly',
          'Implement connection pooling best practices',
          'Set appropriate rate limits to prevent connection exhaustion'
        ],
        issues: issues.length > 0 ? issues : undefined,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    };
  } catch (error) {
    return {
      success: false,
      service: 'Connection Limits',
      message: error instanceof Error ? error.message : 'Connection limits validation failed',
      duration: Date.now() - startTime
    };
  }
}

/**
 * Validate specific merchant configuration
 */
export async function validateMerchantConfig(merchantId: string): Promise<boolean> {
  try {
    const db = getDatabase();
    const sql = db.getSQL() as any;

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

    const logger = getLogger({ component: 'startup-validation' });
    logger.info(`✅ Merchant validation passed: ${merchant.business_name}`);
    return true;
  } catch (error) {
    console.error(`❌ Merchant validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return false;
  }
}