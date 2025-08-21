/**
 * ===============================================
 * Utility Messages API (2025 Feature)
 * REST endpoints for Instagram Utility Messages
 * Order updates, notifications, appointment reminders
 * ===============================================
 */

import { Hono } from 'hono';
import { validator } from 'hono/validator';
import { getUtilityMessagesService, type UtilityMessageType } from '../services/utility-messages.js';
import { securityHeaders, rateLimiter } from '../middleware/security.js';
import { z } from 'zod';
import { getDatabase } from '../database/connection.js';

// Validation schemas
const SendUtilityMessageSchema = z.object({
  recipient_id: z.string().min(1, 'معرف المستلم مطلوب'),
  template_id: z.string().uuid('معرف القالب يجب أن يكون UUID صالح'),
  variables: z.record(z.string()).default({}),
  message_type: z.enum([
    'ORDER_UPDATE',
    'ACCOUNT_NOTIFICATION', 
    'APPOINTMENT_REMINDER',
    'DELIVERY_NOTIFICATION',
    'PAYMENT_UPDATE'
  ])
});

const CreateTemplateSchema = z.object({
  name: z.string().min(1, 'اسم القالب مطلوب'),
  type: z.enum([
    'ORDER_UPDATE',
    'ACCOUNT_NOTIFICATION', 
    'APPOINTMENT_REMINDER',
    'DELIVERY_NOTIFICATION',
    'PAYMENT_UPDATE'
  ]),
  content: z.string().min(10, 'محتوى القالب يجب أن يكون 10 أحرف على الأقل'),
  variables: z.array(z.string()).default([])
});

const MerchantIdSchema = z.object({
  merchantId: z.string().uuid('معرف التاجر يجب أن يكون UUID صالح')
});

const app = new Hono();

// Setup middleware
app.use('*', securityHeaders);
app.use('/api/utility-messages/*', rateLimiter);

/**
 * إرسال رسالة خدمية (Order update, notification, reminder)
 */
app.post('/api/utility-messages/:merchantId/send', 
  validator('param', (value, c) => {
    const parsed = MerchantIdSchema.safeParse(value);
    if (!parsed.success) {
      return c.json({ error: 'معرف التاجر غير صالح', details: parsed.error.issues }, 400);
    }
    return parsed.data;
  }),
  validator('json', (value, c) => {
    const parsed = SendUtilityMessageSchema.safeParse(value);
    if (!parsed.success) {
      return c.json({ error: 'بيانات الرسالة غير صالحة', details: parsed.error.issues }, 400);
    }
    return parsed.data;
  }),
  async (c) => {
    try {
      const { merchantId } = c.req.valid('param');
      const messageData = c.req.valid('json');
      
      const utilityService = getUtilityMessagesService();
      
      const result = await utilityService.sendUtilityMessage(merchantId, messageData);
      
      if (result.success) {
        console.log(`✅ Utility message sent for merchant ${merchantId}`);
        
        return c.json({
          success: true,
          message_id: result.message_id,
          message_type: messageData.message_type,
          sent_at: result.timestamp.toISOString(),
          recipient_id: messageData.recipient_id,
          instructions: {
            ar: 'تم إرسال الرسالة الخدمية بنجاح',
            en: 'Utility message sent successfully'
          }
        });
      } else {
        console.error(`❌ Failed to send utility message for merchant ${merchantId}:`, result.error);
        
        return c.json({
          success: false,
          error: result.error,
          message_type: messageData.message_type,
          timestamp: result.timestamp.toISOString()
        }, 400);
      }
      
    } catch (error) {
      console.error('❌ Utility message API error:', error);
      const err = error instanceof Error ? error : new Error(String(error));
      
      return c.json({
        error: 'فشل في إرسال الرسالة الخدمية',
        details: err.message,
        timestamp: new Date().toISOString()
      }, 500);
    }
  }
);

/**
 * إنشاء قالب رسالة خدمية جديد
 */
