/**
 * ===============================================
 * Startup Validation Tests
 * اختبارات شاملة للتحقق من صحة البدء
 * ===============================================
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'vitest';
import {
  runStartupValidation,
  validateMerchantConfig,
  type ValidationResult,
  type StartupValidationReport
} from './validation.js';

// Mock dependencies
const mockConfig = {
  environment: 'test',
  ai: {
    openaiApiKey: 'sk-test1234567890abcdef1234567890abcdef',
    model: 'gpt-4o-mini',
    maxTokens: 500,
    temperature: 0.7
  },
  database: {
    host: 'localhost',
    port: 5432,
    maxConnections: 20,
    ssl: true
  },
  security: {
    corsOrigins: ['https://example.com'],
    encryptionKey: '0123456789abcdef0123456789abcdef',
    rateLimitMax: 100
  }
};

const mockDatabaseHealth = {
  status: 'healthy',
  details: {
    response_time_ms: 15,
    active_connections: 5,
    database_size: '100MB'
  }
};

const mockDatabase = {
  connect: mock(() => Promise.resolve()),
  healthCheck: mock(() => Promise.resolve(mockDatabaseHealth)),
  getSQL: mock(() => mockSQL)
};

const mockSQL = mock((strings: TemplateStringsArray, ...values: any[]) => {
  const query = strings.join('?');
  
  // Mock table existence check
  if (query.includes('information_schema.tables')) {
    return Promise.resolve([
      { table_name: 'merchants' },
      { table_name: 'conversations' },
      { table_name: 'message_logs' },
      { table_name: 'merchant_credentials' },
      { table_name: 'audit_logs' }
    ]);
  }
  
  // Mock extension check
  if (query.includes('pg_extension')) {
    return Promise.resolve([
      { extname: 'uuid-ossp' }
    ]);
  }
  
  // Mock merchant validation
  if (query.includes('SELECT id, is_active, business_name FROM merchants')) {
    return Promise.resolve([{
      id: 'test-merchant-123',
      is_active: true,
      business_name: 'Test Business'
    }]);
  }
  
  return Promise.resolve([]);
});

// Mock modules
vi.mock('../config/environment.js', () => ({
  getConfig: mock(() => mockConfig),
  EnvironmentValidationError: class extends Error {
    constructor(errors: string[]) {
      super(`Environment validation failed: ${errors.join(', ')}`);
    }
  }
}));

vi.mock('../database/connection.js', () => ({
  getDatabase: mock(() => mockDatabase)
}));

vi.mock('../config/graph-api.js', () => ({
  GRAPH_API_BASE_URL: 'https://graph.facebook.com/v23.0'
}));

// Mock fetch for external service tests
const mockFetch = mock(() => Promise.resolve({
  ok: true,
  status: 200,
  json: () => Promise.resolve({ data: [] })
}));

global.fetch = mockFetch as any;

describe('Startup Validation - التحقق من صحة البدء', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let consoleSpy: any;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    
    // Set up valid test environment
    process.env = {
      ...originalEnv,
      META_APP_ID: '1234567890123',
      IG_APP_SECRET: 'test_app_secret_at_least_20_chars',
      GRAPH_API_VERSION: 'v23.0',
      ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/testdb',
      REDIS_URL: 'redis://localhost:6379',
      OPENAI_API_KEY: 'sk-test1234567890abcdef1234567890abcdef',
      IG_VERIFY_TOKEN: 'test_verify_token_123',
      REDIRECT_URI: 'https://example.com/auth/instagram/callback'
    };

    // Reset mocks
    mockDatabase.connect.mockClear();
    mockDatabase.healthCheck.mockClear();
    mockDatabase.getSQL.mockClear();
    mockSQL.mockClear();
    mockFetch.mockClear();

    // Spy on console methods
    consoleSpy = {
      log: spyOn(console, 'log').mockImplementation(() => {}),
      warn: spyOn(console, 'warn').mockImplementation(() => {}),
      error: spyOn(console, 'error').mockImplementation(() => {})
    };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    
    // Restore console methods
    consoleSpy.log.mockRestore();
    consoleSpy.warn.mockRestore();
    consoleSpy.error.mockRestore();
  });

  describe('Complete Startup Validation - التحقق الكامل من البدء', () => {
    test('should run all validation checks successfully', async () => {
      mockDatabase.healthCheck.mockResolvedValueOnce(mockDatabaseHealth);
      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({}) }) // OpenAI
        .mockResolvedValueOnce({ ok: false, status: 400 }); // Instagram (expected)

      const report = await runStartupValidation();

      expect(report.overallSuccess).toBe(true);
      expect(report.results).toHaveLength(5);
      expect(report.criticalErrors).toHaveLength(0);
      expect(report.totalDuration).toBeGreaterThan(0);

      // Verify all validation services were checked
      const services = report.results.map(r => r.service);
      expect(services).toContain('Environment Configuration');
      expect(services).toContain('Database Connection');
      expect(services).toContain('Database Schema');
      expect(services).toContain('External Services');
      expect(services).toContain('Security Configuration');
    });

    test('should detect critical errors and block startup', async () => {
      // Simulate missing environment variable
      delete process.env.OPENAI_API_KEY;

      const report = await runStartupValidation();

      expect(report.overallSuccess).toBe(false);
      expect(report.criticalErrors.length).toBeGreaterThan(0);
      expect(report.criticalErrors[0]).toContain('Missing required environment variables');
    });

    test('should handle database connection failures', async () => {
      mockDatabase.connect.mockRejectedValueOnce(new Error('Connection refused'));

      const report = await runStartupValidation();

      expect(report.overallSuccess).toBe(false);
      expect(report.criticalErrors).toContain('Connection refused');
    });

    test('should log detailed validation report', async () => {
      await runStartupValidation();

      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('STARTUP VALIDATION REPORT'));
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('✅'));
    });
  });

  describe('Environment Configuration Validation - التحقق من تكوين البيئة', () => {
    test('should validate all required environment variables', async () => {
      const report = await runStartupValidation();
      const envResult = report.results.find(r => r.service === 'Environment Configuration');

      expect(envResult?.success).toBe(true);
      expect(envResult?.message).toContain('successfully');
      expect(envResult?.details).toHaveProperty('environment');
      expect(envResult?.details).toHaveProperty('aiModel');
    });

    test('should detect missing required environment variables', async () => {
      delete process.env.DATABASE_URL;
      delete process.env.OPENAI_API_KEY;

      const report = await runStartupValidation();
      const envResult = report.results.find(r => r.service === 'Environment Configuration');

      expect(envResult?.success).toBe(false);
      expect(envResult?.message).toContain('Missing required environment variables');
      expect(envResult?.message).toContain('DATABASE_URL');
      expect(envResult?.message).toContain('OPENAI_API_KEY');
    });

    test('should detect placeholder values in production', async () => {
      process.env.NODE_ENV = 'production';
      process.env.IG_APP_SECRET = 'your_app_secret_here_test';

      const report = await runStartupValidation();
      const envResult = report.results.find(r => r.service === 'Environment Configuration');

      expect(envResult?.success).toBe(false);
      expect(envResult?.message).toContain('Placeholder values detected');
    });

    test('should validate AI configuration ranges', async () => {
      // Test through mock config modification
      const invalidConfig = {
        ...mockConfig,
        ai: {
          ...mockConfig.ai,
          maxTokens: 5000, // Too high
          temperature: -1  // Invalid range
        }
      };

      const mockGetConfig = mock(() => invalidConfig);
      vi.mock('../config/environment.js', () => ({
        getConfig: mockGetConfig,
        EnvironmentValidationError: class extends Error {}
      }));

      const report = await runStartupValidation();
      const envResult = report.results.find(r => r.service === 'Environment Configuration');

      expect(envResult?.success).toBe(false);
    });

    test('should validate database connection limits', async () => {
      const invalidConfig = {
        ...mockConfig,
        database: {
          ...mockConfig.database,
          maxConnections: 150 // Too high
        }
      };

      const mockGetConfig = mock(() => invalidConfig);
      vi.mock('../config/environment.js', () => ({
        getConfig: mockGetConfig,
        EnvironmentValidationError: class extends Error {}
      }));

      const report = await runStartupValidation();
      const envResult = report.results.find(r => r.service === 'Environment Configuration');

      expect(envResult?.success).toBe(false);
      expect(envResult?.message).toContain('max connections');
    });

    test('should validate security configuration', async () => {
      const invalidConfig = {
        ...mockConfig,
        security: {
          ...mockConfig.security,
          rateLimitMax: 0 // Invalid
        }
      };

      const mockGetConfig = mock(() => invalidConfig);
      vi.mock('../config/environment.js', () => ({
        getConfig: mockGetConfig,
        EnvironmentValidationError: class extends Error {}
      }));

      const report = await runStartupValidation();
      const envResult = report.results.find(r => r.service === 'Environment Configuration');

      expect(envResult?.success).toBe(false);
      expect(envResult?.message).toContain('Rate limit max');
    });
  });

  describe('Database Validation - التحقق من قاعدة البيانات', () => {
    test('should validate database connection successfully', async () => {
      mockDatabase.healthCheck.mockResolvedValueOnce(mockDatabaseHealth);

      const report = await runStartupValidation();
      const dbResult = report.results.find(r => r.service === 'Database Connection');

      expect(dbResult?.success).toBe(true);
      expect(dbResult?.details).toHaveProperty('status', 'healthy');
      expect(dbResult?.details).toHaveProperty('responseTime');
      expect(dbResult?.details).toHaveProperty('activeConnections');
    });

    test('should handle database connection failures', async () => {
      mockDatabase.connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const report = await runStartupValidation();
      const dbResult = report.results.find(r => r.service === 'Database Connection');

      expect(dbResult?.success).toBe(false);
      expect(dbResult?.message).toContain('ECONNREFUSED');
    });

    test('should detect unhealthy database status', async () => {
      mockDatabase.healthCheck.mockResolvedValueOnce({
        status: 'unhealthy',
        details: { error: 'High connection count' }
      });

      const report = await runStartupValidation();
      const dbResult = report.results.find(r => r.service === 'Database Connection');

      expect(dbResult?.success).toBe(false);
      expect(dbResult?.message).toContain('health check failed');
    });

    test('should validate database schema and required tables', async () => {
      const report = await runStartupValidation();
      const schemaResult = report.results.find(r => r.service === 'Database Schema');

      expect(schemaResult?.success).toBe(true);
      expect(schemaResult?.details).toHaveProperty('tablesFound', 5);
      expect(schemaResult?.details).toHaveProperty('requiredTables', 5);
    });

    test('should detect missing required tables', async () => {
      mockSQL.mockImplementation((strings: TemplateStringsArray) => {
        const query = strings.join('?');
        if (query.includes('information_schema.tables')) {
          return Promise.resolve([
            { table_name: 'merchants' },
            // Missing other required tables
          ]);
        }
        if (query.includes('pg_extension')) {
          return Promise.resolve([{ extname: 'uuid-ossp' }]);
        }
        return Promise.resolve([]);
      });

      const report = await runStartupValidation();
      const schemaResult = report.results.find(r => r.service === 'Database Schema');

      expect(schemaResult?.success).toBe(false);
      expect(schemaResult?.message).toContain('Missing required tables');
    });

    test('should check for required PostgreSQL extensions', async () => {
      mockSQL.mockImplementation((strings: TemplateStringsArray) => {
        const query = strings.join('?');
        if (query.includes('information_schema.tables')) {
          return Promise.resolve([
            { table_name: 'merchants' },
            { table_name: 'conversations' },
            { table_name: 'message_logs' },
            { table_name: 'merchant_credentials' },
            { table_name: 'audit_logs' }
          ]);
        }
        if (query.includes('pg_extension')) {
          return Promise.resolve([]); // No extensions
        }
        return Promise.resolve([]);
      });

      const report = await runStartupValidation();
      const schemaResult = report.results.find(r => r.service === 'Database Schema');

      expect(schemaResult?.success).toBe(true);
      expect(schemaResult?.details?.missingExtensions).toContain('uuid-ossp');
    });
  });

  describe('External Services Validation - التحقق من الخدمات الخارجية', () => {
    test('should validate OpenAI API connectivity', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({}) })
        .mockResolvedValueOnce({ ok: false, status: 400 });

      const report = await runStartupValidation();
      const servicesResult = report.results.find(r => r.service === 'External Services');

      expect(servicesResult?.success).toBe(true);
      expect(servicesResult?.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ service: 'OpenAI API', status: 'connected' })
        ])
      );
    });

    test('should handle OpenAI API authentication errors', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 401 })
        .mockResolvedValueOnce({ ok: false, status: 400 });

      const report = await runStartupValidation();
      const servicesResult = report.results.find(r => r.service === 'External Services');

      expect(servicesResult?.success).toBe(false);
      expect(servicesResult?.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ service: 'OpenAI API', status: 'error', message: 'HTTP 401' })
        ])
      );
    });

    test('should validate Instagram Graph API reachability', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, status: 200 })
        .mockResolvedValueOnce({ ok: false, status: 400 }); // Expected for Graph API

      const report = await runStartupValidation();
      const servicesResult = report.results.find(r => r.service === 'External Services');

      expect(servicesResult?.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ service: 'Instagram Graph API', status: 'reachable' })
        ])
      );
    });

    test('should handle network timeouts for external services', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockRejectedValueOnce(new Error('Network timeout'));

      const report = await runStartupValidation();
      const servicesResult = report.results.find(r => r.service === 'External Services');

      expect(servicesResult?.success).toBe(false);
      expect(servicesResult?.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ service: 'OpenAI API', status: 'error', message: 'Network timeout' })
        ])
      );
    });

    test('should handle fetch abortion due to timeout', async () => {
      mockFetch
        .mockRejectedValueOnce(new DOMException('Operation was aborted', 'AbortError'))
        .mockRejectedValueOnce(new DOMException('Operation was aborted', 'AbortError'));

      const report = await runStartupValidation();
      const servicesResult = report.results.find(r => r.service === 'External Services');

      expect(servicesResult?.success).toBe(false);
    });
  });

  describe('Security Configuration Validation - التحقق من تكوين الأمان', () => {
    test('should validate security configuration successfully', async () => {
      const report = await runStartupValidation();
      const securityResult = report.results.find(r => r.service === 'Security Configuration');

      expect(securityResult?.success).toBe(true);
      expect(securityResult?.details).toHaveProperty('environment', 'test');
      expect(securityResult?.details).toHaveProperty('sslEnabled', true);
    });

    test('should detect production security issues', async () => {
      const prodConfig = {
        ...mockConfig,
        environment: 'production',
        security: {
          ...mockConfig.security,
          corsOrigins: ['*'] // Security issue
        },
        database: {
          ...mockConfig.database,
          ssl: false // Security issue
        },
        ai: {
          ...mockConfig.ai,
          temperature: 1.5 // High for production
        }
      };

      const mockGetConfig = mock(() => prodConfig);
      vi.mock('../config/environment.js', () => ({
        getConfig: mockGetConfig,
        EnvironmentValidationError: class extends Error {}
      }));

      const report = await runStartupValidation();
      const securityResult = report.results.find(r => r.service === 'Security Configuration');

      expect(securityResult?.success).toBe(false);
      expect(securityResult?.details?.issues).toEqual(
        expect.arrayContaining([
          'CORS allows all origins in production',
          'Database SSL is disabled in production',
          'AI temperature is high for production (>1.0)'
        ])
      );
    });

    test('should validate encryption key length', async () => {
      const weakConfig = {
        ...mockConfig,
        security: {
          ...mockConfig.security,
          encryptionKey: 'short_key' // Too short
        }
      };

      const mockGetConfig = mock(() => weakConfig);
      vi.mock('../config/environment.js', () => ({
        getConfig: mockGetConfig,
        EnvironmentValidationError: class extends Error {}
      }));

      const report = await runStartupValidation();
      const securityResult = report.results.find(r => r.service === 'Security Configuration');

      expect(securityResult?.success).toBe(false);
      expect(securityResult?.details?.issues).toContain('Encryption key is too short (minimum 32 characters)');
    });

    test('should warn about high rate limits', async () => {
      const highRateLimitConfig = {
        ...mockConfig,
        security: {
          ...mockConfig.security,
          rateLimitMax: 2000 // Very high
        }
      };

      const mockGetConfig = mock(() => highRateLimitConfig);
      vi.mock('../config/environment.js', () => ({
        getConfig: mockGetConfig,
        EnvironmentValidationError: class extends Error {}
      }));

      const report = await runStartupValidation();
      const securityResult = report.results.find(r => r.service === 'Security Configuration');

      expect(securityResult?.success).toBe(false);
      expect(securityResult?.details?.issues).toContain('Rate limit is very high (>1000 requests)');
    });
  });

  describe('Merchant Configuration Validation - التحقق من تكوين التاجر', () => {
    test('should validate active merchant successfully', async () => {
      const isValid = await validateMerchantConfig('test-merchant-123');

      expect(isValid).toBe(true);
      expect(consoleSpy.log).toHaveBeenCalledWith(expect.stringContaining('Merchant validation passed'));
    });

    test('should reject non-existent merchant', async () => {
      mockSQL.mockResolvedValueOnce([]); // No merchant found

      const isValid = await validateMerchantConfig('non-existent-merchant');

      expect(isValid).toBe(false);
      expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining('Merchant not found'));
    });

    test('should reject inactive merchant', async () => {
      mockSQL.mockResolvedValueOnce([{
        id: 'inactive-merchant',
        is_active: false,
        business_name: 'Inactive Business'
      }]);

      const isValid = await validateMerchantConfig('inactive-merchant');

      expect(isValid).toBe(false);
      expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining('Merchant is inactive'));
    });

    test('should handle database errors during merchant validation', async () => {
      mockSQL.mockRejectedValueOnce(new Error('Database connection failed'));

      const isValid = await validateMerchantConfig('test-merchant');

      expect(isValid).toBe(false);
      expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining('Merchant validation failed'));
    });
  });

  describe('Validation Performance and Timing - الأداء والتوقيت', () => {
    test('should complete validation within reasonable time', async () => {
      const startTime = Date.now();
      const report = await runStartupValidation();
      const totalTime = Date.now() - startTime;

      expect(totalTime).toBeLessThan(10000); // Should complete within 10 seconds
      expect(report.totalDuration).toBeGreaterThan(0);
      expect(report.results.every(r => r.duration >= 0)).toBe(true);
    });

    test('should measure individual validation timings', async () => {
      const report = await runStartupValidation();

      report.results.forEach(result => {
        expect(result.duration).toBeGreaterThan(0);
        expect(result.duration).toBeLessThan(5000); // No single check should take more than 5 seconds
      });
    });

    test('should handle concurrent validations efficiently', async () => {
      const promises = Array.from({ length: 5 }, () => runStartupValidation());
      const reports = await Promise.all(promises);

      expect(reports).toHaveLength(5);
      reports.forEach(report => {
        expect(report.results).toHaveLength(5);
      });
    });
  });

  describe('Error Recovery and Resilience - استعادة الأخطاء والمرونة', () => {
    test('should continue validation even if non-critical services fail', async () => {
      // Make external services fail but keep critical ones working
      mockFetch
        .mockRejectedValueOnce(new Error('OpenAI unreachable'))
        .mockRejectedValueOnce(new Error('Instagram unreachable'));

      const report = await runStartupValidation();

      // Should still pass overall if only external services fail
      const externalServicesResult = report.results.find(r => r.service === 'External Services');
      expect(externalServicesResult?.success).toBe(false);

      // But other critical services should still pass
      const envResult = report.results.find(r => r.service === 'Environment Configuration');
      const dbResult = report.results.find(r => r.service === 'Database Connection');
      expect(envResult?.success).toBe(true);
      expect(dbResult?.success).toBe(true);
    });

    test('should provide detailed error information', async () => {
      delete process.env.OPENAI_API_KEY;
      mockDatabase.connect.mockRejectedValueOnce(new Error('Connection refused'));

      const report = await runStartupValidation();

      expect(report.overallSuccess).toBe(false);
      expect(report.criticalErrors.length).toBeGreaterThan(0);
      expect(report.criticalErrors.some(e => e.includes('OPENAI_API_KEY'))).toBe(true);
      expect(report.criticalErrors.some(e => e.includes('Connection refused'))).toBe(true);
    });

    test('should handle partial validation failures gracefully', async () => {
      // Simulate schema validation failure
      mockSQL.mockImplementation((strings: TemplateStringsArray) => {
        const query = strings.join('?');
        if (query.includes('information_schema.tables')) {
          throw new Error('Permission denied');
        }
        return Promise.resolve([]);
      });

      const report = await runStartupValidation();

      const schemaResult = report.results.find(r => r.service === 'Database Schema');
      expect(schemaResult?.success).toBe(false);
      expect(schemaResult?.message).toContain('Permission denied');
    });
  });
});