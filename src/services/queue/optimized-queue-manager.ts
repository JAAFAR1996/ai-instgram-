import ProductionQueueManager from '../ProductionQueueManager.js';

export class OptimizedQueueManager extends ProductionQueueManager {
  async processBatchMessages<T extends { id: string }>(
    messages: T[],
    batchSize: number = 5
  ): Promise<Array<{ success: boolean; messageId: string; error?: string }>> {
    const results: Array<{ success: boolean; messageId: string; error?: string }> = [];
    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(async (m) => {
        try {
          // Check if processMessage method exists and is callable
          if ('processMessage' in this && typeof this.processMessage === 'function') {
            await (this.processMessage as (message: T) => Promise<unknown>)(m);
          } else {
            throw new Error('processMessage method not available in base class');
          }
          return { success: true, messageId: m.id };
        } catch (e) {
          return { success: false, messageId: m.id, error: (e as Error).message };
        }
      }));
      results.push(...batchResults);
      if (i + batchSize < messages.length) await new Promise(r => setTimeout(r, 500));
    }
    return results;
  }
}

export default OptimizedQueueManager;
