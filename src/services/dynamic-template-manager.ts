/**
 * ===============================================
 * Dynamic Template Manager
 * مدير القوالب الديناميكية - كل شيء من قاعدة البيانات
 * ===============================================
 */

import { getDatabase } from '../db/adapter.js';
import { getLogger } from './logger.js';

export interface DynamicTemplate {
  id: string;
  merchantId: string;
  templateType: string;
  content: string;
  variables: string[];
  priority: number;
  isActive: boolean;
  language: string;
  usageCount: number;
  successRate: number;
}

export interface DynamicAISettings {
  model: string;
  temperature: number;
  maxTokens: number;
  language: string;
  timeout: number;
  presencePenalty: number;
  frequencyPenalty: number;
}

export interface DynamicDefaults {
  businessName: string;
  currency: string;
  merchantType: string;
  businessCategory: string;
  workingHours: Record<string, any>;
  paymentMethods: string[];
  deliveryOptions: Record<string, any>;
}

export interface DynamicErrorMessages {
  fallback: string[];
  timeout: string[];
  apiError: string[];
  validationError: string[];
  networkError: string[];
}

export class DynamicTemplateManager {
  private db = getDatabase();
  private logger = getLogger({ component: 'dynamic-template-manager' });
  private cache = new Map<string, { data: any; timestamp: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 دقائق

  /**
   * جلب قالب رد ديناميكي
   */
  async getResponseTemplate(
    merchantId: string, 
    templateType: string, 
    variables: Record<string, string> = {}
  ): Promise<string> {
    try {
      const cacheKey = `template:${merchantId}:${templateType}`;
      const cached = this.cache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return this.processTemplate(cached.data.content, variables);
      }

      const sql = this.db.getSQL();
      const templates = await sql<{
        id: string;
        merchant_id: string;
        template_type: string;
        content: string;
        variables: string[];
        priority: number;
        is_active: boolean;
        language: string;
        usage_count: number;
        success_rate: number;
      }>`
        SELECT 
          id,
          merchant_id,
          template_type,
          content,
          variables,
          priority,
          is_active,
          language,
          usage_count,
          success_rate
        FROM dynamic_response_templates 
        WHERE merchant_id = ${merchantId}::uuid
          AND template_type = ${templateType}
          AND is_active = true
        ORDER BY priority ASC, success_rate DESC, usage_count DESC
        LIMIT 1
      `;

      if (templates.length === 0) {
        // جلب قالب افتراضي من النظام
        return await this.getSystemDefaultTemplate(templateType, variables);
      }

      const template = templates[0];
      
      // تحديث عدد الاستخدام
      await sql`
        UPDATE dynamic_response_templates 
        SET usage_count = usage_count + 1
        WHERE id = ${template.id}::uuid
      `;

      // حفظ في الكاش
      this.cache.set(cacheKey, { data: template, timestamp: Date.now() });

      return this.processTemplate(template.content, variables);

    } catch (error) {
      this.logger.error('Failed to get response template', {
        merchantId,
        templateType,
        error: error instanceof Error ? error.message : String(error)
      });
      return await this.getSystemDefaultTemplate(templateType, variables);
    }
  }

  /**
   * جلب إعدادات الذكاء الاصطناعي الديناميكية
   */
  async getAISettings(merchantId: string): Promise<DynamicAISettings> {
    try {
      const cacheKey = `ai_settings:${merchantId}`;
      const cached = this.cache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached.data;
      }

      const sql = this.db.getSQL();
      const settings = await sql<{
        setting_name: string;
        setting_value: string;
        setting_type: string;
      }>`
        SELECT setting_name, setting_value, setting_type
        FROM dynamic_ai_settings 
        WHERE merchant_id = ${merchantId}::uuid
          AND is_active = true
      `;

      const aiSettings: DynamicAISettings = {
        model: 'gpt-4o-mini',
        temperature: 0.8,
        maxTokens: 600,
        language: 'ar',
        timeout: 30000,
        presencePenalty: 0.1,
        frequencyPenalty: 0.1
      };

      // تحويل الإعدادات
      for (const setting of settings) {
        switch (setting.setting_name) {
          case 'model':
            aiSettings.model = setting.setting_value;
            break;
          case 'temperature':
            aiSettings.temperature = parseFloat(setting.setting_value);
            break;
          case 'max_tokens':
            aiSettings.maxTokens = parseInt(setting.setting_value, 10);
            break;
          case 'language':
            aiSettings.language = setting.setting_value;
            break;
          case 'timeout':
            aiSettings.timeout = parseInt(setting.setting_value, 10);
            break;
          case 'presence_penalty':
            aiSettings.presencePenalty = parseFloat(setting.setting_value);
            break;
          case 'frequency_penalty':
            aiSettings.frequencyPenalty = parseFloat(setting.setting_value);
            break;
        }
      }

      // حفظ في الكاش
      this.cache.set(cacheKey, { data: aiSettings, timestamp: Date.now() });

      return aiSettings;

    } catch (error) {
      this.logger.error('Failed to get AI settings', {
        merchantId,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        model: 'gpt-4o-mini',
        temperature: 0.8,
        maxTokens: 600,
        language: 'ar',
        timeout: 30000,
        presencePenalty: 0.1,
        frequencyPenalty: 0.1
      };
    }
  }

