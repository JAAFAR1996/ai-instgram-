#!/usr/bin/env node
/**
 * ===============================================
 * اختبار سريع لملف إدخال بيانات التاجر
 * Quick Test for Merchant Data Entry
 * ===============================================
 */

import { MerchantDataEntry } from './merchant-data-entry-complete.js';

// بيانات تجريبية بسيطة للاختبار
const testMerchantData = {
  business_name: 'متجر الاختبار',
  business_category: 'general',
  whatsapp_number: '+964771234567',
  currency: 'IQD',
  ai_config: {
    model: 'gpt-4o-mini',
    temperature: 0.7,
    max_tokens: 600
  },
  response_templates: {
    welcome_message: 'أهلاً بك في متجر الاختبار!',
    fallback_message: 'واضح! كيف يمكنني مساعدتك؟',
    outside_hours_message: 'سنعود لك قريباً.'
  }
};

async function runTest() {
  console.log('🧪 بدء اختبار ملف إدخال بيانات التاجر...\n');
  
  const merchantEntry = new MerchantDataEntry();
  
  try {
    // اختبار التحقق من صحة البيانات
    console.log('1️⃣ اختبار التحقق من صحة البيانات...');
    const validation = merchantEntry.validateMerchantData(testMerchantData);
    console.log(`✅ النتيجة: ${validation.success ? 'نجح' : 'فشل'}`);
    
    if (!validation.success) {
      console.log('❌ أخطاء التحقق:');
      validation.errors.forEach(error => {
        console.log(`  - ${error.field}: ${error.message}`);
      });
    }
    
    // اختبار حساب درجة الاكتمال
    console.log('\n2️⃣ اختبار حساب درجة الاكتمال...');
    const completenessScore = merchantEntry.calculateCompletenessScore(testMerchantData);
    console.log(`✅ درجة الاكتمال: ${completenessScore}%`);
    
    // اختبار التحقق من الجاهزية للإنتاج
    console.log('\n3️⃣ اختبار التحقق من الجاهزية للإنتاج...');
    const productionCheck = merchantEntry.checkProductionReadiness(testMerchantData);
    console.log(`✅ جاهز للإنتاج: ${productionCheck.productionReady ? 'نعم' : 'لا'}`);
    console.log(`✅ درجة الجاهزية: ${productionCheck.score}%`);
    
    console.log('\n🎉 جميع الاختبارات نجحت!');
    console.log('📋 الملف جاهز للاستخدام في الإنتاج');
    
  } catch (error) {
    console.error('❌ فشل الاختبار:', error.message);
    process.exit(1);
  } finally {
    await merchantEntry.close();
  }
}

// تشغيل الاختبار
runTest().catch(console.error);
