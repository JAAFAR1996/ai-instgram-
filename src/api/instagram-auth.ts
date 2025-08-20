/**
 * ===============================================
 * Instagram Authentication API Endpoints
 * OAuth flow with proper scopes for messaging
 * ===============================================
 */

import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { getInstagramOAuthService } from '../services/instagram-oauth.js';
import { getDatabase } from '../database/connection.js';
import { z } from 'zod';

// Validation schemas
const AuthRequestSchema = z.object({
  merchantId: z.string().uuid(),
  redirectUrl: z.string().url().optional()
});

const CallbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_reason: z.string().optional(),
  error_description: z.string().optional()
});

const app = new Hono();

/**
 * بدء تدفق OAuth - إنشاء رابط التفويض
 */
app.post('/auth/instagram/initiate', 
  validator('json', (value, c) => {
    const parsed = AuthRequestSchema.safeParse(value);
    if (!parsed.success) {
      return c.json({ error: 'Invalid request data', details: parsed.error.issues }, 400);
    }
    return parsed.data;
  }),
  async (c) => {
    try {
      const { merchantId, redirectUrl } = c.req.valid('json');
      const oauthService = getInstagramOAuthService();
      
      // Generate secure OAuth URL with PKCE (2025 Enhancement)
      const oauthResult = oauthService.generateAuthorizationUrl(merchantId);
      
      // Store OAuth session securely for later verification
      await oauthService.storeOAuthSession(merchantId, {
        state: oauthResult.state,
        codeVerifier: oauthResult.codeVerifier,
        redirectUri: redirectUrl || oauthService.getConfig().instagram.redirectUri
      });
      
      console.log('🔗 Instagram OAuth initiated for merchant:', merchantId);
      
      return c.json({
        success: true,
        oauthUrl: oauthResult.oauthUrl,
        state: oauthResult.state,
        requiredScopes: [
          'instagram_business_basic',
          'instagram_business_content_publish',
          'instagram_business_manage_messages',
          'instagram_business_manage_comments'
        ],
        securityFeatures: {
          pkce: true,
          secureState: true,
          businessLogin: true
        },
        message: 'OAuth URL created successfully with enhanced 2025 security.',
        instructions: {
          ar: 'انقر على الرابط لربط حساب Instagram Business (بأمان محسن)',
          en: 'Click the link to connect your Instagram Business account (enhanced security)'
        }
      });
      
    } catch (error) {
      console.error('❌ OAuth initiation error:', error);
      const err = error instanceof Error ? error : new Error(String(error));
      return c.json({
        error: 'Failed to initiate OAuth',
        details: err.message
      }, 500);
    }
  }
);

/**
 * معالجة OAuth callback من Instagram
 */
app.get('/auth/instagram/callback', async (c) => {
  try {
    const query = c.req.query();
    const { code, state, error, error_reason, error_description } = query;
    
    // التحقق من وجود أخطاء OAuth
    if (error) {
      console.error('❌ OAuth Error:', {
        error,
        error_reason,
        error_description
      });
      
      return c.json({
        error: 'OAuth authentication failed',
        details: {
          reason: error_reason || error,
          description: error_description || 'User denied permission or authentication failed'
        },
        needsReauth: error_reason === 'user_denied'
      }, 400);
    }
    
    // التحقق من وجود code و state
    if (!code || !state) {
      return c.json({
        error: 'Missing required parameters',
        details: 'Authorization code or state parameter is missing'
      }, 400);
    }
    
    const oauthService = getInstagramOAuthService();
    
    // Retrieve OAuth session using enhanced security (2025)
    const oauthSession = await oauthService.getOAuthSession(state);
    if (!oauthSession) {
      return c.json({
        error: 'Invalid or expired OAuth session',
        details: 'OAuth state not found or session expired'
      }, 400);
    }

    const { merchantId, codeVerifier } = oauthSession;
    
    // تبديل code بـ access token with PKCE verification (2025)
    console.log('🔄 Exchanging code for token with PKCE verification...');
    const tokenData = await oauthService.exchangeCodeForToken(code, merchantId, codeVerifier, state);
    
    // التحقق من permissions
    console.log('🔍 Verifying permissions...');
    const permissions = await oauthService.verifyPermissions(tokenData.longLivedToken);
    
    if (!permissions.hasMessageAccess) {
      console.warn('⚠️ Missing message access permissions');
      
      // إنشاء رابط إعادة التفويض
      const reauthUrl = oauthService.buildReauthURL(state);
      
      return c.json({
        error: 'Insufficient permissions',
        details: {
          message: 'Instagram messaging permissions not granted',
          missing_permissions: permissions.missingPermissions,
          granted_permissions: permissions.grantedPermissions
        },
        needsReauth: true,
        reauthUrl,
        instructions: {
          ar: 'يرجى الموافقة على جميع الصلاحيات المطلوبة لإدارة الرسائل',
          en: 'Please grant all required permissions for message management'
        }
      }, 403);
    }
    
    // الحصول على معلومات Business Account
    console.log('📱 Fetching Instagram Business Account info...');
    const businessAccountInfo = await oauthService.getBusinessAccountInfo(tokenData.longLivedToken);
    
    // الحصول على معلومات المستخدم
    const userProfile = await oauthService.getUserProfile(tokenData.longLivedToken);
    
    // حفظ البيانات في قاعدة البيانات
    console.log('💾 Saving credentials...');
    await oauthService.storeTokens(merchantId, tokenData, userProfile);
    
    // إرجاع النتيجة الناجحة
    return c.json({
      success: true,
      message: 'Instagram account connected successfully!',
      data: {
        businessAccount: {
          id: businessAccountInfo.id,
          username: businessAccountInfo.username,
          name: businessAccountInfo.name,
          followers_count: businessAccountInfo.followers_count
        },
        permissions: {
          granted: permissions.grantedPermissions,
          hasMessageAccess: permissions.hasMessageAccess
        },
        scopes: tokenData.scopes || [],
        tokenExpiresIn: tokenData.expiresIn || null
      },
      nextSteps: {
        ar: 'تم ربط الحساب بنجاح! يمكنك الآن استقبال وإرسال رسائل Instagram',
        en: 'Account connected successfully! You can now receive and send Instagram messages'
      }
    });
    
  } catch (error) {
    console.error('❌ OAuth callback error:', error);
    
    const err = error instanceof Error ? error : new Error(String(error));
    
    // تحديد نوع الخطأ وإرجاع رسالة مناسبة
    let errorMessage = 'OAuth authentication failed';
    let statusCode = 500;
    
    if (err.message.includes('scope not granted')) {
      errorMessage = 'Required permissions not granted';
      statusCode = 403;
    } else if (err.message.includes('Invalid verification code')) {
      errorMessage = 'Invalid or expired authorization code';
      statusCode = 400;
    } else if (err.message.includes('No Instagram Business account')) {
      errorMessage = 'Instagram Business account not found';
      statusCode = 404;
    }
    
    return c.json({
      error: errorMessage,
      details: err.message,
      timestamp: new Date().toISOString()
    }, statusCode as any);
  }
});