  /**
   * جلب القيم الافتراضية الديناميكية
   */
  async getDefaults(merchantId: string): Promise<DynamicDefaults> {
    try {
      const cacheKey = `defaults:${merchantId}`;
      const cached = this.cache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached.data;
      }

      const sql = this.db.getSQL();
      const defaults = await sql<{
        default_type: string;
        default_value: string;
        fallback_value: string;
      }>`
        SELECT default_type, default_value, fallback_value
        FROM dynamic_defaults 
        WHERE merchant_id = ${merchantId}::uuid
          AND is_active = true
      `;

      const dynamicDefaults: DynamicDefaults = {
        businessName: 'متجرنا',
        currency: 'IQD',
        merchantType: 'other',
        businessCategory: 'عام',
        workingHours: {},
        paymentMethods: [],
        deliveryOptions: {}
      };

      // تحويل القيم الافتراضية
      for (const defaultItem of defaults) {
        switch (defaultItem.default_type) {
          case 'business_name':
            dynamicDefaults.businessName = defaultItem.default_value;
            break;
          case 'currency':
            dynamicDefaults.currency = defaultItem.default_value;
            break;
          case 'merchant_type':
            dynamicDefaults.merchantType = defaultItem.default_value;
            break;
          case 'business_category':
            dynamicDefaults.businessCategory = defaultItem.default_value;
            break;
          case 'working_hours':
            try {
              dynamicDefaults.workingHours = JSON.parse(defaultItem.default_value);
            } catch {
              dynamicDefaults.workingHours = {};
            }
            break;
          case 'payment_methods':
            try {
              dynamicDefaults.paymentMethods = JSON.parse(defaultItem.default_value);
            } catch {
              dynamicDefaults.paymentMethods = [];
            }
            break;
          case 'delivery_options':
            try {
              dynamicDefaults.deliveryOptions = JSON.parse(defaultItem.default_value);
            } catch {
              dynamicDefaults.deliveryOptions = {};
            }
            break;
        }
      }

      // حفظ في الكاش
      this.cache.set(cacheKey, { data: dynamicDefaults, timestamp: Date.now() });

      return dynamicDefaults;

    } catch (error) {
      this.logger.error('Failed to get defaults', {
        merchantId,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        businessName: 'متجرنا',
        currency: 'IQD',
        merchantType: 'other',
        businessCategory: 'عام',
        workingHours: {},
        paymentMethods: [],
        deliveryOptions: {}
      };
    }
  }

