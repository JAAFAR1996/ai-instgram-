import { getDatabase } from '../../db/adapter.js';
import type { ConversationContext } from '../ai.js';

export type RejectionType = 'price' | 'quality' | 'timing' | 'other';

export interface RejectionAnalysis {
  rejectionType: RejectionType;
  emotionalTone: 'neutral' | 'negative' | 'positive';
  concerns: string[];
  confidence: number;
  suggestedApproach: string;
  alternativeProducts: string[];
}

export interface RejectionData {
  type: RejectionType;
  reason: string;
  customerMessage: string;
  strategiesUsed: string[];
  context: Record<string, unknown>;
}

export class IntelligentRejectionHandler {
  private db = getDatabase();

  async analyzeRejection(customerMessage: string, _ctx: ConversationContext): Promise<RejectionAnalysis> {
    const msg = (customerMessage ?? '').toLowerCase();
    const isPrice = /(غالي|سعر|خصم|رخيص|مرتفع)/.test(msg);
    const isQuality = /(جودة|تقليد|مزيف|خايس)/.test(msg);
    const isTiming = /(بعدين|مو هسه|مو الآن|لاحقاً)/.test(msg);
    const type: RejectionType = isPrice ? 'price' : isQuality ? 'quality' : isTiming ? 'timing' : 'other';
    const tone: 'neutral' | 'negative' | 'positive' = /(ما|مو|لا)/.test(msg) ? 'negative' : 'neutral';
    const approach = type === 'price' ? 'اعرض بديل بسعر أنسب وركّز على القيمة' : type === 'quality' ? 'قدّم ضمان وثقة وتجارب عملاء' : type === 'timing' ? 'خفّف الإلحاح وذكّر بنُدرة المخزون' : 'استفسر بلطف عن سبب الرفض';
    return {
      rejectionType: type,
      emotionalTone: tone,
      concerns: [],
      confidence: 0.8,
      suggestedApproach: approach,
      alternativeProducts: []
    };
  }

  async generateCounterResponse(analysis: RejectionAnalysis): Promise<string> {
    if (analysis.rejectionType === 'price') {
      return 'أفهمك تماماً، السعر مهم. خلي أشوف لك خيار يناسب ميزانيتك وبجودة طيبة ✨';
    }
    if (analysis.rejectionType === 'quality') {
      return 'مفهوم خوفك من الجودة. عدنا منتجات مضمونة وتجارب عملاء ممتازة، تحب أشوف لك خيارات مجرّبة؟';
    }
    if (analysis.rejectionType === 'timing') {
      return 'تمام، خذ راحتك. بس خابرني إذا تريد نحجزه إلك اليوم لأن الكمية محدودة 😉';
    }
    return 'تمام، إذا تحب خبرني شنو اللي ما كان مناسب حتى أساعدك بخيارات أحسن 🙏';
  }

  async recordRejection(
    merchantId: string,
    customerId: string,
    conversationId: string,
    rejectionData: RejectionData
  ): Promise<void> {
    const sql = this.db.getSQL();
    await sql`
      INSERT INTO conversation_rejections (
        merchant_id, customer_id, conversation_id,
        rejection_type, rejection_reason, customer_message,
        ai_strategies_used, context_data, created_at
      ) VALUES (
        ${merchantId}::uuid, ${customerId}, ${conversationId}::uuid,
        ${rejectionData.type}, ${rejectionData.reason}, ${rejectionData.customerMessage},
        ${JSON.stringify(rejectionData.strategiesUsed)}::jsonb, ${JSON.stringify(rejectionData.context)}::jsonb, NOW()
      )
    `;
  }
}

export default IntelligentRejectionHandler;

