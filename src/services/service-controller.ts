/**
 * ===============================================
 * Service Controller - تشغيل وإطفاء الخدمات
 * Controls enabling/disabling of AI services per merchant
 * ===============================================
 */

import { getDatabase } from '../database/connection';
import type { Platform } from '../types/database';

export interface ServiceStatus {
  enabled: boolean;
  lastToggled: Date;
  toggledBy: string;
  reason?: string;
}

export interface MerchantServices {
  merchantId: string;
  instagram: ServiceStatus;
  whatsapp: ServiceStatus;
  aiProcessing: ServiceStatus;
  autoReply: ServiceStatus;
  storyResponse: ServiceStatus;
  commentResponse: ServiceStatus;
  dmProcessing: ServiceStatus;
}

export interface ServiceToggleRequest {
  merchantId: string;
  service: 'instagram' | 'whatsapp' | 'ai_processing' | 'auto_reply' | 'story_response' | 'comment_response' | 'dm_processing';
  enabled: boolean;
  reason?: string;
  toggledBy?: string;
}

export interface ServiceHealth {
  service: string;
  status: 'healthy' | 'degraded' | 'disabled' | 'error';
  enabled: boolean;
  lastCheck: Date;
  errorCount: number;
  uptime: number;
}

export class ServiceController {
  private db = getDatabase();

  /**
   * Toggle service on/off for merchant
   */
  public async toggleService(request: ServiceToggleRequest): Promise<{
    success: boolean;
    message: string;
    previousState?: boolean;
  }> {
    try {
      const sql = this.db.getSQL();
      
      // Get current state
      const currentState = await this.getServiceStatus(request.merchantId, request.service);
      
      // Update service status
      await sql`
        INSERT INTO merchant_service_status (
          merchant_id,
          service_name,
          enabled,
          last_toggled,
          toggled_by,
          reason
        ) VALUES (
          ${request.merchantId}::uuid,
          ${request.service},
          ${request.enabled},
          NOW(),
          ${request.toggledBy || 'system'},
          ${request.reason}
        )
        ON CONFLICT (merchant_id, service_name)
        DO UPDATE SET
          enabled = EXCLUDED.enabled,
          last_toggled = EXCLUDED.last_toggled,
          toggled_by = EXCLUDED.toggled_by,
          reason = EXCLUDED.reason
      `;

      // Log the change
      await this.logServiceChange(request, currentState);

      const action = request.enabled ? 'تم تفعيل' : 'تم إيقاف';
      const serviceName = this.getServiceDisplayName(request.service);

      return {
        success: true,
        message: `${action} خدمة ${serviceName} بنجاح`,
        previousState: currentState
      };

    } catch (error) {
      console.error('❌ Failed to toggle service:', error);
      return {
        success: false,
        message: 'فشل في تغيير حالة الخدمة'
      };
    }
  }

  /**
   * Get service status for specific merchant and service
   */
  public async getServiceStatus(
    merchantId: string, 
    service: string
  ): Promise<boolean> {
    try {
      const sql = this.db.getSQL();
      
      const result = await sql`
        SELECT enabled
        FROM merchant_service_status
        WHERE merchant_id = ${merchantId}::uuid
        AND service_name = ${service}
      `;

      if (result.length === 0) {
        // Default to enabled for new merchants
        return true;
      }

      return result[0].enabled;
    } catch (error) {
      console.error('❌ Failed to get service status:', error);
      return false; // Fail safe
    }
  }

