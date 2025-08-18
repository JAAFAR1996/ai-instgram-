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
}

export interface AppConfig {
  database: DatabaseConfig;
  ai: AIConfig;
  instagram: InstagramConfig;
  security: SecurityConfig;
  environment: 'development' | 'production' | 'test';
  port: number;
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
    if (env.REDIRECT_URI && !env.REDIRECT_URI.includes('yourdomain.com')) {
      console.warn('⚠️ REDIRECT_URI should use your production domain in production');
    }
    
    if (env.CORS_ORIGINS === '*') {
      errors.push('CORS_ORIGINS should not be "*" in production');
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
    
    database: parseDatabaseConfig(env.DATABASE_URL!),
    
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
    
    security: {
      encryptionKey: env.ENCRYPTION_KEY!,
      jwtSecret: env.JWT_SECRET || env.ENCRYPTION_KEY!,
      corsOrigins: env.CORS_ORIGINS ? env.CORS_ORIGINS.split(',') : ['*'],
      rateLimitWindow: parseInt(env.RATE_LIMIT_WINDOW || '900000'), // 15 minutes
      rateLimitMax: parseInt(env.RATE_LIMIT_MAX || '100')
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
 * Validate configuration at runtime
 */
export function validateRuntimeConfig(config: AppConfig): void {
  const errors: string[] = [];
  
  // Runtime validations
  if (config.ai.maxTokens > 4000) {
    errors.push('AI max_tokens should not exceed 4000 for cost control');
  }
  
  if (config.ai.temperature < 0 || config.ai.temperature > 2) {
    errors.push('AI temperature must be between 0 and 2');
  }
  
  if (config.database.maxConnections > 100) {
    console.warn('⚠️ Database max connections is very high, consider connection pooling');
  }
  
  if (config.environment === 'production' && config.security.corsOrigins.includes('*')) {
    errors.push('CORS should not allow all origins in production');
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