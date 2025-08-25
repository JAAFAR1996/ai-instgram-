import { config } from 'dotenv'
import { vi } from 'vitest'

// Load test environment variables
config({ path: '.env.test' })

// Mock the config module to avoid environment validation errors
vi.mock('../src/config/index.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    database: {
      url: 'postgresql://test:test@localhost:5432/test_db',
      poolMin: 1,
      poolMax: 5,
      maxConnections: 20,
      ssl: false
    },
    redis: {
      url: 'redis://localhost:6379/1',
      password: ''
    },
    security: {
      jwtSecret: 'test-jwt-secret',
      encryptionKey: 'test-encryption-key-32-chars-long',
      corsOrigins: ['https://example.com'],
      trustedRedirectDomains: []
    },
    cors: {
      origins: ['http://localhost:3000']
    },
    api: {
      openai: {
        apiKey: 'test-openai-key',
        model: 'gpt-4o-mini',
        maxTokens: 500,
        temperature: 0.7
      },
      instagram: {
        appId: 'test-instagram-app-id',
        appSecret: 'test-instagram-app-secret',
        accessToken: 'test-instagram-access-token',
        apiVersion: 'v23.0',
        metaAppSecret: 'test-meta-app-secret',
        verifyToken: 'test-verify-token',
        redirectUri: 'https://example.com/auth/instagram/callback'
      },
      whatsapp: {
        phoneNumberId: 'test-whatsapp-phone-id',
        accessToken: 'test-whatsapp-access-token'
      }
    },
    monitoring: {
      sentryDsn: '',
      logLevel: 'error'
    },
    server: {
      port: 3001,
      host: 'localhost'
    },
    rateLimit: {
      windowMs: 900000,
      maxRequests: 100
    },
    queue: {
      redisUrl: 'redis://localhost:6379/2',
      prefix: 'test_queue'
    },
    environment: 'test',
    port: 3000
  }),
  resetConfig: vi.fn(),
  loadAndValidateEnvironment: vi.fn().mockReturnValue({
    database: {
      url: 'postgresql://test:test@localhost:5432/test_db',
      poolMin: 1,
      poolMax: 5,
      maxConnections: 20,
      ssl: false
    },
    redis: {
      url: 'redis://localhost:6379/1',
      password: ''
    },
    security: {
      jwtSecret: 'test-jwt-secret',
      encryptionKey: 'test-encryption-key-32-chars-long',
      corsOrigins: ['https://example.com'],
      trustedRedirectDomains: []
    },
    cors: {
      origins: ['http://localhost:3000']
    },
    api: {
      openai: {
        apiKey: 'test-openai-key',
        model: 'gpt-4o-mini',
        maxTokens: 500,
        temperature: 0.7
      },
      instagram: {
        appId: 'test-instagram-app-id',
        appSecret: 'test-instagram-app-secret',
        accessToken: 'test-instagram-access-token',
        apiVersion: 'v23.0',
        metaAppSecret: 'test-meta-app-secret',
        verifyToken: 'test-verify-token',
        redirectUri: 'https://example.com/auth/instagram/callback'
      },
      whatsapp: {
        phoneNumberId: 'test-whatsapp-phone-id',
        accessToken: 'test-whatsapp-access-token'
      }
    },
    monitoring: {
      sentryDsn: '',
      logLevel: 'error'
    },
    server: {
      port: 3001,
      host: 'localhost'
    },
    rateLimit: {
      windowMs: 900000,
      maxRequests: 100
    },
    queue: {
      redisUrl: 'redis://localhost:6379/2',
      prefix: 'test_queue'
    },
    environment: 'test',
    port: 3000
  }),
  getEnvVar: vi.fn().mockImplementation((key: string, defaultValue?: string) => {
    const envVars: Record<string, string> = {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test_db',
      IG_APP_ID: 'test-instagram-app-id',
      IG_APP_SECRET: 'test-instagram-app-secret',
      META_APP_SECRET: 'test-meta-app-secret',
      IG_VERIFY_TOKEN: 'test-verify-token',
      REDIRECT_URI: 'https://example.com/auth/instagram/callback',
      GRAPH_API_VERSION: 'v23.0',
      OPENAI_API_KEY: 'test-openai-key',
      OPENAI_MODEL: 'gpt-4o-mini',
      OPENAI_MAX_TOKENS: '500',
      OPENAI_TEMPERATURE: '0.7',
      ENCRYPTION_KEY: 'test-encryption-key-32-chars-long',
      JWT_SECRET: 'test-jwt-secret',
      CORS_ORIGINS: 'https://example.com',
      INTERNAL_API_KEY: 'test-internal-api-key',
      BASE_URL: 'https://api.example.com',
      REDIS_URL: 'redis://localhost:6379',
      NODE_ENV: 'test',
      PORT: '3000',
      RATE_LIMIT_WINDOW: '900000',
      RATE_LIMIT_MAX: '100',
      DB_MAX_CONNECTIONS: '20'
    }
    return envVars[key] || defaultValue || key
  })
}))

// Mock bun:test to use vitest instead
vi.mock('bun:test', () => ({
  describe: vi.fn(),
  test: vi.fn(),
  expect: vi.fn(),
  beforeAll: vi.fn(),
  afterAll: vi.fn(),
  beforeEach: vi.fn(),
  afterEach: vi.fn(),
  mock: vi.fn(),
  spyOn: vi.fn(),
  jest: vi.fn()
}))

// Mock external dependencies for testing
vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    on: vi.fn(),
    off: vi.fn()
  }))
}))

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn()
    }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    query: vi.fn().mockResolvedValue({ rows: [] })
  }))
}))

// Mock logger
vi.mock('../src/services/logger.js', () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn()
  }),
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn()
  })
}))

// Mock database
vi.mock('../src/db/index.js', () => ({
  getPool: vi.fn().mockReturnValue({
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn()
    }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    query: vi.fn().mockResolvedValue({ rows: [] })
  })
}))

vi.mock('../src/db/adapter.js', () => ({
  getDatabase: vi.fn().mockReturnValue({
    getSQL: vi.fn().mockReturnValue({
      query: vi.fn().mockResolvedValue({ rows: [] })
    }),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn()
    }),
    end: vi.fn().mockResolvedValue(undefined)
  })
}))

// Global test setup
beforeAll(() => {
  // Setup any global test configuration
})

afterAll(() => {
  // Cleanup after all tests
})
