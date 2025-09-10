#!/usr/bin/env node
/**
 * ===============================================
 * ملف إدخال بيانات التاجر الشامل - AI Sales Platform
 * Comprehensive Merchant Data Entry File
 * ===============================================
 * 
 * هذا الملف يحتوي على:
 * - نموذج إدخال بيانات التاجر الكامل
 * - التحقق من صحة البيانات
 * - التحقق من الاكتمال
 * - التحقق من الجاهزية للإنتاج
 * 
 * Usage: node scripts/merchant-data-entry-complete.js
 */

import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { z } from 'zod';

// ===============================================
// إعدادات قاعدة البيانات
// ===============================================
function getPool() {
  const url = process.env.DATABASE_URL || 'postgresql://ai_instgram_user:rTAH6gFMveMhoSrFu3l9FmrqGYd1ZFdw@dpg-d2f0pije5dus73bi4ac0-a.frankfurt-postgres.render.com/ai_instgram?sslmode=require';
  const ssl = /render\.com|sslmode=require/i.test(url) ? { rejectUnauthorized: false } : undefined;
  return new Pool({ connectionString: url, ssl });
}

// ===============================================
// مخططات التحقق من صحة البيانات
// ===============================================
const MerchantDataSchema = z.object({
  // المعلومات الأساسية
  business_name: z.string().min(2, 'اسم العمل يجب أن يكون على الأقل حرفين').max(255, 'اسم العمل طويل جداً'),
  business_category: z.enum(['general', 'fashion', 'electronics', 'beauty', 'home', 'sports', 'grocery', 'automotive', 'health', 'education']),
  business_address: z.string().optional(),
  business_description: z.string().max(1000, 'الوصف طويل جداً').optional(),
  
  // معلومات التواصل
  whatsapp_number: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'رقم الواتساب غير صحيح'),
  instagram_username: z.string().regex(/^[a-zA-Z0-9._]+$/, 'اسم المستخدم في إنستغرام غير صحيح').optional(),
  email: z.string().email('البريد الإلكتروني غير صحيح').optional(),
  phone: z.string().optional(),
  
  // إعدادات العمل
  currency: z.enum(['IQD', 'USD', 'EUR', 'GBP', 'SAR', 'AED']).default('IQD'),
  timezone: z.string().default('Asia/Baghdad'),
  language: z.enum(['ar', 'en', 'ku']).default('ar'),
  
  // ساعات العمل
  working_hours: z.object({
    enabled: z.boolean().default(true),
    timezone: z.string().default('Asia/Baghdad'),
    schedule: z.object({
      sunday: z.object({ open: z.string(), close: z.string(), enabled: z.boolean() }),
      monday: z.object({ open: z.string(), close: z.string(), enabled: z.boolean() }),
      tuesday: z.object({ open: z.string(), close: z.string(), enabled: z.boolean() }),
      wednesday: z.object({ open: z.string(), close: z.string(), enabled: z.boolean() }),
      thursday: z.object({ open: z.string(), close: z.string(), enabled: z.boolean() }),
      friday: z.object({ open: z.string(), close: z.string(), enabled: z.boolean() }),
      saturday: z.object({ open: z.string(), close: z.string(), enabled: z.boolean() })
    })
  }).optional(),
  
  // طرق الدفع
  payment_methods: z.array(z.enum(['COD', 'ZAIN_CASH', 'ASIA_HAWALA', 'VISA', 'MASTERCARD', 'PAYPAL', 'BANK_TRANSFER'])).default(['COD']),
  
  // إعدادات التوصيل
  delivery_fees: z.object({
    inside_baghdad: z.number().min(0).default(3),
    outside_baghdad: z.number().min(0).default(5),
    free_delivery_threshold: z.number().min(0).optional()
  }).optional(),
  
  // إعدادات الذكاء الاصطناعي
  ai_config: z.object({
    model: z.enum(['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo']).default('gpt-4o-mini'),
    language: z.string().default('ar'),
    temperature: z.number().min(0).max(1).default(0.7),
    max_tokens: z.number().min(50).max(2000).default(600),
    tone: z.enum(['friendly', 'professional', 'casual', 'neutral']).default('friendly'),
    product_hints: z.boolean().default(true),
    auto_responses: z.boolean().default(true)
  }).optional(),
  
  // قوالب الردود
  response_templates: z.object({
    welcome_message: z.string().min(10).max(500).default('أهلاً بك! كيف يمكنني مساعدتك اليوم؟'),
    fallback_message: z.string().min(10).max(500).default('واضح! أعطيني تفاصيل أكثر وسأساعدك فوراً.'),
    outside_hours_message: z.string().min(10).max(500).default('نرحب برسالتك، سنعود لك بأقرب وقت ضمن ساعات الدوام.'),
    order_confirmation: z.string().min(10).max(500).optional(),
    payment_confirmation: z.string().min(10).max(500).optional()
  }).optional(),
  
  // المنتجات
  products: z.array(z.object({
    sku: z.string().min(1, 'رمز المنتج مطلوب').max(50, 'رمز المنتج طويل جداً'),
    name_ar: z.string().min(2, 'اسم المنتج بالعربية مطلوب').max(255, 'اسم المنتج طويل جداً'),
    name_en: z.string().max(255, 'اسم المنتج بالإنجليزية طويل جداً').optional(),
    description_ar: z.string().max(1000, 'وصف المنتج طويل جداً').optional(),
    description_en: z.string().max(1000, 'وصف المنتج بالإنجليزية طويل جداً').optional(),
    category: z.enum(['general', 'fashion', 'electronics', 'beauty', 'home', 'sports', 'grocery', 'automotive', 'health', 'education']).default('general'),
    price_usd: z.number().min(0, 'السعر يجب أن يكون موجب').max(10000, 'السعر مرتفع جداً'),
    stock_quantity: z.number().min(0, 'الكمية يجب أن تكون موجبة').default(0),
    tags: z.array(z.string()).optional(),
    attributes: z.record(z.any()).optional(),
    images: z.array(z.string().url()).optional(),
    is_active: z.boolean().default(true)
  })).optional()
});

