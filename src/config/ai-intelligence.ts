/**
 * AI Intelligence Configuration
 * إعدادات تحسين ذكاء الردود
 */

export interface AIIntelligenceConfig {
  // إعدادات تجنب التكرار
  repetition: {
    presencePenalty: number; // عقوبة التكرار (0-2)
    frequencyPenalty: number; // عقوبة تكرار الكلمات (0-2)
    maxSimilarityThreshold: number; // الحد الأقصى للتشابه مع الردود السابقة
    cacheRepetitionCheck: boolean; // فحص التكرار في التخزين المؤقت
  };
  
  // إعدادات التنويع
  diversity: {
    enableResponseVariation: boolean; // تفعيل تنويع الردود
    maxHistoryCheck: number; // عدد الردود السابقة للفحص
    variationThreshold: number; // عتبة التنويع المطلوبة
    enableGreetingVariation: boolean; // تنويع التحيات
  };
  
  // إعدادات السياق
  context: {
    useConversationHistory: boolean; // استخدام تاريخ المحادثة
    maxContextLength: number; // الحد الأقصى لطول السياق
    includeCustomerProfile: boolean; // تضمين ملف العميل
    includeMerchantPersonality: boolean; // تضمين شخصية التاجر
  };
  
  // إعدادات الجودة
  quality: {
    enableConstitutionalAI: boolean; // تفعيل الذكاء الاصطناعي الدستوري
    enableResponseValidation: boolean; // تفعيل التحقق من الردود
    minResponseLength: number; // الحد الأدنى لطول الرد
    maxResponseLength: number; // الحد الأقصى لطول الرد
  };
}

export const DEFAULT_AI_INTELLIGENCE_CONFIG: AIIntelligenceConfig = {
  repetition: {
    presencePenalty: 0.6,
    frequencyPenalty: 0.4,
    maxSimilarityThreshold: 0.8,
    cacheRepetitionCheck: true
  },
  
  diversity: {
    enableResponseVariation: true,
    maxHistoryCheck: 10,
    variationThreshold: 0.7,
    enableGreetingVariation: true
  },
  
  context: {
    useConversationHistory: true,
    maxContextLength: 2000,
    includeCustomerProfile: true,
    includeMerchantPersonality: true
  },
  
  quality: {
    enableConstitutionalAI: true,
    enableResponseValidation: true,
    minResponseLength: 10,
    maxResponseLength: 500
  }
};

/**
 * تحسين إعدادات OpenAI بناءً على التكوين
 */
export function getOptimizedOpenAISettings(config: AIIntelligenceConfig) {
  return {
    temperature: 0.8,
    max_tokens: 500,
    top_p: 0.9,
    presence_penalty: config.repetition.presencePenalty,
    frequency_penalty: config.repetition.frequencyPenalty,
    stop: null
  };
}

/**
 * قوالب الردود المتنوعة للاستفسارات الشائعة
 */
export const RESPONSE_TEMPLATES = {
  greeting: {
    new: [
      'أهلاً وسهلاً بيك 🙌',
      'مرحباً بك في متجرنا 🌟',
      'أهلاً وسهلاً بيك معنا ✨',
      'مرحباً بك وسهلاً 💫'
    ],
    returning: [
      'رجعنا نفرح بخدمتك 🌟',
      'أهلاً وسهلاً بيك مرة ثانية 🙌',
      'مرحباً بعودتك إلينا 💫',
      'أهلاً وسهلاً بيك مرة أخرى 🌸'
    ],
    vip: [
      'هلا وسهلا عميلنا المميز ✨',
      'أهلاً وسهلاً بيك يا VIP 🌟',
      'مرحباً بعميلنا المميز 💎',
      'أهلاً وسهلاً بالعميل المميز ⭐'
    ]
  },
  
  productInquiry: [
    'بالطبع! عندي خيارات رائعة لك',
    'ممتاز! لدي اقتراحات مناسبة',
    'رائع! عندي منتجات تناسبك',
    'طبعاً! عندي خيارات مميزة'
  ],
  
  priceInquiry: [
    'السعر حسب النوع والمقاس',
    'الأسعار تختلف حسب المواصفات',
    'السعر يعتمد على الخيارات',
    'الأسعار متنوعة حسب النوع'
  ],
  
  availability: [
    'متوفر حالياً في المخزون',
    'نعم، متوفر الآن',
    'موجود في المخزون',
    'متوفر ومتاح للطلب'
  ],
  
  assistance: [
    'أنا هنا لمساعدتك',
    'جاهز لخدمتك',
    'حاضر أساعدك',
    'أنا هنا لخدمتك'
  ]
};

/**
 * كلمات وعبارات يجب تجنب تكرارها
 */
export const REPETITIVE_PHRASES_TO_AVOID = [
  /أهلاً وسهلاً/gi,
  /شكراً لك/gi,
  /حاضر أخدمك/gi,
  /ممكن أساعدك/gi,
  /تحب أشوف/gi,
  /عندي اقتراحات/gi,
  /بالطبع/gi,
  /ممتاز/gi,
  /رائع/gi
];

/**
 * بدائل للعبارات المكررة
 */
export const PHRASE_ALTERNATIVES = {
  'أهلاً وسهلاً': ['مرحباً', 'أهلاً بك', 'أهلاً وسهلاً بك'],
  'شكراً لك': ['شكراً', 'ممتاز', 'رائع'],
  'حاضر أخدمك': ['أنا هنا لمساعدتك', 'جاهز لخدمتك', 'حاضر'],
  'ممكن أساعدك': ['كيف يمكنني مساعدتك', 'أخبرني كيف أساعدك', 'ما الذي تحتاجه'],
  'تحب أشوف': ['هل تريد أن ترى', 'ممكن تشوف', 'عايز تشوف'],
  'عندي اقتراحات': ['لدي خيارات', 'ممكن أقترح عليك', 'عندي خيارات'],
  'بالطبع': ['طبعاً', 'ماشي', 'أكيد'],
  'ممتاز': ['رائع', 'ماشي', 'أكيد'],
  'رائع': ['ممتاز', 'ماشي', 'أكيد']
};

export default {
  DEFAULT_AI_INTELLIGENCE_CONFIG,
  getOptimizedOpenAISettings,
  RESPONSE_TEMPLATES,
  REPETITIVE_PHRASES_TO_AVOID,
  PHRASE_ALTERNATIVES
};
