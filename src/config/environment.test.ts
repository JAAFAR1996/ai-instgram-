/**
 * ===============================================
 * Environment Configuration Tests
 * اختبارات شاملة لتكوين متغيرات البيئة
 * ===============================================
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadAndValidateEnvironment,
  getEnvVar,
  getConfig,
  resetConfig,
  type AppConfig
} from './index.js';
import { validateRuntimeConfig, EnvironmentValidationError } from './validators.js';

describe('Environment Configuration - تكوين متغيرات البيئة', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    
    // Clear and reset configuration
    resetConfig();
    
    // Set up valid test environment
    process.env = {
      ...originalEnv,
      // Database
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/testdb',
      
      // Instagram/Meta
      IG_APP_ID: '1234567890123',
      IG_APP_SECRET: 'test_app_secret_at_least_20_chars',
      META_APP_SECRET: 'test_meta_secret_at_least_20_chars',
      IG_VERIFY_TOKEN: 'test_verify_token_123',
      REDIRECT_URI: 'https://example.com/auth/instagram/callback',
      GRAPH_API_VERSION: 'v23.0',
      
      // AI/OpenAI
      OPENAI_API_KEY: 'sk-test_key_with_proper_length_123456',
      OPENAI_MODEL: 'gpt-4o-mini',
      OPENAI_MAX_TOKENS: '500',
      OPENAI_TEMPERATURE: '0.7',
      
      // Security
      ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      JWT_SECRET: 'test_jwt_secret_with_sufficient_length_for_security',
      CORS_ORIGINS: 'https://example.com,https://app.example.com',
      INTERNAL_API_KEY: 'test_internal_api_key_123',
      BASE_URL: 'https://api.example.com',
      
      // Redis
      REDIS_URL: 'redis://localhost:6379',
      
      // Optional
      NODE_ENV: 'test',
      PORT: '3000',
      RATE_LIMIT_WINDOW: '900000',
      RATE_LIMIT_MAX: '100',
      DB_MAX_CONNECTIONS: '20'
    };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    resetConfig();
  });

  describe('Environment Variable Validation - التحقق من متغيرات البيئة', () => {
    test('should validate all required environment variables successfully', () => {
      expect(() => loadAndValidateEnvironment()).not.toThrow();
      
      const config = loadAndValidateEnvironment();
      expect(config).toBeDefined();
      expect(config.environment).toBe('test');
      expect(config.database.url).toBe('postgresql://user:pass@localhost:5432/testdb');
      expect(config.instagram.appId).toBe('1234567890123');
    });

    test('should throw error for missing required DATABASE_URL', () => {
      delete process.env.DATABASE_URL;
      
      expect(() => loadAndValidateEnvironment()).toThrow(EnvironmentValidationError);
      expect(() => loadAndValidateEnvironment()).toThrow(/Missing required environment variable: DATABASE_URL/);
    });

    test('should throw error for invalid DATABASE_URL format', () => {
      process.env.DATABASE_URL = 'invalid-url';
      
      expect(() => loadAndValidateEnvironment()).toThrow(EnvironmentValidationError);
      expect(() => loadAndValidateEnvironment()).toThrow(/DATABASE_URL must be a valid PostgreSQL connection string/);
    });

    test('should validate Instagram App ID format', () => {
      // Too short
      process.env.IG_APP_ID = '123';
      expect(() => loadAndValidateEnvironment()).toThrow(/IG_APP_ID must be a numeric string with at least 10 digits/);
      
      // Non-numeric
      process.env.IG_APP_ID = 'abc1234567890';
      expect(() => loadAndValidateEnvironment()).toThrow(/IG_APP_ID must be a numeric string with at least 10 digits/);
      
      // Valid
      process.env.IG_APP_ID = '1234567890123';
      expect(() => loadAndValidateEnvironment()).not.toThrow();
    });

    test('should validate Instagram App Secret length', () => {
      process.env.IG_APP_SECRET = 'short';
      expect(() => loadAndValidateEnvironment()).toThrow(/IG_APP_SECRET must be at least 20 characters long/);
      
      process.env.IG_APP_SECRET = 'long_enough_secret_123456';
      expect(() => loadAndValidateEnvironment()).not.toThrow();
    });

    test('should validate OpenAI API key format', () => {
      // Wrong prefix
      process.env.OPENAI_API_KEY = 'invalid-key-format';
      expect(() => loadAndValidateEnvironment()).toThrow(/OPENAI_API_KEY must start with "sk-"/);
      
      // Too short
      process.env.OPENAI_API_KEY = 'sk-short';
      expect(() => loadAndValidateEnvironment()).toThrow(/OPENAI_API_KEY must start with "sk-"/);
      
      // Valid
      process.env.OPENAI_API_KEY = 'sk-valid_key_with_proper_length_12345';
      expect(() => loadAndValidateEnvironment()).not.toThrow();
    });

    test('should validate encryption key format', () => {
      // Too short
      process.env.ENCRYPTION_KEY = 'short_key';
      expect(() => loadAndValidateEnvironment()).toThrow(/ENCRYPTION_KEY must be 32 bytes/);
      
      // Valid hex format
      process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      expect(() => loadAndValidateEnvironment()).not.toThrow();
      
      // Valid 32-char ASCII
      process.env.ENCRYPTION_KEY = '12345678901234567890123456789012';
      expect(() => loadAndValidateEnvironment()).not.toThrow();
    });

    test('should validate CORS origins format', () => {
      process.env.CORS_ORIGINS = '';
      expect(() => loadAndValidateEnvironment()).toThrow(/Missing required environment variable: CORS_ORIGINS/);
      
      process.env.CORS_ORIGINS = 'https://example.com,https://app.example.com';
      expect(() => loadAndValidateEnvironment()).not.toThrow();
    });

    test('should validate redirect URI format', () => {
      // HTTP instead of HTTPS
      process.env.REDIRECT_URI = 'http://example.com/auth/instagram/callback';
      expect(() => loadAndValidateEnvironment()).toThrow(/REDIRECT_URI must be a valid HTTPS URL/);
      
      // Missing callback path
      process.env.REDIRECT_URI = 'https://example.com/auth/other';
      expect(() => loadAndValidateEnvironment()).toThrow(/REDIRECT_URI must be a valid HTTPS URL/);
      
      // Valid
      process.env.REDIRECT_URI = 'https://example.com/auth/instagram/callback';
      expect(() => loadAndValidateEnvironment()).not.toThrow();
    });

    test('should validate Redis URL format', () => {
      process.env.REDIS_URL = 'invalid-redis-url';
      expect(() => loadAndValidateEnvironment()).toThrow(/REDIS_URL must be a valid Redis connection string/);
      
      process.env.REDIS_URL = 'redis://localhost:6379';
      expect(() => loadAndValidateEnvironment()).not.toThrow();
      
      process.env.REDIS_URL = 'rediss://secure-redis:6380';
      expect(() => loadAndValidateEnvironment()).not.toThrow();
    });

    test('should use default values for optional variables', () => {
      delete process.env.NODE_ENV;
      delete process.env.GRAPH_API_VERSION;
      
      const config = loadAndValidateEnvironment();
      
      expect(config.environment).toBe('development');
      expect(config.instagram.apiVersion).toBe('v23.0');
    });

    test('should validate NODE_ENV values', () => {
      process.env.NODE_ENV = 'invalid_env';
      expect(() => loadAndValidateEnvironment()).toThrow(/NODE_ENV must be development, production, or test/);
      
      process.env.NODE_ENV = 'production';
      expect(() => loadAndValidateEnvironment()).not.toThrow();
    });

    test('should validate Graph API version format', () => {
      process.env.GRAPH_API_VERSION = 'invalid_version';
      expect(() => loadAndValidateEnvironment()).toThrow(/GRAPH_API_VERSION must be in format v\{major\}.\{minor\}/);
      
      process.env.GRAPH_API_VERSION = 'v23.0';
      expect(() => loadAndValidateEnvironment()).not.toThrow();
    });
  });

  describe('Production Environment Validation - التحقق من بيئة الإنتاج', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    test('should warn about development redirect URI in production', () => {
      const consoleSpy = vi.spyOn(console, 'warn');
      process.env.REDIRECT_URI = 'https://localhost:3000/auth/instagram/callback';
      
      loadAndValidateEnvironment();
      
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('REDIRECT_URI should match BASE_URL'));
      consoleSpy.mockRestore();
    });

    test('should reject wildcard CORS in production', () => {
      process.env.CORS_ORIGINS = '*';
      
      expect(() => loadAndValidateEnvironment()).toThrow(/CORS_ORIGINS should not be "\*" in production/);
    });

    test('should allow proper production configuration', () => {
      process.env.CORS_ORIGINS = 'https://myapp.com,https://api.myapp.com';
      process.env.REDIRECT_URI = 'https://myapp.com/auth/instagram/callback';
      
      expect(() => loadAndValidateEnvironment()).not.toThrow();
    });
  });

  describe('Database Configuration Parsing - تحليل تكوين قاعدة البيانات', () => {
    test('should parse PostgreSQL URL correctly', () => {
      process.env.DATABASE_URL = 'postgresql://user:password@db.example.com:5432/mydb?sslmode=require';
      
      const config = loadAndValidateEnvironment();
      
      expect(config.database.url).toBe('postgresql://user:password@db.example.com:5432/mydb?sslmode=require');
      expect(config.database.ssl).toBe(true);
    });

    test('should disable SSL when sslmode=disable', () => {
      process.env.DATABASE_URL = 'postgresql://user:password@localhost:5432/testdb?sslmode=disable';
      
      const config = loadAndValidateEnvironment();
      
      expect(config.database.ssl).toBe(false);
    });

    test('should enable SSL by default for Render compatibility', () => {
      process.env.DATABASE_URL = 'postgresql://user:password@localhost:5432/testdb';
      
      const config = loadAndValidateEnvironment();
      
      expect(config.database.ssl).toBe(true);
    });

    test('should handle database max connections', () => {
      process.env.DB_MAX_CONNECTIONS = '50';
      
      const config = loadAndValidateEnvironment();
      
      expect(config.database.maxConnections).toBe(50);
    });

    test('should throw error for invalid database URL', () => {
      process.env.DATABASE_URL = 'not-a-valid-url';
      
      expect(() => loadAndValidateEnvironment()).toThrow(/DATABASE_URL must be a valid PostgreSQL connection string/);
    });
  });

  describe('Runtime Configuration Validation - التحقق من التكوين أثناء التشغيل', () => {
    test('should validate AI configuration limits', () => {
      const config = loadAndValidateEnvironment();
      
      // Test max tokens limit
      config.ai.maxTokens = 5000;
      expect(() => validateRuntimeConfig(config)).toThrow(/AI max_tokens should not exceed 4000/);
      
      // Test temperature range
      config.ai.maxTokens = 500; // Reset
      config.ai.temperature = -1;
      expect(() => validateRuntimeConfig(config)).toThrow(/AI temperature must be between 0 and 2/);
      
      config.ai.temperature = 3;
      expect(() => validateRuntimeConfig(config)).toThrow(/AI temperature must be between 0 and 2/);
      
      // Valid configuration
      config.ai.temperature = 0.7;
      expect(() => validateRuntimeConfig(config)).not.toThrow();
    });

    test('should warn about high database connections', () => {
      const consoleSpy = vi.spyOn(console, 'warn');
      const config = loadAndValidateEnvironment();
      config.database.maxConnections = 150;
      
      validateRuntimeConfig(config);
      
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Database max connections is very high'));
      consoleSpy.mockRestore();
    });

    test('should reject wildcard CORS in production runtime', () => {
      const config = loadAndValidateEnvironment();
      config.environment = 'production';
      config.security.corsOrigins = ['*'];
      
      expect(() => validateRuntimeConfig(config)).toThrow(/CORS should not allow all origins in production/);
    });

    test('should pass valid runtime configuration', () => {
      const config = loadAndValidateEnvironment();
      
      expect(() => validateRuntimeConfig(config)).not.toThrow();
    });
  });

  describe('Environment Variable Utilities - أدوات متغيرات البيئة', () => {
    test('should get environment variable successfully', () => {
      process.env.TEST_VAR = 'test_value';
      
      const value = getEnvVar('TEST_VAR');
      
      expect(value).toBe('test_value');
    });

    test('should use default value when variable not set', () => {
      delete process.env.TEST_VAR;
      
      const value = getEnvVar('TEST_VAR', 'default_value');
      
      expect(value).toBe('default_value');
    });

    test('should throw error for missing required variable', () => {
      delete process.env.TEST_VAR;
      
      expect(() => getEnvVar('TEST_VAR')).toThrow(/Required environment variable TEST_VAR is not set/);
    });

    test('should return actual value over default when set', () => {
      process.env.TEST_VAR = 'actual_value';
      
      const value = getEnvVar('TEST_VAR', 'default_value');
      
      expect(value).toBe('actual_value');
    });
  });

  describe('Configuration Singleton - نمط الكائن الواحد للتكوين', () => {
    test('should return same configuration instance', () => {
      const config1 = getConfig();
      const config2 = getConfig();
      
      expect(config1).toBe(config2);
    });

    test('should reload configuration after reset', () => {
      const config1 = getConfig();
      resetConfig();
      
      process.env.PORT = '4000';
      const config2 = getConfig();
      
      expect(config1).not.toBe(config2);
      expect(config2.port).toBe(4000);
    });

    test('should validate configuration on first load', () => {
      resetConfig();
      process.env.OPENAI_API_KEY = 'invalid-key';
      
      expect(() => getConfig()).toThrow(EnvironmentValidationError);
    });
  });

  describe('Complex Configuration Scenarios - سيناريوهات التكوين المعقدة', () => {
    test('should handle multiple validation errors', () => {
      delete process.env.DATABASE_URL;
      delete process.env.OPENAI_API_KEY;
      process.env.IG_APP_ID = 'invalid';
      
      let error: EnvironmentValidationError | null = null;
      try {
        loadAndValidateEnvironment();
      } catch (e) {
        error = e as EnvironmentValidationError;
      }
      
      expect(error).toBeInstanceOf(EnvironmentValidationError);
      expect(error!.errors).toHaveLength(3);
      expect(error!.message).toContain('Missing required environment variable: DATABASE_URL');
      expect(error!.message).toContain('Missing required environment variable: OPENAI_API_KEY');
      expect(error!.message).toContain('IG_APP_ID must be a numeric string');
    });

    test('should handle complete valid production configuration', () => {
      process.env.NODE_ENV = 'production';
      process.env.CORS_ORIGINS = 'https://myapp.com,https://api.myapp.com';
      process.env.REDIRECT_URI = 'https://myapp.com/auth/instagram/callback';
      process.env.BASE_URL = 'https://api.myapp.com';
      process.env.REDIS_URL = 'rediss://redis.myapp.com:6380';
      
      const config = loadAndValidateEnvironment();
      validateRuntimeConfig(config);
      
      expect(config.environment).toBe('production');
      expect(config.security.corsOrigins).toEqual(['https://myapp.com', 'https://api.myapp.com']);
      expect(config.baseUrl).toBe('https://api.myapp.com');
    });

    test('should handle all optional parameters with defaults', () => {
      // Remove all optional environment variables
      delete process.env.NODE_ENV;
      delete process.env.GRAPH_API_VERSION;
      delete process.env.PORT;
      delete process.env.OPENAI_MODEL;
      delete process.env.OPENAI_MAX_TOKENS;
      delete process.env.OPENAI_TEMPERATURE;
      delete process.env.RATE_LIMIT_WINDOW;
      delete process.env.RATE_LIMIT_MAX;
      delete process.env.DB_MAX_CONNECTIONS;
      
      const config = loadAndValidateEnvironment();
      
      expect(config.environment).toBe('development');
      expect(config.port).toBe(10000);
      expect(config.ai.model).toBe('gpt-4o-mini');
      expect(config.ai.maxTokens).toBe(500);
      expect(config.ai.temperature).toBe(0.7);
      expect(config.security.rateLimitWindow).toBe(900000);
      expect(config.security.rateLimitMax).toBe(100);
      expect(config.database.maxConnections).toBe(20);
    });

    test('should parse numeric environment variables correctly', () => {
      process.env.PORT = '8080';
      process.env.OPENAI_MAX_TOKENS = '1000';
      process.env.OPENAI_TEMPERATURE = '0.9';
      process.env.RATE_LIMIT_MAX = '200';
      process.env.DB_MAX_CONNECTIONS = '50';
      
      const config = loadAndValidateEnvironment();
      
      expect(config.port).toBe(8080);
      expect(config.ai.maxTokens).toBe(1000);
      expect(config.ai.temperature).toBe(0.9);
      expect(config.security.rateLimitMax).toBe(200);
      expect(config.database.maxConnections).toBe(50);
    });
  });

  describe('Edge Cases and Error Handling - الحالات الحدية والتعامل مع الأخطاء', () => {
    test('should handle empty string environment variables', () => {
      process.env.IG_APP_SECRET = '';
      
      expect(() => loadAndValidateEnvironment()).toThrow(/Missing required environment variable: IG_APP_SECRET/);
    });

    test('should handle whitespace in CORS origins', () => {
      process.env.CORS_ORIGINS = ' https://example.com , https://app.example.com ';
      
      const config = loadAndValidateEnvironment();
      
      expect(config.security.corsOrigins).toEqual(['https://example.com', 'https://app.example.com']);
    });

    test('should handle empty trusted redirect domains', () => {
      delete process.env.TRUSTED_REDIRECT_DOMAINS;
      
      const config = loadAndValidateEnvironment();
      
      expect(config.security.trustedRedirectDomains).toEqual([]);
    });

    test('should handle malformed numeric values gracefully', () => {
      process.env.PORT = 'not-a-number';
      
      const config = loadAndValidateEnvironment();
      
      expect(config.port).toBeNaN();
    });

    test('should trim meta app secret whitespace', () => {
      process.env.META_APP_SECRET = '  secret_with_whitespace  ';
      
      const config = loadAndValidateEnvironment();
      
      expect(config.instagram.metaAppSecret).toBe('secret_with_whitespace');
    });
  });

  describe('Integration with Real Environment - التكامل مع البيئة الحقيقية', () => {
    test('should work with actual environment structure', () => {
      // Simulate real .env file structure
      const realEnvStructure = {
        NODE_ENV: 'development',
        PORT: '3000',
        DATABASE_URL: 'postgresql://testuser:testpass@localhost:5432/sales_platform_test',
        IG_APP_ID: '1234567890123456',
        IG_APP_SECRET: 'real_app_secret_with_proper_length_abcdef',
        META_APP_SECRET: 'real_meta_secret_with_proper_length_123456',
        IG_VERIFY_TOKEN: 'verify_token_for_webhooks_123',
        REDIRECT_URI: 'https://localhost:3000/auth/instagram/callback',
        GRAPH_API_VERSION: 'v23.0',
        OPENAI_API_KEY: 'sk-test1234567890abcdef1234567890abcdef',
        OPENAI_MODEL: 'gpt-4o-mini',
        OPENAI_MAX_TOKENS: '750',
        OPENAI_TEMPERATURE: '0.8',
        ENCRYPTION_KEY: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456',
        JWT_SECRET: 'jwt_secret_for_development_environment_with_proper_length',
        CORS_ORIGINS: 'http://localhost:3000,http://localhost:5173',
        INTERNAL_API_KEY: 'internal_dev_api_key_123',
        BASE_URL: 'http://localhost:3000',
        REDIS_URL: 'redis://localhost:6379',
        RATE_LIMIT_WINDOW: '900000',
        RATE_LIMIT_MAX: '100',
        DB_MAX_CONNECTIONS: '10'
      };
      
      // Apply real environment
      Object.assign(process.env, realEnvStructure);
      
      const config = loadAndValidateEnvironment();
      validateRuntimeConfig(config);
      
      expect(config.environment).toBe('development');
      expect(config.database.url).toContain('sales_platform_test');
      expect(config.ai.model).toBe('gpt-4o-mini');
      expect(config.instagram.apiVersion).toBe('v23.0');
      expect(config.security.corsOrigins).toHaveLength(2);
    });
  });
});