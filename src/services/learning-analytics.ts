import { getDatabase } from '../db/adapter.js';
import { getLogger } from './logger.js';
import { telemetry } from './telemetry.js';
import type { LearningOutcome, SuccessPatterns, StrategyUpdate } from '../types/learning.js';
import AdaptationEngine from './adaptation-engine.js';
import { computeSuccessPatterns } from '../utils/pattern-matcher.js';

export class SelfLearningSystem {
  private db = getDatabase();
  private logger = getLogger({ component: 'learning-analytics' });

  async trackConversationOutcome(conversationId: string, outcome: LearningOutcome): Promise<void> {
    const sql = this.db.getSQL();
    // Load minimal context
    const rows = await sql<{ merchant_id: string; converted_to_order: boolean | null }>`
      SELECT merchant_id, converted_to_order FROM conversations WHERE id = ${conversationId}::uuid LIMIT 1
    `;
    const convo = rows[0];
    if (!convo) {
      this.logger.warn('trackConversationOutcome: conversation not found', { conversationId });
      return;
    }

    // Update conversation conversion flag if provided
    try {
      if (typeof outcome.converted === 'boolean') {
        await sql`UPDATE conversations SET converted_to_order = ${outcome.converted}, updated_at = NOW() WHERE id = ${conversationId}::uuid`;
      }
    } catch (e) {
      this.logger.warn('Failed to update conversion flag', { error: String(e) });
    }

    // Record event in message_logs metadata for audit and later mining
    try {
      const meta: Record<string, unknown> = {
        event_type: 'conversation_outcome',
        outcome,
      };
      await sql`
        INSERT INTO message_logs (conversation_id, content, message_type, direction, platform, source_channel, ai_intent, ai_confidence, processing_time_ms, metadata, created_at)
        VALUES (${conversationId}::uuid, ${'[LEARNING] outcome recorded'}::text, 'TEXT', 'OUTGOING', 'instagram', 'manychat', NULL, NULL, 0, ${JSON.stringify(meta)}::jsonb, NOW())
      `;
    } catch (e) {
      this.logger.warn('Failed to record learning outcome in message_logs', { error: String(e) });
    }

    try { telemetry.trackEvent('learning_outcome_recorded', { type: outcome.type, merchant_id: convo.merchant_id }); } catch {}
  }

  async analyzeSuccessPatterns(merchantId: string, days = 30): Promise<SuccessPatterns> {
    const sql = this.db.getSQL();
    const from = new Date(Date.now() - days * 86400000);
    const to = new Date();
    // Fetch successful conversation outgoing messages
  const rows = await sql<{ content: string; created_at: Date; processing_time_ms: number | null; session_data: Record<string, unknown> | null }>`
      SELECT ml.content, ml.created_at, ml.processing_time_ms,
             c.session_data
      FROM message_logs ml
      JOIN conversations c ON c.id = ml.conversation_id
      WHERE c.merchant_id = ${merchantId}::uuid
        AND c.converted_to_order = true
        AND ml.direction = 'OUTGOING'
        AND ml.created_at BETWEEN ${from} AND ${to}
      LIMIT 5000
    `;
    const mapped = rows.map(r => {
  const obj: { content: string; created_at: Date; processing_time_ms?: number; session_data?: Record<string, unknown> } = {
        content: r.content,
        created_at: new Date(r.created_at),
      };
      if (typeof r.processing_time_ms === 'number') obj.processing_time_ms = r.processing_time_ms;
      if (r.session_data != null) obj.session_data = r.session_data;
      return obj;
    });
    const patterns = computeSuccessPatterns(merchantId, mapped);
    this.logger.info('Success patterns analyzed', { merchantId, sample: patterns.sampleSize });
    return patterns;
  }

  async updateResponseStrategies(patterns: SuccessPatterns): Promise<StrategyUpdate> {
    const engine = new AdaptationEngine();
    const update = engine.suggestAdjustments(patterns);
    // Persist into merchants.ai_config as responseStrategies
    try {
      const sql = this.db.getSQL();
      await sql`
        UPDATE merchants
        SET ai_config = COALESCE(ai_config, '{}'::jsonb) || ${JSON.stringify({ responseStrategies: update.responseStrategies })}::jsonb
        WHERE id = ${patterns.merchantId}::uuid
      `;
      this.logger.info('Updated response strategies for merchant', { merchantId: patterns.merchantId });
    } catch (e) {
      this.logger.warn('Failed to persist response strategies', { error: String(e) });
    }
    return update;
  }

  async adaptToCustomerPreferences(customerId: string, preferences: Record<string, unknown>): Promise<{ adjustments: Record<string, unknown>; notes: string[] }>{
    // Provide lightweight real-time adaptation hints for the orchestrator layer
    const notes: string[] = [];
    const adjustments: Record<string, unknown> = {};
    if (typeof preferences['gender'] === 'string') {
      adjustments['tone'] = preferences['gender'] === 'female' ? 'warm' : 'neutral';
    }
    if (typeof preferences['category'] === 'string') {
      adjustments['focus_category'] = preferences['category'];
    }
    if (typeof preferences['price_sensitivity'] === 'string') {
      adjustments['price_tone'] = preferences['price_sensitivity'] === 'high' ? 'highlight_discounts' : 'highlight_quality';
    }
    notes.push('Adapted response parameters based on provided preferences');
    if (customerId) notes.push(`customer:${customerId}`);
    return { adjustments, notes };
  }
}

export default SelfLearningSystem;
