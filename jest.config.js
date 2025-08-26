/**
 * Jest Configuration - AI Sales Platform
 * 🔧 Stage 5: DevOps - Automated testing configuration
 */

module.exports = {
  // Test environment
  testEnvironment: 'node',
  
  // Test file patterns
  testMatch: [
    '**/__tests__/**/*.test.{js,ts}',
    '**/*.test.{js,ts}',
    '**/*.spec.{js,ts}'
  ],
  
  // Files to ignore
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/',
    '/.git/'
  ],
  
  // TypeScript support
  preset: 'ts-jest',
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      useESM: true,
      tsconfig: {
        module: 'ES2022',
        target: 'ES2022'
      }
    }
  },
  
  // Module name mapping for ES modules
  moduleNameMapping: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  
  // Coverage configuration
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: [
    'text',
    'text-summary',
    'lcov',
    'html',
    'json'
  ],
  
  // Coverage collection patterns
  collectCoverageFrom: [
    'src/**/*.{js,ts}',
    '!src/**/*.d.ts',
    '!src/**/*.test.{js,ts}',
    '!src/**/*.spec.{js,ts}',
    '!src/tests/**/*',
    '!src/types/**/*',
    '!src/config/**/*',
    '!**/node_modules/**'
  ],
  
  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 75,
      lines: 80,
      statements: 80
    },
    // Critical modules need higher coverage
    './src/services/': {
      branches: 80,
      functions: 85,
      lines: 90,
      statements: 90
    },
    './src/db/': {
      branches: 85,
      functions: 90,
      lines: 95,
      statements: 95
    }
  },
  
  // Test timeout
  testTimeout: 30000, // 30 seconds for integration tests
  
  // Verbose output
  verbose: true,
  
  // Transform configuration
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true
    }]
  },
  
  // Module file extensions
  moduleFileExtensions: [
    'ts',
    'js',
    'json',
    'node'
  ],
  
  // Clear mocks between tests
  clearMocks: true,
  
  // Restore mocks after each test
  restoreMocks: true,
  
  // Global test configuration
  globals: {
    'ts-jest': {
      useESM: true,
      isolatedModules: true
    }
  },
  
  // Maximum worker processes
  maxWorkers: '50%',
  
  // Bail on first test failure in CI
  bail: process.env.CI ? 1 : false,
  
  // Test results reporting
  reporters: [
    'default',
    // JUnit reporter for CI/CD
    process.env.CI && [
      'jest-junit',
      {
        outputDirectory: './test-results',
        outputName: 'junit.xml',
        suiteName: 'AI Sales Platform Tests'
      }
    ]
  ].filter(Boolean)
};