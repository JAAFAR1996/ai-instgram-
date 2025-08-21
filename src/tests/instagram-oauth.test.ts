import { describe, test, expect, mock, afterEach } from 'bun:test';

// Mock environment configuration
mock.module('../config/environment.js', () => ({
  getConfig: () => ({
    instagram: {
      appId: '1234567890',
      appSecret: '12345678901234567890',
      metaAppSecret: '12345678901234567890',
      verifyToken: 'verifytoken123',
      redirectUri: 'https://example.com/auth/instagram/callback',
      apiVersion: 'v23.0'
    },
    security: {
      encryptionKey: '12345678901234567890123456789012',
      jwtSecret: '12345678901234567890123456789012',
      corsOrigins: [],
      rateLimitWindow: 0,
      rateLimitMax: 0,
      trustedRedirectDomains: []
    },
    database: {
      host: '',
      port: 0,
      database: '',
      username: '',
      password: '',
      ssl: false,
      maxConnections: 1
    },
    ai: {
      openaiApiKey: 'sk-test123456789012345678901',
      model: 'gpt',
      maxTokens: 100,
      temperature: 0.7
    },
    redis: { url: 'redis://localhost' },
    environment: 'test',
    port: 3000,
    baseUrl: '',
    internalApiKey: 'test-key'
  })
}));

// In-memory session store to simulate database
const sessions: Record<string, any> = {};
const sql = async (strings: TemplateStringsArray, ...values: any[]) => {
  const query = strings.join(' ');
  if (query.includes('INSERT INTO oauth_sessions')) {
    const [merchantId, state, codeVerifier, codeChallenge, redirectUri] = values;
    sessions[state] = {
      merchant_id: merchantId,
      code_verifier: codeVerifier,
      code_challenge: codeChallenge,
      redirect_uri: redirectUri,
      scopes: [
        'instagram_business_basic',
        'instagram_business_content_publish',
        'instagram_business_manage_messages',
        'instagram_business_manage_comments'
      ],
      used: false
    };
    return [];
  }
  if (query.includes('SELECT') && query.includes('FROM oauth_sessions')) {
    const [state] = values;
    const record = sessions[state];
    return record && !record.used ? [record] : [];
  }
  if (query.includes('UPDATE oauth_sessions')) {
    const [state] = values;
    if (sessions[state]) sessions[state].used = true;
    return [];
  }
  return [];
};

mock.module('../database/connection.js', () => ({
  getDatabase: () => ({ getSQL: () => sql })
}));

mock.module('../services/RedisConnectionManager.js', () => ({
  getRedisConnectionManager: () => ({
    getConnection: async () => ({
      setex: async () => {},
      get: async () => null,
      del: async () => {},
      multi: () => ({ exec: async () => null })
    })
  })
}));

mock.module('../services/meta-rate-limiter.js', () => ({
  getMetaRateLimiter: () => ({ checkRedisRateLimit: async () => ({ allowed: true }) })
}));

const { InstagramOAuthService } = await import('../services/instagram-oauth.ts');

afterEach(() => {
  mock.restore();
  delete (globalThis as any).fetch;
});

describe('Instagram OAuth', () => {
  test('getAuthUrl stores state in session', async () => {
    const service = new InstagramOAuthService();
    const { oauthUrl, codeVerifier, state } = await service.generateAuthorizationUrl('merchant1');
    await service.storeOAuthSession('merchant1', {
      state,
      codeVerifier,
      redirectUri: 'https://example.com/callback'
    });
    const session = await service.getOAuthSession(state);
    expect(oauthUrl).toContain('https://api.instagram.com/oauth/authorize');
    expect(session?.merchantId).toBe('merchant1');
  });

  test('exchangeCode handles invalid code', async () => {
    const service = new InstagramOAuthService();
    (globalThis as any).fetch = mock(async () => ({
      ok: false,
      status: 400,
      text: async () => 'bad code'
    }));
    await expect(
      service.exchangeCodeForToken('bad', 'merchant1', 'verifier')
    ).rejects.toThrow('Token exchange failed');
  });

  test('exchangeCode returns access token on success', async () => {
    const service = new InstagramOAuthService();
    (service as any).exchangeForLongLivedToken = mock(async () => ({
      access_token: 'long',
      token_type: 'bearer',
      expires_in: 3600
    }));
    (globalThis as any).fetch = mock(async () => ({
      ok: true,
      json: async () => ({ access_token: 'short', user_id: 123 })
    }));
    const tokens = await service.exchangeCodeForToken('good', 'merchant1', 'verifier');
    expect(tokens.shortLivedToken).toBe('short');
    expect(tokens.longLivedToken).toBe('long');
    expect(tokens.igUserId).toBe('123');
  });
});