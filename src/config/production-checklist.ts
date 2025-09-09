/**
 * Production Checklist Configuration
 * قائمة التحقق الإنتاجية
 */

export interface ProductionChecklist {
  ai: {
    enabled: boolean;
    fallbackEnabled: boolean;
    debugLogging: boolean;
    timeout: number;
    retryAttempts: number;
  };
  services: {
    serviceControllerEnabled: boolean;
    degradedModeEnabled: boolean;
    smartFallbacksEnabled: boolean;
  };
  pricing: {
    priceFormattingEnabled: boolean;
    fallbackText: string;
    currency: string;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    openaiRequests: boolean;
    openaiResponses: boolean;
    serviceController: boolean;
  };
}

export const PRODUCTION_CHECKLIST: ProductionChecklist = {
  ai: {
    enabled: true,
    fallbackEnabled: true,
    debugLogging: process.env.NODE_ENV === 'development',
    timeout: 20000, // 20 seconds
    retryAttempts: 3
  },
  services: {
    serviceControllerEnabled: true,
    degradedModeEnabled: true, // باتش 1: وضع degraded
    smartFallbacksEnabled: true // باتش 2: ردود ذكية
  },
  pricing: {
    priceFormattingEnabled: true, // باتش 3: تنسيق الأسعار
    fallbackText: 'السعر يحتاج تأكيد',
    currency: 'IQD'
  },
  logging: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    openaiRequests: true, // باتش 4: تسجيل طلبات OpenAI
    openaiResponses: true, // باتش 4: تسجيل استجابات OpenAI
    serviceController: true
  }
};

/**
 * التحقق من الإعدادات الإنتاجية
 */
export function validateProductionSettings(): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  
  // التحقق من متغيرات البيئة المطلوبة
  if (!process.env.OPENAI_API_KEY) {
    issues.push('OPENAI_API_KEY is not set');
  }
  
  if (!process.env.DATABASE_URL) {
    issues.push('DATABASE_URL is not set');
  }
  
  // التحقق من إعدادات AI
  if (!PRODUCTION_CHECKLIST.ai.enabled) {
    issues.push('AI is disabled in production checklist');
  }
  
  if (!PRODUCTION_CHECKLIST.ai.fallbackEnabled) {
    issues.push('AI fallback is disabled');
  }
  
  // التحقق من إعدادات الخدمات
  if (!PRODUCTION_CHECKLIST.services.degradedModeEnabled) {
    issues.push('Degraded mode is disabled - this may cause service failures');
  }
  
  if (!PRODUCTION_CHECKLIST.services.smartFallbacksEnabled) {
    issues.push('Smart fallbacks are disabled');
  }
  
  // التحقق من إعدادات الأسعار
  if (!PRODUCTION_CHECKLIST.pricing.priceFormattingEnabled) {
    issues.push('Price formatting is disabled');
  }
  
  return {
    valid: issues.length === 0,
    issues
  };
}

/**
 * طباعة تقرير الإعدادات الإنتاجية
 */
export function printProductionReport(): void {
  console.log('🔍 Production Checklist Report:');
  console.log('================================');
  
  const validation = validateProductionSettings();
  
  if (validation.valid) {
    console.log('✅ All production settings are valid');
  } else {
    console.log('❌ Production issues found:');
    validation.issues.forEach(issue => {
      console.log(`   - ${issue}`);
    });
  }
  
  console.log('\n📊 Current Settings:');
  console.log(`   AI Enabled: ${PRODUCTION_CHECKLIST.ai.enabled}`);
  console.log(`   Fallback Enabled: ${PRODUCTION_CHECKLIST.ai.fallbackEnabled}`);
  console.log(`   Debug Logging: ${PRODUCTION_CHECKLIST.ai.debugLogging}`);
  console.log(`   Degraded Mode: ${PRODUCTION_CHECKLIST.services.degradedModeEnabled}`);
  console.log(`   Smart Fallbacks: ${PRODUCTION_CHECKLIST.services.smartFallbacksEnabled}`);
  console.log(`   Price Formatting: ${PRODUCTION_CHECKLIST.pricing.priceFormattingEnabled}`);
  console.log(`   OpenAI Request Logging: ${PRODUCTION_CHECKLIST.logging.openaiRequests}`);
  console.log(`   OpenAI Response Logging: ${PRODUCTION_CHECKLIST.logging.openaiResponses}`);
  
  console.log('\n🚀 Production Ready:', validation.valid ? 'YES' : 'NO');
}

export default {
  PRODUCTION_CHECKLIST,
  validateProductionSettings,
  printProductionReport
};
