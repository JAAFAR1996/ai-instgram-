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
      poolMax: 5
    },
    redis: {
      url: 'redis://localhost:6379/1',
      password: ''
    },
    security: {
      jwtSecret: 'test-jwt-secret',
      encryptionKey: 'test-encryption-key-32-chars-long'
    },
    cors: {
      origins: ['http://localhost:3000']
    },
    api: {
      openai: {
        apiKey: 'test-openai-key'
      },
      instagram: {
        appId: 'test-instagram-app-id',
        appSecret: 'test-instagram-app-secret',
        accessToken: 'test-instagram-access-token'
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
    }
  }),
  resetConfig: vi.fn()
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
    del: vi.fn().mockResolvedValue(1)
  }))
}))

vi.mock('pg', () => ({
  Pool: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn()
    }),
    end: vi.fn().mockResolvedValue(undefined)
  }))
}))

// Global test setup
beforeAll(() => {
  // Setup any global test configuration
})

afterAll(() => {
  // Cleanup after all tests
})
