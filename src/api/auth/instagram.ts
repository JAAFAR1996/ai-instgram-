/**
 * ===============================================
 * Instagram Auth API Endpoints
 * Handles OAuth flow for merchants to connect Instagram
 * ===============================================
 */

import { Hono } from 'hono';
import { getInstagramOAuthService } from '../../services/instagram-oauth.js';
import { getDatabase } from '../../database/connection.js';
import { z } from 'zod';

// Validation schemas
const AuthCallbackSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional()
});

export class InstagramAuthAPI {
  private app: Hono;
  private oauthService = getInstagramOAuthService();
  private db = getDatabase();

  constructor() {
    this.app = new Hono();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Get authorization URL for merchant
    this.app.get('/auth/instagram/connect/:merchantId', async (c) => {
      try {
        const merchantId = c.req.param('merchantId');
        
        if (!merchantId) {
          return c.json({ error: 'Merchant ID is required' }, 400);
        }

        // Verify merchant exists and is active
        const merchant = await this.getMerchant(merchantId);
        if (!merchant) {
          return c.json({ error: 'Merchant not found or inactive' }, 404);
        }

        // Generate authorization URL
        const authUrl = this.oauthService.generateAuthorizationUrl(merchantId);

        return c.json({
          success: true,
          authUrl,
          instructions: {
            en: 'Please visit the authorization URL to connect your Instagram Business account',
            ar: 'يرجى زيارة رابط التفويض لربط حساب Instagram Business الخاص بك'
          },
          scopes: ['instagram_business_basic', 'instagram_business_manage_messages'],
          redirectUri: process.env.REDIRECT_URI
        });

      } catch (error) {
        console.error('❌ Instagram auth URL generation failed:', error);
        return c.json({
          error: 'Failed to generate authorization URL',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
      }
    });

    // Handle OAuth callback
    this.app.get('/auth/instagram/callback', async (c) => {
      try {
        const query = c.req.query();
        const validation = AuthCallbackSchema.safeParse(query);

        if (!validation.success) {
          console.error('❌ Invalid callback parameters:', validation.error);
          return c.json({
            error: 'Invalid callback parameters',
            details: validation.error.errors
          }, 400);
        }

        const { code, state, error, error_description } = validation.data;

        // Handle OAuth error
        if (error) {
          console.error('❌ OAuth error:', error, error_description);
          return c.json({
            error: 'Instagram authorization failed',
            reason: error,
            description: error_description
          }, 400);
        }

        if (!code) {
          return c.json({ error: 'Authorization code not provided' }, 400);
        }

        const merchantId = state; // We use merchantId as state
        if (!merchantId) {
          return c.json({ error: 'Merchant ID not found in state' }, 400);
        }

        console.log(`🔄 Processing Instagram OAuth callback for merchant: ${merchantId}`);

        // Exchange code for tokens
        const tokens = await this.oauthService.exchangeCodeForToken(code, merchantId);
        
        // Get user profile
        const profile = await this.oauthService.getUserProfile(tokens.longLivedToken, merchantId);
        
        // Store tokens in database
        await this.oauthService.storeTokens(merchantId, tokens, profile);

        return c.json({
          success: true,
          message: 'Instagram account connected successfully',
          data: {
            merchantId,
            instagramUsername: profile.username,
            accountType: profile.accountType,
            followersCount: profile.followersCount,
            scopes: tokens.scopes,
            tokenExpiresIn: tokens.expiresIn
          }
        });

      } catch (error) {
        console.error('❌ Instagram OAuth callback failed:', error);
        return c.json({
          error: 'OAuth callback processing failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
      }
    });

    // Get authorization status for merchant
    this.app.get('/auth/instagram/status/:merchantId', async (c) => {
      try {
        const merchantId = c.req.param('merchantId');
        
        if (!merchantId) {
          return c.json({ error: 'Merchant ID is required' }, 400);
        }

        const status = await this.oauthService.getAuthorizationStatus(merchantId);

        return c.json({
          success: true,
          merchantId,
          instagram: status
        });

      } catch (error) {
        console.error('❌ Failed to get Instagram auth status:', error);
        return c.json({
          error: 'Failed to get authorization status',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
      }
    });

    // Refresh token for merchant
    this.app.post('/auth/instagram/refresh/:merchantId', async (c) => {
      try {
        const merchantId = c.req.param('merchantId');
        
        if (!merchantId) {
          return c.json({ error: 'Merchant ID is required' }, 400);
        }

        // Get current status
        const status = await this.oauthService.getAuthorizationStatus(merchantId);
        if (!status.isAuthorized) {
          return c.json({ error: 'Merchant not authorized for Instagram' }, 401);
        }

        // Get current token
        const sql = this.db.getSQL();
        const result = await sql`
          SELECT instagram_access_token
          FROM merchant_credentials
          WHERE merchant_id = ${merchantId}::uuid
          AND instagram_access_token IS NOT NULL
        `;

        if (result.length === 0) {
          return c.json({ error: 'No token found for merchant' }, 404);
        }

        const currentToken = result[0].instagram_access_token;
        
        // Refresh token
        const refreshedToken = await this.oauthService.refreshLongLivedToken(currentToken, merchantId);
        
        // Update in database
        const newExpiresAt = new Date(Date.now() + (refreshedToken.expires_in * 1000));
        
        await sql`
          UPDATE merchant_credentials SET
            instagram_access_token = ${refreshedToken.access_token},
            token_expires_at = ${newExpiresAt},
            last_token_refresh = NOW(),
            updated_at = NOW()
          WHERE merchant_id = ${merchantId}::uuid
        `;

        return c.json({
          success: true,
          message: 'Token refreshed successfully',
          data: {
            merchantId,
            tokenExpiresAt: newExpiresAt,
            expiresIn: refreshedToken.expires_in
          }
        });

      } catch (error) {
        console.error('❌ Token refresh failed:', error);
        return c.json({
          error: 'Token refresh failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
      }
    });

    // Disconnect Instagram for merchant
    this.app.delete('/auth/instagram/disconnect/:merchantId', async (c) => {
      try {
        const merchantId = c.req.param('merchantId');
        
        if (!merchantId) {
          return c.json({ error: 'Merchant ID is required' }, 400);
        }

        const sql = this.db.getSQL();

        // Clear Instagram credentials
        await sql`
          UPDATE merchant_credentials SET
            instagram_access_token = NULL,
            instagram_user_id = NULL,
            instagram_username = NULL,
            instagram_scopes = NULL,
            token_expires_at = NULL,
            last_token_refresh = NULL,
            updated_at = NOW()
          WHERE merchant_id = ${merchantId}::uuid
        `;

        // Update merchant Instagram status
        await sql`
          UPDATE merchants SET
            instagram_username = NULL,
            instagram_connected = false,
            updated_at = NOW()
          WHERE id = ${merchantId}::uuid
        `;

        return c.json({
          success: true,
          message: 'Instagram account disconnected successfully',
          merchantId
        });

      } catch (error) {
        console.error('❌ Instagram disconnect failed:', error);
        return c.json({
          error: 'Failed to disconnect Instagram account',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
      }
    });

    // Validate token for merchant
    this.app.post('/auth/instagram/validate/:merchantId', async (c) => {
      try {
        const merchantId = c.req.param('merchantId');
        
        if (!merchantId) {
          return c.json({ error: 'Merchant ID is required' }, 400);
        }

        const sql = this.db.getSQL();
        const result = await sql`
          SELECT instagram_access_token, token_expires_at
          FROM merchant_credentials
          WHERE merchant_id = ${merchantId}::uuid
          AND instagram_access_token IS NOT NULL
        `;

        if (result.length === 0) {
          return c.json({
            success: false,
            valid: false,
            reason: 'No token found'
          });
        }

        const record = result[0];
        const now = new Date();
        const expiresAt = new Date(record.token_expires_at);
        
        // Check expiration
        if (expiresAt <= now) {
          return c.json({
            success: false,
            valid: false,
            reason: 'Token expired',
            expiresAt
          });
        }

        // Validate with Instagram
        const isValid = await this.oauthService.validateToken(record.instagram_access_token, merchantId);

        return c.json({
          success: true,
          valid: isValid,
          expiresAt,
          reason: isValid ? 'Token is valid' : 'Token invalid with Instagram'
        });

      } catch (error) {
        console.error('❌ Token validation failed:', error);
        return c.json({
          error: 'Token validation failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
      }
    });

    // Batch refresh expiring tokens
    this.app.post('/auth/instagram/refresh-batch', async (c) => {
      try {
        const refreshedCount = await this.oauthService.refreshExpiringTokens();

        return c.json({
          success: true,
          message: `Refreshed ${refreshedCount} expiring tokens`,
          refreshedCount
        });

      } catch (error) {
        console.error('❌ Batch token refresh failed:', error);
        return c.json({
          error: 'Batch token refresh failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        }, 500);
      }
    });
  }

  /**
   * Get merchant by ID
   */
  private async getMerchant(merchantId: string): Promise<any | null> {
    try {
      const sql = this.db.getSQL();

      const result = await sql`
        SELECT id, business_name, subscription_status
        FROM merchants
        WHERE id = ${merchantId}::uuid
        AND subscription_status = 'ACTIVE'
      `;

      return result[0] || null;

    } catch (error) {
      console.error('❌ Failed to get merchant:', error);
      return null;
    }
  }

  /**
   * Get the Hono app instance
   */
  public getApp(): Hono {
    return this.app;
  }
}

// Export singleton instance
let instagramAuthInstance: InstagramAuthAPI | null = null;

export function getInstagramAuthAPI(): InstagramAuthAPI {
  if (!instagramAuthInstance) {
    instagramAuthInstance = new InstagramAuthAPI();
  }
  return instagramAuthInstance;
}

export default InstagramAuthAPI;