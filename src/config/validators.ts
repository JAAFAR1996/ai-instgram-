/**
 * ===============================================
 * Environment Variable Validation Rules
 * قواعد التحقق من متغيرات البيئة
 * ===============================================
 */

import type { EnvVarRule, AppConfig } from './types.js';
import { EnvironmentValidationError } from './types.js';

/**
 * Required environment variables with validation rules
 */
export const REQUIRED_ENV_VARS: Record<string, EnvVarRule> = {
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
  },
  'LOG_LEVEL': {
    required: false,
    default: 'info',
    validator: (value: string) => ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(value.toLowerCase()),
    error: 'LOG_LEVEL must be one of: trace, debug, info, warn, error, fatal'
  },
  
  // Optional business configuration
  'IG_PAGE_ID': {
    required: false,
    validator: (value: string) => /^\d+$/.test(value),
    error: 'IG_PAGE_ID must be a numeric string'
  },
  'MERCHANT_ID': {
    required: false,
    validator: (value: string) => value.length >= 3,
    error: 'MERCHANT_ID must be at least 3 characters long'
  }
} as const;

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

  // Instagram configuration validation - FIXED: Use parseFloat for proper version comparison
  const currentVersion = parseFloat(config.instagram.apiVersion.replace('v', ''));
  const minVersion = parseFloat('18.0');
  if (currentVersion < minVersion) {
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