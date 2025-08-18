/**
 * ===============================================
 * WhatsApp 24h Policy Enforcer (2025 Standards)
 * ✅ إنفاذ صارم لسياسة الـ 24 ساعة
 * ===============================================
 */

import { getMessageWindowService } from './message-window';
import type { CustomerIdentifier } from './message-window';

export interface WhatsAppSendRequest {
  merchantId: string;
  customerPhone: string;
  message: string;
  templateName?: string;
  templateData?: Record<string, string>;
}

export interface PolicyCheckResult {
  canSend: boolean;
  reason: 'WITHIN_24H' | 'TEMPLATE_REQUIRED' | 'TEMPLATE_PROVIDED' | 'BLOCKED';
  templateRequired: boolean;
  windowExpiresAt?: Date;
  minutesRemaining?: number;
}

export class WhatsAppPolicyEnforcer {
  private windowService = getMessageWindowService();

  /**
   * Check WhatsApp 24h policy before sending message
   */
  async checkPolicy(request: WhatsAppSendRequest): Promise<PolicyCheckResult> {
    const customer: CustomerIdentifier = {
      phone: request.customerPhone,
      platform: 'whatsapp'
    };

    // فحص نافذة الـ 24 ساعة
    const windowStatus = await this.windowService.checkCanSendMessage(
      request.merchantId,
      customer
    );

    // داخل نافذة الـ 24 ساعة - إرسال حر مسموح
    if (windowStatus.canSendMessage) {
      return {
        canSend: true,
        reason: 'WITHIN_24H',
        templateRequired: false,
        windowExpiresAt: windowStatus.windowExpiresAt || undefined,
        minutesRemaining: windowStatus.timeRemainingMinutes || undefined
      };
    }

    // خارج نافذة الـ 24 ساعة - يجب استخدام Template
    if (!request.templateName) {
      return {
        canSend: false,
        reason: 'TEMPLATE_REQUIRED',
        templateRequired: true
      };
    }

    // Template مُقدم - مسموح
    return {
      canSend: true,
      reason: 'TEMPLATE_PROVIDED',
      templateRequired: true
    };
  }

  /**
   * Enforce policy gate before sending
   */
  async enforceBeforeSend(request: WhatsAppSendRequest): Promise<void> {
    const policyCheck = await this.checkPolicy(request);

    if (!policyCheck.canSend) {
      throw new WhatsAppPolicyError(
        `WhatsApp policy violation: ${policyCheck.reason}`,
        policyCheck.reason,
        policyCheck
      );
    }

    // تسجيل استخدام النافذة
    if (policyCheck.reason === 'WITHIN_24H') {
      await this.windowService.recordMerchantResponse(
        request.merchantId,
        { phone: request.customerPhone, platform: 'whatsapp' }
      );
    }
  }

  /**
   * Get policy status for customer
   */
  async getPolicyStatus(
    merchantId: string,
    customerPhone: string
  ): Promise<{
    canSendFreeForm: boolean;
    requiresTemplate: boolean;
    windowExpiresAt?: Date;
    minutesRemaining?: number;
    recommendedAction: 'SEND_FREE' | 'USE_TEMPLATE' | 'WAIT_FOR_CUSTOMER';
  }> {
    const customer: CustomerIdentifier = {
      phone: customerPhone,
      platform: 'whatsapp'
    };

    const windowStatus = await this.windowService.getWindowStatus(merchantId, customer);

    if (windowStatus.canSendMessage) {
      return {
        canSendFreeForm: true,
        requiresTemplate: false,
        windowExpiresAt: windowStatus.windowExpiresAt || undefined,
        minutesRemaining: windowStatus.timeRemainingMinutes || undefined,
        recommendedAction: 'SEND_FREE'
      };
    }

    return {
      canSendFreeForm: false,
      requiresTemplate: true,
      recommendedAction: 'USE_TEMPLATE'
    };
  }

  /**
   * Update window when customer sends message
   */
  async onCustomerMessage(
    merchantId: string,
    customerPhone: string,
    messageId?: string
  ): Promise<void> {
    const customer: CustomerIdentifier = {
      phone: customerPhone,
      platform: 'whatsapp'
    };

    await this.windowService.updateCustomerMessageTime(
      merchantId,
      customer,
      messageId
    );
  }

  /**
   * Get active windows summary for merchant
   */
  async getActiveWindowsSummary(merchantId: string): Promise<{
    totalActiveWindows: number;
    expiringWithin1Hour: number;
    expiringWithin6Hours: number;
    windows: Array<{
      customerPhone: string;
      expiresAt: Date;
      minutesRemaining: number;
    }>;
  }> {
    const activeWindows = await this.windowService.getActiveWindows(merchantId);
    const expiringSoon = await this.windowService.getExpiringWindows(merchantId, 360); // 6 hours
    const expiringVeryToon = await this.windowService.getExpiringWindows(merchantId, 60); // 1 hour

    return {
      totalActiveWindows: activeWindows.length,
      expiringWithin1Hour: expiringVeryToon.length,
      expiringWithin6Hours: expiringSoon.length,
      windows: activeWindows
        .filter(w => w.platform === 'whatsapp')
        .map(w => ({
          customerPhone: w.customerId,
          expiresAt: w.expiresAt,
          minutesRemaining: Math.max(0, Math.floor((w.expiresAt.getTime() - Date.now()) / (1000 * 60)))
        }))
    };
  }
}

/**
 * WhatsApp policy violation error
 */
export class WhatsAppPolicyError extends Error {
  constructor(
    message: string,
    public readonly reason: PolicyCheckResult['reason'],
    public readonly policyResult: PolicyCheckResult
  ) {
    super(message);
    this.name = 'WhatsAppPolicyError';
  }
}

// Singleton instance
let policyEnforcerInstance: WhatsAppPolicyEnforcer | null = null;

/**
 * Get WhatsApp policy enforcer instance
 */
export function getWhatsAppPolicyEnforcer(): WhatsAppPolicyEnforcer {
  if (!policyEnforcerInstance) {
    policyEnforcerInstance = new WhatsAppPolicyEnforcer();
  }
  return policyEnforcerInstance;
}

/**
 * Gate function to enforce policy before sending
 */
export async function enforceWhatsAppPolicy(request: WhatsAppSendRequest): Promise<void> {
  const enforcer = getWhatsAppPolicyEnforcer();
  await enforcer.enforceBeforeSend(request);
}

/**
 * Helper: Check if message can be sent freely
 */
export async function canSendFreeMessage(
  merchantId: string,
  customerPhone: string
): Promise<boolean> {
  const enforcer = getWhatsAppPolicyEnforcer();
  const status = await enforcer.getPolicyStatus(merchantId, customerPhone);
  return status.canSendFreeForm;
}

export default WhatsAppPolicyEnforcer;