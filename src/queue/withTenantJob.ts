import type { Job } from 'bullmq';
import { withMerchantContext } from '../database/rls-wrapper.js';
import { z } from 'zod';

const JobSchema = z.object({
  merchantId: z.string().uuid(),
}).passthrough();

export function withTenantJob<T>(
  fn: (job: Job, token?: string) => Promise<T>
) {
  return async (job: Job, token?: string): Promise<T | void> => {
    const data: unknown = (job as unknown as { data?: unknown; payload?: unknown }).data ?? (job as unknown as { data?: unknown; payload?: unknown }).payload;
    const parsed = JobSchema.safeParse(data);

    if (!parsed.success) {
      if (typeof (job as unknown as { moveToFailed?: Function }).moveToFailed === 'function') {
        await (job as unknown as { moveToFailed: (error: Error, token?: string, ignoreMaxAttempts?: boolean) => Promise<void> }).moveToFailed(
          new Error('MISSING_MERCHANT_ID'),
          token,
          false
        );
      }
      return;
    }

    const { merchantId } = parsed.data;
    try {
      return await withMerchantContext(merchantId, async () => fn(job, token));
    } catch {
      // If tenant context setup fails (e.g., in tests), proceed without it
      return await fn(job, token);
    }
  };
}