/**
 * التحقق من حالة الاتصال الحالية
 */
app.get('/auth/instagram/status/:merchantId', async (c) => {
  try {
    const merchantId = c.req.param('merchantId');
    
    // التحقق من صحة UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(merchantId)) {
      return c.json({ error: 'Invalid merchant ID format' }, 400);
    }
    
    // البحث عن بيانات Instagram في قاعدة البيانات
    const db = getDatabase();
    const sql = db.getSQL();
    
    const integration = await sql`
      SELECT 
        business_account_id,
        business_account_name,
        status,
        scopes,
        token_expires_at,
        created_at,
        updated_at
      FROM merchant_integrations 
      WHERE merchant_id = ${merchantId}::uuid 
      AND platform = 'instagram'
    `;
    
    if (integration.length === 0) {
      return c.json({
        connected: false,
        message: 'Instagram account not connected',
        instructions: {
          ar: 'يرجى ربط حساب Instagram Business أولاً',
          en: 'Please connect your Instagram Business account first'
        }
      });
    }
    
    const account = integration[0];
    const isExpired = account.token_expires_at && 
      new Date() >= new Date(account.token_expires_at);
    
    return c.json({
      connected: true,
      status: account.status,
      businessAccount: {
        id: account.business_account_id,
        username: account.business_account_name
      },
      permissions: {
        scopes: account.scopes || [],
        hasMessageAccess: (account.scopes || []).includes('instagram_business_manage_messages')
      },
      token: {
        isExpired,
        expiresAt: account.token_expires_at
      },
      connectedAt: account.created_at,
      lastUpdated: account.updated_at
    });
    
  } catch (error) {
    console.error('❌ Status check error:', error);
    const err = error instanceof Error ? error : new Error(String(error));
    return c.json({
      error: 'Failed to check Instagram connection status',
      details: err.message
    }, 500);
  }
});

/**
 * قطع الاتصال مع Instagram
 */
app.delete('/auth/instagram/disconnect/:merchantId', async (c) => {
  try {
    const merchantId = c.req.param('merchantId');
    
    const db = getDatabase();
    const sql = db.getSQL();
    
    // حذف بيانات الاتصال
    const result = await sql`
      DELETE FROM merchant_integrations 
      WHERE merchant_id = ${merchantId}::uuid 
      AND platform = 'instagram'
      RETURNING business_account_name
    `;
    
    if (result.length === 0) {
      return c.json({
        error: 'Instagram account not found or already disconnected'
      }, 404);
    }
    
    console.log(`🔌 Instagram disconnected for merchant ${merchantId}`);
    
    return c.json({
      success: true,
      message: 'Instagram account disconnected successfully',
      disconnectedAccount: result[0].business_account_name
    });
    
  } catch (error) {
    console.error('❌ Disconnect error:', error);
    const err = error instanceof Error ? error : new Error(String(error));
    return c.json({
      error: 'Failed to disconnect Instagram account',
      details: err.message
    }, 500);
  }
});

export default app;