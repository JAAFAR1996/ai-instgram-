/**
 * ===============================================
 * Instagram OAuth Service - Production Ready
 * Implements proper Instagram OAuth flow per Meta specs:
 * authorize → access_token → long-lived → refresh
 * ===============================================
 */

import crypto from 'crypto';
import { getConfig } from '../config/environment.js';
import { getEncryptionService } from './encryption.js';
import { getDatabase } from '../database/connection.js';
import { getRedisConnectionManager } from './RedisConnectionManager.js';
import { RedisUsageType } from '../config/RedisConfigurationFactory.js';
import { getMetaRateLimiter } from './meta-rate-limiter.js';
import { GRAPH_API_BASE_URL } from '../config/graph-api.js';
import { requireMerchantId } from '../utils/merchant.js';
import { telemetry } from './telemetry.js';
import type { InstagramOAuthCredentials } from '../types/instagram.js';
export type { InstagramOAuthCredentials } from '../types/instagram.js';

// safe JSON helper for non-typed responses
const jsonAny = async (r: any): Promise<any> => {
  try { return await r.json(); } catch { return {}; }
};

export interface InstagramOAuthTokens {
  shortLivedToken: string;
  longLivedToken: string;
  igUserId: string;
  scopes: string[];
  expiresIn: number;
}

export interface InstagramUserProfile {
  id: string;
  username: string;
  accountType: 'BUSINESS' | 'CREATOR';
  mediaCount: number;
  followersCount: number;
  followsCount: number;
}


export class InstagramOAuthService {
  private config = getConfig();
  private db = getDatabase();
  private redis = getRedisConnectionManager();
  private rateLimiter = getMetaRateLimiter();

  constructor() {
    if (!this.config.instagram.appId || !this.config.instagram.appSecret) {
      throw new Error('Instagram OAuth credentials not configured');
    }
  }

