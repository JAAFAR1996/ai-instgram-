/**
 * ===============================================
 * Simple Admin UI + API for Merchant Onboarding
 * Protected with Basic Auth (ADMIN_USER / ADMIN_PASS)
 * ===============================================
 */

import { Hono } from 'hono';
import { getLogger } from '../services/logger.js';
import { getDatabase } from '../db/adapter.js';
import { z } from 'zod';
import { getCache } from '../cache/index.js';
import * as jwt from 'jsonwebtoken';
import { checkPredictiveServicesHealth, runManualPredictiveAnalytics } from '../startup/predictive-services.js';
import { randomUUID } from 'crypto';

const log = getLogger({ component: 'admin-routes' });

function requireAdminAuth(req: Request): void {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Basic ')) throw new Error('Unauthorized');
  const creds = Buffer.from(auth.slice(6), 'base64').toString('utf8');
  const [user, pass] = creds.split(':');
  const ADMIN_USER = process.env.ADMIN_USER || 'admin';
  const ADMIN_PASS = process.env.ADMIN_PASS ?? '';
  if (!ADMIN_PASS) throw new Error('Admin not configured');
  if (user !== ADMIN_USER || pass !== ADMIN_PASS) throw new Error('Unauthorized');
}

const CreateMerchantSchema = z.object({
  business_name: z.string().min(2).max(255),
  business_category: z.string().min(2).max(100).optional().default('general'),
  whatsapp_number: z.string().min(6).max(20),
  instagram_username: z.string().min(0).max(100).optional().default(''),
  email: z.string().email().optional(),
  currency: z.string().length(3).optional().default('IQD'),
  settings: z.record(z.any()).optional(),
  ai_config: z.record(z.any()).optional()
}).strict();

// Schema for complete merchant registration
const CompleteMerchantSchema = z.object({
  // Basic Business Information
  business_name: z.string().min(2).max(255),
  business_category: z.string().min(2).max(100).default('general'),
  business_address: z.string().optional(),
  business_description: z.string().optional(),
  
  // Contact Information
  whatsapp_number: z.string().min(6).max(20),
  instagram_username: z.string().min(0).max(100).optional(),
  email: z.string().email().optional(),
  
  // Business Settings
  currency: z.string().length(3).default('IQD'),
  timezone: z.string().default('Asia/Baghdad'),
  
  // Working Hours
  working_hours: z.object({
    enabled: z.boolean().default(true),
    schedule: z.object({
      sunday: z.object({ open: z.string(), close: z.string(), enabled: z.boolean() }).optional(),
      monday: z.object({ open: z.string(), close: z.string(), enabled: z.boolean() }).optional(),
      tuesday: z.object({ open: z.string(), close: z.string(), enabled: z.boolean() }).optional(),
      wednesday: z.object({ open: z.string(), close: z.string(), enabled: z.boolean() }).optional(),
      thursday: z.object({ open: z.string(), close: z.string(), enabled: z.boolean() }).optional(),
      friday: z.object({ open: z.string(), close: z.string(), enabled: z.boolean() }).optional(),
      saturday: z.object({ open: z.string(), close: z.string(), enabled: z.boolean() }).optional(),
    }).optional()
  }).optional(),
  
  // Payment Methods
  payment_methods: z.array(z.string()).default(['COD']),
  
  // Delivery Settings
  delivery_fees: z.object({
    inside_baghdad: z.number().default(0),
    outside_baghdad: z.number().default(5)
  }).optional(),
  
  // AI Configuration
  ai_config: z.object({
    model: z.string().default('gpt-4o-mini'),
    temperature: z.number().min(0).max(1).default(0.8),
    max_tokens: z.number().min(50).max(1000).default(600),
    language: z.string().default('ar'),
    sales_style: z.enum(['friendly', 'professional', 'casual', 'neutral']).default('neutral'),
    
    // Product Knowledge
    categories: z.array(z.string()).optional(),
    brands: z.array(z.string()).optional(),
    colors: z.array(z.string()).optional(),
    sizes: z.array(z.string()).optional(),
    
    // Custom Entities
    synonyms: z.record(z.array(z.string())).optional(),
    custom_entities: z.record(z.array(z.string())).optional()
  }).optional(),
  
  // Response Templates
  response_templates: z.object({
    greeting: z.string().optional(),
    fallback: z.string().optional(),
    outside_hours: z.string().optional(),
    thank_you: z.string().optional()
  }).optional(),
  
  // Products (Optional - can be added later)
  products: z.array(z.object({
    sku: z.string(),
    name_ar: z.string(),
    name_en: z.string().optional(),
    description_ar: z.string().optional(),
    category: z.string().default('general'),
    price_usd: z.number().min(0),
    stock_quantity: z.number().min(0).default(0),
    attributes: z.record(z.any()).optional(),
    images: z.array(z.string()).optional()
  })).optional()
});

const SettingsPatchSchema = z.object({
  payment_methods: z.array(z.string().min(1).max(40)).max(10).optional(),
  delivery_fees: z.record(z.union([z.string(), z.number()])).optional(),
  working_hours: z.any().optional(),
  auto_responses: z.record(z.string()).optional()
}).strict();

const AIConfigPatchSchema = z.object({
  model: z.string().min(2).max(120).optional(),
  temperature: z.number().min(0).max(1).optional(),
  maxTokens: z.number().int().min(50).max(1000).optional(),
  language: z.string().min(2).max(10).optional()
}).strict();

