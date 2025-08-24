import type { Hono } from 'hono';

// Development-only utilities and endpoints
class MockDatabase {
  // private data: Map<string, any> = new Map();
  private currentMerchantId: string | null = null;

  setMerchantContext(merchantId: string): void {
    this.currentMerchantId = merchantId;
    console.log(` RLS Context set: merchant_id = ${merchantId}`);
  }

  clearMerchantContext(): void {
    this.currentMerchantId = null;
    console.log(' RLS Context cleared');
  }

  async query(sql: string, params: any[] = []): Promise<any[]> {
    console.log(` Mock DB Query: ${sql}`, { params, context: this.currentMerchantId });

    // Simulate RLS behavior
    if (sql.includes('SELECT') && !this.currentMerchantId) {
      console.log(' RLS blocked: No merchant context');
      return [];
    }

    return [{ id: 1, merchant_id: this.currentMerchantId, test: 'data' }];
  }

  async testRLS(): Promise<{ withoutContext: any[]; withContext: any[] }> {
    // Test without context
    this.clearMerchantContext();
    const withoutContext = await this.query('SELECT * FROM merchants');

    // Test with context
    this.setMerchantContext('test-merchant-123');
    const withContext = await this.query('SELECT * FROM merchants');

    return { withoutContext, withContext };
  }
}

class MockQueueService {
  private jobs: Map<string, any> = new Map();
  private dlq: any[] = [];
  private processedEvents: Set<string> = new Set();

  async addJob(eventId: string, data: any): Promise<{ duplicate: boolean; jobId?: string }> {
    // Idempotency check
    if (this.processedEvents.has(eventId)) {
      console.log(` Idempotency collision detected: ${eventId}`);
      return { duplicate: true };
    }

    const jobId = `job_${Date.now()}`;
    this.jobs.set(jobId, { id: jobId, eventId, data, attempts: 0, maxAttempts: 3 });
    this.processedEvents.add(eventId);

    console.log(` Job added: ${jobId} (event: ${eventId})`);
    return { duplicate: false, jobId };
  }

  async processJob(jobId: string, shouldFail: boolean = false): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    job.attempts++;
    console.log(`⚙️ Processing job ${jobId} (attempt ${job.attempts}/${job.maxAttempts})`);

    if (shouldFail) {
      if (job.attempts >= job.maxAttempts) {
        // Move to DLQ
        this.dlq.push({
          ...job,
          dlqAt: new Date(),
          reason: 'Max attempts exceeded'
        });
        this.jobs.delete(jobId);
        console.log(` Job moved to DLQ: ${jobId}`);
      } else {
        console.log(` Job retry scheduled: ${jobId}`);
      }
    } else {
      this.jobs.delete(jobId);
      console.log(`✅ Job completed: ${jobId}`);
    }
  }

  getDLQStats(): { jobs: number; entries: any[] } {
    return { jobs: this.dlq.length, entries: this.dlq };
  }
}

export function registerTestRoutes(app: Hono) {
  const mockDb = new MockDatabase();
  const mockQueue = new MockQueueService();

  // RLS test endpoint
  app.get('/internal/test/rls', async (c) => {
    console.log(' Testing Row Level Security');

    try {
      const results = await mockDb.testRLS();

      return c.json({
        test: 'Row Level Security (RLS)',
        results: {
          without_context: {
            query: 'SELECT * FROM merchants (no context)',
            rows_returned: results.withoutContext.length,
            data: results.withoutContext
          },
          with_context: {
            query: 'SELECT * FROM merchants (with merchant context)',
            rows_returned: results.withContext.length,
            data: results.withContext
          }
        },
        rls_working: results.withoutContext.length === 0 && results.withContext.length > 0,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ RLS test failed:', error);
      return c.json({
        test: 'Row Level Security (RLS)',
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      }, 500);
    }
  });

  // Queue + DLQ test endpoint
  app.get('/internal/test/queue', async (c) => {
    console.log(' Testing Queue + DLQ + Idempotency');

    try {
      // Test idempotency
      const eventId = `test_event_${Date.now()}`;
      const result1 = await mockQueue.addJob(eventId, { test: 'data' });
      const result2 = await mockQueue.addJob(eventId, { test: 'data' }); // Duplicate

      // Test DLQ (force failure)
      const failEventId = `fail_event_${Date.now()}`;
      const failJob = await mockQueue.addJob(failEventId, { test: 'fail' });

      if (!failJob.duplicate && failJob.jobId) {
        // Force job to fail and move to DLQ
        await mockQueue.processJob(failJob.jobId, true); // Attempt 1
        await mockQueue.processJob(failJob.jobId, true); // Attempt 2
        await mockQueue.processJob(failJob.jobId, true); // Attempt 3 -> DLQ
      }

      const dlqStats = mockQueue.getDLQStats();

      return c.json({
        test: 'Queue + DLQ + Idempotency',
        idempotency: {
          first_attempt: { duplicate: result1.duplicate, jobId: result1.jobId },
          second_attempt: { duplicate: result2.duplicate },
          working: !result1.duplicate && result2.duplicate
        },
        dlq: {
          jobs_in_dlq: dlqStats.jobs,
          entries: dlqStats.entries,
          working: dlqStats.jobs > 0
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ Queue test failed:', error);
      return c.json({
        test: 'Queue + DLQ + Idempotency',
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      }, 500);
    }
  });
}
