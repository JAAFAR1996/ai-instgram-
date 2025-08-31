/**
 * ===============================================
 * Configuration Type Definitions
 * تعريفات أنواع التكوين
 * ===============================================
 */

export interface DatabaseConfig {
  url: string;
  ssl: boolean;
  maxConnections: number;
}

export interface AIConfig {
  openaiApiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  timeout?: number;
  // Intent analysis configuration
  intentModel?: string;
  intentTemperature?: number;
  intentMaxTokens?: number;
  // Product recommendation configuration
  recommendationModel?: string;
  recommendationTemperature?: number;
  recommendationMaxTokens?: number;
  // Summary configuration
  summaryModel?: string;
  summaryTemperature?: number;
  summaryMaxTokens?: number;
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

export type EnvMode = 'development' | 'production' | 'test';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface AppConfig {
  database: DatabaseConfig;
  ai: AIConfig;
  instagram: InstagramConfig;
  security: SecurityConfig;
  redis: RedisConfig;
  environment: EnvMode;
  port: number;
  baseUrl: string;
  internalApiKey: string;
  logLevel: LogLevel;
  // Optional business configuration
  pageId?: string;
  merchantId?: string;
  meta: {
    version: string;
    environment: 'development' | 'staging' | 'production';
  };
}

/**
 * Environment variable validation rule
 */
export interface EnvVarRule {
  required: boolean;
  default?: string;
  validator?: (value: string) => boolean;
  error: string;
}

/**
 * Validation errors collected during environment check
 */
export class EnvironmentValidationError extends Error {
  constructor(public errors: string[]) {
    super(`Environment validation failed:\n${errors.map(e => `  • ${e}`).join('\n')}`);
    this.name = 'EnvironmentValidationError';
  }
}