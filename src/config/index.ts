/**
 * ===============================================
 * Centralized Configuration Management
 * إدارة التكوين المركزي - process.env فقط هنا
 * ===============================================
 */

import type { AppConfig, DatabaseConfig, EnvMode, LogLevel } from './types.js';
import { EnvironmentValidationError } from './types.js';
import { REQUIRED_ENV_VARS, validateRuntimeConfig } from './validators.js';

// ✅ BREAKING CIRCULAR DEPENDENCY - Use console instead of logger
// Cannot import logger here as it creates circular dependency with logger importing getConfig

/**
 * Validate and load environment configuration
 * @throws {EnvironmentValidationError} If validation fails
 */
// ✅ RENDER-OPTIMIZED Safe console logging for config validation
const configConsole = {
  info: (message: string) => {
    const isRender = process.env.IS_RENDER === 'true' || process.env.RENDER === 'true';
    const env = process.env.NODE_ENV || 'development';
    
    if (env === 'production' || isRender) {
      console.log(JSON.stringify({
        level: 'info',
        message,
        context: { component: 'config-validation' },
        metadata: { environment: env, pid: process.pid }
      }));
    } else {
      console.log(`INFO Config: ${message}`);
    }
  }
};

export function loadAndValidateEnvironment(): AppConfig {
  configConsole.info('🔍 Validating environment configuration...');
  
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
        configConsole.info(`⚙️ Using default value for ${varName}: ${config.default}`);
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

    // Strict HTTPS validation for production URLs
    const urlFields = [
      { key: 'BASE_URL', value: env.BASE_URL, name: 'Base URL' },
      { key: 'REDIRECT_URI', value: env.REDIRECT_URI, name: 'Redirect URI' }
    ];

    for (const field of urlFields) {
      if (field.value) {
        try {
          const url = new URL(field.value);
          if (url.protocol !== 'https:') {
            errors.push(`${field.name} (${field.key}) must use HTTPS protocol in production`);
          }
        } catch (error) {
          errors.push(`${field.name} (${field.key}) must be a valid URL in production`);
        }
      }
    }

    // Database and Redis URL validation (allow non-HTTPS for internal services)
    if (env.DATABASE_URL) {
      try {
        const url = new URL(env.DATABASE_URL);
        if (!url.protocol.startsWith('postgresql')) {
          errors.push(`Database URL (DATABASE_URL) must use PostgreSQL protocol in production`);
        }
      } catch (error) {
        errors.push(`Database URL (DATABASE_URL) must be a valid URL in production`);
      }
    }

    if (env.REDIS_URL) {
      try {
        const url = new URL(env.REDIS_URL);
        if (!url.protocol.startsWith('redis')) {
          errors.push(`Redis URL (REDIS_URL) must use Redis protocol in production`);
        }
      } catch (error) {
        errors.push(`Redis URL (REDIS_URL) must be a valid URL in production`);
      }
    }

    // Validate CORS origins use HTTPS
    if (env.CORS_ORIGINS && env.CORS_ORIGINS !== '*') {
      const corsOrigins = env.CORS_ORIGINS.split(',').map(o => o.trim());
      for (const origin of corsOrigins) {
        if (origin && origin !== '*') {
          try {
            const url = new URL(origin);
            if (url.protocol !== 'https:') {
              errors.push(`CORS origin "${origin}" must use HTTPS protocol in production`);
            }
          } catch (error) {
            errors.push(`CORS origin "${origin}" must be a valid URL in production`);
          }
        }
      }
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

  // FIXED: Validate PORT as number with Number.isFinite
  const port = Number(env.PORT ?? '10000');
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new EnvironmentValidationError(['PORT must be a valid number between 1-65535']);
  }

  // Parse and return configuration with proper numeric validation
  const maxTokens = Number(env.OPENAI_MAX_TOKENS || '500');
  const rateLimitWindow = Number(env.RATE_LIMIT_WINDOW || '900000');
  const rateLimitMax = Number(env.RATE_LIMIT_MAX || '100');
  
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    throw new EnvironmentValidationError(['OPENAI_MAX_TOKENS must be a positive number']);
  }
  if (!Number.isFinite(rateLimitWindow) || rateLimitWindow <= 0) {
    throw new EnvironmentValidationError(['RATE_LIMIT_WINDOW must be a positive number']);
  }
  if (!Number.isFinite(rateLimitMax) || rateLimitMax <= 0) {
    throw new EnvironmentValidationError(['RATE_LIMIT_MAX must be a positive number']);
  }

  const config: AppConfig = {
    environment: (env.NODE_ENV as EnvMode) || 'development',
    port,
    baseUrl: env.BASE_URL!,
    internalApiKey: env.INTERNAL_API_KEY!,
    logLevel: (env.LOG_LEVEL?.toLowerCase() as LogLevel) || 'info',
    
    // Optional business configuration
    ...(env.IG_PAGE_ID && { pageId: env.IG_PAGE_ID }),
    ...(env.MERCHANT_ID && { merchantId: env.MERCHANT_ID }),
    
    database: parseDatabaseConfig(getEnvVar('DATABASE_URL')),
    
    ai: {
      openaiApiKey: env.OPENAI_API_KEY!,
      model: env.OPENAI_MODEL || 'gpt-4o-mini',
      maxTokens,
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
      rateLimitWindow,
      rateLimitMax,
      trustedRedirectDomains: env.TRUSTED_REDIRECT_DOMAINS ? env.TRUSTED_REDIRECT_DOMAINS.split(',') : []
    },

    meta: {
      version: env.APP_VERSION || '1.0.0',
      environment: (env.NODE_ENV as 'development' | 'staging' | 'production') || 'development'
    }
  };

  configConsole.info('✅ Environment validation passed');
  configConsole.info(`🌍 Running in ${config.environment} mode`);
  
  return config;
}

/**
 * Parse database configuration from connection URL - SIMPLIFIED for Render
 */
function parseDatabaseConfig(databaseUrl: string): DatabaseConfig {
  try {
    const url = new URL(databaseUrl);
    
    // For production on Render, prefer SSL unless explicitly disabled
    let ssl = true;
    const sslmode = url.searchParams.get('sslmode');
    if (sslmode === 'disable') {
      ssl = false;
    }
    
    const maxConnections = Number(process.env.DB_MAX_CONNECTIONS || '20');
    if (!Number.isFinite(maxConnections) || maxConnections <= 0) {
      throw new Error('DB_MAX_CONNECTIONS must be a positive number');
    }
    
    return {
      url: databaseUrl,
      ssl,
      maxConnections
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new Error(`Invalid DATABASE_URL format: ${err.message}`);
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

// Re-export types for convenience
export type { AppConfig, DatabaseConfig, AIConfig, InstagramConfig, SecurityConfig, RedisConfig, EnvMode, LogLevel, EnvironmentValidationError } from './types.js';