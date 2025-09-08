import { getLogger } from './logger.js';
import SmartCache, { CustomerContextCache } from './smart-cache.js';
import { getAIService } from './ai.js';

export interface ConversationMsg {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date | string;
}

export interface ConversationOptimizationResult {
  summary?: string;
  trimmedHistory: ConversationMsg[];
  sessionPatch?: CustomerContextCache;
}

/**
 * Lightweight conversation manager to preserve context across messages
 * and keep history compact with an auto-summary.
 */
export class ConversationManager {
  private log = getLogger({ component: 'conversation-manager' });
  private cache = new SmartCache();

  /**
   * Return a compact view of history with an appended rolling summary.
   * Keeps last N messages and stores a summary in smart cache.
   */
  async optimizeHistory(
    merchantId: string,
    customerId: string,
    messages: ConversationMsg[],
    keepLast = 6
  ): Promise<ConversationOptimizationResult> {
    try {
      const trimmed = messages.slice(-keepLast);
      const older = messages.slice(0, Math.max(0, messages.length - keepLast));
      let summary = '';
      try {
        const ai = await getAIService();
        // Map to AI.MessageHistory format
        const hist = older.map(m => ({ role: m.role, content: m.content, timestamp: new Date(m.timestamp as any) })) as any;
        summary = await ai.generateConversationSummary(hist, {
          merchantId,
          customerId,
          platform: 'instagram' as any,
          stage: 'GREETING' as any,
          cart: [],
          preferences: {},
          conversationHistory: []
        } as any);
      } catch (e) {
        const olderSummary = summarizeNaively(older, 600);
        summary = mergeSummaries('', olderSummary, 700);
      }

      const sessionPatch: CustomerContextCache = { lastSummary: summary };
      await this.cache.patchCustomerContext(merchantId, customerId, sessionPatch);

      return { summary, trimmedHistory: trimmed, sessionPatch };
    } catch (e) {
      this.log.warn('optimizeHistory failed', { error: String(e) });
      return { trimmedHistory: messages.slice(-keepLast) };
    }
  }

  /**
   * Store/merge session patch into SmartCache for quick recall.
   */
  async updateSessionContext(
    merchantId: string,
    customerId: string,
    patch: CustomerContextCache
  ): Promise<void> {
    try {
      if (patch && Object.keys(patch).length) {
        await this.cache.patchCustomerContext(merchantId, customerId, patch);
      }
    } catch (e) {
      this.log.warn('updateSessionContext failed', { error: String(e) });
    }
  }
}

function summarizeNaively(msgs: ConversationMsg[], max = 800): string {
  if (!msgs.length) return '';
  const lines = msgs.map(m => `${m.role === 'user' ? 'U' : 'A'}: ${sanitize(m.content)}`);
  const text = lines.join(' | ');
  return text.length > max ? text.slice(0, max - 3) + '...' : text;
}

function mergeSummaries(prev: string, next: string, max = 900): string {
  const merged = [prev, next].filter(Boolean).join(' || ');
  return merged.length > max ? merged.slice(0, max - 3) + '...' : merged;
}

function sanitize(s: string): string {
  return (s ?? '').replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export default ConversationManager;