// ===============================================
// فئة إدخال بيانات التاجر
// ===============================================
class MerchantDataEntry {
  constructor() {
    this.pool = getPool();
    this.validationErrors = [];
    this.completenessScore = 0;
    this.productionReady = false;
  }

  // ===============================================
  // التحقق من صحة البيانات
  // ===============================================
  validateMerchantData(data) {
    this.validationErrors = [];
    
    try {
      const validatedData = MerchantDataSchema.parse(data);
      console.log('✅ البيانات صحيحة ومتوافقة مع المخطط');
      return { success: true, data: validatedData };
    } catch (error) {
      if (error instanceof z.ZodError) {
        this.validationErrors = error.errors.map(err => ({
          field: err.path.join('.'),
          message: err.message,
          code: err.code
        }));
        console.log('❌ أخطاء في التحقق من صحة البيانات:');
        this.validationErrors.forEach(err => {
          console.log(`  - ${err.field}: ${err.message}`);
        });
        return { success: false, errors: this.validationErrors };
      }
      throw error;
    }
  }

  // ===============================================
  // حساب درجة الاكتمال
  // ===============================================
  calculateCompletenessScore(data) {
    const requiredFields = [
      'business_name',
      'business_category', 
      'whatsapp_number',
      'currency'
    ];

    const importantFields = [
      'instagram_username',
      'email',
      'business_address',
      'working_hours',
      'payment_methods',
      'ai_config',
      'response_templates'
    ];

    const optionalFields = [
      'business_description',
      'phone',
      'delivery_fees',
      'products'
    ];

    let score = 0;
    let totalWeight = 0;

    // الحقول المطلوبة (وزن 3)
    requiredFields.forEach(field => {
      totalWeight += 3;
      if (data[field] && data[field] !== '') {
        score += 3;
      }
    });

    // الحقول المهمة (وزن 2)
    importantFields.forEach(field => {
      totalWeight += 2;
      if (data[field] && data[field] !== '') {
        score += 2;
      }
    });

    // الحقول الاختيارية (وزن 1)
    optionalFields.forEach(field => {
      totalWeight += 1;
      if (data[field] && data[field] !== '') {
        score += 1;
      }
    });

    this.completenessScore = Math.round((score / totalWeight) * 100);
    
    console.log(`📊 درجة الاكتمال: ${this.completenessScore}%`);
    
    if (this.completenessScore >= 90) {
      console.log('🟢 ممتاز - البيانات مكتملة جداً');
    } else if (this.completenessScore >= 75) {
      console.log('🟡 جيد - البيانات مكتملة بشكل جيد');
    } else if (this.completenessScore >= 60) {
      console.log('🟠 متوسط - البيانات تحتاج تحسين');
    } else {
      console.log('🔴 ضعيف - البيانات غير مكتملة');
    }

    return this.completenessScore;
  }

