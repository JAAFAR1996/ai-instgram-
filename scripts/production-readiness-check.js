#!/usr/bin/env node
/**
 * ===============================================
 * سكريبت التحقق من الجاهزية للإنتاج
 * Production Readiness Check Script
 * ===============================================
 * 
 * هذا السكريبت يتحقق من:
 * - اكتمال بيانات التاجر
 * - صحة الإعدادات
 * - جاهزية النظام للإنتاج
 * - فحص قاعدة البيانات
 * - فحص الخدمات
 * 
 * Usage: node scripts/production-readiness-check.js [merchant_id]
 */

import { Pool } from 'pg';
import { MerchantDataEntry } from './merchant-data-entry-complete.js';

// ===============================================
// إعدادات قاعدة البيانات
// ===============================================
function getPool() {
  const url = process.env.DATABASE_URL || 'postgresql://ai_instgram_user:rTAH6gFMveMhoSrFu3l9FmrqGYd1ZFdw@dpg-d2f0pije5dus73bi4ac0-a.frankfurt-postgres.render.com/ai_instgram?sslmode=require';
  const ssl = /render\.com|sslmode=require/i.test(url) ? { rejectUnauthorized: false } : undefined;
  return new Pool({ connectionString: url, ssl });
}

// ===============================================
// فئة فحص الجاهزية للإنتاج
// ===============================================
class ProductionReadinessChecker {
  constructor() {
    this.pool = getPool();
    this.checks = [];
    this.overallScore = 0;
    this.isProductionReady = false;
  }