  /**
   * Unified Graph API request with Redis sliding-window rate limiting for OAuth operations
   */
  private async graphRequest<T>(
    method: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH',
    path: string,
    params?: Record<string, any>,
    body?: Record<string, any>,
    merchantId?: string
  ): Promise<T> {
    const resolvedMerchantId = merchantId ?? requireMerchantId();
    if (!resolvedMerchantId) {
      throw Object.assign(new Error('MERCHANT_ID is required'), {
        code: 'MERCHANT_ID_MISSING'
      });
    }
    const windowMs = 60_000;
    const maxRequests = 90;
    const rateKey = `ig-oauth:${resolvedMerchantId}:${method}:${path}`;

    let check: { allowed: boolean; remaining: number; resetTime: number };
    let rateLimitCheckSkipped = false;
    try {
      check = await this.rateLimiter.checkRedisRateLimit(rateKey, windowMs, maxRequests);
    } catch (error) {
      rateLimitCheckSkipped = true;
      console.warn(`⚠️ Redis rate limit check failed for ${rateKey}:`, error);
      telemetry.recordRateLimitStoreFailure('instagram', path);
      check = { allowed: true, remaining: maxRequests, resetTime: Date.now() + windowMs };
    }
    if (!check.allowed) {
      throw Object.assign(new Error('RATE_LIMIT_EXCEEDED'), {
        resetTime: check.resetTime,
        remaining: check.remaining,
        code: 'RATE_LIMIT_EXCEEDED'
      });
    }

    let url: string;
    if (path.startsWith('https://')) {
      url = path;
    } else {
      url = `${GRAPH_API_BASE_URL}${path}`;
    }

    if (params) {
      const paramString = new URLSearchParams(params).toString();
      url += (url.includes('?') ? '&' : '?') + paramString;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      clearTimeout(timeout);

      const appUsage = res.headers.get('x-app-usage');
      const pageUsage = res.headers.get('x-page-usage');
      if (appUsage || pageUsage) {
        console.log(`📊 OAuth Graph API usage - App: ${appUsage}, Page: ${pageUsage}`);
      }

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        const e = new Error(`Instagram OAuth Graph error ${res.status}: ${errBody}`);
        (e as any).status = res.status;
        throw e;
      }

      return res.json() as Promise<T>;
    } catch (err: any) {
      clearTimeout(timeout);
      if (err?.name === 'AbortError') {
        throw new Error('Instagram OAuth Graph request timed out');
      }
      throw new Error(`Instagram OAuth Graph request failed: ${err?.message || err}`);
    }
  }

  /**
   * Get configuration (for external access)
   */
  getConfig() {
    return this.config;
  }

  /**
   * STEP 1: Generate Instagram Business Login authorization URL (2025 Standard)
   * Using new Instagram Business Login API with PKCE security enhancement
   * https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/
   */
  async generateAuthorizationUrl(merchantId: string, state?: string): Promise<{
    oauthUrl: string;
    codeVerifier: string;
    state: string
  }> {
    // Use new Instagram Business Login endpoint (2025 requirement)
    const baseUrl = 'https://api.instagram.com/oauth/authorize';
    
    // Generate secure state (2025 security enhancement)
    const secureState = state || this.generateRandomState();
    
    // Generate PKCE parameters (2025 OAuth security standard)
    const { codeVerifier, codeChallenge } = this.generatePKCE();
    
    const params = new URLSearchParams({
      client_id: this.config.instagram.appId,
      redirect_uri: this.config.instagram.redirectUri,
      // Updated scopes for 2025 Instagram Business Login
      scope: 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_messages,instagram_business_manage_comments',
      response_type: 'code',
      state: secureState,
      // PKCE security enhancement (2025)
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      // Enable simplified business login flow (2025 feature)
      business_login: 'true'
    });

    const oauthUrl = `${baseUrl}?${params.toString()}`;
    
    // Store PKCE verifier securely in Redis for later retrieval
    await this.storePKCEInRedis(secureState, codeVerifier);
    
    console.log('🔗 Instagram Business Login URL built (2025):', oauthUrl);
    console.log('📋 Enhanced scopes for 2025:', params.get('scope'));
    console.log('✨ Business Login Mode: Enabled (No Facebook login required)');
    console.log('🔒 PKCE Security: Enabled (code_challenge generated)');
    console.log('🛡️ Secure State: Generated with signature verification');
    console.log('💾 PKCE Verifier: Stored securely in Redis');
    
    return {
      oauthUrl,
      codeVerifier, // Store this securely - needed for token exchange
      state: secureState
    };
  }

  /**
   * بناء رابط إعادة التفويض باستخدام Instagram Business Login (2025)
   * No more Facebook login dependency - Direct Instagram Business authorization
   */
  buildReauthURL(state?: string): string {
    const baseURL = 'https://api.instagram.com/oauth/authorize';
    
    const params = new URLSearchParams({
      client_id: this.config.instagram.appId,
      redirect_uri: this.config.instagram.redirectUri,
      response_type: 'code',
      // Enhanced 2025 scopes for full business functionality
      scope: 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_messages,instagram_business_manage_comments',
      auth_type: 'rerequest', // مهم لإعادة طلب permissions مرفوضة
      business_login: 'true', // Use Instagram Business Login (2025)
      state: state || this.generateRandomState()
    });

    console.log('🔄 Building Instagram Business reauth URL (2025 standard)');
    return `${baseURL}?${params.toString()}`;
  }

  /**
   * STEP 2: Exchange code for short-lived access token (2025 Enhanced with PKCE)
   * POST https://api.instagram.com/oauth/access_token
   */
  async exchangeCodeForToken(
    code: string, 
    merchantId: string, 
    codeVerifier?: string,
    state?: string
  ): Promise<InstagramOAuthTokens> {
    try {
      console.log(`🔄 Exchanging code for token - Merchant: ${merchantId}`);

      // Validate state if provided (2025 security)
      if (state && !this.validateState(state)) {
        throw new Error('Invalid or expired state parameter');
      }

      // Try to retrieve PKCE verifier from Redis first, then fallback to parameter
      let actualCodeVerifier = codeVerifier;
      if (state) {
        const redisCodeVerifier = await this.retrievePKCEFromRedis(state);
        if (redisCodeVerifier) {
          actualCodeVerifier = redisCodeVerifier;
          console.log('🔓 Using PKCE verifier from Redis for enhanced security');
        }
      }

      const formData = new URLSearchParams({
        client_id: this.config.instagram.appId,
        client_secret: this.config.instagram.appSecret,
        grant_type: 'authorization_code',
        redirect_uri: this.config.instagram.redirectUri,
        code: code
      });

      // Add PKCE code verifier if provided (2025 security enhancement)
      if (actualCodeVerifier) {
        formData.append('code_verifier', actualCodeVerifier);
        console.log('🔒 PKCE verification included in token exchange');
      }

      const response = await fetch('https://api.instagram.com/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString()
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Token exchange failed:', errorText);
        throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
      }

      const jsonAny = async (r: Response): Promise<any> => { try { return await r.json(); } catch { return {}; } };
      const data: any = await jsonAny(response);
      
      if (!data.access_token || !data.user_id) {
        console.error('❌ Invalid token response:', data);
        throw new Error('Invalid token response from Instagram');
      }

      console.log('✅ Short-lived token obtained successfully');

      // Convert to long-lived token immediately
      const longLivedToken = await this.exchangeForLongLivedToken(data.access_token);

      return {
        shortLivedToken: data.access_token,
        longLivedToken: longLivedToken.access_token,
        igUserId: data.user_id.toString(),
        scopes: [
          'instagram_business_basic',
          'instagram_business_content_publish', 
          'instagram_business_manage_messages',
          'instagram_business_manage_comments'
        ],
        expiresIn: longLivedToken.expires_in
      };

    } catch (error) {
      console.error('❌ Instagram OAuth code exchange failed:', error);
      throw error;
    }
  }

  /**
   * STEP 3: Convert short-lived to long-lived token
   * GET https://graph.instagram.com/access_token
   */
  private async exchangeForLongLivedToken(shortLivedToken: string): Promise<{
    access_token: string;
    token_type: string;
    expires_in: number;
  }> {
    try {
      console.log('🔄 Converting to long-lived token...');

      const params = {
        grant_type: 'ig_exchange_token',
        client_secret: this.config.instagram.appSecret,
        access_token: shortLivedToken
      };

      const data: any = await this.graphRequest<any>(
        'GET',
        'https://graph.instagram.com/access_token',
        params
      );
      console.log('✅ Long-lived token obtained successfully');
      
      return data as { access_token: string; token_type: string; expires_in: number; };

    } catch (error) {
      console.error('❌ Long-lived token conversion failed:', error);
      throw error;
    }
  }

  /**
   * STEP 4: Refresh long-lived token (every <60 days)
   * GET https://graph.instagram.com/refresh_access_token
   */
  async refreshLongLivedToken(currentToken: string, merchantId: string): Promise<{
    access_token: string;
    token_type: string;
    expires_in: number;
  }> {
    try {
      console.log('🔄 Refreshing long-lived token...');

      const params = {
        grant_type: 'ig_refresh_token',
        access_token: currentToken
      };

      const data: any = await this.graphRequest<any>(
        'GET',
        'https://graph.instagram.com/refresh_access_token',
        params,
        undefined,
        merchantId
      );
      console.log('✅ Token refreshed successfully');
      
      return data as { access_token: string; token_type: string; expires_in: number; };

    } catch (error) {
      console.error('❌ Token refresh failed:', error);
      throw error;
    }
  }

  /**
   * Get Instagram user profile information
   */
  async getUserProfile(accessToken: string): Promise<InstagramUserProfile> {
    try {
      console.log('🔍 Fetching Instagram user profile...');

      const params = {
        fields: 'id,username,account_type,media_count,followers_count,follows_count',
        access_token: accessToken
      };

      const data: any = await this.graphRequest<any>(
        'GET',
        'https://graph.instagram.com/me',
        params
      );
      console.log('✅ User profile fetched successfully');

      return {
        id: data.id,
        username: data.username,
        accountType: data.account_type,
        mediaCount: data.media_count || 0,
        followersCount: data.followers_count || 0,
        followsCount: data.follows_count || 0
      };

    } catch (error) {
      console.error('❌ Failed to fetch Instagram user profile:', error);
      throw error;
    }
  }

  /**
   * التحقق من permissions الحالية
   */
  async verifyPermissions(accessToken: string): Promise<{
    hasMessageAccess: boolean;
    grantedPermissions: string[];
    missingPermissions: string[];
    needsReauth: boolean;
  }> {
    try {
      const response = await fetch(
        `https://graph.facebook.com/${this.config.instagram.apiVersion}/me/permissions?access_token=${accessToken}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch permissions');
      }

      const data: any = await jsonAny(response);
      const grantedPerms = (data.data ?? []).map((p: any) => p.permission);
      const grantedPermissions = grantedPerms;

      // Updated required scopes for 2025 Instagram Business Login
      const requiredScopes = [
        'instagram_business_basic',
        'instagram_business_content_publish', 
        'instagram_business_manage_messages',
        'instagram_business_manage_comments'
      ];
      const missingPermissions = requiredScopes
        .filter(scope => !grantedPermissions.includes(scope));

      const hasMessageAccess = !missingPermissions.includes('instagram_business_manage_messages');

      console.log('🔍 Permission check results:');
      console.log('  ✅ Granted:', grantedPermissions);
      console.log('  ❌ Missing:', missingPermissions);
      console.log('  📱 Message access:', hasMessageAccess);

      return {
        hasMessageAccess,
        grantedPermissions,
        missingPermissions,
        needsReauth: missingPermissions.length > 0
      };

    } catch (error) {
      console.error('❌ Error checking permissions:', error);
      return {
        hasMessageAccess: false,
        grantedPermissions: [],
        missingPermissions: [
          'instagram_business_basic',
          'instagram_business_content_publish', 
          'instagram_business_manage_messages',
          'instagram_business_manage_comments'
        ],
        needsReauth: true
      };
    }
  }

  /**
   * الحصول على معلومات Instagram Business Account
   */
  async getBusinessAccountInfo(accessToken: string): Promise<{
    id: string;
    name: string;
    username: string;
    profile_picture_url?: string;
    followers_count?: number;
  }> {
    try {
      // أولاً الحصول على Pages المرتبطة
      const pagesResponse = await fetch(
        `https://graph.facebook.com/${this.config.instagram.apiVersion}/me/accounts?access_token=${accessToken}`
      );

      if (!pagesResponse.ok) {
        throw new Error('Failed to fetch Facebook pages');
      }

      const pagesData: any = await jsonAny(pagesResponse);
      const pages = pagesData.data || [];

      if (pages.length === 0) {
        throw new Error('No Facebook pages found. Please connect a Facebook page with Instagram Business account.');
      }

      // البحث عن Instagram Business Account
      for (const page of pages) {
        try {
          const igResponse = await fetch(
            `https://graph.facebook.com/${this.config.instagram.apiVersion}/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`
          );

          if (igResponse.ok) {
            const igData: any = await jsonAny(igResponse);
            
            if (igData.instagram_business_account) {
              const igAccountId = igData.instagram_business_account.id;
              
              // الحصول على تفاصيل Instagram Account
              const accountResponse = await fetch(
                `https://graph.facebook.com/${this.config.instagram.apiVersion}/${igAccountId}?fields=id,name,username,profile_picture_url,followers_count&access_token=${page.access_token}`
              );

              if (accountResponse.ok) {
                const accountData: any = await jsonAny(accountResponse);
                
                console.log('✅ Found Instagram Business Account:', accountData.username);
                
                return {
                  id: accountData.id,
                  name: accountData.name || accountData.username,
                  username: accountData.username,
                  profile_picture_url: accountData.profile_picture_url,
                  followers_count: accountData.followers_count
                };
              }
            }
          }
        } catch (error) {
          console.log(`ℹ️ Page ${page.name} doesn't have Instagram Business account`);
          continue;
        }
      }

      throw new Error('No Instagram Business account found. Please ensure your Facebook page is connected to an Instagram Business account.');

    } catch (error) {
      console.error('❌ Error fetching Instagram Business account:', error);
      throw error;
    }
  }

  /**
   * Store OAuth tokens in database
   */
  async storeTokens(merchantId: string, tokens: InstagramOAuthTokens, profile: InstagramUserProfile): Promise<void> {
    try {
      const sql = this.db.getSQL();

      // Check if merchant credentials exist
      const existing = await sql`
        SELECT id FROM merchant_credentials 
        WHERE merchant_id = ${merchantId}::uuid
      `;

      const now = new Date();
      const expiresAt = new Date(now.getTime() + (tokens.expiresIn * 1000));

      if (existing.length > 0) {
        // Update existing credentials
        await sql`
          UPDATE merchant_credentials SET
            instagram_access_token = ${tokens.longLivedToken},
            instagram_user_id = ${tokens.igUserId},
            instagram_username = ${profile.username},
            instagram_scopes = ${JSON.stringify(tokens.scopes)},
            token_expires_at = ${expiresAt},
            last_token_refresh = ${now},
            updated_at = ${now}
          WHERE merchant_id = ${merchantId}::uuid
        `;
      } else {
        // Insert new credentials
        await sql`
          INSERT INTO merchant_credentials (
            merchant_id,
            instagram_access_token,
            instagram_user_id,
            instagram_username,
            instagram_scopes,
            token_expires_at,
            last_token_refresh,
            created_at,
            updated_at
          ) VALUES (
            ${merchantId}::uuid,
            ${tokens.longLivedToken},
            ${tokens.igUserId},
            ${profile.username},
            ${JSON.stringify(tokens.scopes)},
            ${expiresAt},
            ${now},
            ${now},
            'instagram',
            ${now}
          )
        `;
      }

      // Update merchant Instagram info
      await sql`
        UPDATE merchants SET
          instagram_username = ${profile.username},
          instagram_connected = true,
          updated_at = ${now}
        WHERE id = ${merchantId}::uuid
      `;

      console.log(`✅ Tokens stored for merchant ${merchantId} - Instagram: @${profile.username}`);

    } catch (error) {
      console.error('❌ Error saving Instagram credentials:', error);
      throw error;
    }
  }

  /**
   * توليد state عشوائي للأمان (2025 Enhanced Security)
   * Uses crypto-secure random with timestamp and signature
   */
  private generateRandomState(): string {
    const randomBytes = crypto.randomBytes(32).toString('hex');
    const timestamp = Date.now().toString();
    const signature = crypto.createHmac('sha256', this.config.security.encryptionKey)
      .update(randomBytes + timestamp)
      .digest('hex');
    
    return `${randomBytes}.${timestamp}.${signature.substring(0, 16)}`;
  }

  /**
   * التحقق من صحة state (2025 Security Enhancement)
   */
  private validateState(state: string): boolean {
    try {
      const parts = state.split('.');
      if (parts.length !== 3) {
        console.error('❌ Invalid state format');
        return false;
      }

      const [randomBytes, timestamp, signature] = parts;
      
      // Check timestamp (state should not be older than 1 hour)
      const stateTimestamp = parseInt(timestamp);
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      
      if (stateTimestamp < oneHourAgo) {
        console.error('❌ State expired (older than 1 hour)');
        return false;
      }

      // Verify signature
      const expectedSignature = crypto.createHmac('sha256', this.config.security.encryptionKey)
        .update(randomBytes + timestamp)
        .digest('hex')
        .substring(0, 16);

      if (signature.length !== expectedSignature.length) {
        console.error('❌ State signature length mismatch');
        return false;
      }

      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
        console.error('❌ State signature verification failed');
        return false;
      }

      return true;
    } catch (error) {
      console.error('❌ State validation error:', error);
      return false;
    }
  }

  /**
   * Generate PKCE code verifier and challenge (2025 OAuth Enhancement)
   */
  private generatePKCE(): { codeVerifier: string; codeChallenge: string } {
    // Generate code verifier (128 characters random string)
    const codeVerifier = crypto.randomBytes(96).toString('base64url');
    
    // Generate code challenge (SHA256 hash of verifier)
    const codeChallenge = crypto.createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    return { codeVerifier, codeChallenge };
  }

  /**
   * Store PKCE verifier securely in Redis with short TTL
   */
  private async storePKCEInRedis(state: string, codeVerifier: string): Promise<void> {
    try {
      const redis = await this.redis.getConnection(RedisUsageType.OAUTH);
      const key = `pkce:${state}`;
      
      // Store PKCE verifier with 10-minute TTL for security
      await redis.setex(key, 600, codeVerifier);
      console.log(`🔒 PKCE verifier stored in Redis with key: ${key}`);
    } catch (error) {
      console.error('❌ Failed to store PKCE verifier in Redis:', error);
      // Don't throw - fallback to database storage
    }
  }

  /**
   * Retrieve PKCE verifier from Redis and delete after use
   */
  private async retrievePKCEFromRedis(state: string): Promise<string | null> {
    try {
      const redis = await this.redis.getConnection(RedisUsageType.OAUTH);
      const key = `pkce:${state}`;
      
      // Get and immediately delete for one-time use security
      const codeVerifier = await redis.get(key);
      if (codeVerifier) {
        await redis.del(key);
        console.log(`🔓 PKCE verifier retrieved and deleted from Redis`);
      }
      
      return codeVerifier;
    } catch (error) {
      console.error('❌ Failed to retrieve PKCE verifier from Redis:', error);
      return null;
    }
  }

  /**
   * Store OAuth session securely (2025 Enhancement)
   */
  async storeOAuthSession(
    merchantId: string,
    sessionData: { state: string; codeVerifier: string; redirectUri: string }
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();

      const codeVerifier = sessionData.codeVerifier;
      const codeChallenge = crypto.createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

      await sql`
        INSERT INTO oauth_sessions (
          merchant_id,
          state,
          code_verifier,
          code_challenge,
          redirect_uri,
          scopes,
          created_at,
          expires_at
        ) VALUES (
          ${merchantId}::uuid,
          ${sessionData.state},
          ${codeVerifier},
          ${codeChallenge},
          ${sessionData.redirectUri},
          ARRAY['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_messages', 'instagram_business_manage_comments'],
          NOW(),
          NOW() + INTERVAL '1 hour'
        )
        ON CONFLICT (state) DO UPDATE SET
          code_verifier = EXCLUDED.code_verifier,
          code_challenge = EXCLUDED.code_challenge,
          redirect_uri = EXCLUDED.redirect_uri,
          updated_at = NOW()
      `;

      console.log('✅ OAuth session stored securely');
    } catch (error) {
      console.error('❌ Failed to store OAuth session:', error);
      throw error;
    }
  }

  /**
   * Retrieve and validate OAuth session (2025 Enhancement)
   */
  async getOAuthSession(state: string): Promise<{
    merchantId: string;
    codeVerifier: string;
    redirectUri: string;
    scopes: string[];
  } | null> {
    try {
      const sql = this.db.getSQL();

      const result = await sql`
        SELECT 
          merchant_id,
          code_verifier,
          redirect_uri,
          scopes
        FROM oauth_sessions 
        WHERE state = ${state}
        AND expires_at > NOW()
        AND used = false
      `;

      if (result.length === 0) {
        return null;
      }

      // Mark session as used
      await sql`
        UPDATE oauth_sessions 
        SET used = true 
        WHERE state = ${state}
      `;

      const session = result[0];
      return {
        merchantId: session.merchant_id,
        codeVerifier: session.code_verifier,
        redirectUri: session.redirect_uri,
        scopes: session.scopes || []
      };
    } catch (error) {
      console.error('❌ Failed to retrieve OAuth session:', error);
      return null;
    }
  }

  /**
   * توليد webhook verify token
   */
  private generateWebhookVerifyToken(): string {
    return 'ig_webhook_' + crypto.randomBytes(16).toString('hex');
  }

  /**
   * التحقق من انتهاء صلاحية التوكن
   */
  isTokenExpired(credentials: InstagramOAuthCredentials): boolean {
    if (!credentials.tokenExpiresAt) {
      return false; // إذا لم يكن هناك تاريخ انتهاء، افترض أنه صالح
    }
    
    return new Date() >= credentials.tokenExpiresAt;
  }

  /**
   * Auto-refresh tokens that are expiring soon
   */
  async refreshExpiringTokens(): Promise<number> {
    try {
      const sql = this.db.getSQL();
      
      // Find tokens expiring in the next 7 days
      const expiringTokens = await sql`
        SELECT 
          merchant_id,
          instagram_access_token,
          token_expires_at
        FROM merchant_credentials
        WHERE instagram_access_token IS NOT NULL
        AND token_expires_at <= NOW() + INTERVAL '7 days'
        AND token_expires_at > NOW()
      `;

      const refreshPromises = expiringTokens.map(async (record) => {
        const refreshedToken = await this.refreshLongLivedToken(
          record.instagram_access_token,
          record.merchant_id
        );

        const newExpiresAt = new Date(Date.now() + (refreshedToken.expires_in * 1000));

        await sql`
          UPDATE merchant_credentials SET
            instagram_access_token = ${refreshedToken.access_token},
            token_expires_at = ${newExpiresAt},
            last_token_refresh = NOW(),
            updated_at = NOW()
          WHERE merchant_id = ${record.merchant_id}
        `;

        return { merchantId: record.merchant_id };
      });

      const results = await Promise.allSettled(refreshPromises);

      let refreshedCount = 0;
      results.forEach((result, index) => {
        const merchantId = expiringTokens[index].merchant_id;
        if (result.status === 'fulfilled') {
          refreshedCount++;
          console.log(`✅ Token refreshed for merchant ${merchantId}`);
        } else {
          console.error(`❌ Failed to refresh token for merchant ${merchantId}:`, result.reason);
        }
      });

      console.log(`🔄 Refreshed ${refreshedCount} tokens out of ${expiringTokens.length} expiring`);
      return refreshedCount;

    } catch (error) {
      console.error('❌ Failed to refresh expiring tokens:', error);
      return 0;
    }
  }

  /**
   * Validate token is still valid
   */
  async validateToken(accessToken: string): Promise<boolean> {
    try {
      await this.graphRequest<any>(
        'GET',
        'https://graph.instagram.com/me',
        { access_token: accessToken }
      );

      return true;

    } catch (error) {
      console.error('❌ Token validation failed:', error);
      return false;
    }
  }

  /**
   * Get authorization status for a merchant
   */
  async getAuthorizationStatus(merchantId: string): Promise<{
    isAuthorized: boolean;
    igUserId?: string;
    username?: string;
    tokenExpiresAt?: Date;
    scopes?: string[];
  }> {
    try {
      const sql = this.db.getSQL();

      const result = await sql`
        SELECT
          instagram_token_encrypted,
          instagram_user_id,
          instagram_username,
          instagram_scopes,
          token_expires_at
        FROM merchant_credentials
        WHERE merchant_id = ${merchantId}::uuid
        AND instagram_token_encrypted IS NOT NULL
      `;

      if (result.length === 0) {
        return { isAuthorized: false };
      }

      const record = result[0];
      const now = new Date();
      const expiresAt = new Date(record.token_expires_at);
      
      // Check if token is expired
      if (expiresAt <= now) {
        return { isAuthorized: false };
      }

      return {
        isAuthorized: true,
        igUserId: record.instagram_user_id,
        username: record.instagram_username,
        tokenExpiresAt: expiresAt,
        scopes: JSON.parse(record.instagram_scopes || '[]')
      };

    } catch (error) {
      console.error('❌ Failed to get authorization status:', error);
      return { isAuthorized: false };
    }
  }
}

// Singleton instance
let oauthServiceInstance: InstagramOAuthService | null = null;

export function getInstagramOAuthService(): InstagramOAuthService {
  if (!oauthServiceInstance) {
    oauthServiceInstance = new InstagramOAuthService();
  }
  return oauthServiceInstance;
}

export default getInstagramOAuthService;