/**
 * Response Diversity Utilities
 * أدوات تنويع الردود وتجنب التكرار
 */

import { getLogger } from '../services/logger.js';

const logger = getLogger({ component: 'response-diversity' });

export interface DiversityCheck {
  hasRepetition: boolean;
  repetitionScore: number;
  suggestions: string[];
  needsImprovement: boolean;
}

export interface ConversationHistory {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

/**
 * فحص تنويع الردود وتجنب التكرار
 */
export function checkResponseDiversity(
  response: string,
  conversationHistory: ConversationHistory[] = [],
  maxHistoryLength: number = 10
): DiversityCheck {
  const responseWords = response.toLowerCase().split(/\s+/).filter(word => word.length > 2);
  const uniqueWords = new Set(responseWords);
  const repetitionScore = uniqueWords.size / responseWords.length;
  
  // فحص التكرار الداخلي في الرد
  const hasInternalRepetition = repetitionScore < 0.7;
  
  // فحص التكرار مع المحادثات السابقة
  const recentHistory = conversationHistory
    .slice(-maxHistoryLength)
    .filter(msg => msg.role === 'assistant')
    .map(msg => msg.content.toLowerCase());
  
  let hasHistoricalRepetition = false;
  const suggestions: string[] = [];
  
  if (recentHistory.length > 0) {
    const responseLower = response.toLowerCase();
    
    // فحص التكرار مع آخر 3 ردود
    const lastResponses = recentHistory.slice(-3);
    for (const prevResponse of lastResponses) {
      const similarity = calculateTextSimilarity(responseLower, prevResponse);
      if (similarity > 0.8) {
        hasHistoricalRepetition = true;
        suggestions.push('جرب استخدام كلمات مختلفة أو إعادة صياغة الجمل');
        break;
      }
    }
  }
  
  // فحص العبارات المكررة الشائعة
  const commonRepetitivePhrases = [
    /أهلاً وسهلاً/gi,
    /شكراً لك/gi,
    /حاضر أخدمك/gi,
    /ممكن أساعدك/gi,
    /تحب أشوف/gi,
    /عندي اقتراحات/gi,
    /ممكن نتأكد من القياس المناسب إلك/gi,
    /إذا تحب أعطيك جدول المقاسات/gi
  ];
  
  let hasCommonRepetition = false;
  for (const phrase of commonRepetitivePhrases) {
    if (phrase.test(response)) {
      hasCommonRepetition = true;
      suggestions.push('تجنب استخدام العبارات المكررة الشائعة');
      break;
    }
  }
  
  const needsImprovement = hasInternalRepetition || hasHistoricalRepetition || hasCommonRepetition;
  
  if (needsImprovement) {
    logger.debug('Response diversity issues detected', {
      repetitionScore,
      hasInternalRepetition,
      hasHistoricalRepetition,
      hasCommonRepetition
    });
  }
  
  return {
    hasRepetition: needsImprovement,
    repetitionScore,
    suggestions,
    needsImprovement
  };
}

/**
 * حساب التشابه بين نصين
 */
function calculateTextSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.split(/\s+/).filter(word => word.length > 2));
  const words2 = new Set(text2.split(/\s+/).filter(word => word.length > 2));
  
  const intersection = new Set([...words1].filter(word => words2.has(word)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

/**
 * تحسين الرد لتجنب التكرار
 */
export function improveResponseDiversity(
  response: string,
  conversationHistory: ConversationHistory[] = []
): string {
  const diversityCheck = checkResponseDiversity(response, conversationHistory);
  
  if (!diversityCheck.needsImprovement) {
    return response;
  }
  
  let improvedResponse = response;
  
  // استبدال العبارات المكررة الشائعة
  const replacements = [
    { from: /أهلاً وسهلاً/gi, to: ['مرحباً', 'أهلاً بك', 'أهلاً وسهلاً بك'] },
    { from: /شكراً لك/gi, to: ['شكراً', 'ممتاز', 'رائع'] },
    { from: /حاضر أخدمك/gi, to: ['أنا هنا لمساعدتك', 'جاهز لخدمتك', 'حاضر'] },
    { from: /ممكن أساعدك/gi, to: ['كيف يمكنني مساعدتك', 'أخبرني كيف أساعدك', 'ما الذي تحتاجه'] },
    { from: /تحب أشوف/gi, to: ['هل تريد أن ترى', 'ممكن تشوف', 'عايز تشوف'] },
    { from: /عندي اقتراحات/gi, to: ['لدي خيارات', 'ممكن أقترح عليك', 'عندي خيارات'] },
    { from: /ممكن نتأكد من القياس المناسب إلك\؟ إذا تحب أعطيك جدول المقاسات ✅/gi, to: [
      'هل تريد التأكد من المقاس المناسب؟',
      'ممكن نساعدك في اختيار المقاس الصحيح',
      'هل تحتاج مساعدة في المقاس؟'
    ]}
  ];
  
  for (const replacement of replacements) {
    if (replacement.from.test(improvedResponse)) {
      const randomAlternative = replacement.to[Math.floor(Math.random() * replacement.to.length)];
      improvedResponse = improvedResponse.replace(replacement.from, randomAlternative);
    }
  }
  
  // إضافة تنويع في بداية الجمل
  const sentenceStarters = [
    'بالتأكيد',
    'طبعاً',
    'بالطبع',
    'حسناً',
    'ممتاز',
    'رائع',
    'ماشي'
  ];
  
  // إذا كان الرد يبدأ بنفس الكلمات، أضف بداية متنوعة
  if (conversationHistory.length > 0) {
    const lastResponse = conversationHistory[conversationHistory.length - 1]?.content || '';
    if (lastResponse.length > 0) {
      const lastWords = lastResponse.split(/\s+/).slice(0, 2).join(' ');
      const currentWords = improvedResponse.split(/\s+/).slice(0, 2).join(' ');
      
      if (lastWords === currentWords) {
        const randomStarter = sentenceStarters[Math.floor(Math.random() * sentenceStarters.length)];
        improvedResponse = `${randomStarter}، ${improvedResponse}`;
      }
    }
  }
  
  logger.debug('Response diversity improved', {
    originalLength: response.length,
    improvedLength: improvedResponse.length,
    changesApplied: improvedResponse !== response
  });
  
  return improvedResponse;
}

/**
 * إنشاء ردود متنوعة للاستفسارات المتشابهة
 */
export function generateVariedResponses(
  baseResponse: string,
  count: number = 3
): string[] {
  const variations: string[] = [baseResponse];
  
  // إضافة تنويعات بسيطة
  const starters = ['بالتأكيد', 'طبعاً', 'ممتاز', 'رائع'];
  const connectors = ['،', '.', '!', ' -'];
  
  for (let i = 1; i < count; i++) {
    let variation = baseResponse;
    
    // تغيير البداية
    const starter = starters[i % starters.length];
    if (!variation.startsWith(starter)) {
      variation = `${starter}، ${variation}`;
    }
    
    // تغيير علامات الترقيم
    const connector = connectors[i % connectors.length];
    variation = variation.replace(/[.,!-]/g, connector);
    
    variations.push(variation);
  }
  
  return variations;
}

export default {
  checkResponseDiversity,
  improveResponseDiversity,
  generateVariedResponses
};
