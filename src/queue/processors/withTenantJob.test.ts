import { describe, test, expect } from 'bun:test';
import { withTenantJob } from '../withTenantJob.js';

class FakeJob {
  data: Record<string, any>;
  failedCount = 0;
  constructor(data: Record<string, any>) {
    this.data = data;
  }
  async moveToFailed(err: Error, _token?: string, requeue?: boolean) {
    this.failedCount++;
    this.err = err;
    this.requeue = requeue;
  }
  err?: Error;
  requeue?: boolean;
}

describe('withTenantJob', () => {
  test('fails once with clear message when merchantId is missing', async () => {
    const job = new FakeJob({});
    const processor = withTenantJob(async () => {});

    await processor(job as any, 'token');

    expect(job.failedCount).toBe(1);
    expect(job.err?.message).toBe('MISSING_MERCHANT_ID');
    expect(job.requeue).toBe(false);
  });
});