  // ===============================================
  // فحص قاعدة البيانات
  // ===============================================
  async checkDatabase() {
    console.log('🔍 فحص قاعدة البيانات...');
    
    const checks = [];
    
    try {
      // فحص الاتصال
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      checks.push({ name: 'اتصال قاعدة البيانات', status: 'pass', message: 'متصل بنجاح' });
      
      // فحص الجداول المطلوبة
      const requiredTables = [
        'merchants',
        'products', 
        'dynamic_response_templates',
        'dynamic_ai_settings',
        'dynamic_defaults',
        'service_control'
      ];
      
      for (const table of requiredTables) {
        const result = await this.pool.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = $1
          )
        `, [table]);
        
        if (result.rows[0].exists) {
          checks.push({ name: `جدول ${table}`, status: 'pass', message: 'موجود' });
        } else {
          checks.push({ name: `جدول ${table}`, status: 'fail', message: 'غير موجود' });
        }
      }
      
      // فحص الفهارس
      const indexResult = await this.pool.query(`
        SELECT indexname FROM pg_indexes 
        WHERE schemaname = 'public' 
        AND tablename = 'merchants'
      `);
      
      if (indexResult.rows.length > 0) {
        checks.push({ name: 'فهارس قاعدة البيانات', status: 'pass', message: `${indexResult.rows.length} فهرس موجود` });
      } else {
        checks.push({ name: 'فهارس قاعدة البيانات', status: 'warn', message: 'لا توجد فهارس' });
      }
      
    } catch (error) {
      checks.push({ name: 'اتصال قاعدة البيانات', status: 'fail', message: `خطأ: ${error.message}` });
    }
    
    return {
      category: 'قاعدة البيانات',
      checks,
      score: this.calculateCategoryScore(checks)
    };
  }

  // ===============================================
  // فحص التاجر المحدد
  // ===============================================
  async checkMerchant(merchantId) {
    console.log(`🔍 فحص التاجر: ${merchantId}...`);
    
    const checks = [];
    
    try {
      // فحص وجود التاجر
      const merchantResult = await this.pool.query(`
        SELECT * FROM merchants WHERE id = $1
      `, [merchantId]);
      
      if (merchantResult.rows.length === 0) {
        checks.push({ name: 'وجود التاجر', status: 'fail', message: 'التاجر غير موجود' });
        return {
          category: 'التاجر',
          checks,
          score: 0
        };
      }
      
      const merchant = merchantResult.rows[0];
      checks.push({ name: 'وجود التاجر', status: 'pass', message: 'موجود' });
      
      // فحص البيانات الأساسية
      const basicFields = ['business_name', 'business_category', 'whatsapp_number', 'currency'];
      let basicScore = 0;
      
      basicFields.forEach(field => {
        if (merchant[field] && merchant[field] !== '') {
          basicScore++;
          checks.push({ name: `حقل ${field}`, status: 'pass', message: 'مكتمل' });
        } else {
          checks.push({ name: `حقل ${field}`, status: 'fail', message: 'ناقص' });
        }
      });
      
      // فحص الإعدادات
      if (merchant.settings) {
        try {
          const settings = JSON.parse(merchant.settings);
          if (settings.working_hours) {
            checks.push({ name: 'ساعات العمل', status: 'pass', message: 'محددة' });
          } else {
            checks.push({ name: 'ساعات العمل', status: 'warn', message: 'غير محددة' });
          }
          
          if (settings.payment_methods && settings.payment_methods.length > 0) {
            checks.push({ name: 'طرق الدفع', status: 'pass', message: `${settings.payment_methods.length} طريقة` });
          } else {
            checks.push({ name: 'طرق الدفع', status: 'fail', message: 'غير محددة' });
          }
        } catch (error) {
          checks.push({ name: 'إعدادات التاجر', status: 'fail', message: 'تنسيق خاطئ' });
        }
      } else {
        checks.push({ name: 'إعدادات التاجر', status: 'fail', message: 'غير موجودة' });
      }
      
      // فحص إعدادات AI
      if (merchant.ai_config) {
        try {
          const aiConfig = JSON.parse(merchant.ai_config);
          const aiFields = ['model', 'temperature', 'max_tokens', 'tone'];
          let aiScore = 0;
          
          aiFields.forEach(field => {
            if (aiConfig[field] !== undefined && aiConfig[field] !== null) {
              aiScore++;
            }
          });
          
          if (aiScore >= 3) {
            checks.push({ name: 'إعدادات الذكاء الاصطناعي', status: 'pass', message: 'مكتملة' });
          } else {
            checks.push({ name: 'إعدادات الذكاء الاصطناعي', status: 'warn', message: 'ناقصة' });
          }
        } catch (error) {
          checks.push({ name: 'إعدادات الذكاء الاصطناعي', status: 'fail', message: 'تنسيق خاطئ' });
        }
      } else {
        checks.push({ name: 'إعدادات الذكاء الاصطناعي', status: 'fail', message: 'غير موجودة' });
      }
      
      // فحص قوالب الردود
      const templatesResult = await this.pool.query(`
        SELECT COUNT(*) as count FROM dynamic_response_templates 
        WHERE merchant_id = $1 AND is_active = true
      `, [merchantId]);
      
      const templateCount = parseInt(templatesResult.rows[0].count);
      if (templateCount >= 3) {
        checks.push({ name: 'قوالب الردود', status: 'pass', message: `${templateCount} قالب` });
      } else {
        checks.push({ name: 'قوالب الردود', status: 'warn', message: `${templateCount} قالب (يُنصح بـ 3+ قوالب)` });
      }
      
      // فحص المنتجات
      const productsResult = await this.pool.query(`
        SELECT COUNT(*) as count FROM products 
        WHERE merchant_id = $1 AND is_active = true
      `, [merchantId]);
      
      const productCount = parseInt(productsResult.rows[0].count);
      if (productCount > 0) {
        checks.push({ name: 'المنتجات', status: 'pass', message: `${productCount} منتج` });
      } else {
        checks.push({ name: 'المنتجات', status: 'warn', message: 'لا توجد منتجات (اختياري)' });
      }
      
    } catch (error) {
      checks.push({ name: 'فحص التاجر', status: 'fail', message: `خطأ: ${error.message}` });
    }
    
    return {
      category: 'التاجر',
      checks,
      score: this.calculateCategoryScore(checks)
    };
  }

  // ===============================================
  // فحص الخدمات
  // ===============================================
  async checkServices(merchantId) {
    console.log(`🔍 فحص الخدمات للتاجر: ${merchantId}...`);
    
    const checks = [];
    
    try {
      // فحص جدول service_control
      const servicesResult = await this.pool.query(`
        SELECT service_name, enabled, last_updated 
        FROM service_control 
        WHERE merchant_id = $1
        ORDER BY service_name
      `, [merchantId]);
      
      if (servicesResult.rows.length === 0) {
        checks.push({ name: 'خدمات التاجر', status: 'warn', message: 'لا توجد خدمات مُعرّفة' });
      } else {
        const enabledServices = servicesResult.rows.filter(s => s.enabled);
        const totalServices = servicesResult.rows.length;
        
        checks.push({ 
          name: 'خدمات التاجر', 
          status: enabledServices.length > 0 ? 'pass' : 'warn', 
          message: `${enabledServices.length}/${totalServices} خدمة مفعلة` 
        });
        
        // فحص كل خدمة
        servicesResult.rows.forEach(service => {
          const status = service.enabled ? 'pass' : 'warn';
          const message = service.enabled ? 'مفعلة' : 'معطلة';
          checks.push({ 
            name: `خدمة ${service.service_name}`, 
            status, 
            message 
          });
        });
      }
      
    } catch (error) {
      checks.push({ name: 'فحص الخدمات', status: 'fail', message: `خطأ: ${error.message}` });
    }
    
    return {
      category: 'الخدمات',
      checks,
      score: this.calculateCategoryScore(checks)
    };
  }

  // ===============================================
  // فحص الأداء
  // ===============================================
  async checkPerformance() {
    console.log('🔍 فحص الأداء...');
    
    const checks = [];
    
    try {
      // فحص عدد التجار
      const merchantsResult = await this.pool.query('SELECT COUNT(*) as count FROM merchants');
      const merchantCount = parseInt(merchantsResult.rows[0].count);
      
      if (merchantCount > 0) {
        checks.push({ name: 'عدد التجار', status: 'pass', message: `${merchantCount} تاجر` });
      } else {
        checks.push({ name: 'عدد التجار', status: 'warn', message: 'لا توجد تجار' });
      }
      
      // فحص عدد المنتجات
      const productsResult = await this.pool.query('SELECT COUNT(*) as count FROM products WHERE is_active = true');
      const productCount = parseInt(productsResult.rows[0].count);
      
      if (productCount > 0) {
        checks.push({ name: 'عدد المنتجات', status: 'pass', message: `${productCount} منتج` });
      } else {
        checks.push({ name: 'عدد المنتجات', status: 'warn', message: 'لا توجد منتجات' });
      }
      
      // فحص قوالب الردود
      const templatesResult = await this.pool.query('SELECT COUNT(*) as count FROM dynamic_response_templates WHERE is_active = true');
      const templateCount = parseInt(templatesResult.rows[0].count);
      
      if (templateCount > 0) {
        checks.push({ name: 'قوالب الردود', status: 'pass', message: `${templateCount} قالب` });
      } else {
        checks.push({ name: 'قوالب الردود', status: 'warn', message: 'لا توجد قوالب' });
      }
      
      // فحص سرعة الاستعلام
      const startTime = Date.now();
      await this.pool.query('SELECT * FROM merchants LIMIT 10');
      const queryTime = Date.now() - startTime;
      
      if (queryTime < 100) {
        checks.push({ name: 'سرعة قاعدة البيانات', status: 'pass', message: `${queryTime}ms` });
      } else if (queryTime < 500) {
        checks.push({ name: 'سرعة قاعدة البيانات', status: 'warn', message: `${queryTime}ms (بطيء قليلاً)` });
      } else {
        checks.push({ name: 'سرعة قاعدة البيانات', status: 'fail', message: `${queryTime}ms (بطيء جداً)` });
      }
      
    } catch (error) {
      checks.push({ name: 'فحص الأداء', status: 'fail', message: `خطأ: ${error.message}` });
    }
    
    return {
      category: 'الأداء',
      checks,
      score: this.calculateCategoryScore(checks)
    };
  }

  // ===============================================
  // فحص الأمان
  // ===============================================
  async checkSecurity() {
    console.log('🔍 فحص الأمان...');
    
    const checks = [];
    
    try {
      // فحص متغيرات البيئة
      const requiredEnvVars = ['DATABASE_URL', 'ADMIN_USER', 'ADMIN_PASS'];
      let envScore = 0;
      
      requiredEnvVars.forEach(envVar => {
        if (process.env[envVar]) {
          envScore++;
          checks.push({ name: `متغير البيئة ${envVar}`, status: 'pass', message: 'محدد' });
        } else {
          checks.push({ name: `متغير البيئة ${envVar}`, status: 'fail', message: 'غير محدد' });
        }
      });
      
      // فحص كلمات المرور
      if (process.env.ADMIN_PASS && process.env.ADMIN_PASS.length >= 8) {
        checks.push({ name: 'قوة كلمة مرور الإدارة', status: 'pass', message: 'قوية' });
      } else {
        checks.push({ name: 'قوة كلمة مرور الإدارة', status: 'warn', message: 'ضعيفة' });
      }
      
      // فحص SSL
      const dbUrl = process.env.DATABASE_URL || '';
      if (dbUrl.includes('sslmode=require')) {
        checks.push({ name: 'اتصال قاعدة البيانات الآمن', status: 'pass', message: 'SSL مفعل' });
      } else {
        checks.push({ name: 'اتصال قاعدة البيانات الآمن', status: 'warn', message: 'SSL غير مفعل' });
      }
      
    } catch (error) {
      checks.push({ name: 'فحص الأمان', status: 'fail', message: `خطأ: ${error.message}` });
    }
    
    return {
      category: 'الأمان',
      checks,
      score: this.calculateCategoryScore(checks)
    };
  }

  // ===============================================
  // حساب درجة الفئة
  // ===============================================
  calculateCategoryScore(checks) {
    if (checks.length === 0) return 0;
    
    const weights = { pass: 1, warn: 0.5, fail: 0 };
    const totalWeight = checks.reduce((sum, check) => sum + weights[check.status], 0);
    const maxWeight = checks.length;
    
    return Math.round((totalWeight / maxWeight) * 100);
  }

  // ===============================================
  // الفحص الشامل
  // ===============================================
  async runFullCheck(merchantId = null) {
    console.log('🚀 بدء الفحص الشامل للجاهزية للإنتاج...\n');
    
    const results = [];
    
    // 1. فحص قاعدة البيانات
    const dbCheck = await this.checkDatabase();
    results.push(dbCheck);
    
    // 2. فحص الأداء
    const performanceCheck = await this.checkPerformance();
    results.push(performanceCheck);
    
    // 3. فحص الأمان
    const securityCheck = await this.checkSecurity();
    results.push(securityCheck);
    
    // 4. فحص التاجر (إذا تم تحديد معرف)
    if (merchantId) {
      const merchantCheck = await this.checkMerchant(merchantId);
      results.push(merchantCheck);
      
      const servicesCheck = await this.checkServices(merchantId);
      results.push(servicesCheck);
    }
    
    // حساب النتيجة الإجمالية
    this.overallScore = Math.round(results.reduce((sum, result) => sum + result.score, 0) / results.length);
    this.isProductionReady = this.overallScore >= 80;
    
    // عرض النتائج
    this.displayResults(results);
    
    return {
      isProductionReady: this.isProductionReady,
      overallScore: this.overallScore,
      results
    };
  }

  // ===============================================
  // عرض النتائج
  // ===============================================
  displayResults(results) {
    console.log('\n📊 نتائج الفحص الشامل:');
    console.log('========================\n');
    
    results.forEach(result => {
      console.log(`📁 ${result.category} (${result.score}%)`);
      console.log('─'.repeat(50));
      
      result.checks.forEach(check => {
        const icon = check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌';
        console.log(`  ${icon} ${check.name}: ${check.message}`);
      });
      
      console.log('');
    });
    
    console.log('🎯 النتيجة الإجمالية:');
    console.log('====================');
    console.log(`📊 الدرجة الإجمالية: ${this.overallScore}%`);
    console.log(`🚀 جاهز للإنتاج: ${this.isProductionReady ? 'نعم ✅' : 'لا ❌'}`);
    
    if (this.isProductionReady) {
      console.log('\n🎉 مبروك! النظام جاهز للإنتاج');
    } else {
      console.log('\n⚠️ النظام يحتاج تحسينات قبل الإنتاج');
      console.log('📋 التوصيات:');
      results.forEach(result => {
        if (result.score < 80) {
          console.log(`  - تحسين ${result.category} (${result.score}%)`);
        }
      });
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
// الدالة الرئيسية
// ===============================================
async function main() {
  const merchantId = process.argv[2]; // معرف التاجر من سطر الأوامر
  
  const checker = new ProductionReadinessChecker();
  
  try {
    console.log('🔍 سكريبت التحقق من الجاهزية للإنتاج');
    console.log('=====================================\n');
    
    if (merchantId) {
      console.log(`🎯 فحص التاجر: ${merchantId}\n`);
    } else {
      console.log('🌐 فحص النظام العام\n');
    }
    
    const result = await checker.runFullCheck(merchantId);
    
    // إنهاء البرنامج بالكود المناسب
    process.exit(result.isProductionReady ? 0 : 1);
    
  } catch (error) {
    console.error('❌ خطأ في الفحص:', error.message);
    process.exit(1);
  } finally {
    await checker.close();
  }
}

// تشغيل البرنامج إذا تم استدعاؤه مباشرة
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { ProductionReadinessChecker };
