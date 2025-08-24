/* @ts-nocheck */
/**
 * ===============================================
 * Message Window Service - WhatsApp 24h Enforcement
 * Manages and enforces the 24-hour customer service window
 * ===============================================
 */

import { getDatabase } from '../db/adapter.js';
import { logger } from './logger.js';
import type { DBRow } from '../types/instagram.js';

export interface MessageWindowStatus {
  canSendMessage: boolean;
  windowExpiresAt: Date | null;
  timeRemainingMinutes: number | null;
  isExpired: boolean;
  windowType: 'ACTIVE' | 'EXPIRED' | 'NONE';
}

export interface WindowUpdateResult {
  success: boolean;
  windowExpiresAt: Date;
  isNewWindow: boolean;
  messageCount: number;
}

export interface CustomerIdentifier {
  phone?: string;
  instagram?: string;
  platform: 'whatsapp' | 'instagram';
}

interface MessageWindowRow {
  can_send_message: boolean;
  window_expires_at: Date;
  time_remaining_minutes: number;
  message_count_in_window: number;
  merchant_response_count: number;
  [key: string]: unknown;
}

interface MessageWindowRecord {
  id: string;
  window_expires_at: Date;
  message_count_in_window: number;
  merchant_response_count: number;
  platform: string;
  customer_phone: string | null;
  customer_instagram: string | null;
  [key: string]: unknown;
}

interface ActiveWindowRow {
  id: string;
  customer_id: string;
  platform: string;
  expires_at: Date;
  message_count: number;
  merchant_response_count: number;
}

interface WindowStatsRow {
  total_windows: string;
  active_windows: string;
  expired_windows: string;
  avg_duration_hours: string | null;
  total_customer_messages: string;
  total_merchant_responses: string;
  [key: string]: unknown;
}

interface ExpiringWindowRow {
  customer_id: string;
  platform: string;
  expires_at: Date;
  minutes_remaining: number;
  [key: string]: unknown;
}

interface DeleteCountRow {
  count: number;
  [key: string]: unknown;
}

// حذف الواجهة غير المستخدمة

export class MessageWindowService {
  private db = getDatabase();

  /**
   * Check if merchant can send message to customer
   */
  public async checkCanSendMessage(
    merchantId: string,
    customer: CustomerIdentifier
  ): Promise<MessageWindowStatus> {
    try {
      const sql = this.db.getSQL();
      
      const result = await sql.unsafe<MessageWindowRow>(`
        SELECT * FROM check_message_window(
          '${merchantId}'::uuid,
          ${customer.phone ? `'${customer.phone}'` : 'null'},
          ${customer.instagram ? `'${customer.instagram}'` : 'null'},
          '${customer.platform}'
        )
      `);

      if (result.length === 0) {
        return {
          canSendMessage: false,
          windowExpiresAt: null,
          timeRemainingMinutes: null,
          isExpired: true,
          windowType: 'NONE'
        };
      }

      const window = (result[0] as unknown) as MessageWindowRow;
      
      return {
        canSendMessage: window?.can_send_message ?? false,
        windowExpiresAt: window?.window_expires_at ?? null,
        timeRemainingMinutes: window?.time_remaining_minutes ?? null,
        isExpired: !(window?.can_send_message ?? false),
        windowType: (window?.can_send_message ?? false) ? 'ACTIVE' : 'EXPIRED'
      };
    } catch (error) {
      console.error('❌ Error checking message window:', error);
      throw new Error('Failed to check message window status');
    }
  }

  /**
   * Update message window when customer sends message
   */
  public async updateCustomerMessageTime(
    merchantId: string,
    customer: CustomerIdentifier,
    messageId?: string
  ): Promise<WindowUpdateResult> {
    try {
      const sql = this.db.getSQL();
      
      // Check if window already exists
      const existingWindow = await this.getExistingWindow(merchantId, customer);
      const isNewWindow = !existingWindow;
      
      // Update or create window
      await sql.unsafe(`
        SELECT update_message_window(
          '${merchantId}'::uuid,
          ${customer.phone ? `'${customer.phone}'` : 'null'},
          ${customer.instagram ? `'${customer.instagram}'` : 'null'},
          '${customer.platform}',
          ${messageId ? `'${messageId}'::uuid` : 'null::uuid'}
        )
      `);

      // Get updated window info
      const updatedWindow = await this.getExistingWindow(merchantId, customer);
      
      if (!updatedWindow) {
        throw new Error('Failed to update message window');
      }

      return {
        success: true,
        windowExpiresAt: updatedWindow.window_expires_at,
        isNewWindow,
        messageCount: updatedWindow.message_count_in_window
      };
    } catch (error) {
      console.error('❌ Error updating message window:', error);
      throw new Error('Failed to update message window');
    }
  }

