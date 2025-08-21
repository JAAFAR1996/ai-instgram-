import { describe, test, expect, mock, afterEach } from 'bun:test';
import crypto from 'crypto';

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
      state,
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
      del: async () => {}
    })
  })
}));

const { InstagramOAuthService } = await import('../services/instagram-oauth.ts');

afterEach(() => {
  mock.restore();
  delete (global as any).fetch;
});

describe('OAuth session PKCE handling', () => {
  test('stores and retrieves matching PKCE parameters', async () => {
    const service = new InstagramOAuthService();
    const codeVerifier = 'test_verifier';
    const state = 'state123';

    await service.storeOAuthSession('merchant1', {
      state,
      codeVerifier,
      redirectUri: 'https://example.com/callback'
    });

    const stored = sessions[state];
    const expectedChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    expect(stored.code_verifier).toBe(codeVerifier);
    expect(stored.code_challenge).toBe(expectedChallenge);

    const session = await service.getOAuthSession(state);
    expect(session?.codeVerifier).toBe(codeVerifier);
  });

  test('exchanges code with PKCE verifier', async () => {
    const service = new InstagramOAuthService();
    (service as any).exchangeForLongLivedToken = mock(async () => ({
      access_token: 'long',
      token_type: 'bearer',
      expires_in: 3600
    }));
    const codeVerifier = 'another_verifier';
    let requestBody = '';

    (global as any).fetch = mock(async (url: any, options: any) => {
      if (url === 'https://api.instagram.com/oauth/access_token') {
        requestBody = options.body;
        return {
          ok: true,
          json: async () => ({ access_token: 'short', user_id: 123 })
        } as any;
      }
      return { ok: false, text: async () => '', status: 500 } as any;
    });

    await service.exchangeCodeForToken('code123', 'merchant1', codeVerifier);

    const params = new URLSearchParams(requestBody);
    expect(params.get('code_verifier')).toBe(codeVerifier);
  });
});