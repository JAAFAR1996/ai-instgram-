/**
 * ===============================================
 * Merchant Onboarding Routes - صفحة إضافة التاجر الجديد
 * Comprehensive merchant registration and setup
 * ===============================================
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { getLogger } from '../services/logger.js';
import { getDatabase } from '../db/adapter.js';
import { getCache } from '../cache/index.js';
import { randomUUID } from 'crypto';

const log = getLogger({ component: 'merchant-onboarding' });

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

export function registerMerchantOnboardingRoutes(app: Hono) {
  const db = getDatabase();
  const sql = db.getSQL();
  const cache = getCache();

  // Main onboarding page
  app.get('/onboarding', async (c) => {
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
                const response = await fetch('/onboarding/api/create', {
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

  // API endpoint to create merchant
  app.post('/onboarding/api/create', async (c) => {
    try {
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
        await sql\`
          INSERT INTO merchants (
            id, business_name, business_category, business_address,
            whatsapp_number, instagram_username, email, currency,
            settings, ai_config, created_at, updated_at, last_activity_at
          ) VALUES (
            \${merchantId}::uuid,
            \${data.business_name},
            \${data.business_category},
            \${data.business_address || null},
            \${data.whatsapp_number},
            \${data.instagram_username || null},
            \${data.email || null},
            \${data.currency},
            \${JSON.stringify({
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
            \${JSON.stringify(data.ai_config || {
              model: 'gpt-4o-mini',
              temperature: 0.8,
              max_tokens: 600,
              language: 'ar',
              sales_style: 'neutral'
            })}::jsonb,
            NOW(), NOW(), NOW()
          )
        \`;
        
        // Insert dynamic templates
        await sql\`
          INSERT INTO dynamic_response_templates (merchant_id, template_type, content, variables, priority)
          VALUES 
            (\${merchantId}::uuid, 'greeting', \${data.response_templates?.greeting || 'مرحباً بك في ' || data.business_name || '! كيف يمكنني مساعدتك اليوم؟'}, ARRAY['business_name'], 1),
            (\${merchantId}::uuid, 'fallback', \${data.response_templates?.fallback || 'عذراً، لم أفهم طلبك. هل يمكنك توضيح ما تبحث عنه؟'}, '{}', 1),
            (\${merchantId}::uuid, 'outside_hours', \${data.response_templates?.outside_hours || 'نعتذر، المحل مغلق حالياً. ساعات العمل: 9 صباحاً - 10 مساءً'}, '{}', 1)
        \`;
        
        // Insert dynamic AI settings
        const aiConfig = data.ai_config || {};
        await sql\`
          INSERT INTO dynamic_ai_settings (merchant_id, setting_name, setting_value, setting_type)
          VALUES 
            (\${merchantId}::uuid, 'model', \${aiConfig.model || 'gpt-4o-mini'}, 'string'),
            (\${merchantId}::uuid, 'temperature', \${String(aiConfig.temperature || 0.8)}, 'number'),
            (\${merchantId}::uuid, 'max_tokens', \${String(aiConfig.max_tokens || 600)}, 'number'),
            (\${merchantId}::uuid, 'language', \${aiConfig.language || 'ar'}, 'string')
        \`;
        
        // Insert dynamic defaults
        await sql\`
          INSERT INTO dynamic_defaults (merchant_id, default_type, default_value, fallback_value)
          VALUES 
            (\${merchantId}::uuid, 'business_name', \${data.business_name}, 'متجرنا'),
            (\${merchantId}::uuid, 'currency', \${data.currency}, 'IQD'),
            (\${merchantId}::uuid, 'merchant_type', \${data.business_category}, 'general')
        \`;
        
        // Insert products if provided
        if (data.products && data.products.length > 0) {
          for (const product of data.products) {
            await sql\`
              INSERT INTO products (
                merchant_id, sku, name_ar, name_en, description_ar, category,
                price_usd, stock_quantity, attributes, created_at, updated_at
              ) VALUES (
                \${merchantId}::uuid,
                \${product.sku},
                \${product.name_ar},
                \${product.name_en || null},
                \${product.description_ar || null},
                \${product.category},
                \${product.price_usd},
                \${product.stock_quantity},
                \${JSON.stringify(product.attributes || {})}::jsonb,
                NOW(), NOW()
              )
            \`;
          }
        }
      });
      
      // Invalidate cache
      await cache.delete(\`merchant:ctx:\${merchantId}\`, { prefix: 'ctx' });
      await cache.delete(\`merchant:cats:\${merchantId}\`, { prefix: 'ctx' });
      
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
}
