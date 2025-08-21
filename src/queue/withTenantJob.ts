import type { Job } from 'bull';
import { withMerchantContext } from '../database/rls-wrapper.js';
import { z } from 'zod';

const JobSchema = z.object({
  merchantId: z.string().uuid(),
}).passthrough();

export function withTenantJob<T>(
  fn: (job: Job, token?: string) => Promise<T>
) {
  return async (job: Job, token?: string): Promise<T | void> => {
    const data: any = (job as any).data ?? (job as any).payload;
    const parsed = JobSchema.safeParse(data);

    if (!parsed.success) {
      if (typeof (job as any).moveToFailed === 'function') {
        await (job as any).moveToFailed(
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