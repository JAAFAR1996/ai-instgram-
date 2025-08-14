/**
 * ===============================================
 * Instagram Authentication API Endpoints
 * OAuth flow with proper scopes for messaging
 * ===============================================
 */

import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { getInstagramOAuthService } from '@/services/instagram-oauth';
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
      
      // إنشاء state يحتوي على merchant ID
      const state = JSON.stringify({
        merchantId,
        timestamp: Date.now(),
        random: Math.random().toString(36).substr(2, 8)
      });
      
      // بناء OAuth URL مع الـ scopes الصحيحة
      const oauthUrl = oauthService.buildOAuthURL(
        Buffer.from(state).toString('base64')
      );
      
      console.log('🔗 Instagram OAuth initiated for merchant:', merchantId);
      
      return c.json({
        success: true,
        oauthUrl,
        state,
        requiredScopes: [
          'instagram_business_basic',
          'instagram_business_manage_messages'
        ],
        message: 'OAuth URL created successfully. Redirect user to authenticate.',
        instructions: {
          ar: 'انقر على الرابط لربط حساب Instagram Business',
          en: 'Click the link to connect your Instagram Business account'
        }
      });
      
    } catch (error) {
      console.error('❌ OAuth initiation error:', error);
      return c.json({
        error: 'Failed to initiate OAuth',
        details: error.message
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
    
    // فك تشفير state واستخراج merchant ID
    let merchantId: string;
    try {
      const decodedState = Buffer.from(state, 'base64').toString();
      const stateData = JSON.parse(decodedState);
      merchantId = stateData.merchantId;
      
      if (!merchantId) {
        throw new Error('Merchant ID not found in state');
      }
    } catch (stateError) {
      return c.json({
        error: 'Invalid state parameter',
        details: 'State parameter is corrupted or invalid'
      }, 400);
    }
    
    const oauthService = getInstagramOAuthService();
    
    // تبديل code بـ access token
    console.log('🔄 Exchanging code for access token...');
    const tokenData = await oauthService.exchangeCodeForToken(code);
    
    // التحقق من permissions
    console.log('🔍 Verifying permissions...');
    const permissions = await oauthService.verifyPermissions(tokenData.accessToken);
    
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
    const businessAccountInfo = await oauthService.getBusinessAccountInfo(tokenData.accessToken);
    
    // حفظ البيانات في قاعدة البيانات
    console.log('💾 Saving credentials...');
    const savedCredentials = await oauthService.saveInstagramCredentials(
      merchantId,
      tokenData,
      businessAccountInfo
    );
    
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
        scopes: tokenData.scope?.split(',') || [],
        tokenExpiresIn: tokenData.expiresIn || null
      },
      nextSteps: {
        ar: 'تم ربط الحساب بنجاح! يمكنك الآن استقبال وإرسال رسائل Instagram',
        en: 'Account connected successfully! You can now receive and send Instagram messages'
      }
    });
    
  } catch (error) {
    console.error('❌ OAuth callback error:', error);
    
    // تحديد نوع الخطأ وإرجاع رسالة مناسبة
    let errorMessage = 'OAuth authentication failed';
    let statusCode = 500;
    
    if (error.message.includes('scope not granted')) {
      errorMessage = 'Required permissions not granted';
      statusCode = 403;
    } else if (error.message.includes('Invalid verification code')) {
      errorMessage = 'Invalid or expired authorization code';
      statusCode = 400;
    } else if (error.message.includes('No Instagram Business account')) {
      errorMessage = 'Instagram Business account not found';
      statusCode = 404;
    }
    
    return c.json({
      error: errorMessage,
      details: error.message,
      timestamp: new Date().toISOString()
    }, statusCode);
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
      AND platform = 'INSTAGRAM'
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
    return c.json({
      error: 'Failed to check Instagram connection status',
      details: error.message
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
      AND platform = 'INSTAGRAM'
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
    return c.json({
      error: 'Failed to disconnect Instagram account',
      details: error.message
    }, 500);
  }
});

export default app;