  /**
   * جلب رسائل الخطأ الديناميكية
   */
  async getErrorMessages(merchantId: string): Promise<DynamicErrorMessages> {
    try {
      const cacheKey = `error_messages:${merchantId}`;
      const cached = this.cache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached.data;
      }

      const sql = this.db.getSQL();
      const errorMessages = await sql<{
        error_type: string;
        message_template: string;
        priority: number;
      }>`
        SELECT error_type, message_template, priority
        FROM dynamic_error_messages 
        WHERE merchant_id = ${merchantId}::uuid
          AND is_active = true
        ORDER BY error_type, priority ASC
      `;

      const dynamicErrorMessages: DynamicErrorMessages = {
        fallback: [],
        timeout: [],
        apiError: [],
        validationError: [],
        networkError: []
      };

      // تجميع رسائل الخطأ حسب النوع
      for (const errorMessage of errorMessages) {
        switch (errorMessage.error_type) {
          case 'fallback':
            dynamicErrorMessages.fallback.push(errorMessage.message_template);
            break;
          case 'timeout':
            dynamicErrorMessages.timeout.push(errorMessage.message_template);
            break;
          case 'api_error':
            dynamicErrorMessages.apiError.push(errorMessage.message_template);
            break;
          case 'validation_error':
            dynamicErrorMessages.validationError.push(errorMessage.message_template);
            break;
          case 'network_error':
            dynamicErrorMessages.networkError.push(errorMessage.message_template);
            break;
        }
      }

      // إضافة رسائل افتراضية إذا لم تكن موجودة
      if (dynamicErrorMessages.fallback.length === 0) {
        dynamicErrorMessages.fallback = [
          'واضح! أعطيني تفاصيل أكثر (اسم المنتج/الكود أو اللي يدور ببالك) وأنا أجاوبك فوراً بمعلومة محددة.',
          'ممتاز! أخبرني أكثر عن ما تبحث عنه (النوع/المقاس/اللون) وسأساعدك بسرعة.',
          'رائع! وضح لي احتياجاتك بالتفصيل وسأجد لك الأنسب فوراً.'
        ];
      }

      if (dynamicErrorMessages.timeout.length === 0) {
        dynamicErrorMessages.timeout = [
          'عذراً، واجهت مشكلة تقنية بسيطة. حاول مرة أخرى أو أخبرني بما تحتاجه وسأساعدك فوراً.'
        ];
      }

      if (dynamicErrorMessages.apiError.length === 0) {
        dynamicErrorMessages.apiError = [
          'حدث خطأ تقني مؤقت. يرجى المحاولة مرة أخرى أو التواصل معنا مباشرة.'
        ];
      }

      // حفظ في الكاش
      this.cache.set(cacheKey, { data: dynamicErrorMessages, timestamp: Date.now() });

      return dynamicErrorMessages;

    } catch (error) {
      this.logger.error('Failed to get error messages', {
        merchantId,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        fallback: [
          'واضح! أعطيني تفاصيل أكثر (اسم المنتج/الكود أو اللي يدور ببالك) وأنا أجاوبك فوراً بمعلومة محددة.'
        ],
        timeout: [
          'عذراً، واجهت مشكلة تقنية بسيطة. حاول مرة أخرى أو أخبرني بما تحتاجه وسأساعدك فوراً.'
        ],
        apiError: [
          'حدث خطأ تقني مؤقت. يرجى المحاولة مرة أخرى أو التواصل معنا مباشرة.'
        ],
        validationError: [
          'يرجى التحقق من المعلومات المدخلة والمحاولة مرة أخرى.'
        ],
        networkError: [
          'مشكلة في الاتصال. يرجى المحاولة مرة أخرى.'
        ]
      };
    }
  }

  /**
   * معالجة القالب واستبدال المتغيرات
   */
  private processTemplate(template: string, variables: Record<string, string>): string {
    let processedTemplate = template;
    
    // استبدال المتغيرات
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      processedTemplate = processedTemplate.replace(new RegExp(placeholder, 'g'), value);
    }

    return processedTemplate;
  }

  /**
   * جلب قالب افتراضي من النظام
   */
  private async getSystemDefaultTemplate(templateType: string, variables: Record<string, string>): Promise<string> {
    const systemTemplates: Record<string, string> = {
      greeting: 'مرحباً بك! كيف يمكنني مساعدتك اليوم؟',
      fallback: 'واضح! أعطيني تفاصيل أكثر وأنا أجاوبك فوراً.',
      error: 'عذراً، حدث خطأ. يرجى المحاولة مرة أخرى.',
      timeout: 'عذراً، واجهت مشكلة تقنية. حاول مرة أخرى.',
      goodbye: 'شكراً لك! أتمنى أن أكون قد ساعدتك.',
      thank_you: 'العفو! سعيد لخدمتك.',
      help: 'كيف يمكنني مساعدتك؟'
    };

    const template = systemTemplates[templateType] || systemTemplates.fallback;
    return this.processTemplate(template, variables);
  }

  /**
   * تحديث معدل نجاح القالب
   */
  async updateTemplateSuccessRate(templateId: string, isSuccess: boolean): Promise<void> {
    try {
      const sql = this.db.getSQL();
      
      if (isSuccess) {
        await sql`
          UPDATE dynamic_response_templates 
          SET success_rate = (success_rate * usage_count + 1.0) / (usage_count + 1)
          WHERE id = ${templateId}::uuid
        `;
      } else {
        await sql`
          UPDATE dynamic_response_templates 
          SET success_rate = (success_rate * usage_count) / (usage_count + 1)
          WHERE id = ${templateId}::uuid
        `;
      }

      // مسح الكاش
      this.clearCache();

    } catch (error) {
      this.logger.error('Failed to update template success rate', {
        templateId,
        isSuccess,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * مسح الكاش
   */
  clearCache(merchantId?: string): void {
    if (merchantId) {
      // مسح كاش تاجر محدد
      for (const key of this.cache.keys()) {
        if (key.includes(merchantId)) {
          this.cache.delete(key);
        }
      }
    } else {
      // مسح الكاش كاملاً
      this.cache.clear();
    }
  }
}

// Export singleton instance
export const dynamicTemplateManager = new DynamicTemplateManager();
