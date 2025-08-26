/**
 * ===============================================
 * Instagram Setup Service - STEP 1 Implementation
 * Handles Instagram Business Account setup and credential management
 * ===============================================
 */

import type { BusinessAccountInfo } from '../types/instagram.js';
import { getInstagramClient, getInstagramAPICredentialsManager, type InstagramAPICredentials } from './instagram-api.js';
import { getDatabase } from '../db/adapter.js';
import { createLogger } from './logger.js';

export interface InstagramSetupConfig {
  pageAccessToken: string;
  businessAccountId: string;
  pageId: string;
  appId: string;
  appSecret: string;
  webhookVerifyToken: string;
  webhookUrl: string;
}

export interface InstagramSetupResult {
  success: boolean;
  businessAccountId?: string;
  pageId?: string;
  errors: string[];
  warnings: string[];
  steps: SetupStep[];
}

export interface SetupStep {
  step: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  message: string;
  details?: any;
}

// Using imported BusinessAccountInfo from types/instagram.js

function isBusinessAccountInfo(data: unknown): data is BusinessAccountInfo {
  if (!data || typeof data !== 'object') return false;
  const info = data as Record<string, unknown>;
  return (
    typeof info.id === 'string' &&
    typeof info.username === 'string' &&
    typeof info.name === 'string' &&
    typeof info.profile_picture_url === 'string' &&
    typeof info.followers_count === 'number' &&
    typeof info.media_count === 'number'
  );
}

export class InstagramSetupService {
  private db = getDatabase();
  private logger = createLogger({ component: 'InstagramSetupService' });

  /**
   * Complete Instagram Business setup for merchant
   */
  public async setupInstagramIntegration(
    merchantId: string,
    config: InstagramSetupConfig,
    ipAddress?: string
  ): Promise<InstagramSetupResult> {
    const result: InstagramSetupResult = {
      success: false,
      errors: [],
      warnings: [],
      steps: []
    };

    try {
      this.logger.info('Starting Instagram setup', { merchantId });

      // Step 1: Validate provided credentials
      await this.executeStep(result, 'validate_credentials', 'Validating Instagram credentials', async () => {
        await this.validateInstagramAPICredentials(config);
      });

      // Step 2: Test API connectivity
      let businessAccountInfo: BusinessAccountInfo | null = null;
      await this.executeStep(result, 'test_api', 'Testing Instagram API connectivity', async () => {
        businessAccountInfo = await this.testInstagramAPI(config);
        result.businessAccountId = businessAccountInfo?.id;
        result.pageId = config.pageId;
      });

      // Step 3: Store encrypted credentials
      await this.executeStep(result, 'store_credentials', 'Storing encrypted credentials', async () => {
        const credManager = await getInstagramAPICredentialsManager();
        await credManager.storeCredentials(
          merchantId,
          {
            pageAccessToken: config.pageAccessToken,
            businessAccountId: config.businessAccountId,
            pageId: config.pageId,
            appSecret: config.appSecret,
            webhookVerifyToken: config.webhookVerifyToken
          },
          ipAddress
        );
      });

      // Step 4: Initialize Instagram client
      let credentials: InstagramAPICredentials | null = null;
      await this.executeStep(result, 'initialize_client', 'Initializing Instagram client', async () => {
        const client = await getInstagramClient(merchantId);
        credentials = await client.loadMerchantCredentials(merchantId);
        if (!credentials) {
          throw new Error('Instagram credentials not found');
        }
        await client.validateCredentials(credentials, merchantId);
      });

      // Step 5: Subscribe to webhooks
      await this.executeStep(result, 'setup_webhooks', 'Setting up webhook subscriptions', async () => {
        const client = await getInstagramClient(merchantId);
        const creds = credentials ?? await client.loadMerchantCredentials(merchantId);
        if (!creds) {
          throw new Error('Instagram credentials not found');
        }
        const webhookSuccess = await client.subscribeToWebhooks(creds, merchantId, config.webhookUrl);
        if (!webhookSuccess) {
          throw new Error('Failed to subscribe to Instagram webhooks');
        }
      });

      // Step 6: Perform health check
      await this.executeStep(result, 'health_check', 'Performing final health check', async () => {
        const client = await getInstagramClient(merchantId);
        const creds = credentials ?? await client.loadMerchantCredentials(merchantId);
        const health = await client.healthCheck(creds, merchantId);

        if (health.status !== 'healthy') {
          throw new Error(`Instagram API health check failed: ${health.status}`);
        }
      });

      // Step 7: Log successful setup
      await this.executeStep(result, 'log_setup', 'Logging setup completion', async () => {
        await this.logSetupCompletion(merchantId, config, businessAccountInfo);
      });

      result.success = true;
      this.logger.info('Instagram setup completed successfully', { merchantId });

    } catch (error) {
      this.logger.error('Instagram setup failed', error, { merchantId });
      result.errors.push(error instanceof Error ? error.message : 'Unknown setup error');
    }

    return result;
  }