  // ===============================================
  // التحقق من الجاهزية للإنتاج
  // ===============================================
  checkProductionReadiness(data) {
    const checks = {
      basicInfo: this.checkBasicInfo(data),
      contactInfo: this.checkContactInfo(data),
      businessSettings: this.checkBusinessSettings(data),
      aiConfig: this.checkAIConfig(data),
      responseTemplates: this.checkResponseTemplates(data),
      products: this.checkProducts(data),
      workingHours: this.checkWorkingHours(data),
      paymentMethods: this.checkPaymentMethods(data)
    };

    const passedChecks = Object.values(checks).filter(check => check.passed).length;
    const totalChecks = Object.keys(checks).length;
    
    this.productionReady = passedChecks >= Math.ceil(totalChecks * 0.8); // 80% من الفحوصات يجب أن تمر

    console.log('\n🔍 تقرير الجاهزية للإنتاج:');
    console.log(`✅ الفحوصات المنجزة: ${passedChecks}/${totalChecks}`);
    console.log(`🎯 جاهز للإنتاج: ${this.productionReady ? 'نعم' : 'لا'}`);
    
    Object.entries(checks).forEach(([name, check]) => {
      const status = check.passed ? '✅' : '❌';
      console.log(`  ${status} ${check.name}: ${check.message}`);
    });

    return {
      productionReady: this.productionReady,
      checks,
      score: Math.round((passedChecks / totalChecks) * 100)
    };
  }

  // ===============================================
  // فحوصات مفصلة
  // ===============================================
  checkBasicInfo(data) {
    const hasName = data.business_name && data.business_name.length >= 2;
    const hasCategory = data.business_category && data.business_category !== '';
    const hasAddress = data.business_address && data.business_address.length >= 10;
    
    return {
      name: 'المعلومات الأساسية',
      passed: hasName && hasCategory,
      message: hasName && hasCategory ? 'مكتملة' : 'ناقصة',
      details: {
        name: hasName,
        category: hasCategory,
        address: hasAddress
      }
    };
  }

  checkContactInfo(data) {
    const hasWhatsapp = data.whatsapp_number && /^\+?[1-9]\d{1,14}$/.test(data.whatsapp_number);
    const hasInstagram = data.instagram_username && data.instagram_username.length >= 3;
    const hasEmail = data.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email);
    