  /**
   * Get all services status for merchant
   */
  public async getAllServicesStatus(merchantId: string): Promise<MerchantServices> {
    try {
      const sql = this.db.getSQL();
      
      const result = await sql`
        SELECT 
          service_name,
          enabled,
          last_toggled,
          toggled_by,
          reason
        FROM merchant_service_status
        WHERE merchant_id = ${merchantId}::uuid
      `;

      const services: Record<string, ServiceStatus> = {};
      
      result.forEach(row => {
        services[row.service_name] = {
          enabled: row.enabled,
          lastToggled: row.last_toggled,
          toggledBy: row.toggled_by,
          reason: row.reason
        };
      });

      const defaultStatus: ServiceStatus = {
        enabled: true,
        lastToggled: new Date(),
        toggledBy: 'system'
      };

      return {
        merchantId,
        instagram: services.instagram || defaultStatus,
        whatsapp: services.whatsapp || { ...defaultStatus, enabled: false },
        aiProcessing: services.ai_processing || defaultStatus,
        autoReply: services.auto_reply || defaultStatus,
        storyResponse: services.story_response || defaultStatus,
        commentResponse: services.comment_response || defaultStatus,
        dmProcessing: services.dm_processing || defaultStatus
      };

    } catch (error) {
      console.error('❌ Failed to get all services status:', error);
      
      // Return default state on error
      const defaultStatus: ServiceStatus = {
        enabled: false,
        lastToggled: new Date(),
        toggledBy: 'system',
        reason: 'Error loading status'
      };

      return {
        merchantId,
        instagram: defaultStatus,
        whatsapp: defaultStatus,
        aiProcessing: defaultStatus,
        autoReply: defaultStatus,
        storyResponse: defaultStatus,
        commentResponse: defaultStatus,
        dmProcessing: defaultStatus
      };
    }
  }

  /**
   * Check if service is enabled before processing
   */
  public async isServiceEnabled(
    merchantId: string, 
    service: string
  ): Promise<boolean> {
    try {
      // First check if Instagram integration is enabled
      if (service !== 'instagram' && service !== 'whatsapp') {
        const platformEnabled = await this.getServiceStatus(merchantId, 'instagram');
        if (!platformEnabled) {
          return false;
        }
      }

      return await this.getServiceStatus(merchantId, service);
    } catch (error) {
      console.error('❌ Failed to check service enabled:', error);
      return false;
    }
  }