app.post('/api/utility-messages/:merchantId/templates',
  validator('param', (value, c) => {
    const parsed = MerchantIdSchema.safeParse(value);
    if (!parsed.success) {
      return c.json({ error: 'معرف التاجر غير صالح', details: parsed.error.issues }, 400);
    }
    return parsed.data;
  }),
  validator('json', (value, c) => {
    const parsed = CreateTemplateSchema.safeParse(value);
    if (!parsed.success) {
      return c.json({ error: 'بيانات القالب غير صالحة', details: parsed.error.issues }, 400);
    }
    return parsed.data;
  }),
  async (c) => {
    try {
      const { merchantId } = c.req.valid('param');
      const templateData = c.req.valid('json');
      
      const utilityService = getUtilityMessagesService();
      
      const result = await utilityService.createUtilityTemplate(merchantId, templateData);
      
      if (result.success) {
        console.log(`✅ Utility template created for merchant ${merchantId}`);
        
        return c.json({
          success: true,
          template_id: result.template_id,
          name: templateData.name,
          type: templateData.type,
          approved: true, // Auto-approved for page-owned templates (2025)
          created_at: new Date().toISOString(),
          compliance_note: {
            ar: 'تم الموافقة على القالب تلقائياً - يمكن استخدامه فوراً',
            en: 'Template auto-approved - ready for immediate use'
          }
        });
      } else {
        console.error(`❌ Failed to create utility template for merchant ${merchantId}:`, result.error);
        
        return c.json({
          success: false,
          error: result.error,
          template_name: templateData.name
        }, 400);
      }
      
    } catch (error) {
      console.error('❌ Template creation API error:', error);
      const err = error instanceof Error ? error : new Error(String(error));
      
      return c.json({
        error: 'فشل في إنشاء القالب',
        details: err.message,
        timestamp: new Date().toISOString()
      }, 500);
    }
  }
);

/**
 * الحصول على قوائم القوالب للتاجر
 */
app.get('/api/utility-messages/:merchantId/templates',
  validator('param', (value, c) => {
    const parsed = MerchantIdSchema.safeParse(value);
    if (!parsed.success) {
      return c.json({ error: 'معرف التاجر غير صالح', details: parsed.error.issues }, 400);
    }
    return parsed.data;
  }),
  async (c) => {
    try {
      const { merchantId } = c.req.valid('param');
      
      const utilityService = getUtilityMessagesService();
      const templates = await utilityService.getTemplates(merchantId);
      
      return c.json({
        success: true,
        templates: templates.map(template => ({
          id: template.id,
          name: template.name,
          type: template.type,
          content: template.content,
          variables: template.variables,
          approved: template.approved,
          created_at: template.created_at.toISOString(),
          updated_at: template.updated_at.toISOString()
        })),
        total_count: templates.length,
        supported_types: [
          {
            type: 'ORDER_UPDATE',
            description: 'تحديثات الطلبات والتأكيدات',
            examples: ['تأكيد الطلب', 'تحديث حالة الطلب', 'إلغاء الطلب']
          },
          {
            type: 'DELIVERY_NOTIFICATION', 
            description: 'إشعارات التوصيل والشحن',
            examples: ['خروج الطلب للتوصيل', 'وصول الطلب', 'تأخير التوصيل']
          },
          {
            type: 'PAYMENT_UPDATE',
            description: 'تحديثات الدفع والفواتير', 
            examples: ['تأكيد الدفع', 'فشل الدفع', 'استرداد المبلغ']
          },
          {
            type: 'ACCOUNT_NOTIFICATION',
            description: 'إشعارات الحساب والأمان',
            examples: ['تحديث كلمة المرور', 'تسجيل دخول جديد', 'تعطيل الحساب']
          },
          {
            type: 'APPOINTMENT_REMINDER',
            description: 'تذكير المواعيد والحجوزات',
            examples: ['تذكير بالموعد', 'إلغاء الموعد', 'تأكيد الحجز']
          }
        ]
      });
      
    } catch (error) {
      console.error('❌ Get templates API error:', error);
      const err = error instanceof Error ? error : new Error(String(error));
      
      return c.json({
        error: 'فشل في جلب القوالب',
        details: err.message,
        timestamp: new Date().toISOString()
      }, 500);
    }
  }
);

/**
 * إنشاء القوالب الافتراضية للتاجر
 */