  /**
   * Get current window status for customer
   */
  public async getWindowStatus(
    merchantId: string,
    customer: CustomerIdentifier
  ): Promise<MessageWindowStatus> {
    try {
      const window = await this.getExistingWindow(merchantId, customer);
      
      if (!window) {
        return {
          canSendMessage: false,
          windowExpiresAt: null,
          timeRemainingMinutes: null,
          isExpired: true,
          windowType: 'NONE'
        };
      }

      const now = new Date();
      const expiresAt = new Date(window.window_expires_at);
      const isExpired = expiresAt <= now;
      const timeRemainingMs = isExpired ? 0 : expiresAt.getTime() - now.getTime();
      const timeRemainingMinutes = Math.floor(timeRemainingMs / (1000 * 60));

      return {
        canSendMessage: !isExpired,
        windowExpiresAt: expiresAt,
        timeRemainingMinutes: isExpired ? 0 : timeRemainingMinutes,
        isExpired,
        windowType: isExpired ? 'EXPIRED' : 'ACTIVE'
      };
    } catch (error) {
      console.error('❌ Error getting window status:', error);
      throw new Error('Failed to get window status');
    }
  }

  /**
   * Record merchant response in window
   */
  public async recordMerchantResponse(
    merchantId: string,
    customer: CustomerIdentifier,
    messageId?: string
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();
      
      await sql`
        UPDATE message_windows
        SET
          merchant_response_count = merchant_response_count + 1,
          updated_at = NOW()
        WHERE merchant_id = ${merchantId}::uuid
        AND platform = ${customer.platform}
        AND (
          (customer_phone = ${customer.phone || null} AND customer_phone IS NOT NULL) OR
          (customer_instagram = ${customer.instagram || null} AND customer_instagram IS NOT NULL)
        )
      `;
    } catch (error) {
      console.error('❌ Error recording merchant response:', error);
      throw new Error('Failed to record merchant response');
    }
  }

  /**
   * Get all active windows for merchant
   */
  public async getActiveWindows(merchantId: string): Promise<Array<{
    id: string;
    customerId: string;
    platform: string;
    expiresAt: Date;
    messageCount: number;
    merchantResponseCount: number;
  }>> {
    try {
      const sql = this.db.getSQL();
      
      const windows = await sql`
        SELECT
          id,
          COALESCE(customer_phone, customer_instagram) as customer_id,
          platform,
          window_expires_at as expires_at,
          message_count_in_window as message_count,
          merchant_response_count
        FROM message_windows
        WHERE merchant_id = ${merchantId}::uuid
        AND is_expired = false
        ORDER BY window_expires_at ASC
      `;

      return windows.map((window) => ({
        id: ((window as unknown) as ActiveWindowRow)?.id ?? '',
        customerId: ((window as unknown) as ActiveWindowRow)?.customer_id ?? '',
        platform: ((window as unknown) as ActiveWindowRow)?.platform ?? '',
        expiresAt: new Date(((window as unknown) as ActiveWindowRow)?.expires_at ?? new Date()),
        messageCount: ((window as unknown) as ActiveWindowRow)?.message_count ?? 0,
        merchantResponseCount: ((window as unknown) as ActiveWindowRow)?.merchant_response_count ?? 0
      }));
    } catch (error) {
      console.error('❌ Error getting active windows:', error);
      throw new Error('Failed to get active windows');
    }
  }

  /**
   * Clean up expired windows (for maintenance)
   */
  public async cleanupExpiredWindows(olderThanDays: number = 7): Promise<number> {
    try {
      const sql = this.db.getSQL();
      
      const result = await sql.unsafe<DeleteCountRow>(`
        DELETE FROM message_windows
        WHERE window_expires_at < NOW() - (${olderThanDays} * INTERVAL '1 day')
      `);

      const count = ((result[0] as unknown) as DeleteCountRow)?.count ?? 0;
      logger.info(`🧹 Cleaned up ${count} expired message windows`);
      return count;
    } catch (error) {
      console.error('❌ Error cleaning up expired windows:', error);
      throw new Error('Failed to cleanup expired windows');
    }
  }

  /**
   * Get window statistics for merchant
   */
  public async getWindowStats(
    merchantId: string,
    days: number = 7
  ): Promise<{
    totalWindows: number;
    activeWindows: number;
    expiredWindows: number;
    averageWindowDuration: number;
    totalCustomerMessages: number;
    totalMerchantResponses: number;
    responseRate: number;
  }> {
    try {
      const sql = this.db.getSQL();
      
      const stats = await sql.unsafe<WindowStatsRow>(`
        SELECT
          COUNT(*) as total_windows,
          SUM(CASE WHEN is_expired = false THEN 1 ELSE 0 END) as active_windows,
          SUM(CASE WHEN is_expired = true THEN 1 ELSE 0 END) as expired_windows,
          AVG(EXTRACT(EPOCH FROM (window_expires_at - created_at))/3600) as avg_duration_hours,
          SUM(message_count_in_window) as total_customer_messages,
          SUM(merchant_response_count) as total_merchant_responses
        FROM message_windows
        WHERE merchant_id = ${merchantId}::uuid
        AND created_at >= NOW() - INTERVAL '${days} days'
      `);

      const result = ((stats[0] as unknown) as WindowStatsRow);
      const totalCustomerMessages = parseInt(result?.total_customer_messages ?? '0', 10);
      const totalMerchantResponses = parseInt(result?.total_merchant_responses ?? '0', 10);
      const responseRate = totalCustomerMessages > 0
        ? (totalMerchantResponses / totalCustomerMessages) * 100
        : 0;

      return {
        totalWindows: parseInt(result?.total_windows ?? '0', 10),
        activeWindows: parseInt(result?.active_windows ?? '0', 10),
        expiredWindows: parseInt(result?.expired_windows ?? '0', 10),
        averageWindowDuration: parseFloat(result?.avg_duration_hours ?? '0'),
        totalCustomerMessages,
        totalMerchantResponses,
        responseRate: Math.round(responseRate * 100) / 100
      };
    } catch (error) {
      console.error('❌ Error getting window stats:', error);
      throw new Error('Failed to get window statistics');
    }
  }

  /**
   * Check for windows expiring soon (for notifications)
   */
  public async getExpiringWindows(
    merchantId: string,
    minutesUntilExpiry: number = 60
  ): Promise<Array<{
    customerId: string;
    platform: string;
    expiresAt: Date;
    minutesRemaining: number;
  }>> {
    try {
      const sql = this.db.getSQL();
      
      const windows = await sql.unsafe<ExpiringWindowRow>(`
        SELECT
          COALESCE(customer_phone, customer_instagram) as customer_id,
          platform,
          window_expires_at as expires_at,
          EXTRACT(EPOCH FROM (window_expires_at - NOW()))/60 as minutes_remaining
        FROM message_windows
        WHERE merchant_id = ${merchantId}::uuid
        AND is_expired = false
        AND window_expires_at <= NOW() + INTERVAL '${minutesUntilExpiry} minutes'
        ORDER BY window_expires_at ASC
      `);
        
      return windows.map((window) => ({
        customerId: ((window as unknown) as ExpiringWindowRow)?.customer_id ?? '',
        platform: ((window as unknown) as ExpiringWindowRow)?.platform ?? '',
        expiresAt: new Date(((window as unknown) as ExpiringWindowRow)?.expires_at ?? new Date()),
        minutesRemaining: Math.floor(((window as unknown) as ExpiringWindowRow)?.minutes_remaining ?? 0)
      }));
    } catch (error) {
      console.error('❌ Error getting expiring windows:', error);
      throw new Error('Failed to get expiring windows');
    }
  }

  /**
   * Private helper: Get existing window
   */
  private async getExistingWindow(
    merchantId: string,
    customer: CustomerIdentifier
  ): Promise<MessageWindowRecord | null> {
    try {
      const sql = this.db.getSQL();
      
      const windows = await sql.unsafe<MessageWindowRecord>(`
        SELECT *
        FROM message_windows
        WHERE merchant_id = ${merchantId}::uuid
        AND platform = '${customer.platform}'
        AND (
          (customer_phone = ${customer.phone ? `'${customer.phone}'` : 'null'} AND customer_phone IS NOT NULL) OR
          (customer_instagram = ${customer.instagram ? `'${customer.instagram}'` : 'null'} AND customer_instagram IS NOT NULL)
        )
      `);

      return windows.length > 0 ? ((windows[0] as unknown) as MessageWindowRecord) : null;
    } catch (error) {
      console.error('❌ Error getting existing window:', error);
      return null;
    }
  }
}

// Singleton instance
let windowServiceInstance: MessageWindowService | null = null;

/**
 * Get message window service instance
 */
export function getMessageWindowService(): MessageWindowService {
  if (!windowServiceInstance) {
    windowServiceInstance = new MessageWindowService();
  }
  return windowServiceInstance;
}

export default MessageWindowService;