  /**
   * Validate Instagram Business Account requirements
   */
  public async validateBusinessAccount(
    pageAccessToken: string,
    businessAccountId: string
  ): Promise<{
    isValid: boolean;
    accountInfo?: BusinessAccountInfo;
    issues: string[];
  }> {
    const issues: string[] = [];

    try {
      const client = await getInstagramClient('validation'); // Use a temporary client

      const res = await client.graphRequest(
        'GET',
        `/${businessAccountId}?fields=id,username,name,profile_picture_url,followers_count,media_count,biography`,
        pageAccessToken,
        undefined,
        'validation',
        true
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Instagram API error ${res.status}: ${text}`);
      }
      const data = await res.json();
      if (!isBusinessAccountInfo(data)) {
        throw new Error('Invalid account info response');
      }
      const accountInfo = data;

      // Validate account type
      if (!accountInfo.id) {
        issues.push('Invalid business account ID');
      }

      if (!accountInfo.username) {
        issues.push('Account username not found - ensure this is a business account');
      }

      // Check if account has required permissions
      try {
        const permissions = await client.graphRequest<any>(
          'GET',
          `/me/permissions`,
          pageAccessToken,
          undefined,
          'validation'
        );
        const requiredPerms = ['instagram_basic', 'pages_messaging'];
        const grantedPerms = (permissions as any).data?.map((p: any) => p.permission) ?? [];

        const missingPerms = requiredPerms.filter(perm => !grantedPerms.includes(perm));
        if (missingPerms.length > 0) {
          issues.push(`Missing permissions: ${missingPerms.join(', ')}`);
        }
      } catch {
        issues.push('Could not verify account permissions');
      }

      return {
        isValid: issues.length === 0,
        accountInfo: {
          id: accountInfo.id,
          username: accountInfo.username ?? accountInfo.name ?? '',
          name: accountInfo.name ?? '',
          profile_picture_url: accountInfo.profile_picture_url ?? '',
          followers_count: accountInfo.followers_count ?? 0,
          media_count: accountInfo.media_count ?? 0
        },
        issues
      };

    } catch (error) {
      issues.push(`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { isValid: false, issues };
    }
  }

  /**
   * Generate setup instructions for merchant
   */
  public generateSetupInstructions(): {
    title: string;
    steps: Array<{
      step: number;
      title: string;
      description: string;
      action: string;
      tips: string[];
    }>;
    requirements: string[];
    troubleshooting: Array<{
      issue: string;
      solution: string;
    }>;
  } {
    return {
      title: 'إعداد تكامل Instagram Business للمبيعات الذكية',
      steps: [
        {
          step: 1,
          title: 'تحويل الحساب إلى Business Account',
          description: 'تحويل حساب Instagram الشخصي إلى حساب تجاري',
          action: 'Instagram → Settings → Account → Switch to Professional Account → Business',
          tips: [
            'تحتاج بيانات الشركة الأساسية',
            'اختر فئة العمل المناسبة',
            'أضف معلومات الاتصال'
          ]
        },
        {
          step: 2,
          title: 'إنشاء صفحة Facebook Business',
          description: 'إنشاء صفحة أعمال على Facebook (مطلوبة للـ API)',
          action: 'facebook.com/pages/create → Business → Choose Category',
          tips: [
            'استخدم نفس اسم النشاط في Instagram',
            'أضف صورة الشعار والغلاف',
            'املأ جميع معلومات النشاط'
          ]
        },
        {
          step: 3,
          title: 'ربط Instagram بصفحة Facebook',
          description: 'ربط حساب Instagram التجاري بصفحة Facebook',
          action: 'Facebook Page → Settings → Instagram → Connect Account',
          tips: [
            'استخدم نفس البريد الإلكتروني',
            'تأكد من صلاحيات الإدارة',
            'اختبر الربط بنشر منشور'
          ]
        },
        {
          step: 4,
          title: 'إعداد Facebook Developer App',
          description: 'إنشاء تطبيق مطور للوصول للـ APIs',
          action: 'developers.facebook.com → My Apps → Create App → Business',
          tips: [
            'اختر نوع Business App',
            'أضف Instagram Graph API Product',
            'احفظ App ID و App Secret'
          ]
        },
        {
          step: 5,
          title: 'الحصول على Page Access Token',
          description: 'توليد رمز الوصول الدائم للصفحة',
          action: 'Graph API Explorer → Select Page → Generate Token',
          tips: [
            'اختر الصلاحيات المطلوبة',
            'استخدم Long-Lived Token',
            'احفظ الرمز في مكان آمن'
          ]
        },
        {
          step: 6,
          title: 'تكوين Webhook URL',
          description: 'إعداد رابط استقبال الأحداث من Instagram',
          action: 'Developer Console → Webhooks → Add Callback URL',
          tips: [
            'استخدم HTTPS فقط',
            'تأكد من إمكانية الوصول للرابط',
            'احفظ Verify Token'
          ]
        }
      ],
      requirements: [
        'حساب Instagram Business نشط',
        'صفحة Facebook Business مؤكدة',
        'Facebook Developer Account',
        'خادم مع HTTPS للـ webhooks',
        'معرف النشاط التجاري (Business ID)'
      ],
      troubleshooting: [
        {
          issue: 'خطأ "Invalid Access Token"',
          solution: 'تأكد من أن الرمز صحيح وغير منتهي الصلاحية. جدد الرمز إذا لزم الأمر.'
        },
        {
          issue: 'خطأ "Insufficient Permissions"',
          solution: 'تحقق من منح جميع الصلاحيات المطلوبة: instagram_basic, pages_messaging'
        },
        {
          issue: 'فشل ربط Instagram بـ Facebook',
          solution: 'تأكد من أن كلا الحسابين يستخدمان نفس البريد الإلكتروني وأن لديك صلاحيات الإدارة'
        },
        {
          issue: 'Webhook Verification Failed',
          solution: 'تحقق من أن رابط الـ webhook يرد بالـ challenge token الصحيح'
        }
      ]
    };
  }

  /**
   * Test Instagram API credentials
   */
  public async testCredentials(
    merchantId: string
  ): Promise<{
    success: boolean;
    accountInfo?: BusinessAccountInfo;
    healthStatus?: any;
    errors: string[];
  }> {
    const errors: string[] = [];

    try {
      const client = await getInstagramClient(merchantId);
      const creds = await client.loadMerchantCredentials(merchantId);
      if (!creds) {
        throw new Error('Instagram credentials not found');
      }
      await client.validateCredentials(creds, merchantId);

      // Get account info
      const accountInfo = await client.getBusinessAccountInfo(creds, merchantId);
      const normalizedAccountInfo: BusinessAccountInfo = {
        ...accountInfo,
        username: String((accountInfo as any)?.username ?? '')
      };
      
      // Perform health check
      const healthStatus = await client.healthCheck(creds, merchantId);

      return {
        success: true,
        accountInfo: normalizedAccountInfo,
        healthStatus,
        errors
      };

    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown error');
      return {
        success: false,
        errors
      };
    }
  }

  /**
   * Remove Instagram integration for merchant
   */
  public async removeIntegration(merchantId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const credManager = await getInstagramAPICredentialsManager();
      await credManager.removeCredentials(merchantId);

      // Log removal
      await this.logIntegrationRemoval(merchantId);

      this.logger.info('Instagram integration removed', { merchantId });
      return { success: true };

    } catch (error) {
      this.logger.error('Failed to remove Instagram integration', error, { merchantId });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Private: Execute setup step with error handling
   */
  private async executeStep(
    result: InstagramSetupResult,
    stepName: string,
    message: string,
    action: () => Promise<void>
  ): Promise<void> {
    const step: SetupStep = {
      step: stepName,
      status: 'in_progress',
      message
    };

    result.steps.push(step);

    try {
      await action();
      step.status = 'completed';
      this.logger.info(message);
    } catch (error) {
      step.status = 'failed';
      step.details = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`${message} failed`, error, { step: stepName });
      throw error;
    }
  }

  /**
   * Private: Validate Instagram credentials
   */
  private async validateInstagramAPICredentials(config: InstagramSetupConfig): Promise<void> {
    const required = [
      'pageAccessToken',
      'businessAccountId',
      'pageId',
      'appSecret',
      'webhookVerifyToken'
    ];

    const missing = required.filter(field => !config[field as keyof InstagramSetupConfig]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required fields: ${missing.join(', ')}`);
    }

    // Validate token format
    if (!config.pageAccessToken.startsWith('EAA') && !config.pageAccessToken.startsWith('EAB')) {
      throw new Error('Invalid Page Access Token format');
    }

    // Validate business account ID format - sanitize input
    const sanitizedAccountId = config.businessAccountId.replace(/[^0-9]/g, '');
    if (!sanitizedAccountId || sanitizedAccountId !== config.businessAccountId) {
      throw new Error('Invalid Business Account ID format - only numbers allowed');
    }
  }

  /**
   * Private: Test Instagram API with provided credentials
   */
  private async testInstagramAPI(
    config: InstagramSetupConfig
  ): Promise<BusinessAccountInfo> {
          const client = await getInstagramClient('setup-test');
    const res = await client.graphRequest(
      'GET',
      `/${config.businessAccountId}?fields=id,username,name,profile_picture_url,followers_count,media_count,biography`,
      config.pageAccessToken,
      undefined,
      'setup-test',
      true
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Instagram API error ${res.status}: ${text}`);
    }
    const data = await res.json();
    if (!isBusinessAccountInfo(data)) {
      throw new Error('Invalid account info response');
    }
    return data;
  }