  /**
   * Enable all Instagram services for merchant
   */
  public async enableInstagramServices(
    merchantId: string, 
    toggledBy: string = 'system'
  ): Promise<boolean> {
    try {
      const instagramServices = [
        'instagram',
        'ai_processing', 
        'auto_reply',
        'story_response',
        'comment_response',
        'dm_processing'
      ];

      for (const service of instagramServices) {
        await this.toggleService({
          merchantId,
          service: service as any,
          enabled: true,
          toggledBy,
          reason: 'Instagram setup completion'
        });
      }

      console.log(`✅ All Instagram services enabled for merchant: ${merchantId}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to enable Instagram services:', error);
      return false;
    }
  }

  /**
   * Disable all services for merchant (maintenance mode)
   */
  public async disableAllServices(
    merchantId: string, 
    reason: string = 'Maintenance', 
    toggledBy: string = 'system'
  ): Promise<boolean> {
    try {
      const allServices = [
        'instagram',
        'whatsapp',
        'ai_processing',
        'auto_reply', 
        'story_response',
        'comment_response',
        'dm_processing'
      ];

      for (const service of allServices) {
        await this.toggleService({
          merchantId,
          service: service as any,
          enabled: false,
          toggledBy,
          reason
        });
      }

      console.log(`🛑 All services disabled for merchant: ${merchantId}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to disable all services:', error);
      return false;
    }
  }

  /**
   * Get services health status
   */
  public async getServicesHealth(merchantId: string): Promise<ServiceHealth[]> {
    try {
      const sql = this.db.getSQL();
      
      const healthData = await sql`
        SELECT 
          mss.service_name,
          mss.enabled,
          mss.last_toggled,
          COALESCE(se.error_count, 0) as error_count,
          COALESCE(se.last_error_at, mss.last_toggled) as last_check
        FROM merchant_service_status mss
        LEFT JOIN service_errors se ON (
          se.merchant_id = mss.merchant_id 
          AND se.service_name = mss.service_name
          AND se.created_at >= NOW() - INTERVAL '1 hour'
        )
        WHERE mss.merchant_id = ${merchantId}::uuid
      `;

      return healthData.map(row => {
        const uptime = Date.now() - new Date(row.last_toggled).getTime();
        let status: ServiceHealth['status'] = 'healthy';

        if (!row.enabled) {
          status = 'disabled';
        } else if (row.error_count > 10) {
          status = 'error';
        } else if (row.error_count > 5) {
          status = 'degraded';
        }

        return {
          service: this.getServiceDisplayName(row.service_name),
          status,
          enabled: row.enabled,
          lastCheck: row.last_check,
          errorCount: row.error_count,
          uptime: uptime
        };
      });

    } catch (error) {
      console.error('❌ Failed to get services health:', error);
      return [];
    }
  }

  /**
   * Record service error for monitoring
   */
  public async recordServiceError(
    merchantId: string,
    service: string,
    error: Error,
    context?: any
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();
      
      await sql`
        INSERT INTO service_errors (
          merchant_id,
          service_name,
          error_message,
          error_context,
          created_at
        ) VALUES (
          ${merchantId}::uuid,
          ${service},
          ${error.message},
          ${JSON.stringify(context || {})},
          NOW()
        )
        ON CONFLICT (merchant_id, service_name, DATE(created_at))
        DO UPDATE SET
          error_count = service_errors.error_count + 1,
          last_error_at = NOW(),
          error_message = EXCLUDED.error_message
      `;

      // Auto-disable service if too many errors
      const errorCount = await this.getServiceErrorCount(merchantId, service);
      if (errorCount > 50) {
        await this.toggleService({
          merchantId,
          service: service as any,
          enabled: false,
          reason: `Auto-disabled: ${errorCount} errors in last hour`,
          toggledBy: 'system'
        });
      }

    } catch (error) {
      console.error('❌ Failed to record service error:', error);
    }
  }

  /**
   * Private: Get service error count in last hour
   */
  private async getServiceErrorCount(
    merchantId: string, 
    service: string
  ): Promise<number> {
    try {
      const sql = this.db.getSQL();
      
      const result = await sql`
        SELECT COALESCE(error_count, 0) as count
        FROM service_errors
        WHERE merchant_id = ${merchantId}::uuid
        AND service_name = ${service}
        AND created_at >= NOW() - INTERVAL '1 hour'
      `;

      return result[0]?.count || 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Private: Log service change
   */
  private async logServiceChange(
    request: ServiceToggleRequest,
    previousState: boolean
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
          ${request.merchantId}::uuid,
          'SERVICE_TOGGLED',
          'SERVICE_CONTROL',
          ${JSON.stringify({
            service: request.service,
            enabled: request.enabled,
            previousState,
            reason: request.reason,
            toggledBy: request.toggledBy
          })},
          true
        )
      `;
    } catch (error) {
      console.error('❌ Failed to log service change:', error);
    }
  }

  /**
   * Private: Get service display name in Arabic
   */
  private getServiceDisplayName(service: string): string {
    const names = {
      'instagram': 'انستغرام',
      'whatsapp': 'واتساب',
      'ai_processing': 'معالجة الذكاء الاصطناعي',
      'auto_reply': 'الرد التلقائي',
      'story_response': 'الرد على الستوريز',
      'comment_response': 'الرد على التعليقات',
      'dm_processing': 'معالجة الرسائل المباشرة'
    };

    return names[service] || service;
  }
}

// Singleton instance
let serviceControllerInstance: ServiceController | null = null;

/**
 * Get service controller instance
 */
export function getServiceController(): ServiceController {
  if (!serviceControllerInstance) {
    serviceControllerInstance = new ServiceController();
  }
  return serviceControllerInstance;
}

export default ServiceController;