/**
 * ===============================================
 * Unified Admin Dashboard - All functions in one page
 * Protected with Basic Auth (ADMIN_USER / ADMIN_PASS)
 * ===============================================
 */

import { Hono } from 'hono';
import { getLogger } from '../services/logger.js';
import { getDatabase } from '../db/adapter.js';
import { z } from 'zod';
import { getCache } from '../cache/index.js';
// import * as jwt from 'jsonwebtoken';
// import { checkPredictiveServicesHealth, runManualPredictiveAnalytics } from '../startup/predictive-services.js';
import { randomUUID } from 'crypto';

const log = getLogger({ component: 'admin-routes' });

function requireAdminAuth(req: Request): void {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Basic ')) throw new Error('Unauthorized');
  const decode = (b64: string) => (typeof atob === 'function') ? atob(b64) : Buffer.from(b64, 'base64').toString('utf8');
  const creds = decode(auth.slice(6));
  const [user, pass] = creds.split(':');
  const ADMIN_USER = process.env.ADMIN_USER || 'admin';
  const ADMIN_PASS = process.env.ADMIN_PASS ?? '';
  if (!ADMIN_PASS) throw new Error('Admin not configured');
  if (user !== ADMIN_USER || pass !== ADMIN_PASS) throw new Error('Unauthorized');
}

