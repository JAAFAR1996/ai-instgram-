/**
 * ===============================================
 * Service Control API Routes - REST endpoints للتحكم في الخدمات
 * Provides REST API endpoints for managing service on/off states
 * ===============================================
 */

import { Hono, Context } from 'hono';
import { cors } from 'hono/cors';
import { zValidator } from '@hono/zod-validator';
import { getServiceController } from '../services/service-controller.js';
import { securityHeaders, rateLimiter } from '../middleware/security.js';
import { z } from 'zod';
import { getConfig } from '../config/index.js';
import { ToggleServiceSchema, ServiceNameSchema } from '../types/service-control.js';


export class ServiceControlAPI {
  private app: Hono;
  private serviceController = getServiceController();

  constructor() {
    this.app = new Hono();
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup middleware
   */
  private setupMiddleware(): void {
    // Security headers
    this.app.use('*', securityHeaders);
    
    // CORS for API endpoints
    const config = getConfig();
    this.app.use('/api/services/*', cors({
      origin: [config.baseUrl],
      allowHeaders: ['Content-Type', 'Authorization']
    }));

    // Rate limiting
    this.app.use('/api/services/*', rateLimiter);
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Toggle specific service
    this.app.post(
      '/api/services/toggle',
      zValidator('json', ToggleServiceSchema),
      this.toggleService.bind(this)
    );

    // Get merchant services status
    this.app.get('/api/services/:merchantId/status', this.getServicesStatus.bind(this));

    // Get specific service status
    this.app.get('/api/services/:merchantId/:service/status', this.getServiceStatus.bind(this));

    // Enable all Instagram services
    this.app.post('/api/services/:merchantId/instagram/enable-all', this.enableInstagramServices.bind(this));

    // Disable all services (maintenance mode)
    this.app.post('/api/services/:merchantId/disable-all', this.disableAllServices.bind(this));

    // Get services health
    this.app.get('/api/services/:merchantId/health', this.getServicesHealth.bind(this));

    // Service control dashboard endpoints
    this.app.get('/api/services/overview', this.getServicesOverview.bind(this));
  }

  /**
   * Toggle service on/off
   */
  private async toggleService(c: any) {
    try {
      const data = c.req.valid('json');
      
      const result = await this.serviceController.toggleService(data);
      
      if (result.success) {
        return c.json({
          success: true,
          message: result.message,
          data: {
            service: data.service,
            enabled: data.enabled,
            previousState: result.previousState
          }
        });
      } else {
        return c.json({
          success: false,
          message: result.message
        }, 400);
      }
    } catch (error) {
      // API error logged via security middleware
      return c.json({
        success: false,
        message: 'خطأ في النظام'
      }, 500);
    }
  }

  /**
   * Get all services status for merchant
   */
  private async getServicesStatus(c: Context) {
    try {
      const merchantId = c.req.param('merchantId');
      
      // Validate merchant ID
      const validation = z.string().uuid().safeParse(merchantId);
      if (!validation.success) {
        return c.json({
          error: 'معرف التاجر غير صحيح'
        }, 400);
      }

      const services = await this.serviceController.getAllServicesStatus(merchantId);
      
      return c.json({
        success: true,
        data: services
      });
    } catch (error) {
      // API error logged via security middleware
      return c.json({
        success: false,
        message: 'خطأ في تحميل حالة الخدمات'
      }, 500);
    }
  }

  /**
   * Get specific service status
   */
  private async getServiceStatus(c: Context) {
    try {
      const merchantId = c.req.param('merchantId');
      const service = c.req.param('service');
      
      // Validate parameters
      const merchantValidation = z.string().uuid().safeParse(merchantId);
      if (!merchantValidation.success) {
        return c.json({
          error: 'معرف التاجر غير صحيح'
        }, 400);
      }

      const serviceValidation = ServiceNameSchema.safeParse(service);
      if (!serviceValidation.success) {
        return c.json({
          error: 'اسم الخدمة غير صحيح'
        }, 400);
      }

      const enabled = await this.serviceController.getServiceStatus(merchantId, service);
      
      return c.json({
        success: true,
        data: {
          merchantId,
          service,
          enabled
        }
      });
    } catch (error) {
      // API error logged via security middleware
      return c.json({
        success: false,
        message: 'خطأ في تحميل حالة الخدمة'
      }, 500);
    }
  }

  /**
   * Enable all Instagram services
   */
  private async enableInstagramServices(c: Context) {
    try {
      const merchantId = c.req.param('merchantId');
      
      // Validate merchant ID
      const validation = z.string().uuid().safeParse(merchantId);
      if (!validation.success) {
        return c.json({
          error: 'معرف التاجر غير صحيح'
        }, 400);
      }

      const toggledBy = c.req.header('X-User-ID') || 'api';
      const success = await this.serviceController.enableInstagramServices(merchantId, toggledBy);
      
      if (success) {
        return c.json({
          success: true,
          message: 'تم تفعيل جميع خدمات Instagram بنجاح'
        });
      } else {
        return c.json({
          success: false,
          message: 'فشل في تفعيل خدمات Instagram'
        }, 400);
      }
    } catch (error) {
      // API error logged via security middleware
      return c.json({
        success: false,
        message: 'خطأ في تفعيل خدمات Instagram'
      }, 500);
    }
  }

  /**
   * Disable all services (maintenance mode)
   */
  private async disableAllServices(c: Context) {
    try {
      const merchantId = c.req.param('merchantId');
      
      // Validate merchant ID
      const validation = z.string().uuid().safeParse(merchantId);
      if (!validation.success) {
        return c.json({
          error: 'معرف التاجر غير صحيح'
        }, 400);
      }

      const body = await c.req.json().catch(() => ({}));
      const reason = body.reason || 'Maintenance mode';
      const toggledBy = c.req.header('X-User-ID') || 'api';
      
      const success = await this.serviceController.disableAllServices(merchantId, reason, toggledBy);
      
      if (success) {
        return c.json({
          success: true,
          message: 'تم إيقاف جميع الخدمات بنجاح'
        });
      } else {
        return c.json({
          success: false,
          message: 'فشل في إيقاف الخدمات'
        }, 400);
      }
    } catch (error) {
      // API error logged via security middleware
      return c.json({
        success: false,
        message: 'خطأ في إيقاف الخدمات'
      }, 500);
    }
  }

  /**
   * Get services health status
   */
  private async getServicesHealth(c: Context) {
    try {
      const merchantId = c.req.param('merchantId');
      
      // Validate merchant ID
      const validation = z.string().uuid().safeParse(merchantId);
      if (!validation.success) {
        return c.json({
          error: 'معرف التاجر غير صحيح'
        }, 400);
      }

      const health = await this.serviceController.getServicesHealth(merchantId);
      
      return c.json({
        success: true,
        data: {
          merchantId,
          services: health,
          lastUpdated: new Date().toISOString()
        }
      });
    } catch (error) {
      // API error logged via security middleware
      return c.json({
        success: false,
        message: 'خطأ في تحميل حالة صحة الخدمات'
      }, 500);
    }
  }

  /**
   * Get services overview (admin endpoint)
   */
  private async getServicesOverview(c: Context) {
    try {
      // This would be protected by admin authentication in production
      const db = this.serviceController['db'];
      const sql = db.getSQL();
      
      const overview = await sql`
        SELECT 
          m.id,
          m.business_name,
          COUNT(mss.service_name) as total_services,
          COUNT(CASE WHEN mss.enabled = true THEN 1 END) as enabled_services,
          COUNT(CASE WHEN mss.enabled = false THEN 1 END) as disabled_services,
          MAX(mss.last_toggled) as last_change
        FROM merchants m
        LEFT JOIN merchant_service_status mss ON m.id = mss.merchant_id
        WHERE m.subscription_status = 'ACTIVE'
        GROUP BY m.id, m.business_name
        ORDER BY last_change DESC NULLS LAST
        LIMIT 50
      `;
      
      return c.json({
        success: true,
        data: {
          merchants: overview,
          summary: {
            totalMerchants: overview.length,
            timestamp: new Date().toISOString()
          }
        }
      });
    } catch (error) {
      // API error logged via security middleware
      return c.json({
        success: false,
        message: 'خطأ في تحميل نظرة عامة على الخدمات'
      }, 500);
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
let serviceControlAPIInstance: ServiceControlAPI | null = null;

export function getServiceControlAPI(): ServiceControlAPI {
  if (!serviceControlAPIInstance) {
    serviceControlAPIInstance = new ServiceControlAPI();
  }
  return serviceControlAPIInstance;
}

export default ServiceControlAPI;