    return {
      name: 'معلومات التواصل',
      passed: hasWhatsapp && (hasInstagram || hasEmail),
      message: hasWhatsapp ? 'مكتملة' : 'ناقصة',
      details: {
        whatsapp: hasWhatsapp,
        instagram: hasInstagram,
        email: hasEmail
      }
    };
  }

  checkBusinessSettings(data) {
    const hasCurrency = data.currency && ['IQD', 'USD', 'EUR'].includes(data.currency);
    const hasTimezone = data.timezone && data.timezone !== '';
    const hasLanguage = data.language && ['ar', 'en', 'ku'].includes(data.language);
    
    return {
      name: 'إعدادات العمل',
      passed: hasCurrency && hasTimezone && hasLanguage,
      message: hasCurrency && hasTimezone && hasLanguage ? 'مكتملة' : 'ناقصة',
      details: {
        currency: hasCurrency,
        timezone: hasTimezone,
        language: hasLanguage
      }
    };
  }

  checkAIConfig(data) {
    const aiConfig = data.ai_config || {};
    const hasModel = aiConfig.model && ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'].includes(aiConfig.model);
    const hasTemperature = typeof aiConfig.temperature === 'number' && aiConfig.temperature >= 0 && aiConfig.temperature <= 1;
    const hasMaxTokens = typeof aiConfig.max_tokens === 'number' && aiConfig.max_tokens >= 50 && aiConfig.max_tokens <= 2000;
    
    return {
      name: 'إعدادات الذكاء الاصطناعي',
      passed: hasModel && hasTemperature && hasMaxTokens,
      message: hasModel && hasTemperature && hasMaxTokens ? 'مكتملة' : 'ناقصة',
      details: {
        model: hasModel,
        temperature: hasTemperature,
        maxTokens: hasMaxTokens
      }
    };
  }

  checkResponseTemplates(data) {
    const templates = data.response_templates || {};
    const hasWelcome = templates.welcome_message && templates.welcome_message.length >= 10;
    const hasFallback = templates.fallback_message && templates.fallback_message.length >= 10;
    const hasOutsideHours = templates.outside_hours_message && templates.outside_hours_message.length >= 10;
    
    return {
      name: 'قوالب الردود',
      passed: hasWelcome && hasFallback && hasOutsideHours,
      message: hasWelcome && hasFallback && hasOutsideHours ? 'مكتملة' : 'ناقصة',
      details: {
        welcome: hasWelcome,
        fallback: hasFallback,
        outsideHours: hasOutsideHours
      }
    };
  }

  checkProducts(data) {
    const products = data.products || [];
    if (products.length === 0) {
      return {
        name: 'المنتجات',
        passed: true, // المنتجات اختيارية
        message: 'لا توجد منتجات (اختياري)',
        details: { count: 0 }
      };
    }

    const validProducts = products.filter(product => 
      product.sku && 
      product.name_ar && 
      typeof product.price_usd === 'number' && 
      product.price_usd > 0
    );
    
    return {
      name: 'المنتجات',
      passed: validProducts.length === products.length,
      message: `${validProducts.length}/${products.length} منتج صحيح`,
      details: {
        total: products.length,
        valid: validProducts.length,
        invalid: products.length - validProducts.length
      }
    };
  }

  checkWorkingHours(data) {
    const workingHours = data.working_hours;
    if (!workingHours) {
      return {
        name: 'ساعات العمل',
        passed: false,
        message: 'غير محدد',
        details: { enabled: false }
      };
    }

    const hasSchedule = workingHours.schedule && 
      Object.values(workingHours.schedule).some(day => day.enabled);
    
    return {
      name: 'ساعات العمل',
      passed: hasSchedule,
      message: hasSchedule ? 'محددة' : 'غير محددة',
      details: {
        enabled: workingHours.enabled,
        hasSchedule
      }
    };
  }

  checkPaymentMethods(data) {
    const paymentMethods = data.payment_methods || [];
    const hasValidMethods = paymentMethods.length > 0 && 
      paymentMethods.every(method => 
        ['COD', 'ZAIN_CASH', 'ASIA_HAWALA', 'VISA', 'MASTERCARD', 'PAYPAL', 'BANK_TRANSFER'].includes(method)
      );
    
    return {
      name: 'طرق الدفع',
      passed: hasValidMethods,
      message: hasValidMethods ? `${paymentMethods.length} طريقة دفع` : 'غير محددة',
      details: {
        methods: paymentMethods,
        count: paymentMethods.length
      }
    };
  }

  // ===============================================
  // إنشاء التاجر في قاعدة البيانات
  // ===============================================
  async createMerchant(data) {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const merchantId = randomUUID();
      const now = new Date();
      
      // إدراج التاجر
      await client.query(`
        INSERT INTO merchants (
          id, business_name, business_category, business_address, business_description,
          whatsapp_number, instagram_username, email, phone, currency, timezone, language,
          settings, ai_config, created_at, updated_at, last_activity_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      `, [
        merchantId,
        data.business_name,
        data.business_category,
        data.business_address || null,
        data.business_description || null,
        data.whatsapp_number,
        data.instagram_username || null,
        data.email || null,
        data.phone || null,
        data.currency,
        data.timezone,
        data.language,
        JSON.stringify({
          working_hours: data.working_hours,
          payment_methods: data.payment_methods,
          delivery_fees: data.delivery_fees
        }),
        JSON.stringify(data.ai_config),
        now,
        now,
        now
      ]);

      // إدراج قوالب الردود الديناميكية
      if (data.response_templates) {
        const templates = [
          { type: 'greeting', content: data.response_templates.welcome_message },
          { type: 'fallback', content: data.response_templates.fallback_message },
          { type: 'outside_hours', content: data.response_templates.outside_hours_message }
        ];

        for (const template of templates) {
          if (template.content) {
            await client.query(`
              INSERT INTO dynamic_response_templates (merchant_id, template_type, content, priority)
              VALUES ($1, $2, $3, 1)
            `, [merchantId, template.type, template.content]);
          }
        }
      }

      // إدراج إعدادات الذكاء الاصطناعي الديناميكية
      if (data.ai_config) {
        const aiSettings = [
          { name: 'model', value: data.ai_config.model },
          { name: 'temperature', value: data.ai_config.temperature?.toString() },
          { name: 'max_tokens', value: data.ai_config.max_tokens?.toString() },
          { name: 'tone', value: data.ai_config.tone },
          { name: 'language', value: data.ai_config.language }
        ];

        for (const setting of aiSettings) {
          if (setting.value) {
            await client.query(`
              INSERT INTO dynamic_ai_settings (merchant_id, setting_name, setting_value, setting_type)
              VALUES ($1, $2, $3, $4)
            `, [merchantId, setting.name, setting.value, typeof setting.value === 'number' ? 'number' : 'string']);
          }
        }
      }

      // إدراج القيم الافتراضية
      const defaults = [
        { type: 'business_name', value: data.business_name },
        { type: 'currency', value: data.currency },
        { type: 'merchant_type', value: data.business_category }
      ];

      for (const default_ of defaults) {
        await client.query(`
          INSERT INTO dynamic_defaults (merchant_id, default_type, default_value)
          VALUES ($1, $2, $3)
        `, [merchantId, default_.type, default_.value]);
      }

      // إدراج المنتجات
      if (data.products && data.products.length > 0) {
        for (const product of data.products) {
          await client.query(`
            INSERT INTO products (
              merchant_id, sku, name_ar, name_en, description_ar, description_en,
              category, price_usd, stock_quantity, tags, attributes, is_active,
              created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          `, [
            merchantId,
            product.sku,
            product.name_ar,
            product.name_en || null,
            product.description_ar || null,
            product.description_en || null,
            product.category,
            product.price_usd,
            product.stock_quantity,
            product.tags || null,
            product.attributes ? JSON.stringify(product.attributes) : null,
            product.is_active,
            now,
            now
          ]);
        }
      }

      await client.query('COMMIT');
      
      console.log(`✅ تم إنشاء التاجر بنجاح!`);
      console.log(`🆔 معرف التاجر: ${merchantId}`);
      
      return {
        success: true,
        merchant_id: merchantId,
        message: 'تم إنشاء التاجر بنجاح'
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ فشل في إنشاء التاجر:', error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  // ===============================================
  // معالجة شاملة لبيانات التاجر
  // ===============================================
  async processMerchantData(data) {
    console.log('\n🚀 بدء معالجة بيانات التاجر...\n');
    
    // 1. التحقق من صحة البيانات
    console.log('1️⃣ التحقق من صحة البيانات...');
    const validation = this.validateMerchantData(data);
    if (!validation.success) {
      return {
        success: false,
        step: 'validation',
        errors: validation.errors
      };
    }

    // 2. حساب درجة الاكتمال
    console.log('\n2️⃣ حساب درجة الاكتمال...');
    const completenessScore = this.calculateCompletenessScore(validation.data);

    // 3. التحقق من الجاهزية للإنتاج
    console.log('\n3️⃣ التحقق من الجاهزية للإنتاج...');
    const productionCheck = this.checkProductionReadiness(validation.data);

    // 4. إنشاء التاجر
    if (productionCheck.productionReady) {
      console.log('\n4️⃣ إنشاء التاجر في قاعدة البيانات...');
      const result = await this.createMerchant(validation.data);
      
      return {
        success: true,
        merchant_id: result.merchant_id,
        completeness_score: completenessScore,
        production_ready: productionCheck.productionReady,
        production_score: productionCheck.score,
        message: 'تم إنشاء التاجر بنجاح'
      };
    } else {
      console.log('\n❌ التاجر غير جاهز للإنتاج');
      return {
        success: false,
        step: 'production_check',
        completeness_score: completenessScore,
        production_ready: productionCheck.productionReady,
        production_score: productionCheck.score,
        message: 'التاجر غير جاهز للإنتاج - يرجى إكمال البيانات المطلوبة'
      };
    }
  }

  // ===============================================
  // إغلاق الاتصال
  // ===============================================
  async close() {
    await this.pool.end();
  }
}

// ===============================================
// بيانات تجريبية للتاجر
// ===============================================
const sampleMerchantData = {
  // المعلومات الأساسية
  business_name: 'متجر الأزياء الحديث',
  business_category: 'fashion',
  business_address: 'بغداد، الكرادة، شارع 52',
  business_description: 'متجر متخصص في الأزياء العصرية والراقية للرجال والنساء',
  
  // معلومات التواصل
  whatsapp_number: '+964771234567',
  instagram_username: 'modern_fashion_store',
  email: 'info@modernfashion.com',
  phone: '+964771234567',
  
  // إعدادات العمل
  currency: 'IQD',
  timezone: 'Asia/Baghdad',
  language: 'ar',
  
  // ساعات العمل
  working_hours: {
    enabled: true,
    timezone: 'Asia/Baghdad',
    schedule: {
      sunday: { open: '10:00', close: '22:00', enabled: true },
      monday: { open: '10:00', close: '22:00', enabled: true },
      tuesday: { open: '10:00', close: '22:00', enabled: true },
      wednesday: { open: '10:00', close: '22:00', enabled: true },
      thursday: { open: '10:00', close: '22:00', enabled: true },
      friday: { open: '14:00', close: '22:00', enabled: true },
      saturday: { open: '10:00', close: '22:00', enabled: false }
    }
  },
  
  // طرق الدفع
  payment_methods: ['COD', 'ZAIN_CASH', 'ASIA_HAWALA'],
  
  // إعدادات التوصيل
  delivery_fees: {
    inside_baghdad: 3,
    outside_baghdad: 5,
    free_delivery_threshold: 50
  },
  
  // إعدادات الذكاء الاصطناعي
  ai_config: {
    model: 'gpt-4o-mini',
    language: 'ar',
    temperature: 0.7,
    max_tokens: 600,
    tone: 'friendly',
    product_hints: true,
    auto_responses: true
  },
  
  // قوالب الردود
  response_templates: {
    welcome_message: 'أهلاً بك في متجر الأزياء الحديث! كيف يمكنني مساعدتك اليوم؟',
    fallback_message: 'واضح! أعطيني تفاصيل أكثر عن المنتج الذي تبحث عنه وسأساعدك فوراً.',
    outside_hours_message: 'نرحب برسالتك، سنعود لك بأقرب وقت ضمن ساعات الدوام (10:00 - 22:00).',
    order_confirmation: 'تم تأكيد طلبك بنجاح! سنتواصل معك قريباً لتأكيد التفاصيل.',
    payment_confirmation: 'تم استلام الدفع بنجاح! شكراً لثقتك بنا.'
  },
  
  // المنتجات
  products: [
    {
      sku: 'SHIRT-001',
      name_ar: 'قميص قطني رجالي',
      name_en: 'Men Cotton Shirt',
      description_ar: 'قميص قطني 100% مريح وناعم، مناسب للاستخدام اليومي',
      category: 'fashion',
      price_usd: 25.0,
      stock_quantity: 50,
      tags: ['رجالي', 'قطني', 'صيفي'],
      is_active: true
    },
    {
      sku: 'DRESS-001',
      name_ar: 'فستان كاجوال موف',
      name_en: 'Casual Midi Dress',
      description_ar: 'فستان كاجوال أنيق، خامة خفيفة وتصميم مريح',
      category: 'fashion',
      price_usd: 35.0,
      stock_quantity: 30,
      tags: ['نسائي', 'كاجوال', 'صيفي'],
      is_active: true
    }
  ]
};

// ===============================================
// الدالة الرئيسية
// ===============================================
async function main() {
  const merchantEntry = new MerchantDataEntry();
  
  try {
    console.log('🎯 ملف إدخال بيانات التاجر الشامل');
    console.log('=====================================\n');
    
    // معالجة البيانات التجريبية
    const result = await merchantEntry.processMerchantData(sampleMerchantData);
    
    console.log('\n📋 النتيجة النهائية:');
    console.log('===================');
    console.log(`✅ النجاح: ${result.success ? 'نعم' : 'لا'}`);
    if (result.merchant_id) {
      console.log(`🆔 معرف التاجر: ${result.merchant_id}`);
    }
    if (result.completeness_score) {
      console.log(`📊 درجة الاكتمال: ${result.completeness_score}%`);
    }
    if (result.production_ready !== undefined) {
      console.log(`🎯 جاهز للإنتاج: ${result.production_ready ? 'نعم' : 'لا'}`);
    }
    if (result.production_score) {
      console.log(`🔍 درجة الجاهزية: ${result.production_score}%`);
    }
    console.log(`💬 الرسالة: ${result.message}`);
    
  } catch (error) {
    console.error('❌ خطأ في المعالجة:', error.message);
    process.exit(1);
  } finally {
    await merchantEntry.close();
  }
}

// تشغيل البرنامج إذا تم استدعاؤه مباشرة
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { MerchantDataEntry, MerchantDataSchema };