app.post('/api/utility-messages/:merchantId/setup-defaults',
  validator('param', (value, c) => {
    const parsed = MerchantIdSchema.safeParse(value);
    if (!parsed.success) {
      return c.json({ error: 'معرف التاجر غير صالح', details: parsed.error.issues }, 400);
    }
    return parsed.data;
  }),
  async (c) => {
    try {
      const { merchantId } = c.req.valid('param');
      
      const utilityService = getUtilityMessagesService();
      await utilityService.createDefaultTemplates(merchantId);
      
      const templates = await utilityService.getTemplates(merchantId);
      
      return c.json({
        success: true,
        message: 'تم إنشاء القوالب الافتراضية بنجاح',
        templates_created: templates.length,
        ready_for_use: true,
        next_steps: {
          ar: 'يمكنك الآن إرسال رسائل خدمية باستخدام القوالب المنشأة',
          en: 'You can now send utility messages using the created templates'
        }
      });
      
    } catch (error) {
      console.error('❌ Setup defaults API error:', error);
      const err = error instanceof Error ? error : new Error(String(error));
      
      return c.json({
        error: 'فشل في إنشاء القوالب الافتراضية',
        details: err.message,
        timestamp: new Date().toISOString()
      }, 500);
    }
  }
);

/**
 * إحصائيات الرسائل الخدمية
 */
app.get('/api/utility-messages/:merchantId/stats',
  validator('param', (value, c) => {
    const parsed = MerchantIdSchema.safeParse(value);
    if (!parsed.success) {
      return c.json({ error: 'معرف التاجر غير صالح', details: parsed.error.issues }, 400);
    }
    return parsed.data;
  }),
  async (c) => {
    try {
      const { merchantId } = c.req.valid('param');
      const db = getDatabase();
      const sql = db.getSQL();

      try {
        const [counts] = await sql`
          SELECT 
            COUNT(*) AS total_sent,
            COUNT(*) FILTER (WHERE sent_at >= DATE_TRUNC('day', NOW())) AS sent_today,
            COUNT(*) FILTER (WHERE sent_at >= DATE_TRUNC('week', NOW())) AS sent_this_week,
            COUNT(*) FILTER (WHERE sent_at >= DATE_TRUNC('month', NOW())) AS sent_this_month,
            MAX(sent_at) AS last_sent
          FROM utility_message_logs
          WHERE merchant_id = ${merchantId}::uuid
        `;

        const typeRows = await sql`
          SELECT message_type, COUNT(*) AS count
          FROM utility_message_logs
          WHERE merchant_id = ${merchantId}::uuid
          GROUP BY message_type
        `;

        const byType: Record<UtilityMessageType, number> = {
          ORDER_UPDATE: 0,
          DELIVERY_NOTIFICATION: 0,
          PAYMENT_UPDATE: 0,
          ACCOUNT_NOTIFICATION: 0,
          APPOINTMENT_REMINDER: 0
        };

        for (const row of typeRows) {
          const type = row.message_type as UtilityMessageType;
          byType[type] = Number(row.count);
        }

        return c.json({
          success: true,
          merchant_id: merchantId,
          stats: {
            total_sent: Number(counts.total_sent || 0),
            sent_today: Number(counts.sent_today || 0),
            sent_this_week: Number(counts.sent_this_week || 0),
            sent_this_month: Number(counts.sent_this_month || 0),
            by_type: byType,
            compliance_status: 'compliant',
            last_sent: counts.last_sent ? new Date(counts.last_sent).toISOString() : null
          },
          period: {
            from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
            to: new Date().toISOString()
          }
        });

      } catch (dbError) {
        console.error('❌ Failed to fetch utility message stats:', dbError);
        const err = dbError instanceof Error ? dbError : new Error(String(dbError));
        return c.json({
          error: 'فشل في الاستعلام عن الإحصائيات',
          details: err.message,
          timestamp: new Date().toISOString()
        }, 500);
      }

    } catch (error) {
      console.error('❌ Get stats API error:', error);
      const err = error instanceof Error ? error : new Error(String(error));

      return c.json({
        error: 'فشل في جلب الإحصائيات',
        details: err.message,
        timestamp: new Date().toISOString()
      }, 500);
    }
  }
);

export default app;