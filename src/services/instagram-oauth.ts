/**
 * ===============================================
 * Instagram OAuth Service - Production Ready
 * Implements proper Instagram OAuth flow per Meta specs:
 * authorize → access_token → long-lived → refresh
 * ===============================================
 */

import { getConfig } from '../config/environment';
import { getEncryptionService } from './encryption';
import { getDatabase } from '@/database/connection';

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

  constructor() {
    if (!this.config.instagram.appId || !this.config.instagram.appSecret) {
      throw new Error('Instagram OAuth credentials not configured');
    }
  }

  /**
   * STEP 1: Generate Instagram authorization URL
   * https://www.instagram.com/oauth/authorize
   */
  generateAuthorizationUrl(merchantId: string, state?: string): string {
    const params = new URLSearchParams({
      client_id: this.config.instagram.appId,
      redirect_uri: this.config.instagram.redirectUri,
      scope: 'instagram_business_basic,instagram_business_manage_messages',
      response_type: 'code',
      state: state || merchantId // Use merchantId as state if not provided
    });

    const oauthUrl = `https://www.instagram.com/oauth/authorize?${params.toString()}`;
    
    console.log('🔗 Instagram OAuth URL built:', oauthUrl);
    console.log('📋 Scopes requested: instagram_business_basic,instagram_business_manage_messages');
    
    return oauthUrl;
  }

  /**
   * بناء رابط إعادة التفويض (عند رفض permissions)
   */
  buildReauthURL(state?: string): string {
    const baseURL = `https://www.facebook.com/${this.apiVersion}/dialog/oauth`;
    
    const params = new URLSearchParams({
      client_id: this.config.appId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: this.config.requiredScopes.join(','),
      auth_type: 'rerequest', // مهم لإعادة طلب permissions مرفوضة
      state: state || this.generateRandomState()
    });

    return `${baseURL}?${params.toString()}`;
  }

  /**
   * STEP 2: Exchange code for short-lived access token
   * POST https://api.instagram.com/oauth/access_token
   */
  async exchangeCodeForToken(code: string, merchantId: string): Promise<InstagramOAuthTokens> {
    try {
      console.log(`🔄 Exchanging code for token - Merchant: ${merchantId}`);

      const formData = new URLSearchParams({
        client_id: this.config.instagram.appId,
        client_secret: this.config.instagram.appSecret,
        grant_type: 'authorization_code',
        redirect_uri: this.config.instagram.redirectUri,
        code: code
      });

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

      const data = await response.json();
      
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
        scopes: ['instagram_business_basic', 'instagram_business_manage_messages'],
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

      const params = new URLSearchParams({
        grant_type: 'ig_exchange_token',
        client_secret: this.config.instagram.appSecret,
        access_token: shortLivedToken
      });

      const response = await fetch(`https://graph.instagram.com/access_token?${params.toString()}`, {
        method: 'GET'
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Long-lived token conversion failed:', errorText);
        throw new Error(`Long-lived token conversion failed: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      console.log('✅ Long-lived token obtained successfully');
      
      return data;

    } catch (error) {
      console.error('❌ Long-lived token conversion failed:', error);
      throw error;
    }
  }

  /**
   * STEP 4: Refresh long-lived token (every <60 days)
   * GET https://graph.instagram.com/refresh_access_token
   */
  async refreshLongLivedToken(currentToken: string): Promise<{
    access_token: string;
    token_type: string;
    expires_in: number;
  }> {
    try {
      console.log('🔄 Refreshing long-lived token...');

      const params = new URLSearchParams({
        grant_type: 'ig_refresh_token',
        access_token: currentToken
      });

      const response = await fetch(`https://graph.instagram.com/refresh_access_token?${params.toString()}`, {
        method: 'GET'
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Token refresh failed:', errorText);
        throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      console.log('✅ Token refreshed successfully');
      
      return data;

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

      const params = new URLSearchParams({
        fields: 'id,username,account_type,media_count,followers_count,follows_count',
        access_token: accessToken
      });

      const response = await fetch(`https://graph.instagram.com/me?${params.toString()}`, {
        method: 'GET'
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Failed to fetch user profile:', errorText);
        throw new Error(`Profile fetch failed: ${response.status} ${errorText}`);
      }

      const data = await response.json();
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
        `https://graph.facebook.com/${this.apiVersion}/me/permissions?access_token=${accessToken}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch permissions');
      }

      const data = await response.json();
      const permissions = data.data || [];

      const grantedPermissions = permissions
        .filter((p: any) => p.status === 'granted')
        .map((p: any) => p.permission);

      const missingPermissions = this.config.requiredScopes
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
        missingPermissions: this.config.requiredScopes,
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
        `https://graph.facebook.com/${this.apiVersion}/me/accounts?access_token=${accessToken}`
      );

      if (!pagesResponse.ok) {
        throw new Error('Failed to fetch Facebook pages');
      }

      const pagesData = await pagesResponse.json();
      const pages = pagesData.data || [];

      if (pages.length === 0) {
        throw new Error('No Facebook pages found. Please connect a Facebook page with Instagram Business account.');
      }

      // البحث عن Instagram Business Account
      for (const page of pages) {
        try {
          const igResponse = await fetch(
            `https://graph.facebook.com/${this.apiVersion}/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`
          );

          if (igResponse.ok) {
            const igData = await igResponse.json();
            
            if (igData.instagram_business_account) {
              const igAccountId = igData.instagram_business_account.id;
              
              // الحصول على تفاصيل Instagram Account
              const accountResponse = await fetch(
                `https://graph.facebook.com/${this.apiVersion}/${igAccountId}?fields=id,name,username,profile_picture_url,followers_count&access_token=${page.access_token}`
              );

              if (accountResponse.ok) {
                const accountData = await accountResponse.json();
                
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
   * توليد state عشوائي للأمان
   */
  private generateRandomState(): string {
    return Math.random().toString(36).substr(2, 15) + Date.now().toString(36);
  }

  /**
   * توليد webhook verify token
   */
  private generateWebhookVerifyToken(): string {
    return 'ig_webhook_' + Math.random().toString(36).substr(2, 12);
  }

  /**
   * التحقق من انتهاء صلاحية التوكن
   */
  isTokenExpired(credentials: InstagramCredentials): boolean {
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

      let refreshedCount = 0;

      for (const record of expiringTokens) {
        try {
          const refreshedToken = await this.refreshLongLivedToken(record.instagram_access_token);
          
          const newExpiresAt = new Date(Date.now() + (refreshedToken.expires_in * 1000));
          
          await sql`
            UPDATE merchant_credentials SET
              instagram_access_token = ${refreshedToken.access_token},
              token_expires_at = ${newExpiresAt},
              last_token_refresh = NOW(),
              updated_at = NOW()
            WHERE merchant_id = ${record.merchant_id}
          `;

          refreshedCount++;
          console.log(`✅ Token refreshed for merchant ${record.merchant_id}`);

        } catch (error) {
          console.error(`❌ Failed to refresh token for merchant ${record.merchant_id}:`, error);
        }
      }

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
      const response = await fetch(`https://graph.instagram.com/me?access_token=${accessToken}`, {
        method: 'GET'
      });

      return response.ok;

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
          instagram_access_token,
          instagram_user_id,
          instagram_username,
          instagram_scopes,
          token_expires_at
        FROM merchant_credentials
        WHERE merchant_id = ${merchantId}::uuid
        AND instagram_access_token IS NOT NULL
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