const CreateMerchantSchema = z.object({
  business_name: z.string().min(2).max(255),
  business_category: z.string().min(2).max(100).optional().default('general'),
  business_address: z.string().optional(),
  whatsapp_number: z.string().min(6).max(20),
  instagram_username: z.string().min(0).max(100).optional().default(''),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  manychat_udid: z.string().min(0).max(255).optional(),
  currency: z.string().length(3).optional().default('IQD'),
  timezone: z.string().optional().default('Asia/Baghdad'),
  working_hours: z.record(z.any()).optional(),
  payment_methods: z.array(z.string()).optional(),
  ai_config: z.record(z.any()).optional(),
  response_templates: z.record(z.string()).optional(),
  products: z.array(z.object({
    sku: z.string(),
    name_ar: z.string(),
    name_en: z.string().optional(),
    description_ar: z.string().optional(),
    category: z.string().default('general'),
    price_usd: z.number().min(0),
    stock_quantity: z.number().min(0).default(0),
    tags: z.array(z.string()).optional(),
    image_url: z.string().optional(),
    is_active: z.boolean().optional().default(true)
  })).optional()
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

  // Redirect to static admin interface
  app.get('/admin', async (c) => {
    try {
      requireAdminAuth(c.req.raw);
    } catch (e) {
      return c.text('Unauthorized', 401, { 'WWW-Authenticate': 'Basic realm="admin"' });
    }

    // Redirect to static merchants management page
    return c.redirect('/public/merchants-management.html');
  });

  // Serve admin interface with auth
  app.get('/admin/interface', async (c) => {
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
    <title>لوحة تحكم الإدارة</title>
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
        .tabs {
            display: flex;
            background: #f8f9fa;
            border-radius: 10px;
            margin-bottom: 30px;
            overflow: hidden;
        }
        .tab {
            flex: 1;
            padding: 15px 20px;
            background: #e9ecef;
            border: none;
            cursor: pointer;
            font-size: 16px;
            font-weight: 600;
            transition: all 0.3s ease;
        }
        .tab.active {
            background: #1e3c72;
            color: white;
        }
        .tab:hover:not(.active) {
            background: #dee2e6;
        }
        .tab-content {
            display: none;
        }
        .tab-content.active {
            display: block;
        }
        .form-section {
            background: #f8f9fa;
            padding: 25px;
            border-radius: 15px;
            margin-bottom: 25px;
            border: 2px solid #e9ecef;
        }
        .form-section h2 {
            color: #1e3c72;
            margin-bottom: 20px;
            font-size: 1.5rem;
            display: flex;
            align-items: center;
            gap: 10px;
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
        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #333;
        }
        .form-group input,
        .form-group select,
        .form-group textarea {
            width: 100%;
            padding: 12px;
            border: 2px solid #e9ecef;
            border-radius: 8px;
            font-size: 14px;
            transition: border-color 0.3s ease;
        }
        .form-group input:focus,
        .form-group select:focus,
        .form-group textarea:focus {
            outline: none;
            border-color: #1e3c72;
        }
        .btn {
            padding: 12px 25px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.3s ease;
            margin: 5px;
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
            box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        }
        .merchant-search {
            background: white;
            padding: 20px;
            border-radius: 10px;
            border: 2px solid #e9ecef;
            margin-bottom: 20px;
        }
        .merchant-search input {
            width: 300px;
            padding: 10px;
            border: 2px solid #e9ecef;
            border-radius: 8px;
            margin-left: 10px;
        }
        .merchant-actions {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            margin-top: 15px;
        }
        .loading {
            display: none;
            text-align: center;
            padding: 20px;
            color: #666;
        }
        .success {
            display: none;
            background: #d4edda;
            color: #155724;
            padding: 15px;
            border-radius: 8px;
            margin: 15px 0;
        }
        .error {
            display: none;
            background: #f8d7da;
            color: #721c24;
            padding: 15px;
            border-radius: 8px;
            margin: 15px 0;
        }
        .product-item {
            background: white;
            border: 2px solid #e9ecef;
            border-radius: 15px;
            padding: 20px;
            margin-bottom: 15px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .product-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid #e9ecef;
        }
        .add-product {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 15px 30px;
            border-radius: 15px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            margin-bottom: 20px;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
        }
        .add-product:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
        }
        #products-container {
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎛️ لوحة تحكم الإدارة الموحدة</h1>
            <p>إدارة شاملة للتجار والخدمات والمنتجات</p>
        </div>
        
        <div class="content">
            <div class="tabs">
                <button class="tab active" onclick="showTab('create', this)">➕ إنشاء تاجر جديد</button>
                <button class="tab" onclick="showTab('manage', this)">⚙️ إدارة التجار</button>
                <button class="tab" onclick="showTab('services', this)">🔧 إدارة الخدمات</button>
                <button class="tab" onclick="showTab('products', this)">📦 إدارة المنتجات</button>
                <button class="tab" onclick="showTab('analytics', this)">📊 التحليلات</button>
            </div>
            
            <!-- Create Merchant Tab -->
            <div id="create-tab" class="tab-content active">
                <div class="form-section">
                    <h2><i class="fas fa-user-plus"></i> إنشاء تاجر جديد</h2>
                    <form id="createMerchantForm">
                        <div class="form-row">
                            <div class="form-group">
                                <label>اسم العمل *</label>
                                <input type="text" name="business_name" required placeholder="مثال: متجر الأزياء الحديث">
                            </div>
                            <div class="form-group">
                                <label>فئة العمل</label>
                                <select name="business_category">
                                    <option value="general">عام</option>
                                    <option value="fashion">أزياء</option>
                                    <option value="electronics">إلكترونيات</option>
                                    <option value="beauty">جمال</option>
                                    <option value="home">منزل</option>
                                    <option value="sports">رياضة</option>
                                </select>
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label>رقم الواتساب *</label>
                                <input type="text" name="whatsapp_number" required placeholder="مثال: +964771234567">
                            </div>
                            <div class="form-group">
                                <label>اسم المستخدم في إنستغرام</label>
                                <input type="text" name="instagram_username" placeholder="مثال: my_shop">
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label>البريد الإلكتروني</label>
                                <input type="email" name="email" placeholder="مثال: info@myshop.com">
                            </div>
                            <div class="form-group">
                                <label>العملة</label>
                                <select name="currency">
                                    <option value="IQD">دينار عراقي</option>
                                    <option value="USD">دولار أمريكي</option>
                                    <option value="EUR">يورو</option>
                                </select>
                            </div>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label>ManyChat UDID (معرف المشترك)</label>
                                <input type="text" name="manychat_udid" placeholder="مثال: 1234567890123456789">
                                <small style="color: #666; font-size: 12px;">معرف المشترك في ManyChat لربط الحساب</small>
                            </div>
                            <div class="form-group">
                                <label>رقم الهاتف</label>
                                <input type="tel" name="phone" placeholder="مثال: +964771234567">
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label>وصف العمل</label>
                            <textarea name="business_description" placeholder="وصف مختصر عن العمل..."></textarea>
                        </div>
                        
                        <!-- Products Section -->
                        <div class="form-section">
                            <h2><i class="fas fa-box"></i> المنتجات (اختياري)</h2>
                            <p>يمكنك إضافة المنتجات الآن أو لاحقاً من لوحة التحكم</p>
                            <button type="button" class="add-product" id="add-product-btn">
                                <i class="fas fa-plus"></i> إضافة منتج جديد
                            </button>
                            <div id="products-container"></div>
                        </div>
                        
                        <button type="submit" class="btn btn-success">
                            <i class="fas fa-rocket"></i> إنشاء التاجر
                        </button>
                        
                        <div class="loading" id="loading">
                            <p><i class="fas fa-spinner fa-spin"></i> جاري إنشاء التاجر...</p>
                        </div>
                        
                        <div class="success" id="success">
                            <h3><i class="fas fa-check-circle"></i> تم إنشاء التاجر بنجاح!</h3>
                            <p id="success-message"></p>
                        </div>
                        
                        <div class="error" id="error">
                            <h3><i class="fas fa-exclamation-triangle"></i> حدث خطأ</h3>
                            <p id="error-message"></p>
                        </div>
                    </form>
                </div>
            </div>
            
            <!-- Manage Merchants Tab -->
            <div id="manage-tab" class="tab-content">
                <div class="form-section">
                    <h2><i class="fas fa-users"></i> إدارة التجار</h2>
                    <div class="merchant-search">
                        <label>البحث عن تاجر:</label>
                        <input type="text" id="merchantSearchInput" placeholder="أدخل معرف التاجر أو اسم العمل">
                        <button class="btn btn-primary" onclick="searchMerchant()">🔍 بحث</button>
                    </div>
                    <div id="merchantResults"></div>
                </div>
            </div>
            
            <!-- Services Management Tab -->
            <div id="services-tab" class="tab-content">
                <div class="form-section">
                    <h2><i class="fas fa-cogs"></i> إدارة الخدمات</h2>
                    <div class="merchant-search">
                        <label>اختر التاجر:</label>
                        <input type="text" id="servicesMerchantInput" placeholder="أدخل معرف التاجر">
                        <button class="btn btn-primary" onclick="loadServices()">⚙️ تحميل الخدمات</button>
                    </div>
                    <div id="servicesResults"></div>
                </div>
            </div>
            
            <!-- Products Management Tab -->
            <div id="products-tab" class="tab-content">
                <div class="form-section">
                    <h2><i class="fas fa-box"></i> إدارة المنتجات</h2>
                    <div class="merchant-search">
                        <label>اختر التاجر:</label>
                        <input type="text" id="productsMerchantInput" placeholder="أدخل معرف التاجر">
                        <button class="btn btn-primary" onclick="loadProducts()">📦 تحميل المنتجات</button>
                    </div>
                    <div id="productsResults"></div>
                </div>
            </div>
            
            <!-- Analytics Tab -->
            <div id="analytics-tab" class="tab-content">
                <div class="form-section">
                    <h2><i class="fas fa-chart-bar"></i> التحليلات والإحصائيات</h2>
                    <div class="merchant-search">
                        <label>اختر التاجر:</label>
                        <input type="text" id="analyticsMerchantInput" placeholder="أدخل معرف التاجر">
                        <button class="btn btn-primary" onclick="loadAnalytics()">📊 تحميل التحليلات</button>
                    </div>
                    <div id="analyticsResults"></div>
                </div>
            </div>
        </div>
    </div>

    <script>
        let productCount = 0;
        let currentMerchantId = null;

        // Tab Management
        function showTab(tabName, element) {
            // Hide all tab contents
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            
            // Remove active class from all tabs
            document.querySelectorAll('.tab').forEach(tab => {
                tab.classList.remove('active');
            });
            
            // Show selected tab content
            document.getElementById(tabName + '-tab').classList.add('active');
            
            // Add active class to clicked tab
            if (element) {
                element.classList.add('active');
            }
        }

        // Product Management Functions
        function addProduct() {
            productCount++;
            const container = document.getElementById('products-container');
            
            if (!container) {
                console.error('Products container not found');
                alert('خطأ: لم يتم العثور على حاوية المنتجات');
                return;
            }
            
            // Ensure container is visible and properly styled
            container.style.display = 'block';
            container.style.visibility = 'visible';
            container.style.opacity = '1';
            container.style.marginTop = '20px';
            container.style.padding = '15px';
            container.style.border = '1px solid #e9ecef';
            container.style.borderRadius = '10px';
            container.style.backgroundColor = '#f8f9fa';
            
            const productDiv = document.createElement('div');
            productDiv.className = 'product-item';
            productDiv.style.cssText = \`
                background: white;
                border: 2px solid #e9ecef;
                border-radius: 15px;
                padding: 20px;
                margin-bottom: 15px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                transition: all 0.3s ease;
            \`;
            productDiv.innerHTML = 
                '<div class="product-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #e9ecef;">' +
                    '<h3 style="color: #1e3c72; margin: 0; font-size: 1.2rem;">منتج ' + productCount + '</h3>' +
                    '<button type="button" class="remove-product" onclick="removeProduct(this)" style="background: #dc3545; color: white; border: none; padding: 8px 15px; border-radius: 5px; cursor: pointer; font-size: 14px;">حذف</button>' +
                '</div>' +
                '<div class="form-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">' +
                    '<div class="form-group">' +
                        '<label style="display: block; margin-bottom: 5px; font-weight: 600; color: #333;">رمز المنتج (SKU) *</label>' +
                        '<input type="text" name="products[' + productCount + '].sku" required placeholder="مثال: PROD-' + productCount + '" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px;">' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label style="display: block; margin-bottom: 5px; font-weight: 600; color: #333;">اسم المنتج (عربي) *</label>' +
                        '<input type="text" name="products[' + productCount + '].name_ar" required placeholder="مثال: قميص قطني" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px;">' +
                    '</div>' +
                '</div>' +
                '<div class="form-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">' +
                    '<div class="form-group">' +
                        '<label style="display: block; margin-bottom: 5px; font-weight: 600; color: #333;">اسم المنتج (إنجليزي)</label>' +
                        '<input type="text" name="products[' + productCount + '].name_en" placeholder="مثال: Cotton Shirt" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px;">' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label style="display: block; margin-bottom: 5px; font-weight: 600; color: #333;">الفئة</label>' +
                        '<select name="products[' + productCount + '].category" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px;">' +
                            '<option value="general">عام</option>' +
                            '<option value="fashion">أزياء</option>' +
                            '<option value="electronics">إلكترونيات</option>' +
                            '<option value="beauty">جمال</option>' +
                            '<option value="home">منزل</option>' +
                            '<option value="sports">رياضة</option>' +
                        '</select>' +
                    '</div>' +
                '</div>' +
                '<div class="form-group" style="margin-bottom: 15px;">' +
                    '<label style="display: block; margin-bottom: 5px; font-weight: 600; color: #333;">وصف المنتج</label>' +
                    '<textarea name="products[' + productCount + '].description_ar" placeholder="وصف مختصر للمنتج..." style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px; min-height: 80px; resize: vertical;"></textarea>' +
                '</div>' +
                '<div class="form-row" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">' +
                    '<div class="form-group">' +
                        '<label style="display: block; margin-bottom: 5px; font-weight: 600; color: #333;">السعر (دولار) *</label>' +
                        '<input type="number" name="products[' + productCount + '].price_usd" step="0.01" min="0" required placeholder="0.00" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px;">' +
                    '</div>' +
                    '<div class="form-group">' +
                        '<label style="display: block; margin-bottom: 5px; font-weight: 600; color: #333;">الكمية المتوفرة</label>' +
                        '<input type="number" name="products[' + productCount + '].stock_quantity" min="0" value="0" placeholder="0" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 14px;">' +
                    '</div>' +
                '</div>';
            container.appendChild(productDiv);
            
            // Add smooth animation
            productDiv.style.opacity = '0';
            productDiv.style.transform = 'translateY(20px)';
            setTimeout(() => {
                productDiv.style.transition = 'all 0.3s ease';
                productDiv.style.opacity = '1';
                productDiv.style.transform = 'translateY(0)';
            }, 100);
        }

        function removeProduct(button) {
            try {
                const productItem = button.closest('.product-item');
                if (productItem) {
                    if (confirm('هل أنت متأكد من حذف هذا المنتج؟')) {
                        productItem.style.transition = 'all 0.3s ease';
                        productItem.style.opacity = '0';
                        productItem.style.transform = 'translateY(-20px)';
                        setTimeout(() => {
                            productItem.remove();
                            updateProductCount();
                        }, 300);
                    }
                } else {
                    console.error('Product item not found');
                    alert('خطأ: لم يتم العثور على المنتج المراد حذفه');
                }
            } catch (error) {
                console.error('Error removing product:', error);
                alert('حدث خطأ في حذف المنتج. يرجى المحاولة مرة أخرى.');
            }
        }

        function updateProductCount() {
            const container = document.getElementById('products-container');
            if (container) {
                const productItems = container.querySelectorAll('.product-item');
                productItems.forEach((item, index) => {
                    const header = item.querySelector('.product-header h3');
                    if (header) {
                        header.textContent = \`منتج \${index + 1}\`;
                    }
                });
                productCount = productItems.length;
            }
        }

        // Form Submission
        document.getElementById('createMerchantForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const loadingDiv = document.getElementById('loading');
            const successDiv = document.getElementById('success');
            const errorDiv = document.getElementById('error');
            
            // Show loading
            loadingDiv.style.display = 'block';
            successDiv.style.display = 'none';
            errorDiv.style.display = 'none';
            
            try {
                const formData = new FormData(this);
                const data = Object.fromEntries(formData.entries());
                
                // Process products array
                const products = [];
                const productInputs = this.querySelectorAll('[name^="products["]');
                const productGroups = {};
                
                productInputs.forEach(input => {
                    const match = input.name.match(/products\[(\d+)\]\.(.+)/);
                    if (match) {
                        const [, index, field] = match;
                        if (!productGroups[index]) productGroups[index] = {};
                        productGroups[index][field] = input.value;
                    }
                });
                
                Object.values(productGroups).forEach(product => {
                    if (product.sku && product.name_ar) {
                        products.push({
                            sku: product.sku,
                            name_ar: product.name_ar,
                            name_en: product.name_en || '',
                            description_ar: product.description_ar || '',
                            category: product.category || 'general',
                            price_usd: parseFloat(product.price_usd) || 0,
                            stock_quantity: parseInt(product.stock_quantity) || 0
                        });
                    }
                });
                
                if (products.length > 0) {
                    data.products = products;
                }
                
                const response = await fetch('/admin/merchants', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Basic ' + btoa('admin:admin')
                    },
                    body: JSON.stringify(data)
                });
                
                const result = await response.json();
                
                loadingDiv.style.display = 'none';
                
                if (response.ok) {
                    successDiv.style.display = 'block';
                    document.getElementById('success-message').textContent = 
                        \`تم إنشاء التاجر بنجاح! معرف التاجر: \${result.merchant_id}\`;
                    this.reset();
                    document.getElementById('products-container').innerHTML = '';
                    productCount = 0;
                } else {
                    errorDiv.style.display = 'block';
                    document.getElementById('error-message').textContent = result.message || 'حدث خطأ غير متوقع';
                }
            } catch (error) {
                loadingDiv.style.display = 'none';
                errorDiv.style.display = 'block';
                document.getElementById('error-message').textContent = 'حدث خطأ في الاتصال: ' + error.message;
            }
        });

        // Merchant Search Functions
        async function searchMerchant() {
            const searchInput = document.getElementById('merchantSearchInput');
            const resultsDiv = document.getElementById('merchantResults');
            const query = searchInput.value.trim();
            
            if (!query) {
                alert('يرجى إدخال معرف التاجر أو اسم العمل');
                return;
            }
            
            resultsDiv.innerHTML = '<p>جاري البحث...</p>';
            
            try {
                const response = await fetch(\`/admin/merchants/search?q=\${encodeURIComponent(query)}\`, {
                    headers: {
                        'Authorization': 'Basic ' + btoa('admin:admin')
                    }
                });
                
                const merchants = await response.json();
                
                if (merchants.length === 0) {
                    resultsDiv.innerHTML = '<p>لم يتم العثور على تجار</p>';
                    return;
                }
                
                resultsDiv.innerHTML = merchants.map(merchant => \`
                    <div class="form-section">
                        <h3>\${merchant.business_name}</h3>
                        <p><strong>المعرف:</strong> \${merchant.id}</p>
                        <p><strong>الفئة:</strong> \${merchant.business_category}</p>
                        <p><strong>الواتساب:</strong> \${merchant.whatsapp_number}</p>
                        <p><strong>إنستغرام:</strong> \${merchant.instagram_username || 'غير محدد'}</p>
                        <p><strong>تاريخ الإنشاء:</strong> \${new Date(merchant.created_at).toLocaleDateString('ar-SA')}</p>
                        <div class="merchant-actions">
                            <button class="btn btn-primary" onclick="loadServicesForMerchant('\${merchant.id}')">⚙️ إدارة الخدمات</button>
                            <button class="btn btn-warning" onclick="loadProductsForMerchant('\${merchant.id}')">📦 إدارة المنتجات</button>
                            <button class="btn btn-success" onclick="loadAnalyticsForMerchant('\${merchant.id}')">📊 التحليلات</button>
                        </div>
                    </div>
                \`).join('');
            } catch (error) {
                resultsDiv.innerHTML = '<p>حدث خطأ في البحث: ' + error.message + '</p>';
            }
        }

        // Service Management Functions
        async function loadServices() {
            const merchantInput = document.getElementById('servicesMerchantInput');
            const resultsDiv = document.getElementById('servicesResults');
            const merchantId = merchantInput.value.trim();
            
            if (!merchantId) {
                alert('يرجى إدخال معرف التاجر');
                return;
            }
            
            await loadServicesForMerchant(merchantId);
        }

        async function loadServicesForMerchant(merchantId) {
            const resultsDiv = document.getElementById('servicesResults');
            resultsDiv.innerHTML = '<p>جاري تحميل الخدمات...</p>';
            
            try {
                const response = await fetch(\`/admin/services/\${merchantId}\`, {
                    headers: {
                        'Authorization': 'Basic ' + btoa('admin:admin')
                    }
                });
                
                const result = await response.json();
                
                if (result.success) {
                    const { merchant, services } = result;
                    resultsDiv.innerHTML = \`
                        <div class="form-section">
                            <h3>خدمات \${merchant.business_name}</h3>
                            <p><strong>الواتساب:</strong> \${merchant.whatsapp_number}</p>
                            <p><strong>إنستغرام:</strong> \${merchant.instagram_username || 'غير محدد'}</p>
                            <div class="merchant-actions">
                                \${services.map(service => \`
                                    <div style="background: white; padding: 15px; margin: 10px 0; border-radius: 8px; border: 2px solid \${service.enabled ? '#28a745' : '#dc3545'};">
                                        <h4>\${getServiceName(service.service_name)} \${service.enabled ? '✅' : '❌'}</h4>
                                        <p><strong>الحالة:</strong> \${service.enabled ? 'مفعل' : 'معطل'}</p>
                                        <p><strong>آخر تحديث:</strong> \${new Date(service.last_updated).toLocaleString('ar-SA')}</p>
                                        <p><strong>بواسطة:</strong> \${service.toggled_by}</p>
                                        <button class="btn \${service.enabled ? 'btn-danger' : 'btn-success'}" onclick="toggleService('\${merchantId}', '\${service.service_name}', \${!service.enabled})">
                                            \${service.enabled ? 'إيقاف' : 'تفعيل'}
                                        </button>
                                    </div>
                                \`).join('')}
                            </div>
                        </div>
                    \`;
                } else {
                    resultsDiv.innerHTML = '<p>لم يتم العثور على التاجر أو الخدمات</p>';
                }
            } catch (error) {
                resultsDiv.innerHTML = '<p>حدث خطأ في تحميل الخدمات: ' + error.message + '</p>';
            }
        }

        // Product Management Functions
        async function loadProducts() {
            const merchantInput = document.getElementById('productsMerchantInput');
            const merchantId = merchantInput.value.trim();
            
            if (!merchantId) {
                alert('يرجى إدخال معرف التاجر');
                return;
            }
            
            await loadProductsForMerchant(merchantId);
        }

        async function loadProductsForMerchant(merchantId) {
            const resultsDiv = document.getElementById('productsResults');
            resultsDiv.innerHTML = '<p>جاري تحميل المنتجات...</p>';
            
            try {
                const response = await fetch(\`/admin/merchants/\${merchantId}/products\`, {
                    headers: {
                        'Authorization': 'Basic ' + btoa('admin:admin')
                    }
                });
                
                const result = await response.json();
                
                if (result.success) {
                    const { products } = result;
                    if (products.length === 0) {
                        resultsDiv.innerHTML = '<p>لا توجد منتجات لهذا التاجر</p>';
                        return;
                    }
                    
                    resultsDiv.innerHTML = \`
                        <div class="form-section">
                            <h3>منتجات التاجر (\${products.length} منتج)</h3>
                            <div class="merchant-actions">
                                \${products.map(product => \`
                                    <div style="background: white; padding: 15px; margin: 10px 0; border-radius: 8px; border: 2px solid #e9ecef;">
                                        <h4>\${product.name_ar}</h4>
                                        <p><strong>SKU:</strong> \${product.sku}</p>
                                        <p><strong>الفئة:</strong> \${product.category}</p>
                                        <p><strong>السعر:</strong> \$\${product.price_usd}</p>
                                        <p><strong>الكمية:</strong> \${product.stock_quantity}</p>
                                        <p><strong>تاريخ الإنشاء:</strong> \${new Date(product.created_at).toLocaleDateString('ar-SA')}</p>
                                    </div>
                                \`).join('')}
                            </div>
                        </div>
                    \`;
                } else {
                    resultsDiv.innerHTML = '<p>لم يتم العثور على المنتجات</p>';
                }
            } catch (error) {
                resultsDiv.innerHTML = '<p>حدث خطأ في تحميل المنتجات: ' + error.message + '</p>';
            }
        }

        // Analytics Functions
        async function loadAnalytics() {
            const merchantInput = document.getElementById('analyticsMerchantInput');
            const merchantId = merchantInput.value.trim();
            
            if (!merchantId) {
                alert('يرجى إدخال معرف التاجر');
                return;
            }
            
            await loadAnalyticsForMerchant(merchantId);
        }

        async function loadAnalyticsForMerchant(merchantId) {
            const resultsDiv = document.getElementById('analyticsResults');
            resultsDiv.innerHTML = '<p>جاري تحميل التحليلات...</p>';
            
            try {
                const response = await fetch(\`/admin/merchants/\${merchantId}/analytics\`, {
                    headers: {
                        'Authorization': 'Basic ' + btoa('admin:admin')
                    }
                });
                
                const result = await response.json();
                
                if (result.success) {
                    const { analytics } = result;
                    resultsDiv.innerHTML = \`
                        <div class="form-section">
                            <h3>تحليلات \${analytics.merchant.business_name}</h3>
                            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px;">
                                <div style="background: #e3f2fd; padding: 20px; border-radius: 10px; text-align: center;">
                                    <h4 style="color: #1976d2;">إجمالي المنتجات</h4>
                                    <p style="font-size: 2rem; font-weight: bold; color: #1976d2;">\${analytics.total_products}</p>
                                </div>
                                <div style="background: #e8f5e8; padding: 20px; border-radius: 10px; text-align: center;">
                                    <h4 style="color: #388e3c;">قيمة المخزون</h4>
                                    <p style="font-size: 2rem; font-weight: bold; color: #388e3c;">\$\${analytics.inventory_value.toFixed(2)}</p>
                                </div>
                                <div style="background: #fff3e0; padding: 20px; border-radius: 10px; text-align: center;">
                                    <h4 style="color: #f57c00;">تاريخ الإنشاء</h4>
                                    <p style="font-size: 1.2rem; font-weight: bold; color: #f57c00;">\${new Date(analytics.created_at).toLocaleDateString('ar-SA')}</p>
                                </div>
                            </div>
                        </div>
                    \`;
                } else {
                    resultsDiv.innerHTML = '<p>لم يتم العثور على التحليلات</p>';
                }
            } catch (error) {
                resultsDiv.innerHTML = '<p>حدث خطأ في تحميل التحليلات: ' + error.message + '</p>';
            }
        }

        // Service Toggle Function
        async function toggleService(merchantId, serviceName, enabled) {
            try {
                const response = await fetch(\`/admin/services/\${merchantId}/toggle\`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Basic ' + btoa('admin:admin')
                    },
                    body: JSON.stringify({
                        service_name: serviceName,
                        enabled: enabled,
                        reason: enabled ? 'تم التفعيل من لوحة الإدارة' : 'تم الإيقاف من لوحة الإدارة'
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('تم تحديث الخدمة بنجاح');
                    await loadServicesForMerchant(merchantId);
                } else {
                    alert('حدث خطأ في تحديث الخدمة');
                }
            } catch (error) {
                console.error('Error:', error);
                alert('حدث خطأ في الاتصال');
            }
        }

        // Helper function for service names
        function getServiceName(serviceName) {
            const names = {
                'whatsapp_automation': 'أتمتة واتساب',
                'instagram_automation': 'أتمتة إنستغرام',
                'ai_responses': 'الردود الذكية',
                'order_processing': 'معالجة الطلبات',
                'inventory_management': 'إدارة المخزون',
                'customer_support': 'دعم العملاء',
                'analytics': 'التحليلات',
                'notifications': 'الإشعارات'
            };
            return names[serviceName] || serviceName;
        }

        // Setup event listeners when DOM is ready
        document.addEventListener('DOMContentLoaded', function() {
            const addProductBtn = document.getElementById('add-product-btn');
            if (addProductBtn) {
                addProductBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                        addProduct();
                    } catch (error) {
                        console.error('Error adding product:', error);
                        alert('حدث خطأ في إضافة المنتج. يرجى المحاولة مرة أخرى.');
                    }
                    return false;
                });
            }
            
            // Initialize first tab
            showTab('create');
        });
        
        // Define missing functions
        function searchMerchant() {
            const searchTerm = document.getElementById('merchantSearchInput')?.value;
            const resultsDiv = document.getElementById('merchantResults');
            if (resultsDiv) {
                resultsDiv.innerHTML = searchTerm ? 
                    \`<p>جاري البحث عن: \${searchTerm}...</p>\` : 
                    '<p>يرجى إدخال اسم التاجر</p>';
            }
        }
        
        function loadServices() {
            const servicesDiv = document.getElementById('servicesResults');
            if (servicesDiv) {
                servicesDiv.innerHTML = '<p>جاري تحميل الخدمات...</p>';
            }
        }
        
        function loadProducts() {
            const productsDiv = document.getElementById('productsResults');
            if (productsDiv) {
                productsDiv.innerHTML = '<p>جاري تحميل المنتجات...</p>';
            }
        }
        
        function loadAnalytics() {
            const analyticsDiv = document.getElementById('analyticsResults');
            if (analyticsDiv) {
                analyticsDiv.innerHTML = '<p>جاري تحميل التحليلات...</p>';
            }
        }
    </script>
</body>
</html>`;

    return c.html(html);
  });

  // Create Merchant API
  app.post('/admin/merchants', async (c) => {
    const startTime = Date.now();
    
    try {
      requireAdminAuth(c.req.raw);
    } catch (e) {
      return c.json({ success: false, error: 'unauthorized' }, 401);
    }

    try {
      const body = await c.req.json();
      const validatedData = CreateMerchantSchema.parse(body);
      
      const merchantId = randomUUID();
      const now = new Date();
      
      // Prepare settings JSONB
      const settings = {
        working_hours: validatedData.working_hours || {
          enabled: true,
          timezone: validatedData.timezone || 'Asia/Baghdad',
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
        payment_methods: validatedData.payment_methods || ['COD'],
        delivery_fees: {
          inside_baghdad: 0,
          outside_baghdad: 5
        },
        auto_responses: validatedData.response_templates || {
          welcome_message: "أهلاً وسهلاً! كيف أقدر أساعدك؟",
          outside_hours: "نعتذر، المحل مغلق حالياً. أوقات العمل: 9 صباحاً - 10 مساءً"
        }
      };

      // Prepare AI config JSONB
      const aiConfig = validatedData.ai_config || {
        model: "gpt-4o-mini",
        temperature: 0.7,
        max_tokens: 150,
        response_tone: "friendly"
      };
      
      // Insert merchant
      await sql`
        INSERT INTO merchants (
          id, business_name, business_category, business_address, whatsapp_number, 
          instagram_username, email, currency, settings, ai_config, created_at, updated_at
        ) VALUES (
          ${merchantId}::uuid, ${validatedData.business_name}, 
          ${validatedData.business_category}, ${validatedData.business_address || null}, 
          ${validatedData.whatsapp_number}, ${validatedData.instagram_username || ''}, 
          ${validatedData.email || null}, ${validatedData.currency}, 
          ${JSON.stringify(settings)}, ${JSON.stringify(aiConfig)}, ${now}, ${now}
        )
      `;
      
      // Insert ManyChat UDID if provided
      if (validatedData.manychat_udid && validatedData.manychat_udid.trim()) {
        await sql`
          INSERT INTO manychat_subscribers (
            merchant_id, manychat_subscriber_id, instagram_customer_id, 
            status, created_at, updated_at
          ) VALUES (
            ${merchantId}::uuid, ${validatedData.manychat_udid.trim()}, 
            ${validatedData.instagram_username || null}, 
            'active', ${now}, ${now}
          )
        `;
        
        log.info('✅ ManyChat UDID linked to merchant', {
          merchantId,
          udid: validatedData.manychat_udid.trim(),
          instagram: validatedData.instagram_username
        });
      }
      
      // Insert products if provided
      if (validatedData.products && validatedData.products.length > 0) {
        // Generate merchant prefix from first two characters of business name
        const merchantPrefix = validatedData.business_name
          .replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '') // Remove special characters, keep Arabic and English
          .substring(0, 2)
          .toUpperCase();
        
        for (let i = 0; i < validatedData.products.length; i++) {
          const product = validatedData.products[i];
          
          // Generate automatic SKU if not provided
          let productSku = product.sku;
          if (!productSku || productSku.trim() === '') {
            // Generate SKU: MERCHANT_PREFIX + random 4 digits
            const randomDigits = Math.floor(1000 + Math.random() * 9000);
            productSku = `${merchantPrefix}${randomDigits}`;
          }
          
          await sql`
            INSERT INTO products (
              merchant_id, sku, name_ar, name_en, description_ar,
              category, price_usd, stock_quantity, tags, images, 
              is_active, created_at, updated_at
            ) VALUES (
              ${merchantId}::uuid, ${productSku}, ${product.name_ar},
              ${product.name_en || ''}, ${product.description_ar || ''},
              ${product.category}, ${product.price_usd}, ${product.stock_quantity},
              ${product.tags || []}, ${product.image_url ? JSON.stringify([{url: product.image_url}]) : '[]'},
              ${product.is_active !== false}, ${now}, ${now}
            )
          `;
        }
      }
      
      await invalidate(merchantId);
      
      // Calculate completeness score
      let completenessScore = 0;
      const totalFields = 10;
      
      if (validatedData.business_name) completenessScore++;
      if (validatedData.business_category) completenessScore++;
      if (validatedData.whatsapp_number) completenessScore++;
      if (validatedData.instagram_username) completenessScore++;
      if (validatedData.email) completenessScore++;
      if (validatedData.business_address) completenessScore++;
      if (validatedData.working_hours) completenessScore++;
      if (validatedData.payment_methods && validatedData.payment_methods.length > 0) completenessScore++;
      if (validatedData.ai_config) completenessScore++;
      if (validatedData.products && validatedData.products.length > 0) completenessScore++;
      
      const completenessPercentage = Math.round((completenessScore / totalFields) * 100);
      
      return c.json({
        success: true,
        merchant_id: merchantId,
        message: 'Merchant created successfully',
        completeness_score: completenessPercentage,
        execution_time_ms: Date.now() - startTime
      });
    } catch (error) {
      log.error('Failed to create merchant', { error: String(error) });
      return c.json({
        success: false,
        error: 'Failed to create merchant',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, 500);
    }
  });

  // Search Merchants API
  app.get('/admin/merchants/search', async (c) => {
    try {
      requireAdminAuth(c.req.raw);
    } catch (e) {
      return c.json({ success: false, error: 'unauthorized' }, 401);
    }

    try {
      const query = c.req.query('q');
      if (!query) {
        return c.json([]);
      }

      const merchants = await sql`
        SELECT id, business_name, business_category, whatsapp_number, 
               instagram_username, email, currency, created_at
        FROM merchants 
        WHERE business_name ILIKE ${'%' + query + '%'} 
           OR id::text ILIKE ${'%' + query + '%'}
           OR whatsapp_number ILIKE ${'%' + query + '%'}
        ORDER BY created_at DESC
        LIMIT 20
      `;

      return c.json(merchants);
    } catch (error) {
      log.error('Failed to search merchants', { error: String(error) });
      return c.json({ success: false, error: 'Search failed' }, 500);
    }
  });

  // Get Merchant Services API
  app.get('/admin/services/:merchantId', async (c) => {
    try {
      requireAdminAuth(c.req.raw);
    } catch (e) {
      return c.json({ success: false, error: 'unauthorized' }, 401);
    }

    try {
      const merchantId = c.req.param('merchantId');
      
      // Get merchant info
      const merchantRows = await sql`
        SELECT business_name, business_category, whatsapp_number, instagram_username 
        FROM merchants WHERE id = ${merchantId}::uuid
      `;
      
      if (merchantRows.length === 0) {
        return c.json({ success: false, error: 'Merchant not found' }, 404);
      }
      
      const merchant = merchantRows[0];
      
      // Get services status
      const services = await sql`
        SELECT service_name, enabled, last_updated, toggled_by, reason
        FROM service_control 
        WHERE merchant_id = ${merchantId}::uuid 
        ORDER BY service_name
      `;

      return c.json({
        success: true,
        merchant,
        services
      });
    } catch (error) {
      log.error('Failed to get merchant services', { error: String(error) });
      return c.json({ success: false, error: 'Failed to get services' }, 500);
    }
  });

  // Get Merchant Products API
  app.get('/admin/merchants/:merchantId/products', async (c) => {
    try {
      requireAdminAuth(c.req.raw);
    } catch (e) {
      return c.json({ success: false, error: 'unauthorized' }, 401);
    }

    try {
      const merchantId = c.req.param('merchantId');
      
      const products = await sql`
        SELECT id, sku, name_ar, name_en, description_ar, category, 
               price_usd, stock_quantity, created_at, updated_at
        FROM products 
        WHERE merchant_id = ${merchantId}::uuid 
        ORDER BY created_at DESC
      `;

      return c.json({
        success: true,
        products
      });
    } catch (error) {
      log.error('Failed to get merchant products', { error: String(error) });
      return c.json({ success: false, error: 'Failed to get products' }, 500);
    }
  });

  // Get Merchant Analytics API
  app.get('/admin/merchants/:merchantId/analytics', async (c) => {
    try {
      requireAdminAuth(c.req.raw);
    } catch (e) {
      return c.json({ success: false, error: 'unauthorized' }, 401);
    }

    try {
      const merchantId = c.req.param('merchantId');
      
      // Get basic analytics
      const [merchantInfo, productCount, totalValue] = await Promise.all([
        sql`SELECT business_name, business_category, created_at FROM merchants WHERE id = ${merchantId}::uuid`,
        sql`SELECT COUNT(*) as count FROM products WHERE merchant_id = ${merchantId}::uuid`,
        sql`SELECT COALESCE(SUM(price_usd * stock_quantity), 0) as total FROM products WHERE merchant_id = ${merchantId}::uuid`
      ]);

      return c.json({
        success: true,
        analytics: {
          merchant: merchantInfo[0] || null,
          total_products: parseInt(String(productCount[0]?.count || '0')),
          inventory_value: parseFloat(String(totalValue[0]?.total || '0')),
          created_at: merchantInfo[0]?.created_at
        }
      });
    } catch (error) {
      log.error('Failed to get merchant analytics', { error: String(error) });
      return c.json({ success: false, error: 'Failed to get analytics' }, 500);
    }
  });

  // Toggle Service API
  app.post('/admin/services/:merchantId/toggle', async (c) => {
    try {
      requireAdminAuth(c.req.raw);
    } catch (e) {
      return c.json({ success: false, error: 'unauthorized' }, 401);
    }

    try {
      const merchantId = c.req.param('merchantId');
      const body = await c.req.json();
      
      await sql`
        INSERT INTO service_control (merchant_id, service_name, enabled, toggled_by, reason)
        VALUES (${merchantId}::uuid, ${body.service_name}, ${body.enabled}, 'admin', ${body.reason || 'Updated via admin'})
        ON CONFLICT (merchant_id, service_name)
        DO UPDATE SET 
          enabled = ${body.enabled},
          toggled_by = 'admin',
          reason = ${body.reason || 'Updated via admin'},
          last_updated = NOW()
      `;
      
      await invalidate(merchantId);
      return c.json({ success: true, message: 'Service updated successfully' });
    } catch (error) {
      log.error('Failed to toggle service', { error: String(error) });
      return c.json({ success: false, error: 'Failed to update service' }, 500);
    }
  });

  // ===============================================
  // New API Endpoints for Web Interface
  // ===============================================

  // Get all merchants with search and pagination
  app.get('/api/merchants/search', async (c) => {
    try {
      const search = c.req.query('search') || '';
      const category = c.req.query('category') || '';
      const status = c.req.query('status') || '';
      const page = parseInt(c.req.query('page') || '1');
      const limit = parseInt(c.req.query('limit') || '50');
      const offset = (page - 1) * limit;

      let whereConditions = ['1=1'];
      let params: any[] = [];
      let paramIndex = 1;

      if (search) {
        whereConditions.push(`(
          business_name ILIKE $${paramIndex} OR 
          whatsapp_number ILIKE $${paramIndex} OR 
          instagram_username ILIKE $${paramIndex} OR 
          email ILIKE $${paramIndex}
        )`);
        params.push(`%${search}%`);
        paramIndex++;
      }

      if (category) {
        whereConditions.push(`business_category = $${paramIndex}`);
        params.push(category);
        paramIndex++;
      }

      if (status) {
        whereConditions.push(`status = $${paramIndex}`);
        params.push(status);
        paramIndex++;
      }

      const whereClause = whereConditions.join(' AND ');

      // Get merchants with product count
      const merchants = await sql`
        SELECT 
          m.*,
          COUNT(p.id) as products_count,
          COALESCE(
            json_agg(
              json_build_object(
                'id', p.id,
                'sku', p.sku,
                'name_ar', p.name_ar,
                'name_en', p.name_en,
                'price_usd', p.price_usd,
                'stock_quantity', p.stock_quantity,
                'category', p.category,
                'is_active', p.is_active
              )
            ) FILTER (WHERE p.id IS NOT NULL),
            '[]'::json
          ) as products
        FROM merchants m
        LEFT JOIN products p ON m.id = p.merchant_id AND p.deleted_at IS NULL
        WHERE ${sql.unsafe(whereClause)}
        GROUP BY m.id
        ORDER BY m.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      // Get total count
      const totalResult = await sql`
        SELECT COUNT(*) as total
        FROM merchants m
        WHERE ${sql.unsafe(whereClause)}
      `;

      const total = parseInt(String(totalResult[0]?.total || '0'));

      return c.json({
        success: true,
        merchants,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      log.error('Failed to search merchants', { error: String(error) });
      return c.json({ success: false, error: 'Failed to search merchants' }, 500);
    }
  });

  // Get single merchant by ID
  app.get('/api/merchants/:id', async (c) => {
    try {
      const merchantId = c.req.param('id');
      
      const merchant = await sql`
        SELECT 
          m.*,
          COUNT(p.id) as products_count,
          COALESCE(
            json_agg(
              json_build_object(
                'id', p.id,
                'sku', p.sku,
                'name_ar', p.name_ar,
                'name_en', p.name_en,
                'description_ar', p.description_ar,
                'category', p.category,
                'price_usd', p.price_usd,
                'stock_quantity', p.stock_quantity,
                'tags', p.tags,
                'image_url', p.image_url,
                'is_active', p.is_active,
                'created_at', p.created_at
              )
            ) FILTER (WHERE p.id IS NOT NULL),
            '[]'::json
          ) as products
        FROM merchants m
        LEFT JOIN products p ON m.id = p.merchant_id AND p.deleted_at IS NULL
        WHERE m.id = ${merchantId}::uuid
        GROUP BY m.id
      `;

      if (!merchant.length) {
        return c.json({ success: false, error: 'Merchant not found' }, 404);
      }

      return c.json({ success: true, merchant: merchant[0] });
    } catch (error) {
      log.error('Failed to get merchant', { error: String(error) });
      return c.json({ success: false, error: 'Failed to get merchant' }, 500);
    }
  });

  // Update merchant
  app.put('/api/merchants/:id', async (c) => {
    try {
      const merchantId = c.req.param('id');
      const body = await c.req.json();
      
      // Validate required fields
      if (!body.business_name || !body.whatsapp_number) {
        return c.json({ success: false, error: 'Business name and WhatsApp number are required' }, 400);
      }

      const updatedMerchant = await sql`
        UPDATE merchants 
        SET 
          business_name = ${body.business_name},
          business_category = ${body.business_category || 'general'},
          whatsapp_number = ${body.whatsapp_number},
          instagram_username = ${body.instagram_username || ''},
          email = ${body.email || ''},
          currency = ${body.currency || 'IQD'},
          status = ${body.status || 'active'},
          updated_at = NOW()
        WHERE id = ${merchantId}::uuid
        RETURNING *
      `;

      if (!updatedMerchant.length) {
        return c.json({ success: false, error: 'Merchant not found' }, 404);
      }

      await invalidate(merchantId);
      return c.json({ success: true, merchant: updatedMerchant[0] });
    } catch (error) {
      log.error('Failed to update merchant', { error: String(error) });
      return c.json({ success: false, error: 'Failed to update merchant' }, 500);
    }
  });

  // Delete merchant
  app.delete('/api/merchants/:id', async (c) => {
    try {
      const merchantId = c.req.param('id');
      
      // Check if merchant exists
      const merchant = await sql`
        SELECT id FROM merchants WHERE id = ${merchantId}::uuid
      `;

      if (!merchant.length) {
        return c.json({ success: false, error: 'Merchant not found' }, 404);
      }

      // Soft delete merchant and all products
      await sql`
        UPDATE merchants 
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = ${merchantId}::uuid
      `;

      await sql`
        UPDATE products 
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE merchant_id = ${merchantId}::uuid
      `;

      await invalidate(merchantId);
      return c.json({ success: true, message: 'Merchant deleted successfully' });
    } catch (error) {
      log.error('Failed to delete merchant', { error: String(error) });
      return c.json({ success: false, error: 'Failed to delete merchant' }, 500);
    }
  });

  // Get single product by ID
  // Search products
  app.get('/api/products/search', async (c) => {
    try {
      const search = c.req.query('search') || '';
      const category = c.req.query('category') || '';
      const merchantId = c.req.query('merchantId') || '';
      const page = parseInt(c.req.query('page') || '1');
      const limit = parseInt(c.req.query('limit') || '50');
      const offset = (page - 1) * limit;

      let whereConditions = ['p.deleted_at IS NULL'];
      let params: any[] = [];
      let paramIndex = 1;

      if (search) {
        whereConditions.push(`(
          p.name_ar ILIKE $${paramIndex} OR 
          p.name_en ILIKE $${paramIndex} OR 
          p.sku ILIKE $${paramIndex} OR 
          p.description_ar ILIKE $${paramIndex}
        )`);
        params.push(`%${search}%`);
        paramIndex++;
      }

      if (category) {
        whereConditions.push(`p.category = $${paramIndex}`);
        params.push(category);
        paramIndex++;
      }

      if (merchantId) {
        whereConditions.push(`p.merchant_id = $${paramIndex}`);
        params.push(merchantId);
        paramIndex++;
      }

      const whereClause = whereConditions.join(' AND ');

      const products = await sql`
        SELECT 
          p.*,
          m.business_name as merchant_name
        FROM products p
        JOIN merchants m ON p.merchant_id = m.id
        WHERE ${sql.unsafe(whereClause)}
        ORDER BY p.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      const totalResult = await sql`
        SELECT COUNT(*) as total
        FROM products p
        JOIN merchants m ON p.merchant_id = m.id
        WHERE ${sql.unsafe(whereClause)}
      `;

      const total = parseInt(String(totalResult[0]?.total || '0'));

      return c.json({
        success: true,
        products,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      log.error('Failed to search products', { error: String(error) });
      return c.json({ success: false, error: 'Failed to search products' }, 500);
    }
  });

  app.get('/api/products/:id', async (c) => {
    try {
      const productId = c.req.param('id');
      
      const product = await sql`
        SELECT 
          p.*,
          m.business_name as merchant_name
        FROM products p
        JOIN merchants m ON p.merchant_id = m.id
        WHERE p.id = ${productId}::uuid AND p.deleted_at IS NULL
      `;

      if (!product.length) {
        return c.json({ success: false, error: 'Product not found' }, 404);
      }

      return c.json({ success: true, product: product[0] });
    } catch (error) {
      log.error('Failed to get product', { error: String(error) });
      return c.json({ success: false, error: 'Failed to get product' }, 500);
    }
  });

  // Update product
  app.put('/api/products/:id', async (c) => {
    try {
      const productId = c.req.param('id');
      const body = await c.req.json();
      
      // Validate required fields
      if (!body.sku || !body.name_ar) {
        return c.json({ success: false, error: 'SKU and Arabic name are required' }, 400);
      }

      const updatedProduct = await sql`
        UPDATE products 
        SET 
          sku = ${body.sku},
          name_ar = ${body.name_ar},
          name_en = ${body.name_en || ''},
          description_ar = ${body.description_ar || ''},
          category = ${body.category || 'general'},
          price_usd = ${body.price_usd || 0},
          stock_quantity = ${body.stock_quantity || 0},
          tags = ${body.tags ? body.tags : []},
          is_active = ${body.is_active === 'true' || body.is_active === true},
          updated_at = NOW()
        WHERE id = ${productId}::uuid AND deleted_at IS NULL
        RETURNING *
      `;

      if (!updatedProduct.length) {
        return c.json({ success: false, error: 'Product not found' }, 404);
      }

      // Invalidate merchant cache
      const merchant = await sql`
        SELECT merchant_id FROM products WHERE id = ${productId}::uuid
      `;
      if (merchant.length) {
        await invalidate(String(merchant[0].merchant_id));
      }

      return c.json({ success: true, product: updatedProduct[0] });
    } catch (error) {
      log.error('Failed to update product', { error: String(error) });
      return c.json({ success: false, error: 'Failed to update product' }, 500);
    }
  });

  // Delete product
  app.delete('/api/products/:id', async (c) => {
    try {
      const productId = c.req.param('id');
      
      // Get merchant ID before deletion
      const product = await sql`
        SELECT merchant_id FROM products WHERE id = ${productId}::uuid AND deleted_at IS NULL
      `;

      if (!product.length) {
        return c.json({ success: false, error: 'Product not found' }, 404);
      }

      const merchantId = String(product[0].merchant_id);

      // Soft delete product
      await sql`
        UPDATE products 
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = ${productId}::uuid
      `;

      await invalidate(merchantId);
      return c.json({ success: true, message: 'Product deleted successfully' });
    } catch (error) {
      log.error('Failed to delete product', { error: String(error) });
      return c.json({ success: false, error: 'Failed to delete product' }, 500);
    }
  });

  // General file upload endpoint for admin
  app.post('/admin/upload', async (c) => {
    try {
      requireAdminAuth(c.req.raw);
    } catch (e) {
      return c.json({ success: false, error: 'unauthorized' }, 401);
    }

    try {
      const formData = await c.req.formData();
      const file = formData.get('file') as File;

      if (!file) {
        return c.json({ success: false, error: 'No file provided' }, 400);
      }

      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!allowedTypes.includes(file.type)) {
        return c.json({ success: false, error: 'Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.' }, 400);
      }

      // Validate file size (5MB max)
      if (file.size > 5 * 1024 * 1024) {
        return c.json({ success: false, error: 'File too large. Maximum size is 5MB.' }, 400);
      }

      // Generate unique filename
      const fileExtension = file.name.split('.').pop();
      const fileName = `upload_${Date.now()}_${Math.random().toString(36).substring(2)}.${fileExtension}`;
      const uploadPath = `public/uploads/${fileName}`;

      // Create uploads directory if it doesn't exist
      const fs = await import('fs');
      const uploadDir = 'public/uploads';
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      // Save file
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(uploadPath, buffer);

      return c.json({
        success: true,
        url: `/uploads/${fileName}`,
        filename: fileName,
        size: file.size,
        type: file.type
      });
    } catch (error) {
      log.error('Failed to upload file', { error: String(error) });
      return c.json({ success: false, error: 'Failed to upload file' }, 500);
    }
  });

  // Upload product images
  app.post('/api/upload/product-image', async (c) => {
    try {
      requireAdminAuth(c.req.raw);
    } catch (e) {
      return c.json({ success: false, error: 'unauthorized' }, 401);
    }

    try {
      const formData = await c.req.formData();
      const file = formData.get('image') as File;
      const productId = formData.get('productId') as string;

      if (!file || !productId) {
        return c.json({ success: false, error: 'Missing file or product ID' }, 400);
      }

      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (!allowedTypes.includes(file.type)) {
        return c.json({ success: false, error: 'Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.' }, 400);
      }

      // Validate file size (5MB max)
      const maxSize = 5 * 1024 * 1024; // 5MB
      if (file.size > maxSize) {
        return c.json({ success: false, error: 'File too large. Maximum size is 5MB.' }, 400);
      }

      // Generate unique filename
      const fileExtension = file.name.split('.').pop();
      const fileName = `${productId}_${Date.now()}.${fileExtension}`;
      const uploadPath = `public/uploads/products/${fileName}`;

      // Create uploads directory if it doesn't exist
      const fs = await import('fs');
      const uploadDir = 'public/uploads/products';
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      // Save file
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(uploadPath, buffer);

      // Update product images in database
      const product = await sql`
        SELECT images FROM products WHERE id = ${productId}::uuid AND deleted_at IS NULL
      `;

      if (!product.length) {
        return c.json({ success: false, error: 'Product not found' }, 404);
      }

      const currentImages = product[0].images || [];
      const newImages = [...(Array.isArray(currentImages) ? currentImages : []), {
        url: `/uploads/products/${fileName}`,
        filename: fileName,
        uploaded_at: new Date().toISOString(),
        size: file.size,
        type: file.type
      }];

      await sql`
        UPDATE products 
        SET images = ${JSON.stringify(newImages)}, updated_at = NOW()
        WHERE id = ${productId}::uuid
      `;

      return c.json({
        success: true,
        image: {
          url: `/uploads/products/${fileName}`,
          filename: fileName
        }
      });
    } catch (error) {
      log.error('Failed to upload image', { error: String(error) });
      return c.json({ success: false, error: 'Failed to upload image' }, 500);
    }
  });

  // Analytics endpoints
  app.get('/api/analytics/summary', async (c) => {
    try {
      const [merchantsCount] = await sql`
        SELECT COUNT(*) as total_merchants FROM merchants WHERE deleted_at IS NULL
      `;
      
      const [productsCount] = await sql`
        SELECT COUNT(*) as total_products FROM products WHERE deleted_at IS NULL
      `;
      
      const [inventoryValue] = await sql`
        SELECT COALESCE(SUM(price_usd * stock_quantity), 0) as total_inventory_value 
        FROM products WHERE deleted_at IS NULL AND status = 'ACTIVE'
      `;

      return c.json({
        success: true,
        total_merchants: parseInt(String(merchantsCount.total_merchants || '0')),
        total_products: parseInt(String(productsCount.total_products || '0')),
        total_inventory_value: parseFloat(String(inventoryValue.total_inventory_value || '0'))
      });
    } catch (error) {
      log.error('Failed to get analytics summary', { error: String(error) });
      return c.json({ success: false, error: 'Failed to get analytics summary' }, 500);
    }
  });

  app.get('/api/merchants/:id/analytics', async (c) => {
    try {
      const merchantId = c.req.param('id');
      
      const [merchant] = await sql`
        SELECT * FROM merchants WHERE id = ${merchantId}::uuid AND deleted_at IS NULL
      `;
      
      if (!merchant) {
        return c.json({ success: false, error: 'Merchant not found' }, 404);
      }
      
      const [productsCount] = await sql`
        SELECT COUNT(*) as total_products FROM products 
        WHERE merchant_id = ${merchantId}::uuid AND deleted_at IS NULL
      `;
      
      const [inventoryValue] = await sql`
        SELECT COALESCE(SUM(price_usd * stock_quantity), 0) as inventory_value 
        FROM products 
        WHERE merchant_id = ${merchantId}::uuid AND deleted_at IS NULL AND status = 'ACTIVE'
      `;

      return c.json({
        success: true,
        analytics: {
          merchant,
          total_products: parseInt(String(productsCount.total_products || '0')),
          inventory_value: parseFloat(String(inventoryValue.inventory_value || '0'))
        }
      });
    } catch (error) {
      log.error('Failed to get merchant analytics', { error: String(error) });
      return c.json({ success: false, error: 'Failed to get merchant analytics' }, 500);
    }
  });

  // Serve static files from public directory
  app.get('/public/*', async (c) => {
    try {
      const path = c.req.path.replace('/public/', '');
      const filePath = `dist/public/${path}`;
      
      // Log the request for debugging
      log.info('Static file request', { 
        originalPath: c.req.path, 
        extractedPath: path, 
        filePath: filePath 
      });
      
      // Security check - prevent directory traversal
      if (path.includes('..') || path.includes('~')) {
        return c.text('Forbidden', 403);
      }

      // Handle directory listing for /public
      if (path === '' || path === '/') {
        const fs = await import('fs');
        
        try {
          // Check if public directory exists
          if (!fs.existsSync('dist/public')) {
            return c.text('Public directory not found', 404);
          }
          const html = `
            <!DOCTYPE html>
            <html lang="ar" dir="rtl">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>ملفات النظام</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
                    .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                    h1 { color: #333; text-align: center; margin-bottom: 30px; }
                    .file-list { list-style: none; padding: 0; }
                    .file-item { margin: 10px 0; padding: 15px; background: #f8f9fa; border-radius: 5px; border-left: 4px solid #007bff; }
                    .file-item a { text-decoration: none; color: #007bff; font-weight: bold; }
                    .file-item a:hover { color: #0056b3; }
                    .description { color: #666; font-size: 14px; margin-top: 5px; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>📁 ملفات النظام</h1>
                    <ul class="file-list">
                        <li class="file-item">
                            <a href="/public/merchant-entry.html">📝 صفحة إدخال بيانات التاجر</a>
                            <div class="description">صفحة لإضافة تجار جدد مع منتجاتهم</div>
                        </li>
                        <li class="file-item">
                            <a href="/public/merchants-management.html">⚙️ صفحة إدارة التجار</a>
                            <div class="description">صفحة لإدارة التجار والمنتجات الموجودة</div>
                        </li>
                        <li class="file-item">
                            <a href="/public/README.md">📖 دليل الاستخدام</a>
                            <div class="description">دليل شامل لاستخدام النظام</div>
                        </li>
                    </ul>
                </div>
            </body>
            </html>
          `;
          return c.html(html);
        } catch (e) {
          return c.text('Directory listing not available', 403);
        }
      }

      // Try to read the file
      const fs = await import('fs');
      const pathModule = await import('path');
      
      log.info('Checking file existence', { filePath, exists: fs.existsSync(filePath) });
      
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        const ext = pathModule.extname(filePath);
        
        let contentType = 'text/plain';
        if (ext === '.html') contentType = 'text/html; charset=utf-8';
        else if (ext === '.css') contentType = 'text/css';
        else if (ext === '.js') contentType = 'application/javascript';
        else if (ext === '.json') contentType = 'application/json';
        else if (ext === '.png') contentType = 'image/png';
        else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
        else if (ext === '.gif') contentType = 'image/gif';
        else if (ext === '.svg') contentType = 'image/svg+xml';
        
        log.info('Serving file successfully', { filePath, contentType, size: content.length });
        return c.text(content, 200, { 'Content-Type': contentType });
      } else {
        log.warn('File not found', { filePath, requestedPath: path });
        return c.text('File not found', 404);
      }
    } catch (error) {
      log.error('Failed to serve static file', { error: String(error) });
      return c.text('Internal server error', 500);
    }
  });
}
