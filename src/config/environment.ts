/**
 * ===============================================
 * Environment Configuration & Validation
 * تحقق صارم من متغيرات البيئة المطلوبة
 * ===============================================
 */

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
  maxConnections: number;
}

export interface AIConfig {
  openaiApiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface InstagramConfig {
  appId: string;
  appSecret: string;
  metaAppSecret: string;
  verifyToken: string;
  redirectUri: string;
  apiVersion: string;
}

export interface SecurityConfig {
  encryptionKey: string;
  jwtSecret: string;
  corsOrigins: string[];
  rateLimitWindow: number;
  rateLimitMax: number;
  trustedRedirectDomains: string[];
}

export interface RedisConfig {
  url: string;
}

export interface AppConfig {
  database: DatabaseConfig;
  ai: AIConfig;
  instagram: InstagramConfig;
  security: SecurityConfig;
  redis: RedisConfig;
  environment: 'development' | 'production' | 'test';
  port: number;
  baseUrl: string;
  internalApiKey: string;
}

/**
 * Required environment variables with validation rules
 */
const REQUIRED_ENV_VARS = {
  // Database
  'DATABASE_URL': {
    required: true,
    validator: (value: string) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
    error: 'DATABASE_URL must be a valid PostgreSQL connection string'
  },
  
  // Instagram/Meta
  'IG_APP_ID': {
    required: true,
    validator: (value: string) => /^\d+$/.test(value) && value.length >= 10,
    error: 'IG_APP_ID must be a numeric string with at least 10 digits'
  },
  'IG_APP_SECRET': {
    required: true,
    validator: (value: string) => value.length >= 20,
    error: 'IG_APP_SECRET must be at least 20 characters long'
  },
  'META_APP_SECRET': {
    required: true,
    validator: (value: string) => value.length >= 20,
    error: 'META_APP_SECRET must be at least 20 characters long'
  },
  'IG_VERIFY_TOKEN': {
    required: true,
    validator: (value: string) => value.length >= 10,
    error: 'IG_VERIFY_TOKEN must be at least 10 characters long'
  },
  'REDIRECT_URI': {
    required: true,
    validator: (value: string) => value.startsWith('https://') && value.includes('/auth/instagram/callback'),
    error: 'REDIRECT_URI must be a valid HTTPS URL with /auth/instagram/callback path'
  },
  
  // AI/OpenAI
  'OPENAI_API_KEY': {
    required: true,
    validator: (value: string) => value.startsWith('sk-') && value.length > 20,
    error: 'OPENAI_API_KEY must start with "sk-" and be at least 20 characters'
  },
  
  // Security
  'ENCRYPTION_KEY': {
    required: true,
    validator: (value: string) => /^[0-9a-fA-F]{64}$/.test(value) || value.length === 32,
    error: 'ENCRYPTION_KEY must be 32 bytes (64 hex characters) or 32 ASCII characters'
  },
  'JWT_SECRET': {
    required: true,
    validator: (value: string) => value.length >= 32,
    error: 'JWT_SECRET must be at least 32 characters long'
  },
  'CORS_ORIGINS': {
    required: true,
    validator: (value: string) =>
      value.split(',').every(origin => origin.trim().length > 0),
    error: 'CORS_ORIGINS must be a comma-separated list of allowed origins'
  },
  'INTERNAL_API_KEY': {
    required: true,
    validator: (value: string) => value.length >= 16,
    error: 'INTERNAL_API_KEY must be at least 16 characters long'
  },
  'BASE_URL': {
    required: true,
    validator: (value: string) => value.startsWith('http://') || value.startsWith('https://'),
    error: 'BASE_URL must be a valid HTTP or HTTPS URL'
  },
  
  // Redis
  'REDIS_URL': {
    required: true,
    validator: (value: string) => value.startsWith('redis://') || value.startsWith('rediss://'),
    error: 'REDIS_URL must be a valid Redis connection string'
  },
  
  // Optional with defaults
  'NODE_ENV': {
    required: false,
    default: 'development',
    validator: (value: string) => ['development', 'production', 'test'].includes(value),
    error: 'NODE_ENV must be development, production, or test'
  },
  'GRAPH_API_VERSION': {
    required: false,
    default: 'v23.0',
    validator: (value: string) => /^v\d+\.\d+$/.test(value),
    error: 'GRAPH_API_VERSION must be in format v{major}.{minor} (v23.0 latest for 2025)'
  }
} as const;

/**
 * Validation errors collected during environment check
 */
export class EnvironmentValidationError extends Error {
  constructor(public errors: string[]) {
    super(`Environment validation failed:\n${errors.map(e => `  • ${e}`).join('\n')}`);
    this.name = 'EnvironmentValidationError';
  }
}

/**
 * Validate and load environment configuration
 * @throws {EnvironmentValidationError} If validation fails
 */
export function loadAndValidateEnvironment(): AppConfig {
  console.log('🔍 Validating environment configuration...');
  
  const errors: string[] = [];
  const env = process.env;

  // Validate required environment variables
  for (const [varName, config] of Object.entries(REQUIRED_ENV_VARS)) {
    const value = env[varName];
    
    if (!value) {
      if (config.required) {
        errors.push(`Missing required environment variable: ${varName}`);
      } else if (config.default) {
        // Set default value
        env[varName] = config.default;
        console.log(`⚙️ Using default value for ${varName}: ${config.default}`);
      }
      continue;
    }
    
    // Validate value format
    if (config.validator && !config.validator(value)) {
      errors.push(`${varName}: ${config.error}`);
    }
  }

  // Additional security validations
    if (env.NODE_ENV === 'production') {
      // Production-specific validations
      if (env.REDIRECT_URI && env.BASE_URL && !env.REDIRECT_URI.startsWith(env.BASE_URL)) {
        console.warn('⚠️ REDIRECT_URI should match BASE_URL in production');
      }

      if (env.CORS_ORIGINS === '*') {
        errors.push('CORS_ORIGINS should not be "*" in production');
      }

      // Production security requirements
      if (env.JWT_SECRET && env.JWT_SECRET.length < 32) {
        errors.push('JWT_SECRET must be at least 32 characters in production');
      }

      if (env.ENCRYPTION_KEY && env.ENCRYPTION_KEY.length < 32) {
        errors.push('ENCRYPTION_KEY must be at least 32 characters in production');
      }

      // Check for insecure defaults in production
      const insecureDefaults = [
        { key: 'JWT_SECRET', patterns: ['secret', 'default', 'changeme'] },
        { key: 'ENCRYPTION_KEY', patterns: ['key', 'default', 'changeme'] },
        { key: 'IG_VERIFY_TOKEN', patterns: ['token', 'verify', 'default'] }
      ];

      for (const check of insecureDefaults) {
        const value = env[check.key]?.toLowerCase() || '';
        if (check.patterns.some(pattern => value.includes(pattern))) {
          errors.push(`${check.key} appears to contain insecure default values in production`);
        }
      }
    }

  // Throw if validation failed
  if (errors.length > 0) {
    throw new EnvironmentValidationError(errors);
  }

  // Parse and return configuration
  const config: AppConfig = {
    environment: (env.NODE_ENV as any) || 'development',
    port: parseInt(env.PORT || '10000'),
    baseUrl: env.BASE_URL!,
    internalApiKey: env.INTERNAL_API_KEY!,
    
    database: parseDatabaseConfig(getEnvVar('DATABASE_URL')),
    
    ai: {
      openaiApiKey: env.OPENAI_API_KEY!,
      model: env.OPENAI_MODEL || 'gpt-4o-mini',
      maxTokens: parseInt(env.OPENAI_MAX_TOKENS || '500'),
      temperature: parseFloat(env.OPENAI_TEMPERATURE || '0.7')
    },
    
    instagram: {
      appId: env.IG_APP_ID!,
      appSecret: env.IG_APP_SECRET!,
      metaAppSecret: (env.META_APP_SECRET || '').trim(),
      verifyToken: env.IG_VERIFY_TOKEN!,
      redirectUri: env.REDIRECT_URI!,
      apiVersion: env.GRAPH_API_VERSION || 'v23.0'
    },

    redis: {
      url: getEnvVar('REDIS_URL'),
    },

    security: {
      encryptionKey: env.ENCRYPTION_KEY!,
      jwtSecret: env.JWT_SECRET!,
      corsOrigins: env.CORS_ORIGINS!.split(',').map(o => o.trim()),
      rateLimitWindow: parseInt(env.RATE_LIMIT_WINDOW || '900000'), // 15 minutes
      rateLimitMax: parseInt(env.RATE_LIMIT_MAX || '100'),
      trustedRedirectDomains: env.TRUSTED_REDIRECT_DOMAINS ? env.TRUSTED_REDIRECT_DOMAINS.split(',') : []
    }
  };

  console.log('✅ Environment validation passed');
  console.log(`🌍 Running in ${config.environment} mode`);
  
  return config;
}

/**
 * Parse database configuration from connection URL
 */
function parseDatabaseConfig(databaseUrl: string): DatabaseConfig {
  try {
    const url = new URL(databaseUrl);
    
    return {
      host: url.hostname,
      port: parseInt(url.port) || 5432,
      database: url.pathname.slice(1), // Remove leading slash
      username: url.username,
      password: url.password,
      ssl: url.searchParams.get('sslmode') !== 'disable',
      maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20')
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new Error(`Invalid DATABASE_URL format: ${err.message}`);
  }
}

/**
 * Validate configuration at runtime with enhanced checks
 */
export function validateRuntimeConfig(config: AppConfig): void {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // AI configuration validation
  if (config.ai.maxTokens > 4000) {
    errors.push('AI max_tokens should not exceed 4000 for cost control');
  }
  
  if (config.ai.temperature < 0 || config.ai.temperature > 2) {
    errors.push('AI temperature must be between 0 and 2');
  }

  if (config.environment === 'production' && config.ai.temperature > 1.0) {
    warnings.push('AI temperature > 1.0 may produce inconsistent results in production');
  }
  
  // Database configuration validation
  if (config.database.maxConnections > 100) {
    warnings.push('Database max connections is very high, consider connection pooling');
  }

  if (config.database.maxConnections < 5) {
    warnings.push('Database max connections is very low, may cause bottlenecks');
  }
  
  // Security configuration validation
  if (config.environment === 'production' && config.security.corsOrigins.includes('*')) {
    errors.push('CORS should not allow all origins in production');
  }

  if (config.security.rateLimitMax < 10) {
    warnings.push('Rate limit is very restrictive, may impact legitimate users');
  }

  if (config.security.rateLimitMax > 1000) {
    warnings.push('Rate limit is very permissive, may not prevent abuse');
  }

  // Instagram configuration validation
  if (config.instagram.apiVersion < 'v18.0') {
    warnings.push('Instagram API version is outdated, consider upgrading');
  }

  // SSL/TLS validation for production
  if (config.environment === 'production') {
    if (!config.baseUrl.startsWith('https://')) {
      errors.push('BASE_URL must use HTTPS in production');
    }

    if (!config.instagram.redirectUri.startsWith('https://')) {
      errors.push('REDIRECT_URI must use HTTPS in production');
    }

    if (!config.database.ssl) {
      warnings.push('Database SSL is disabled in production - security risk');
    }
  }

  // Log warnings
  if (warnings.length > 0) {
    console.warn('⚠️ Configuration warnings:');
    warnings.forEach(warning => console.warn(`  • ${warning}`));
  }
  
  if (errors.length > 0) {
    throw new EnvironmentValidationError(errors);
  }
}

/**
 * Get environment variable with validation
 */
export function getEnvVar(name: string, defaultValue?: string): string {
  const value = process.env[name];
  
  if (!value) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Required environment variable ${name} is not set`);
  }
  
  return value;
}

/**
 * Global configuration instance
 */
let globalConfig: AppConfig | null = null;

/**
 * Get application configuration (singleton)
 */
export function getConfig(): AppConfig {
  if (!globalConfig) {
    globalConfig = loadAndValidateEnvironment();
    validateRuntimeConfig(globalConfig);
  }
  return globalConfig;
}

/**
 * Reset configuration (for testing)
 */
export function resetConfig(): void {
  globalConfig = null;
}