export function registerAdminRoutes(app: Hono) {
  const db = getDatabase();
  const sql = db.getSQL();
  const cache = getCache();

  async function invalidate(merchantId: string) {
    try {
      await cache.delete(`merchant:ctx:${merchantId}`, { prefix: 'ctx' });
      await cache.delete(`merchant:cats:${merchantId}`, { prefix: 'ctx' });
    } catch (e) {
      log.warn('Cache invalidation failed', { merchantId, error: String(e) });
    }
  }

  // Service Management Page
  app.get('/admin/services/:merchantId', async (c) => {
    try {
      requireAdminAuth(c.req.raw);
    } catch (e) {
      return c.text('Unauthorized', 401, { 'WWW-Authenticate': 'Basic realm="admin"' });
    }

    const merchantId = c.req.param('merchantId');
    
    // Get merchant info and services status dynamically
    const merchantRows = await sql<{ business_name: string; business_category: string; whatsapp_number: string; instagram_username: string }>`
      SELECT business_name, business_category, whatsapp_number, instagram_username FROM merchants WHERE id = ${merchantId}::uuid
    `;
    
    if (merchantRows.length === 0) {
      return c.text('Merchant not found', 404);
    }
    
    const merchant = merchantRows[0];
    
    // Get services status dynamically
    const services = await sql<{ service_name: string; enabled: boolean; last_updated: Date; toggled_by: string; reason: string }>`
      SELECT service_name, enabled, last_updated, toggled_by, reason
      FROM service_control 
      WHERE merchant_id = ${merchantId}::uuid 
      ORDER BY service_name
    `;
    
    // services is used in the HTML template below
    const servicesCount = services.length; // Force usage of services variable

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>إدارة الخدمات - ${merchant.business_name}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
        }
        .header p {
            font-size: 1.1rem;
            opacity: 0.9;
        }
        .content {
            padding: 40px;
        }
        .service-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .service-card {
            background: white;
            border: 2px solid #e9ecef;
            border-radius: 15px;
            padding: 25px;
            transition: all 0.3s ease;
        }
        .service-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 25px rgba(0,0,0,0.1);
        }
        .service-card.enabled {
            border-color: #28a745;
            background: linear-gradient(135deg, #f8fff9 0%, #e8f5e8 100%);
        }
        .service-card.disabled {
            border-color: #dc3545;
            background: linear-gradient(135deg, #fff8f8 0%, #f5e8e8 100%);
        }
        .service-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 15px;
        }
        .service-icon {
            font-size: 2.5rem;
            margin-left: 15px;
        }
        .service-title {
            font-size: 1.3rem;
            font-weight: bold;
            color: #1e3c72;
        }
        .service-status {
            padding: 5px 12px;
            border-radius: 20px;
            font-size: 0.9rem;
            font-weight: bold;
        }
        .status-enabled {
            background: #d4edda;
            color: #155724;
        }
        .status-disabled {
            background: #f8d7da;
            color: #721c24;
        }
        .service-description {
            color: #666;
            margin-bottom: 15px;
            line-height: 1.5;
        }
        .service-actions {
            display: flex;
            gap: 10px;
        }
        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.3s ease;
        }
        .btn-enable {
            background: #28a745;
            color: white;
        }
        .btn-disable {
            background: #dc3545;
            color: white;
        }
        .btn-info {
            background: #17a2b8;
            color: white;
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 3px 10px rgba(0,0,0,0.2);
        }
        .bulk-actions {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 30px;
            text-align: center;
        }
        .bulk-actions h3 {
            color: #1e3c72;
            margin-bottom: 15px;
        }
        .bulk-buttons {
            display: flex;
            gap: 15px;
            justify-content: center;
            flex-wrap: wrap;
        }
        .btn-bulk {
            padding: 12px 25px;
            font-size: 16px;
        }
        .btn-primary {
            background: #1e3c72;
            color: white;
        }
        .btn-warning {
            background: #ffc107;
            color: #212529;
        }
        .btn-danger {
            background: #dc3545;
            color: white;
        }
        .service-info {
            font-size: 0.9rem;
            color: #999;
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px solid #e9ecef;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>⚙️ إدارة الخدمات</h1>
            <p>${merchant.business_name} - ${merchant.business_category}</p>
            <p>واتساب: ${merchant.whatsapp_number} | إنستغرام: ${merchant.instagram_username || 'غير محدد'}</p>
            <p>عدد الخدمات: ${servicesCount}</p>
        </div>
        
        <div class="content">
            <div class="bulk-actions">
                <h3>إجراءات جماعية</h3>
                <div class="bulk-buttons">
                    <button class="btn btn-bulk btn-primary" onclick="enableAllServices()">✅ تفعيل جميع الخدمات</button>
                    <button class="btn btn-bulk btn-warning" onclick="disableAllServices()">⏸️ إيقاف جميع الخدمات</button>
                    <button class="btn btn-bulk btn-danger" onclick="maintenanceMode()">🔧 وضع الصيانة</button>
                </div>
            </div>
            
            <div class="service-grid">
                <div class="service-card \${services.find(s => s.service_name === 'instagram')?.enabled ? 'enabled' : 'disabled'}">
                    <div class="service-header">
                        <div>
                            <span class="service-icon">📸</span>
                            <span class="service-title">خدمة إنستغرام</span>
                        </div>
                        <span class="service-status \${services.find(s => s.service_name === 'instagram')?.enabled ? 'status-enabled' : 'status-disabled'}">
                            \${services.find(s => s.service_name === 'instagram')?.enabled ? 'مفعل' : 'معطل'}
                        </span>
                    </div>
                    <div class="service-description">
                        معالجة رسائل إنستغرام المباشرة والرد التلقائي على التعليقات والقصص
                    </div>
                    <div class="service-actions">
                        \${services.find(s => s.service_name === 'instagram')?.enabled ? 
                            '<button class="btn btn-disable" onclick="toggleService(\'instagram\', false)">إيقاف</button>' :
                            '<button class="btn btn-enable" onclick="toggleService(\'instagram\', true)">تفعيل</button>'
                        }
                        <button class="btn btn-info" onclick="showServiceInfo('instagram')">معلومات</button>
                    </div>
                    <div class="service-info">
                        آخر تحديث: \${services.find(s => s.service_name === 'instagram')?.last_updated ? new Date(services.find(s => s.service_name === 'instagram').last_updated).toLocaleString('ar-SA') : 'غير محدد'}
                    </div>
                </div>

                <div class="service-card \${services.find(s => s.service_name === 'ai_processing')?.enabled ? 'enabled' : 'disabled'}">
                    <div class="service-header">
                        <div>
                            <span class="service-icon">🤖</span>
                            <span class="service-title">معالجة الذكاء الاصطناعي</span>
                        </div>
                        <span class="service-status \${services.find(s => s.service_name === 'ai_processing')?.enabled ? 'status-enabled' : 'status-disabled'}">
                            \${services.find(s => s.service_name === 'ai_processing')?.enabled ? 'مفعل' : 'معطل'}
                        </span>
                    </div>
                    <div class="service-description">
                        معالجة الرسائل بالذكاء الاصطناعي وتوليد الردود الذكية
                    </div>
                    <div class="service-actions">
                        \${services.find(s => s.service_name === 'ai_processing')?.enabled ? 
                            '<button class="btn btn-disable" onclick="toggleService(\'ai_processing\', false)">إيقاف</button>' :
                            '<button class="btn btn-enable" onclick="toggleService(\'ai_processing\', true)">تفعيل</button>'
                        }
                        <button class="btn btn-info" onclick="showServiceInfo('ai_processing')">معلومات</button>
                    </div>
                    <div class="service-info">
                        آخر تحديث: \${services.find(s => s.service_name === 'ai_processing')?.last_updated ? new Date(services.find(s => s.service_name === 'ai_processing').last_updated).toLocaleString('ar-SA') : 'غير محدد'}
                    </div>
                </div>

                <div class="service-card \${services.find(s => s.service_name === 'auto_reply')?.enabled ? 'enabled' : 'disabled'}">
                    <div class="service-header">
                        <div>
                            <span class="service-icon">🔄</span>
                            <span class="service-title">الرد التلقائي</span>
                        </div>
                        <span class="service-status \${services.find(s => s.service_name === 'auto_reply')?.enabled ? 'status-enabled' : 'status-disabled'}">
                            \${services.find(s => s.service_name === 'auto_reply')?.enabled ? 'مفعل' : 'معطل'}
                        </span>
                    </div>
                    <div class="service-description">
                        إرسال ردود تلقائية للعملاء الجدد وخارج ساعات العمل
                    </div>
                    <div class="service-actions">
                        \${services.find(s => s.service_name === 'auto_reply')?.enabled ? 
                            '<button class="btn btn-disable" onclick="toggleService(\'auto_reply\', false)">إيقاف</button>' :
                            '<button class="btn btn-enable" onclick="toggleService(\'auto_reply\', true)">تفعيل</button>'
                        }
                        <button class="btn btn-info" onclick="showServiceInfo('auto_reply')">معلومات</button>
                    </div>
                    <div class="service-info">
                        آخر تحديث: \${services.find(s => s.service_name === 'auto_reply')?.last_updated ? new Date(services.find(s => s.service_name === 'auto_reply').last_updated).toLocaleString('ar-SA') : 'غير محدد'}
                    </div>
                </div>

                <div class="service-card \${services.find(s => s.service_name === 'story_response')?.enabled ? 'enabled' : 'disabled'}">
                    <div class="service-header">
                        <div>
                            <span class="service-icon">📱</span>
                            <span class="service-title">رد القصص</span>
                        </div>
                        <span class="service-status \${services.find(s => s.service_name === 'story_response')?.enabled ? 'status-enabled' : 'status-disabled'}">
                            \${services.find(s => s.service_name === 'story_response')?.enabled ? 'مفعل' : 'معطل'}
                        </span>
                    </div>
                    <div class="service-description">
                        الرد التلقائي على تفاعلات القصص في إنستغرام
                    </div>
                    <div class="service-actions">
                        \${services.find(s => s.service_name === 'story_response')?.enabled ? 
                            '<button class="btn btn-disable" onclick="toggleService(\'story_response\', false)">إيقاف</button>' :
                            '<button class="btn btn-enable" onclick="toggleService(\'story_response\', true)">تفعيل</button>'
                        }
                        <button class="btn btn-info" onclick="showServiceInfo('story_response')">معلومات</button>
                    </div>
                    <div class="service-info">
                        آخر تحديث: \${services.find(s => s.service_name === 'story_response')?.last_updated ? new Date(services.find(s => s.service_name === 'story_response').last_updated).toLocaleString('ar-SA') : 'غير محدد'}
                    </div>
                </div>

                <div class="service-card \${services.find(s => s.service_name === 'comment_response')?.enabled ? 'enabled' : 'disabled'}">
                    <div class="service-header">
                        <div>
                            <span class="service-icon">💬</span>
                            <span class="service-title">رد التعليقات</span>
                        </div>
                        <span class="service-status \${services.find(s => s.service_name === 'comment_response')?.enabled ? 'status-enabled' : 'status-disabled'}">
                            \${services.find(s => s.service_name === 'comment_response')?.enabled ? 'مفعل' : 'معطل'}
                        </span>
                    </div>
                    <div class="service-description">
                        الرد التلقائي على التعليقات في منشورات إنستغرام
                    </div>
                    <div class="service-actions">
                        \${services.find(s => s.service_name === 'comment_response')?.enabled ? 
                            '<button class="btn btn-disable" onclick="toggleService(\'comment_response\', false)">إيقاف</button>' :
                            '<button class="btn btn-enable" onclick="toggleService(\'comment_response\', true)">تفعيل</button>'
                        }
                        <button class="btn btn-info" onclick="showServiceInfo('comment_response')">معلومات</button>
                    </div>
                    <div class="service-info">
                        آخر تحديث: \${services.find(s => s.service_name === 'comment_response')?.last_updated ? new Date(services.find(s => s.service_name === 'comment_response').last_updated).toLocaleString('ar-SA') : 'غير محدد'}
                    </div>
                </div>

                <div class="service-card \${services.find(s => s.service_name === 'dm_processing')?.enabled ? 'enabled' : 'disabled'}">
                    <div class="service-header">
                        <div>
                            <span class="service-icon">📨</span>
                            <span class="service-title">معالجة الرسائل المباشرة</span>
                        </div>
                        <span class="service-status \${services.find(s => s.service_name === 'dm_processing')?.enabled ? 'status-enabled' : 'status-disabled'}">
                            \${services.find(s => s.service_name === 'dm_processing')?.enabled ? 'مفعل' : 'معطل'}
                        </span>
                    </div>
                    <div class="service-description">
                        معالجة الرسائل المباشرة والرد عليها تلقائياً
                    </div>
                    <div class="service-actions">
                        \${services.find(s => s.service_name === 'dm_processing')?.enabled ? 
                            '<button class="btn btn-disable" onclick="toggleService(\'dm_processing\', false)">إيقاف</button>' :
                            '<button class="btn btn-enable" onclick="toggleService(\'dm_processing\', true)">تفعيل</button>'
                        }
                        <button class="btn btn-info" onclick="showServiceInfo('dm_processing')">معلومات</button>
                    </div>
                    <div class="service-info">
                        آخر تحديث: \${services.find(s => s.service_name === 'dm_processing')?.last_updated ? new Date(services.find(s => s.service_name === 'dm_processing').last_updated).toLocaleString('ar-SA') : 'غير محدد'}
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const merchantId = '${merchantId}';
        
        function toggleService(serviceName, enabled) {
            const action = enabled ? 'تفعيل' : 'إيقاف';
            if (confirm(\`هل أنت متأكد من \${action} خدمة \${serviceName}؟\`)) {
                fetch(\`/admin/api/merchants/\${merchantId}/services/\${serviceName}\`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled: enabled })
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        location.reload();
                    } else {
                        alert('خطأ في تحديث الخدمة: ' + data.error);
                    }
                })
                .catch(error => {
                    alert('خطأ في الاتصال: ' + error.message);
                });
            }
        }
        
        function enableAllServices() {
            if (confirm('هل تريد تفعيل جميع الخدمات؟')) {
                fetch(\`/admin/api/merchants/\${merchantId}/services/enable-all\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        location.reload();
                    } else {
                        alert('خطأ في تفعيل الخدمات: ' + data.error);
                    }
                });
            }
        }
        
        function disableAllServices() {
            if (confirm('هل تريد إيقاف جميع الخدمات؟')) {
                fetch(\`/admin/api/merchants/\${merchantId}/services/disable-all\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        location.reload();
                    } else {
                        alert('خطأ في إيقاف الخدمات: ' + data.error);
                    }
                });
            }
        }
        
        function maintenanceMode() {
            if (confirm('هل تريد تفعيل وضع الصيانة؟ سيتم إيقاف جميع الخدمات مؤقتاً.')) {
                fetch(\`/admin/api/merchants/\${merchantId}/services/maintenance\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        location.reload();
                    } else {
                        alert('خطأ في تفعيل وضع الصيانة: ' + data.error);
                    }
                });
            }
        }
        
        function showServiceInfo(serviceName) {
            alert('معلومات الخدمة: ' + serviceName + '\\n\\nسيتم إضافة تفاصيل أكثر قريباً');
        }
    </script>
</body>
</html>`;

    return c.html(html);
  });

  // Analytics Dashboard Page
  app.get('/admin/analytics/:merchantId', async (c) => {
    try {
      requireAdminAuth(c.req.raw);
    } catch (e) {
      return c.text('Unauthorized', 401, { 'WWW-Authenticate': 'Basic realm="admin"' });
    }

    const merchantId = c.req.param('merchantId');
    
    // Get merchant info dynamically
    const merchantRows = await sql<{ business_name: string; business_category: string; currency: string; created_at: Date }>`
      SELECT business_name, business_category, currency, created_at FROM merchants WHERE id = ${merchantId}::uuid
    `;
    
    if (merchantRows.length === 0) {
      return c.text('Merchant not found', 404);
    }
    
    const merchant = merchantRows[0];
    
    // Get dynamic analytics data
    const [products, conversations, customers, messages] = await Promise.all([
      sql<{ count: number; total_value: number }>`
        SELECT COUNT(*) as count, COALESCE(SUM(price_amount), 0) as total_value
        FROM products WHERE merchant_id = ${merchantId}::uuid AND status = 'ACTIVE'
      `,
      sql<{ count: number; last_week: number }>`
        SELECT COUNT(*) as count, 
               COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as last_week
        FROM conversations WHERE merchant_id = ${merchantId}::uuid
      `,
      sql<{ count: number; active: number }>`
        SELECT COUNT(*) as count,
               COUNT(CASE WHEN last_activity_at > NOW() - INTERVAL '30 days' THEN 1 END) as active
        FROM customers WHERE merchant_id = ${merchantId}::uuid
      `,
      sql<{ count: number; today: number }>`
        SELECT COUNT(*) as count,
               COUNT(CASE WHEN created_at > CURRENT_DATE THEN 1 END) as today
        FROM messages WHERE merchant_id = ${merchantId}::uuid
      `
    ]);

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>لوحة التحليلات - ${merchant.business_name}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
        }
        .header p {
            font-size: 1.1rem;
            opacity: 0.9;
        }
        .content {
            padding: 40px;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }
        .stat-card {
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            padding: 25px;
            border-radius: 15px;
            text-align: center;
            border: 2px solid #e9ecef;
            transition: transform 0.3s ease;
        }
        .stat-card:hover {
            transform: translateY(-5px);
        }
        .stat-icon {
            font-size: 3rem;
            margin-bottom: 15px;
        }
        .stat-number {
            font-size: 2.5rem;
            font-weight: bold;
            color: #1e3c72;
            margin-bottom: 5px;
        }
        .stat-label {
            color: #666;
            font-size: 1.1rem;
        }
        .stat-subtitle {
            color: #999;
            font-size: 0.9rem;
            margin-top: 5px;
        }
        .charts-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
            gap: 30px;
            margin-bottom: 40px;
        }
        .chart-card {
            background: white;
            padding: 25px;
            border-radius: 15px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
            border: 1px solid #e9ecef;
        }
        .chart-title {
            font-size: 1.3rem;
            font-weight: bold;
            color: #1e3c72;
            margin-bottom: 20px;
            text-align: center;
        }
        .chart-placeholder {
            height: 200px;
            background: #f8f9fa;
            border: 2px dashed #dee2e6;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #6c757d;
            font-size: 1.1rem;
        }
        .actions {
            display: flex;
            gap: 15px;
            margin-bottom: 30px;
            flex-wrap: wrap;
            justify-content: center;
        }
        .btn {
            padding: 12px 25px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 16px;
            font-weight: 600;
            transition: all 0.3s ease;
        }
        .btn-primary {
            background: #1e3c72;
            color: white;
        }
        .btn-success {
            background: #28a745;
            color: white;
        }
        .btn-warning {
            background: #ffc107;
            color: #212529;
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        .time-filter {
            display: flex;
            gap: 10px;
            justify-content: center;
            margin-bottom: 30px;
        }
        .time-btn {
            padding: 8px 16px;
            border: 2px solid #1e3c72;
            background: white;
            color: #1e3c72;
            border-radius: 20px;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        .time-btn.active {
            background: #1e3c72;
            color: white;
        }
        .time-btn:hover {
            background: #1e3c72;
            color: white;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 لوحة التحليلات</h1>
            <p>${merchant.business_name} - ${merchant.business_category}</p>
            <p>عضو منذ: ${new Date(merchant.created_at).toLocaleDateString('ar-SA')}</p>
        </div>
        
        <div class="content">
            <div class="time-filter">
                <button class="time-btn active" onclick="filterTime('7d')">7 أيام</button>
                <button class="time-btn" onclick="filterTime('30d')">30 يوم</button>
                <button class="time-btn" onclick="filterTime('90d')">90 يوم</button>
                <button class="time-btn" onclick="filterTime('1y')">سنة</button>
            </div>
            
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-icon">📦</div>
                    <div class="stat-number">${products[0]?.count || 0}</div>
                    <div class="stat-label">المنتجات النشطة</div>
                    <div class="stat-subtitle">قيمة إجمالية: ${(products[0]?.total_value || 0).toLocaleString()} ${merchant.currency}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">💬</div>
                    <div class="stat-number">${conversations[0]?.count || 0}</div>
                    <div class="stat-label">إجمالي المحادثات</div>
                    <div class="stat-subtitle">الأسبوع الماضي: ${conversations[0]?.last_week || 0}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">👥</div>
                    <div class="stat-number">${customers[0]?.count || 0}</div>
                    <div class="stat-label">إجمالي العملاء</div>
                    <div class="stat-subtitle">نشط (30 يوم): ${customers[0]?.active || 0}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">📨</div>
                    <div class="stat-number">${messages[0]?.count || 0}</div>
                    <div class="stat-label">إجمالي الرسائل</div>
                    <div class="stat-subtitle">اليوم: ${messages[0]?.today || 0}</div>
                </div>
            </div>
            
            <div class="actions">
                <button class="btn btn-primary" onclick="refreshAnalytics()">🔄 تحديث البيانات</button>
                <button class="btn btn-success" onclick="exportReport()">📊 تصدير التقرير</button>
                <button class="btn btn-warning" onclick="runPredictiveAnalytics()">🔮 التحليلات التنبؤية</button>
            </div>
            
            <div class="charts-grid">
                <div class="chart-card">
                    <div class="chart-title">📈 اتجاه المحادثات</div>
                    <div class="chart-placeholder">
                        <div>رسم بياني للمحادثات حسب الوقت<br><small>سيتم إضافة الرسوم البيانية قريباً</small></div>
                    </div>
                </div>
                <div class="chart-card">
                    <div class="chart-title">🎯 أداء المنتجات</div>
                    <div class="chart-placeholder">
                        <div>رسم بياني لأداء المنتجات<br><small>سيتم إضافة الرسوم البيانية قريباً</small></div>
                    </div>
                </div>
                <div class="chart-card">
                    <div class="chart-title">👥 توزيع العملاء</div>
                    <div class="chart-placeholder">
                        <div>رسم بياني لتوزيع العملاء<br><small>سيتم إضافة الرسوم البيانية قريباً</small></div>
                    </div>
                </div>
                <div class="chart-card">
                    <div class="chart-title">⏰ أوقات الذروة</div>
                    <div class="chart-placeholder">
                        <div>رسم بياني لأوقات الذروة<br><small>سيتم إضافة الرسوم البيانية قريباً</small></div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const merchantId = '${merchantId}';
        let currentTimeFilter = '7d';
        
        function filterTime(period) {
            currentTimeFilter = period;
            document.querySelectorAll('.time-btn').forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');
            
            // Refresh data based on time filter
            refreshAnalytics();
        }
        
        function refreshAnalytics() {
            // Show loading state
            const statNumbers = document.querySelectorAll('.stat-number');
            statNumbers.forEach(el => el.textContent = '...');
            
            // Simulate API call
            setTimeout(() => {
                location.reload();
            }, 1000);
        }
        
        function exportReport() {
            alert('ميزة تصدير التقرير قيد التطوير');
        }
        
        function runPredictiveAnalytics() {
            if (confirm('هل تريد تشغيل التحليلات التنبؤية؟ قد يستغرق هذا بعض الوقت.')) {
                fetch(\`/admin/api/merchants/\${merchantId}/predictive-analytics\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        alert('تم تشغيل التحليلات التنبؤية بنجاح!');
                        refreshAnalytics();
                    } else {
                        alert('خطأ في تشغيل التحليلات: ' + data.error);
                    }
                })
                .catch(error => {
                    alert('خطأ في الاتصال: ' + error.message);
                });
            }
        }
        
        // Auto-refresh every 5 minutes
        setInterval(refreshAnalytics, 300000);
    </script>
</body>
</html>`;

    return c.html(html);
  });

  // Product Management Page
  app.get('/admin/products/:merchantId', async (c) => {
    try {
      requireAdminAuth(c.req.raw);
    } catch (e) {
      return c.text('Unauthorized', 401, { 'WWW-Authenticate': 'Basic realm="admin"' });
    }

    const merchantId = c.req.param('merchantId');
    
    // Get merchant info and products dynamically
    const merchantRows = await sql<{ business_name: string; business_category: string; currency: string }>`
      SELECT business_name, business_category, currency FROM merchants WHERE id = ${merchantId}::uuid
    `;
    
    if (merchantRows.length === 0) {
      return c.text('Merchant not found', 404);
    }
    
    const merchant = merchantRows[0];
    const products = await sql<{ id: string; sku: string; name_ar: string; name_en: string; category: string; price_amount: number; stock_quantity: number; status: string; created_at: Date }>`
      SELECT id, sku, name_ar, name_en, category, price_amount, stock_quantity, status, created_at
      FROM products WHERE merchant_id = ${merchantId}::uuid ORDER BY created_at DESC
    `;

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>إدارة المنتجات - ${merchant.business_name}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
        }
        .header p {
            font-size: 1.1rem;
            opacity: 0.9;
        }
        .content {
            padding: 40px;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 10px;
            text-align: center;
            border: 2px solid #e9ecef;
        }
        .stat-number {
            font-size: 2rem;
            font-weight: bold;
            color: #1e3c72;
        }
        .stat-label {
            color: #666;
            margin-top: 5px;
        }
        .actions {
            display: flex;
            gap: 15px;
            margin-bottom: 30px;
            flex-wrap: wrap;
        }
        .btn {
            padding: 12px 25px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 16px;
            font-weight: 600;
            transition: all 0.3s ease;
        }
        .btn-primary {
            background: #1e3c72;
            color: white;
        }
        .btn-success {
            background: #28a745;
            color: white;
        }
        .btn-warning {
            background: #ffc107;
            color: #212529;
        }
        .btn-danger {
            background: #dc3545;
            color: white;
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        .products-table {
            width: 100%;
            border-collapse: collapse;
            background: white;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }
        .products-table th {
            background: #1e3c72;
            color: white;
            padding: 15px;
            text-align: right;
        }
        .products-table td {
            padding: 15px;
            border-bottom: 1px solid #e9ecef;
        }
        .products-table tr:hover {
            background: #f8f9fa;
        }
        .status-badge {
            padding: 5px 10px;
            border-radius: 15px;
            font-size: 12px;
            font-weight: bold;
        }
        .status-active {
            background: #d4edda;
            color: #155724;
        }
        .status-inactive {
            background: #f8d7da;
            color: #721c24;
        }
        .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
        }
        .modal-content {
            background: white;
            margin: 5% auto;
            padding: 30px;
            border-radius: 15px;
            width: 90%;
            max-width: 600px;
            max-height: 80vh;
            overflow-y: auto;
        }
        .form-group {
            margin-bottom: 20px;
        }
        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #333;
        }
        .form-group input, .form-group select, .form-group textarea {
            width: 100%;
            padding: 12px 15px;
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            font-size: 16px;
        }
        .form-group input:focus, .form-group select:focus, .form-group textarea:focus {
            outline: none;
            border-color: #1e3c72;
        }
        .close {
            color: #aaa;
            float: left;
            font-size: 28px;
            font-weight: bold;
            cursor: pointer;
        }
        .close:hover {
            color: #000;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📦 إدارة المنتجات</h1>
            <p>${merchant.business_name} - ${merchant.business_category}</p>
        </div>
        
        <div class="content">
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-number">${products.length}</div>
                    <div class="stat-label">إجمالي المنتجات</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${products.filter(p => p.status === 'ACTIVE').length}</div>
                    <div class="stat-label">منتجات نشطة</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${products.filter(p => p.stock_quantity === 0).length}</div>
                    <div class="stat-label">نفد المخزون</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${new Set(products.map(p => p.category)).size}</div>
                    <div class="stat-label">فئات مختلفة</div>
                </div>
            </div>
            
            <div class="actions">
                <button class="btn btn-primary" onclick="openAddProductModal()">+ إضافة منتج جديد</button>
                <button class="btn btn-success" onclick="refreshProducts()">🔄 تحديث</button>
                <button class="btn btn-warning" onclick="exportProducts()">📊 تصدير</button>
                <button class="btn btn-danger" onclick="bulkActions()">⚡ إجراءات جماعية</button>
            </div>
            
            <table class="products-table">
                <thead>
                    <tr>
                        <th>SKU</th>
                        <th>اسم المنتج</th>
                        <th>الفئة</th>
                        <th>السعر (${merchant.currency})</th>
                        <th>المخزون</th>
                        <th>الحالة</th>
                        <th>تاريخ الإنشاء</th>
                        <th>الإجراءات</th>
                    </tr>
                </thead>
                <tbody id="productsTableBody">
                    ${products.map(p => 
                        '<tr>' +
                            '<td>' + p.sku + '</td>' +
                            '<td>' + p.name_ar + '</td>' +
                            '<td>' + p.category + '</td>' +
                            '<td>' + p.price_amount + '</td>' +
                            '<td>' + p.stock_quantity + '</td>' +
                            '<td><span class="status-badge status-' + p.status.toLowerCase() + '">' + (p.status === 'ACTIVE' ? 'نشط' : 'غير نشط') + '</span></td>' +
                            '<td>' + new Date(p.created_at).toLocaleDateString('ar-SA') + '</td>' +
                            '<td>' +
                                '<button class="btn btn-primary" onclick="editProduct(\'' + p.id + '\')">تعديل</button>' +
                                '<button class="btn btn-danger" onclick="deleteProduct(\'' + p.id + '\')">حذف</button>' +
                            '</td>' +
                        '</tr>'
                    ).join('')}
                </tbody>
            </table>
        </div>
    </div>

    <!-- Add Product Modal -->
    <div id="addProductModal" class="modal">
        <div class="modal-content">
            <span class="close" onclick="closeModal('addProductModal')">&times;</span>
            <h2>إضافة منتج جديد</h2>
            <form id="addProductForm">
                <div class="form-group">
                    <label>رمز المنتج (SKU) *</label>
                    <input type="text" name="sku" required>
                </div>
                <div class="form-group">
                    <label>اسم المنتج (عربي) *</label>
                    <input type="text" name="name_ar" required>
                </div>
                <div class="form-group">
                    <label>اسم المنتج (إنجليزي)</label>
                    <input type="text" name="name_en">
                </div>
                <div class="form-group">
                    <label>الفئة</label>
                    <select name="category">
                        <option value="general">عام</option>
                        <option value="fashion">أزياء</option>
                        <option value="electronics">إلكترونيات</option>
                        <option value="beauty">جمال</option>
                        <option value="home">منزل</option>
                        <option value="sports">رياضة</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>السعر (${merchant.currency}) *</label>
                    <input type="number" name="price_amount" step="0.01" min="0" required>
                </div>
                <div class="form-group">
                    <label>الكمية المتوفرة</label>
                    <input type="number" name="stock_quantity" min="0" value="0">
                </div>
                <div class="form-group">
                    <label>وصف المنتج</label>
                    <textarea name="description_ar" rows="3"></textarea>
                </div>
                <button type="submit" class="btn btn-primary">إضافة المنتج</button>
            </form>
        </div>
    </div>

    <script>
        const merchantId = '${merchantId}';
        
        function openAddProductModal() {
            document.getElementById('addProductModal').style.display = 'block';
        }
        
        function closeModal(modalId) {
            document.getElementById(modalId).style.display = 'none';
        }
        
        function refreshProducts() {
            location.reload();
        }
        
        function exportProducts() {
            // Export functionality
            alert('ميزة التصدير قيد التطوير');
        }
        
        function bulkActions() {
            alert('الإجراءات الجماعية قيد التطوير');
        }
        
        function editProduct(productId) {
            alert('تعديل المنتج: ' + productId);
        }
        
        function deleteProduct(productId) {
            if (confirm('هل أنت متأكد من حذف هذا المنتج؟')) {
                fetch(\`/admin/api/products/\${productId}\`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' }
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        location.reload();
                    } else {
                        alert('خطأ في حذف المنتج: ' + data.error);
                    }
                });
            }
        }
        
        document.getElementById('addProductForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            const formData = new FormData(this);
            const data = Object.fromEntries(formData.entries());
            
            try {
                const response = await fetch(\`/admin/api/merchants/\${merchantId}/products\`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                
                const result = await response.json();
                
                if (result.success) {
                    closeModal('addProductModal');
                    location.reload();
                } else {
                    alert('خطأ في إضافة المنتج: ' + result.error);
                }
            } catch (error) {
                alert('خطأ في الاتصال: ' + error.message);
            }
        });
        
        // Close modal when clicking outside
        window.onclick = function(event) {
            const modals = document.querySelectorAll('.modal');
            modals.forEach(modal => {
                if (event.target === modal) {
                    modal.style.display = 'none';
                }
            });
        };
    </script>
</body>
</html>`;

    return c.html(html);
  });

  // Complete Merchant Onboarding Page
  app.get('/admin/onboarding', async (c) => {
    try {
      requireAdminAuth(c.req.raw);
    } catch (e) {
      return c.text('Unauthorized', 401, { 'WWW-Authenticate': 'Basic realm="admin"' });
    }

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>إضافة تاجر جديد - AI Sales Platform</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
        }
        .header p {
            font-size: 1.1rem;
            opacity: 0.9;
        }
        .form-container {
            padding: 40px;
        }
        .form-section {
            margin-bottom: 40px;
            padding: 30px;
            border: 2px solid #f0f0f0;
            border-radius: 15px;
            background: #fafafa;
        }
        .form-section h2 {
            color: #1e3c72;
            margin-bottom: 20px;
            font-size: 1.5rem;
            border-bottom: 3px solid #667eea;
            padding-bottom: 10px;
        }
        .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 20px;
        }
        .form-group {
            margin-bottom: 20px;
        }
        .form-group.full-width {
            grid-column: 1 / -1;
        }
        label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #333;
        }
        input, select, textarea {
            width: 100%;
            padding: 12px 15px;
            border: 2px solid #e0e0e0;
            border-radius: 10px;
            font-size: 16px;
            transition: all 0.3s ease;
        }
        input:focus, select:focus, textarea:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        textarea {
            resize: vertical;
            min-height: 100px;
        }
        .checkbox-group {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-top: 10px;
        }
        .checkbox-item {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .checkbox-item input[type="checkbox"] {
            width: auto;
        }
        .time-inputs {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
        }
        .product-item {
            border: 2px solid #e0e0e0;
            border-radius: 10px;
            padding: 20px;
            margin-bottom: 20px;
            background: white;
        }
        .product-header {
            display: flex;
            justify-content: between;
            align-items: center;
            margin-bottom: 15px;
        }
        .remove-product {
            background: #ff4757;
            color: white;
            border: none;
            padding: 8px 15px;
            border-radius: 5px;
            cursor: pointer;
        }
        .add-product {
            background: #2ed573;
            color: white;
            border: none;
            padding: 12px 25px;
            border-radius: 10px;
            cursor: pointer;
            font-size: 16px;
            margin-bottom: 20px;
        }
        .submit-btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 15px 40px;
            border-radius: 10px;
            font-size: 18px;
            font-weight: 600;
            cursor: pointer;
            width: 100%;
            margin-top: 30px;
            transition: all 0.3s ease;
        }
        .submit-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
        }
        .loading {
            display: none;
            text-align: center;
            padding: 20px;
        }
        .success {
            display: none;
            background: #2ed573;
            color: white;
            padding: 20px;
            border-radius: 10px;
            text-align: center;
            margin-top: 20px;
        }
        .error {
            display: none;
            background: #ff4757;
            color: white;
            padding: 20px;
            border-radius: 10px;
            text-align: center;
            margin-top: 20px;
        }
        .required {
            color: #ff4757;
        }
        .help-text {
            font-size: 0.9rem;
            color: #666;
            margin-top: 5px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 إضافة تاجر جديد</h1>
            <p>قم بإعداد تاجر جديد في النظام مع جميع الإعدادات المطلوبة</p>
        </div>
        
        <div class="form-container">
            <form id="merchantForm">
                <!-- Basic Business Information -->
                <div class="form-section">
                    <h2>📋 المعلومات الأساسية للمتجر</h2>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="business_name">اسم المتجر <span class="required">*</span></label>
                            <input type="text" id="business_name" name="business_name" required>
                            <div class="help-text">اسم المتجر كما سيظهر للعملاء</div>
                        </div>
                        <div class="form-group">
                            <label for="business_category">فئة المتجر</label>
                            <select id="business_category" name="business_category">
                                <option value="general">عام</option>
                                <option value="fashion">أزياء</option>
                                <option value="electronics">إلكترونيات</option>
                                <option value="beauty">جمال</option>
                                <option value="home">منزل</option>
                                <option value="sports">رياضة</option>
                                <option value="books">كتب</option>
                                <option value="food">طعام</option>
                                <option value="health">صحة</option>
                                <option value="automotive">سيارات</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="business_address">عنوان المتجر</label>
                        <input type="text" id="business_address" name="business_address" placeholder="مثال: بغداد، الكرادة، شارع 52">
                    </div>
                    <div class="form-group">
                        <label for="business_description">وصف المتجر</label>
                        <textarea id="business_description" name="business_description" placeholder="وصف مختصر عن المتجر ونوع المنتجات"></textarea>
                    </div>
                </div>

                <!-- Contact Information -->
                <div class="form-section">
                    <h2>📞 معلومات التواصل</h2>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="whatsapp_number">رقم الواتساب <span class="required">*</span></label>
                            <input type="tel" id="whatsapp_number" name="whatsapp_number" required placeholder="9647701234567">
                            <div class="help-text">رقم الواتساب مع رمز الدولة</div>
                        </div>
                        <div class="form-group">
                            <label for="instagram_username">اسم المستخدم في إنستغرام</label>
                            <input type="text" id="instagram_username" name="instagram_username" placeholder="@username">
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="email">البريد الإلكتروني</label>
                        <input type="email" id="email" name="email" placeholder="merchant@example.com">
                    </div>
                </div>

                <!-- Business Settings -->
                <div class="form-section">
                    <h2>⚙️ إعدادات المتجر</h2>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="currency">العملة</label>
                            <select id="currency" name="currency">
                                <option value="IQD">دينار عراقي (IQD)</option>
                                <option value="USD">دولار أمريكي (USD)</option>
                                <option value="EUR">يورو (EUR)</option>
                                <option value="SAR">ريال سعودي (SAR)</option>
                                <option value="AED">درهم إماراتي (AED)</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="timezone">المنطقة الزمنية</label>
                            <select id="timezone" name="timezone">
                                <option value="Asia/Baghdad">بغداد (Asia/Baghdad)</option>
                                <option value="Asia/Dubai">دبي (Asia/Dubai)</option>
                                <option value="Asia/Riyadh">الرياض (Asia/Riyadh)</option>
                                <option value="Europe/London">لندن (Europe/London)</option>
                                <option value="America/New_York">نيويورك (America/New_York)</option>
                            </select>
                        </div>
                    </div>
                </div>

                <!-- Working Hours -->
                <div class="form-section">
                    <h2>🕒 ساعات العمل</h2>
                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="working_hours_enabled" name="working_hours_enabled" checked>
                            تفعيل ساعات العمل
                        </label>
                    </div>
                    <div id="working-hours-container">
                        <div class="form-row">
                            <div class="form-group">
                                <label>الأحد</label>
                                <div class="time-inputs">
                                    <input type="time" name="sunday_open" value="09:00">
                                    <input type="time" name="sunday_close" value="22:00">
                                </div>
                                <label><input type="checkbox" name="sunday_enabled" checked> مفعل</label>
                            </div>
                            <div class="form-group">
                                <label>الاثنين</label>
                                <div class="time-inputs">
                                    <input type="time" name="monday_open" value="09:00">
                                    <input type="time" name="monday_close" value="22:00">
                                </div>
                                <label><input type="checkbox" name="monday_enabled" checked> مفعل</label>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>الثلاثاء</label>
                                <div class="time-inputs">
                                    <input type="time" name="tuesday_open" value="09:00">
                                    <input type="time" name="tuesday_close" value="22:00">
                                </div>
                                <label><input type="checkbox" name="tuesday_enabled" checked> مفعل</label>
                            </div>
                            <div class="form-group">
                                <label>الأربعاء</label>
                                <div class="time-inputs">
                                    <input type="time" name="wednesday_open" value="09:00">
                                    <input type="time" name="wednesday_close" value="22:00">
                                </div>
                                <label><input type="checkbox" name="wednesday_enabled" checked> مفعل</label>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>الخميس</label>
                                <div class="time-inputs">
                                    <input type="time" name="thursday_open" value="09:00">
                                    <input type="time" name="thursday_close" value="22:00">
                                </div>
                                <label><input type="checkbox" name="thursday_enabled" checked> مفعل</label>
                            </div>
                            <div class="form-group">
                                <label>الجمعة</label>
                                <div class="time-inputs">
                                    <input type="time" name="friday_open" value="14:00">
                                    <input type="time" name="friday_close" value="22:00">
                                </div>
                                <label><input type="checkbox" name="friday_enabled" checked> مفعل</label>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>السبت</label>
                                <div class="time-inputs">
                                    <input type="time" name="saturday_open" value="09:00">
                                    <input type="time" name="saturday_close" value="22:00">
                                </div>
                                <label><input type="checkbox" name="saturday_enabled"> مفعل</label>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Payment Methods -->
                <div class="form-section">
                    <h2>💳 طرق الدفع</h2>
                    <div class="checkbox-group">
                        <div class="checkbox-item">
                            <input type="checkbox" id="cod" name="payment_methods" value="COD" checked>
                            <label for="cod">الدفع عند الاستلام (COD)</label>
                        </div>
                        <div class="checkbox-item">
                            <input type="checkbox" id="zain_cash" name="payment_methods" value="ZAIN_CASH">
                            <label for="zain_cash">زين كاش</label>
                        </div>
                        <div class="checkbox-item">
                            <input type="checkbox" id="asia_hawala" name="payment_methods" value="ASIA_HAWALA">
                            <label for="asia_hawala">آسيا حوالة</label>
                        </div>
                        <div class="checkbox-item">
                            <input type="checkbox" id="visa" name="payment_methods" value="VISA">
                            <label for="visa">فيزا</label>
                        </div>
                        <div class="checkbox-item">
                            <input type="checkbox" id="mastercard" name="payment_methods" value="MASTERCARD">
                            <label for="mastercard">ماستركارد</label>
                        </div>
                        <div class="checkbox-item">
                            <input type="checkbox" id="paypal" name="payment_methods" value="PAYPAL">
                            <label for="paypal">باي بال</label>
                        </div>
                    </div>
                </div>

                <!-- Delivery Settings -->
                <div class="form-section">
                    <h2>🚚 إعدادات التوصيل</h2>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="delivery_inside">رسوم التوصيل داخل بغداد</label>
                            <input type="number" id="delivery_inside" name="delivery_inside" value="0" min="0">
                        </div>
                        <div class="form-group">
                            <label for="delivery_outside">رسوم التوصيل خارج بغداد</label>
                            <input type="number" id="delivery_outside" name="delivery_outside" value="5" min="0">
                        </div>
                    </div>
                </div>

                <!-- AI Configuration -->
                <div class="form-section">
                    <h2>🤖 إعدادات الذكاء الاصطناعي</h2>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="ai_model">نموذج الذكاء الاصطناعي</label>
                            <select id="ai_model" name="ai_model">
                                <option value="gpt-4o-mini">GPT-4o Mini (سريع واقتصادي)</option>
                                <option value="gpt-4o">GPT-4o (أكثر ذكاءً)</option>
                                <option value="gpt-3.5-turbo">GPT-3.5 Turbo (متوازن)</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="sales_style">أسلوب البيع</label>
                            <select id="sales_style" name="sales_style">
                                <option value="friendly">ودود</option>
                                <option value="professional">مهني</option>
                                <option value="casual">عادي</option>
                                <option value="neutral" selected>محايد</option>
                            </select>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="ai_temperature">درجة الإبداع (0-1)</label>
                            <input type="range" id="ai_temperature" name="ai_temperature" min="0" max="1" step="0.1" value="0.8">
                            <div class="help-text">0 = دقيق ومتسق، 1 = مبدع ومتنوع</div>
                        </div>
                        <div class="form-group">
                            <label for="ai_max_tokens">الحد الأقصى للكلمات</label>
                            <input type="number" id="ai_max_tokens" name="ai_max_tokens" value="600" min="50" max="1000">
                        </div>
                    </div>
                </div>

                <!-- Response Templates -->
                <div class="form-section">
                    <h2>💬 قوالب الردود</h2>
                    <div class="form-group">
                        <label for="greeting_template">رسالة الترحيب</label>
                        <textarea id="greeting_template" name="greeting_template" placeholder="مرحباً بك في متجرنا! كيف يمكنني مساعدتك اليوم؟"></textarea>
                    </div>
                    <div class="form-group">
                        <label for="fallback_template">رد عدم الفهم</label>
                        <textarea id="fallback_template" name="fallback_template" placeholder="عذراً، لم أفهم طلبك. هل يمكنك توضيح ما تبحث عنه؟"></textarea>
                    </div>
                    <div class="form-group">
                        <label for="outside_hours_template">رد خارج ساعات العمل</label>
                        <textarea id="outside_hours_template" name="outside_hours_template" placeholder="نعتذر، المحل مغلق حالياً. ساعات العمل: 9 صباحاً - 10 مساءً"></textarea>
                    </div>
                </div>

                <!-- Products Section -->
                <div class="form-section">
                    <h2>📦 المنتجات (اختياري)</h2>
                    <p>يمكنك إضافة المنتجات الآن أو لاحقاً من لوحة التحكم</p>
                    <button type="button" class="add-product" onclick="addProduct()">+ إضافة منتج</button>
                    <div id="products-container"></div>
                </div>

                <button type="submit" class="submit-btn">🚀 إنشاء التاجر</button>
                
                <div class="loading" id="loading">
                    <p>جاري إنشاء التاجر...</p>
                </div>
                
                <div class="success" id="success">
                    <h3>✅ تم إنشاء التاجر بنجاح!</h3>
                    <p id="success-message"></p>
                </div>
                
                <div class="error" id="error">
                    <h3>❌ حدث خطأ</h3>
                    <p id="error-message"></p>
                </div>
            </form>
        </div>
    </div>

    <script>
        let productCount = 0;

        function addProduct() {
            productCount++;
            const container = document.getElementById('products-container');
            const productDiv = document.createElement('div');
            productDiv.className = 'product-item';
            productDiv.innerHTML = \`
                <div class="product-header">
                    <h3>منتج \${productCount}</h3>
                    <button type="button" class="remove-product" onclick="removeProduct(this)">حذف</button>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>رمز المنتج (SKU)</label>
                        <input type="text" name="products[\${productCount}].sku" required>
                    </div>
                    <div class="form-group">
                        <label>اسم المنتج (عربي)</label>
                        <input type="text" name="products[\${productCount}].name_ar" required>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>اسم المنتج (إنجليزي)</label>
                        <input type="text" name="products[\${productCount}].name_en">
                    </div>
                    <div class="form-group">
                        <label>الفئة</label>
                        <select name="products[\${productCount}].category">
                            <option value="general">عام</option>
                            <option value="fashion">أزياء</option>
                            <option value="electronics">إلكترونيات</option>
                            <option value="beauty">جمال</option>
                            <option value="home">منزل</option>
                            <option value="sports">رياضة</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label>وصف المنتج</label>
                    <textarea name="products[\${productCount}].description_ar"></textarea>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>السعر (دولار)</label>
                        <input type="number" name="products[\${productCount}].price_usd" step="0.01" min="0" required>
                    </div>
                    <div class="form-group">
                        <label>الكمية المتوفرة</label>
                        <input type="number" name="products[\${productCount}].stock_quantity" min="0" value="0">
                    </div>
                </div>
            \`;
            container.appendChild(productDiv);
        }

        function removeProduct(button) {
            button.closest('.product-item').remove();
        }

        // Toggle working hours
        document.getElementById('working_hours_enabled').addEventListener('change', function() {
            const container = document.getElementById('working-hours-container');
            container.style.display = this.checked ? 'block' : 'none';
        });

        // Form submission
        document.getElementById('merchantForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const formData = new FormData(this);
            const data = {};
            
            // Convert form data to object
            for (let [key, value] of formData.entries()) {
                if (key.includes('[')) {
                    // Handle array/object fields
                    const [parent, child] = key.split('[');
                    const cleanChild = child.replace(']', '');
                    
                    if (!data[parent]) data[parent] = {};
                    if (cleanChild.includes('.')) {
                        const [index, field] = cleanChild.split('.');
                        if (!data[parent][index]) data[parent][index] = {};
                        data[parent][index][field] = value;
                    } else {
                        data[parent][cleanChild] = value;
                    }
                } else {
                    data[key] = value;
                }
            }
            
            // Handle checkboxes
            const paymentMethods = [];
            document.querySelectorAll('input[name="payment_methods"]:checked').forEach(cb => {
                paymentMethods.push(cb.value);
            });
            data.payment_methods = paymentMethods;
            
            // Handle working hours
            if (data.working_hours_enabled) {
                data.working_hours = {
                    enabled: true,
                    schedule: {}
                };
                
                const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                days.forEach(day => {
                    const enabled = formData.get(\`\${day}_enabled\`);
                    if (enabled) {
                        data.working_hours.schedule[day] = {
                            open: formData.get(\`\${day}_open\`),
                            close: formData.get(\`\${day}_close\`),
                            enabled: true
                        };
                    }
                });
            }
            
            // Show loading
            document.getElementById('loading').style.display = 'block';
            document.getElementById('success').style.display = 'none';
            document.getElementById('error').style.display = 'none';
            
            try {
                const response = await fetch('/admin/api/merchants/complete', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });
                
                const result = await response.json();
                
                document.getElementById('loading').style.display = 'none';
                
                if (result.success) {
                    document.getElementById('success').style.display = 'block';
                    document.getElementById('success-message').textContent = \`تم إنشاء التاجر بنجاح! معرف التاجر: \${result.merchant_id}\`;
                    this.reset();
                } else {
                    document.getElementById('error').style.display = 'block';
                    document.getElementById('error-message').textContent = result.error || 'حدث خطأ غير متوقع';
                }
            } catch (error) {
                document.getElementById('loading').style.display = 'none';
                document.getElementById('error').style.display = 'block';
                document.getElementById('error-message').textContent = 'خطأ في الاتصال: ' + error.message;
            }
        });
    </script>
</body>
</html>`;

    return c.html(html);
  });

  // Admin UI (very small HTML form page)
  app.get('/admin', async (c) => {
    try {
      requireAdminAuth(c.req.raw);
    } catch (e) {
      return c.text('Unauthorized', 401, { 'WWW-Authenticate': 'Basic realm="admin"' });
    }

    const html = `<!doctype html>
<meta charset="utf-8" />
<title>Merchant Admin</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:900px;margin:40px auto;padding:0 16px;color:#222}
  h1,h2{margin:16px 0}
  form{border:1px solid #ddd;padding:16px;border-radius:8px;margin:16px 0}
  label{display:block;margin:8px 0 4px}
  input,select,textarea{width:100%;padding:8px;border:1px solid #ccc;border-radius:6px}
  button{padding:10px 14px;border:0;border-radius:6px;background:#1f6feb;color:#fff;cursor:pointer}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .mono{font-family:ui-monospace,Consolas,monospace;background:#f6f8fa;padding:8px;border-radius:6px}
  small{color:#555}
  .ok{color:#116329}
  .err{color:#d73a49}
  .card{background:#fff;border:1px solid #eaecef;border-radius:8px;padding:12px}
  .section{margin:24px 0}
  .muted{color:#666}
</style>
<h1>Merchant Admin</h1>

<div class="section">
  <h2>1) Create Complete Merchant</h2>
  <p><a href="/admin/onboarding" target="_blank">🚀 إضافة تاجر جديد (واجهة كاملة)</a></p>
</div>

<div class="section">
  <h2>2) Merchant Management</h2>
  <p>أدخل معرف التاجر (UUID) للوصول إلى أدوات الإدارة:</p>
  <input type="text" id="merchantIdInput" placeholder="merchant-uuid-here" style="width: 300px; padding: 8px; margin: 10px 0;">
  <div style="margin-top: 10px;">
    <button onclick="openMerchantPage('products')" class="btn">📦 إدارة المنتجات</button>
    <button onclick="openMerchantPage('analytics')" class="btn">📊 التحليلات</button>
    <button onclick="openMerchantPage('services')" class="btn">⚙️ إدارة الخدمات</button>
  </div>
</div>

<div class="section">
  <h2>3) Create Simple Merchant</h2>
  <form id="createForm">
    <div class="row">
      <div>
        <label>Business Name</label>
        <input name="business_name" required />
      </div>
      <div>
        <label>Business Category</label>
        <input name="business_category" value="general" />
      </div>
    </div>
    <div class="row">
      <div>
        <label>WhatsApp Number</label>
        <input name="whatsapp_number" required />
      </div>
      <div>
        <label>Instagram Username</label>
        <input name="instagram_username" />
      </div>
    </div>
    <div class="row">
      <div>
        <label>Email</label>
        <input name="email" type="email" />
      </div>
      <div>
        <label>Currency</label>
        <input name="currency" value="IQD" />
      </div>
    </div>
    <label>Settings (JSON optional)</label>
    <textarea name="settings" rows="4" placeholder='{"payment_methods":["COD"],"delivery_fees":{"inside_baghdad":0}}'></textarea>
    <label>AI Config (JSON optional)</label>
    <textarea name="ai_config" rows="3" placeholder='{"model":"gpt-4o-mini","temperature":0.3,"maxTokens":200}'></textarea>
    <button type="submit">Create</button>
    <div id="createOut" class="muted"></div>
  </form>
</div>

<div class="section card">
  <h2>4) Generate Merchant JWT</h2>
  <form id="jwtForm">
    <label>Merchant ID (UUID)</label>
    <input name="merchant_id" required />
    <button type="submit">Generate JWT</button>
    <div id="jwtOut" class="mono"></div>
    <small>Header: Authorization: Bearer &lt;token&gt;</small>
  </form>
</div>

<div class="section">
  <h2>5) Update Settings / AI / Currency</h2>
  <form id="patchForm">
    <label>Merchant ID (UUID)</label>
    <input name="merchant_id" required />
    <label>Patch Type</label>
    <select name="type">
      <option value="settings">settings</option>
      <option value="ai-config">ai-config</option>
      <option value="currency">currency</option>
    </select>
    <label>Payload (JSON or {"currency":"IQD"})</label>
    <textarea name="payload" rows="4"></textarea>
    <button type="submit">Apply Patch</button>
    <div id="patchOut" class="muted"></div>
  </form>
</div>

<script>
async function post(path, body) {
  const res = await fetch(path, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  return res.json();
}
async function patch(path, body) {
  const res = await fetch(path, {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  return res.json();
}
const out = (id, html) => document.getElementById(id).innerHTML = html;

document.getElementById('createForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  try { if (body.settings) body.settings = JSON.parse(body.settings); else delete body.settings; } catch { alert('Invalid settings JSON'); return; }
  try { if (body.ai_config) body.ai_config = JSON.parse(body.ai_config); else delete body.ai_config; } catch { alert('Invalid ai_config JSON'); return; }
  const res = await post('/admin/api/merchants', body);
  out('createOut', res.ok ? '<span class="ok">Created</span>: ' + res.id : '<span class="err">Error</span>: ' + (res.error||'failed'));
});

document.getElementById('jwtForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const res = await post('/admin/api/merchants/'+fd.get('merchant_id')+'/jwt', {});
  out('jwtOut', res.ok ? res.token : (res.error||'failed'));
});

document.getElementById('patchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const id = fd.get('merchant_id');
  const type = fd.get('type');
  let payload = {};
  try { payload = JSON.parse(fd.get('payload')); } catch { alert('Invalid JSON payload'); return; }
  const res = await patch('/admin/api/merchants/'+id+'/'+type, payload);
  out('patchOut', res.ok ? '<span class="ok">Updated</span>' : '<span class="err">Error</span>: ' + (res.error||'failed'));
});

function openMerchantPage(page) {
  const merchantId = document.getElementById('merchantIdInput').value.trim();
  if (!merchantId) {
    alert('يرجى إدخال معرف التاجر أولاً');
    return;
  }
  
  const pages = {
    'products': '/admin/products/',
    'analytics': '/admin/analytics/',
    'services': '/admin/services/'
  };
  
  if (pages[page]) {
    window.open(pages[page] + merchantId, '_blank');
  }
}
</script>`;

    return c.html(html);
  });

  // Service Management APIs
  app.patch('/admin/api/merchants/:merchantId/services/:serviceName', async (c) => {
    try {
      try { requireAdminAuth(c.req.raw); } catch { return c.json({ success:false, error:'unauthorized' }, 401); }
      const merchantId = c.req.param('merchantId');
      const serviceName = c.req.param('serviceName');
      const body = await c.req.json();
      
      await sql`
        INSERT INTO service_control (merchant_id, service_name, enabled, toggled_by, reason, last_updated)
        VALUES (${merchantId}::uuid, ${serviceName}, ${body.enabled}, 'admin', 'Manual toggle via admin panel', NOW())
        ON CONFLICT (merchant_id, service_name) 
        DO UPDATE SET 
          enabled = EXCLUDED.enabled,
          toggled_by = EXCLUDED.toggled_by,
          reason = EXCLUDED.reason,
          last_updated = EXCLUDED.last_updated
      `;
      
      await invalidate(merchantId);
      return c.json({ success: true });
    } catch (error) {
      log.error('Failed to toggle service', { error: String(error) });
      return c.json({ success: false, error: 'internal_error' }, 500);
    }
  });

  app.post('/admin/api/merchants/:merchantId/services/enable-all', async (c) => {
    try {
      try { requireAdminAuth(c.req.raw); } catch { return c.json({ success:false, error:'unauthorized' }, 401); }
      const merchantId = c.req.param('merchantId');
      
      const services = ['instagram', 'ai_processing', 'auto_reply', 'story_response', 'comment_response', 'dm_processing'];
      
      for (const service of services) {
        await sql`
          INSERT INTO service_control (merchant_id, service_name, enabled, toggled_by, reason, last_updated)
          VALUES (${merchantId}::uuid, ${service}, true, 'admin', 'Enable all services', NOW())
          ON CONFLICT (merchant_id, service_name) 
          DO UPDATE SET 
            enabled = true,
            toggled_by = 'admin',
            reason = 'Enable all services',
            last_updated = NOW()
        `;
      }
      
      await invalidate(merchantId);
      return c.json({ success: true });
    } catch (error) {
      log.error('Failed to enable all services', { error: String(error) });
      return c.json({ success: false, error: 'internal_error' }, 500);
    }
  });

  app.post('/admin/api/merchants/:merchantId/services/disable-all', async (c) => {
    try {
      try { requireAdminAuth(c.req.raw); } catch { return c.json({ success:false, error:'unauthorized' }, 401); }
      const merchantId = c.req.param('merchantId');
      
      const services = ['instagram', 'ai_processing', 'auto_reply', 'story_response', 'comment_response', 'dm_processing'];
      
      for (const service of services) {
        await sql`
          INSERT INTO service_control (merchant_id, service_name, enabled, toggled_by, reason, last_updated)
          VALUES (${merchantId}::uuid, ${service}, false, 'admin', 'Disable all services', NOW())
          ON CONFLICT (merchant_id, service_name) 
          DO UPDATE SET 
            enabled = false,
            toggled_by = 'admin',
            reason = 'Disable all services',
            last_updated = NOW()
        `;
      }
      
      await invalidate(merchantId);
      return c.json({ success: true });
    } catch (error) {
      log.error('Failed to disable all services', { error: String(error) });
      return c.json({ success: false, error: 'internal_error' }, 500);
    }
  });

  app.post('/admin/api/merchants/:merchantId/services/maintenance', async (c) => {
    try {
      try { requireAdminAuth(c.req.raw); } catch { return c.json({ success:false, error:'unauthorized' }, 401); }
      const merchantId = c.req.param('merchantId');
      
      const services = ['instagram', 'ai_processing', 'auto_reply', 'story_response', 'comment_response', 'dm_processing'];
      
      for (const service of services) {
        await sql`
          INSERT INTO service_control (merchant_id, service_name, enabled, toggled_by, reason, last_updated)
          VALUES (${merchantId}::uuid, ${service}, false, 'admin', 'Maintenance mode', NOW())
          ON CONFLICT (merchant_id, service_name) 
          DO UPDATE SET 
            enabled = false,
            toggled_by = 'admin',
            reason = 'Maintenance mode',
            last_updated = NOW()
        `;
      }
      
      await invalidate(merchantId);
      return c.json({ success: true });
    } catch (error) {
      log.error('Failed to enable maintenance mode', { error: String(error) });
      return c.json({ success: false, error: 'internal_error' }, 500);
    }
  });

  // Product Management APIs
  app.post('/admin/api/merchants/:merchantId/products', async (c) => {
    try {
      try { requireAdminAuth(c.req.raw); } catch { return c.json({ success:false, error:'unauthorized' }, 401); }
      const merchantId = c.req.param('merchantId');
      const body = await c.req.json();
      
      const productId = randomUUID();
      await sql`
        INSERT INTO products (
          id, merchant_id, sku, name_ar, name_en, description_ar, category,
          price_amount, stock_quantity, status, created_at, updated_at
        ) VALUES (
          ${productId}::uuid,
          ${merchantId}::uuid,
          ${body.sku},
          ${body.name_ar},
          ${body.name_en || null},
          ${body.description_ar || null},
          ${body.category || 'general'},
          ${body.price_amount},
          ${body.stock_quantity || 0},
          'ACTIVE',
          NOW(), NOW()
        )
      `;
      
      await invalidate(merchantId);
      return c.json({ success: true, product_id: productId });
    } catch (error) {
      log.error('Failed to create product', { error: String(error) });
      return c.json({ success: false, error: 'internal_error' }, 500);
    }
  });

  app.delete('/admin/api/products/:productId', async (c) => {
    try {
      try { requireAdminAuth(c.req.raw); } catch { return c.json({ success:false, error:'unauthorized' }, 401); }
      const productId = c.req.param('productId');
      
      const result = await sql`
        DELETE FROM products WHERE id = ${productId}::uuid
      `;
      
      if (result.length === 0) {
        return c.json({ success: false, error: 'product_not_found' }, 404);
      }
      
      return c.json({ success: true });
    } catch (error) {
      log.error('Failed to delete product', { error: String(error) });
      return c.json({ success: false, error: 'internal_error' }, 500);
    }
  });

  // API endpoint to create complete merchant
  app.post('/admin/api/merchants/complete', async (c) => {
    try {
      try { requireAdminAuth(c.req.raw); } catch { return c.json({ success:false, error:'unauthorized' }, 401); }
      const body = await c.req.json();
      const parsed = CompleteMerchantSchema.safeParse(body);
      
      if (!parsed.success) {
        return c.json({ 
          success: false, 
          error: 'validation_error', 
          details: parsed.error.issues 
        }, 400);
      }
      
      const data = parsed.data;
      const merchantId = randomUUID();
      
      // Start transaction
      await sql.begin(async (sql) => {
        // Insert merchant
        await sql`
          INSERT INTO merchants (
            id, business_name, business_category, business_address,
            whatsapp_number, instagram_username, email, currency,
            settings, ai_config, created_at, updated_at, last_activity_at
          ) VALUES (
            ${merchantId}::uuid,
            ${data.business_name},
            ${data.business_category},
            ${data.business_address || null},
            ${data.whatsapp_number},
            ${data.instagram_username || null},
            ${data.email || null},
            ${data.currency},
            ${JSON.stringify({
              working_hours: data.working_hours || {
                enabled: true,
                timezone: data.timezone,
                schedule: {
                  sunday: { open: "09:00", close: "22:00", enabled: true },
                  monday: { open: "09:00", close: "22:00", enabled: true },
                  tuesday: { open: "09:00", close: "22:00", enabled: true },
                  wednesday: { open: "09:00", close: "22:00", enabled: true },
                  thursday: { open: "09:00", close: "22:00", enabled: true },
                  friday: { open: "14:00", close: "22:00", enabled: true },
                  saturday: { open: "09:00", close: "22:00", enabled: false }
                }
              },
              payment_methods: data.payment_methods,
              delivery_fees: data.delivery_fees || {
                inside_baghdad: 0,
                outside_baghdad: 5
              },
              auto_responses: {
                welcome_message: data.response_templates?.greeting || "أهلاً وسهلاً! كيف أقدر أساعدك؟",
                outside_hours: data.response_templates?.outside_hours || "نعتذر، المحل مغلق حالياً. أوقات العمل: 9 صباحاً - 10 مساءً"
              }
            })}::jsonb,
            ${JSON.stringify(data.ai_config || {
              model: 'gpt-4o-mini',
              temperature: 0.8,
              max_tokens: 600,
              language: 'ar',
              sales_style: 'neutral'
            })}::jsonb,
            NOW(), NOW(), NOW()
          )
        `;
        
        // Insert dynamic templates
        await sql`
          INSERT INTO dynamic_response_templates (merchant_id, template_type, content, variables, priority)
          VALUES 
            (${merchantId}::uuid, 'greeting', ${data.response_templates?.greeting || 'مرحباً بك في ' + data.business_name + '! كيف يمكنني مساعدتك اليوم؟'}, ARRAY['business_name'], 1),
            (${merchantId}::uuid, 'fallback', ${data.response_templates?.fallback || 'عذراً، لم أفهم طلبك. هل يمكنك توضيح ما تبحث عنه؟'}, '{}', 1),
            (${merchantId}::uuid, 'outside_hours', ${data.response_templates?.outside_hours || 'نعتذر، المحل مغلق حالياً. ساعات العمل: 9 صباحاً - 10 مساءً'}, '{}', 1)
        `;
        
        // Insert dynamic AI settings
        const aiConfig = data.ai_config || {};
        await sql`
          INSERT INTO dynamic_ai_settings (merchant_id, setting_name, setting_value, setting_type)
          VALUES 
            (${merchantId}::uuid, 'model', ${(aiConfig as any).model || 'gpt-4o-mini'}, 'string'),
            (${merchantId}::uuid, 'temperature', ${String((aiConfig as any).temperature || 0.8)}, 'number'),
            (${merchantId}::uuid, 'max_tokens', ${String((aiConfig as any).max_tokens || 600)}, 'number'),
            (${merchantId}::uuid, 'language', ${(aiConfig as any).language || 'ar'}, 'string')
        `;
        
        // Insert dynamic defaults
        await sql`
          INSERT INTO dynamic_defaults (merchant_id, default_type, default_value, fallback_value)
          VALUES 
            (${merchantId}::uuid, 'business_name', ${data.business_name}, 'متجرنا'),
            (${merchantId}::uuid, 'currency', ${data.currency}, 'IQD'),
            (${merchantId}::uuid, 'merchant_type', ${data.business_category}, 'general')
        `;
        
        // Insert products if provided
        if (data.products && data.products.length > 0) {
          for (const product of data.products) {
            await sql`
              INSERT INTO products (
                merchant_id, sku, name_ar, name_en, description_ar, category,
                price_usd, stock_quantity, attributes, created_at, updated_at
              ) VALUES (
                ${merchantId}::uuid,
                ${product.sku},
                ${product.name_ar},
                ${product.name_en || null},
                ${product.description_ar || null},
                ${product.category},
                ${product.price_usd},
                ${product.stock_quantity},
                ${JSON.stringify(product.attributes || {})}::jsonb,
                NOW(), NOW()
              )
            `;
          }
        }
      });
      
      // Invalidate cache
      await cache.delete(`merchant:ctx:${merchantId}`, { prefix: 'ctx' });
      await cache.delete(`merchant:cats:${merchantId}`, { prefix: 'ctx' });
      
      log.info('Merchant created successfully', { 
        merchantId, 
        businessName: data.business_name,
        category: data.business_category 
      });
      
      return c.json({ 
        success: true, 
        merchant_id: merchantId,
        message: 'تم إنشاء التاجر بنجاح مع جميع الإعدادات المطلوبة'
      });
      
    } catch (error) {
      log.error('Failed to create merchant', { error: String(error) });
      return c.json({ 
        success: false, 
        error: 'internal_error',
        message: 'حدث خطأ في إنشاء التاجر'
      }, 500);
    }
  });

  // Create merchant
  app.post('/admin/api/merchants', async (c) => {
    try {
      try { requireAdminAuth(c.req.raw); } catch { return c.json({ ok:false, error:'unauthorized' }, 401); }
      const body = await c.req.json();
      const parsed = CreateMerchantSchema.safeParse(body);
      if (!parsed.success) return c.json({ ok:false, error:'validation_error', details: parsed.error.issues }, 400);
      const d = parsed.data;

      const rows = await sql<{ id: string }>`
        INSERT INTO merchants (
          business_name, business_category, whatsapp_number, instagram_username, email, currency, settings, last_activity_at
        ) VALUES (
          ${d.business_name}, ${d.business_category}, ${d.whatsapp_number}, ${d.instagram_username ?? null}, ${d.email ?? null}, ${d.currency?.toUpperCase() || 'IQD'}, ${JSON.stringify(d.settings || {})}::jsonb, NOW()
        )
        ON CONFLICT (whatsapp_number) DO UPDATE SET business_name = EXCLUDED.business_name
        RETURNING id
      `;

      if (d.ai_config) {
        await sql`UPDATE merchants SET ai_config = ${JSON.stringify(d.ai_config)}::jsonb WHERE id = ${rows[0]!.id}::uuid`;
      }

      await invalidate(rows[0]!.id);
      return c.json({ ok: true, id: rows[0]!.id });
    } catch (error) {
      log.error('Create merchant failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  // Generate JWT for merchant
  app.post('/admin/api/merchants/:id/jwt', async (c) => {
    try {
      try { requireAdminAuth(c.req.raw); } catch { return c.json({ ok:false, error:'unauthorized' }, 401); }
      const merchantId = c.req.param('id');
      const secret = process.env.JWT_SECRET;
      if (!secret) return c.json({ ok:false, error:'missing_jwt_secret' }, 500);
      const token = jwt.sign({ merchantId }, secret, { expiresIn: '365d' });
      return c.json({ ok: true, token });
    } catch (error) {
      log.error('Generate merchant JWT failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  // Patch settings
  app.patch('/admin/api/merchants/:id/settings', async (c) => {
    try {
      try { requireAdminAuth(c.req.raw); } catch { return c.json({ ok:false, error:'unauthorized' }, 401); }
      const merchantId = c.req.param('id');
      const body = await c.req.json();
      const parsed = SettingsPatchSchema.safeParse(body);
      if (!parsed.success) return c.json({ ok:false, error:'validation_error', details: parsed.error.issues }, 400);
      const patch = parsed.data;
      await sql`UPDATE merchants SET settings = COALESCE(settings,'{}'::jsonb) || ${JSON.stringify(patch)}::jsonb, updated_at = NOW() WHERE id = ${merchantId}::uuid`;
      await invalidate(merchantId);
      return c.json({ ok: true });
    } catch (error) {
      log.error('Patch merchant settings failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  // Patch AI config
  app.patch('/admin/api/merchants/:id/ai-config', async (c) => {
    try {
      try { requireAdminAuth(c.req.raw); } catch { return c.json({ ok:false, error:'unauthorized' }, 401); }
      const merchantId = c.req.param('id');
      const body = await c.req.json();
      const parsed = AIConfigPatchSchema.safeParse(body);
      if (!parsed.success) return c.json({ ok:false, error:'validation_error', details: parsed.error.issues }, 400);
      const patch = parsed.data;
      await sql`UPDATE merchants SET ai_config = COALESCE(ai_config,'{}'::jsonb) || ${JSON.stringify(patch)}::jsonb, updated_at = NOW() WHERE id = ${merchantId}::uuid`;
      await invalidate(merchantId);
      return c.json({ ok: true });
    } catch (error) {
      log.error('Patch merchant ai_config failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  // Patch currency
  app.patch('/admin/api/merchants/:id/currency', async (c) => {
    try {
      try { requireAdminAuth(c.req.raw); } catch { return c.json({ ok:false, error:'unauthorized' }, 401); }
      const merchantId = c.req.param('id');
      const body = await c.req.json();
      const currency = typeof body?.currency === 'string' ? String(body.currency).toUpperCase() : '';
      if (!/^\w{3}$/.test(currency)) return c.json({ ok:false, error:'invalid_currency' }, 400);
      await sql`UPDATE merchants SET currency = ${currency}, updated_at = NOW() WHERE id = ${merchantId}::uuid`;
      await invalidate(merchantId);
      return c.json({ ok: true, currency });
    } catch (error) {
      log.error('Patch merchant currency failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  // Predictive Analytics Admin Endpoints
  app.get('/admin/predictive/health', async (c) => {
    try {
      requireAdminAuth(c.req.raw);
      const health = checkPredictiveServicesHealth();
      return c.json({ 
        ok: true, 
        predictiveServices: health 
      });
    } catch (error) {
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }
  });

  app.post('/admin/predictive/run-manual', async (c) => {
    try {
      requireAdminAuth(c.req.raw);
      log.info('Manual predictive analytics triggered by admin');
      const results = await runManualPredictiveAnalytics();
      return c.json({ 
        ok: true, 
        results 
      });
    } catch (error) {
      log.error('Manual predictive analytics failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  app.get('/admin/predictive/insights/:merchantId', async (c) => {
    try {
      requireAdminAuth(c.req.raw);
      const merchantId = c.req.param('merchantId');
      const sql = getDatabase().getSQL();

      // Get recent insights cache for this merchant
      const insights = await sql<{ customer_id: string; insights: Record<string, unknown>; computed_at: Date }>`
        SELECT customer_id, insights, computed_at
        FROM customer_insights_cache
        WHERE merchant_id = ${merchantId}::uuid
          AND expires_at > NOW()
        ORDER BY computed_at DESC
        LIMIT 10
      `;

      return c.json({ 
        ok: true, 
        merchantId,
        insights: insights.map(i => ({
          customerId: i.customer_id,
          data: i.insights,
          computedAt: i.computed_at
        }))
      });

    } catch (error) {
      log.error('Failed to fetch predictive insights', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });
}

export default registerAdminRoutes;