  /**
   * Private: Log setup completion
   */
  private async logSetupCompletion(
    merchantId: string,
    config: InstagramSetupConfig,
    accountInfo: BusinessAccountInfo | null
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();

      await sql`
        INSERT INTO audit_logs (
          merchant_id,
          action,
          entity_type,
          details,
          success
        ) VALUES (
          ${merchantId}::uuid,
          'INSTAGRAM_SETUP_COMPLETED',
          'INTEGRATION',
          ${JSON.stringify({
            businessAccountId: config.businessAccountId,
            pageId: config.pageId,
            username: accountInfo?.username,
            followersCount: accountInfo?.followers_count,
            setupTimestamp: new Date().toISOString()
          })},
          true
        )
      `;
    } catch (error) {
      this.logger.error('Failed to log setup completion', error, { merchantId });
    }
  }

  /**
   * Private: Log integration removal
   */
  private async logIntegrationRemoval(merchantId: string): Promise<void> {
    try {
      const sql = this.db.getSQL();

      await sql`
        INSERT INTO audit_logs (
          merchant_id,
          action,
          entity_type,
          details,
          success
        ) VALUES (
          ${merchantId}::uuid,
          'INSTAGRAM_INTEGRATION_REMOVED',
          'INTEGRATION',
          ${JSON.stringify({
            removedAt: new Date().toISOString()
          })},
          true
        )
      `;
    } catch (error) {
      this.logger.error('Failed to log integration removal', error, { merchantId });
    }
  }
}

// Singleton instance
let setupServiceInstance: InstagramSetupService | null = null;

/**
 * Get Instagram setup service instance
 */
export function getInstagramSetupService(): InstagramSetupService {
  if (!setupServiceInstance) {
    setupServiceInstance = new InstagramSetupService();
  }
  return setupServiceInstance;
}

export default InstagramSetupService;