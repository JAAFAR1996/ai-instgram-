import type { Job } from 'bullmq';
import { withMerchantContext } from '../database/rls-wrapper.js';
import { getLogger } from '../services/logger.js';
import { z } from 'zod';

const logger = getLogger({ component: 'withTenantJob' });

const JobSchema = z.object({
  merchantId: z.string().uuid(),
}).passthrough();

interface JobWithMethods {
  id?: string;
  name?: string;
  data?: unknown;
  payload?: unknown;
  attemptsMade?: number;
  opts?: { attempts?: number };
  moveToFailed?: (error: Error, token?: string, ignoreMaxAttempts?: boolean) => Promise<void>;
}

export function withTenantJob<T>(
  fn: (job: Job, token?: string) => Promise<T>
) {
  return async (job: Job, token?: string): Promise<T | void> => {
    const jobWithMethods = job as Job & Partial<JobWithMethods>;
    const data: unknown = (jobWithMethods as { data?: unknown; payload?: unknown }).data ?? (jobWithMethods as { data?: unknown; payload?: unknown }).payload;
    const parsed = JobSchema.safeParse(data);

    // Enhanced logging for job validation
    const jobInfo = {
      jobId: jobWithMethods.id ?? 'unknown',
      jobName: jobWithMethods.name ?? 'unknown',
      attemptsMade: jobWithMethods.attemptsMade ?? 0,
      maxAttempts: jobWithMethods.opts?.attempts ?? 3
    };

    if (!parsed.success) {
      const validationError = new Error(`Job validation failed: ${parsed.error.message}`);
      
      logger.error('Job validation failed - missing or invalid merchantId', {
        ...jobInfo,
        validationErrors: parsed.error.issues,
        jobData: data
      });

      // Attempt to move job to failed state
      try {
        if (typeof jobWithMethods.moveToFailed === 'function') {
          await jobWithMethods.moveToFailed(validationError, token, false);
          logger.info('Job moved to failed state due to validation error', jobInfo);
        } else {
          logger.warn('Cannot move job to failed state - moveToFailed method not available', jobInfo);
          throw validationError; // Throw error to ensure job doesn't succeed silently
        }
      } catch (moveToFailedError) {
        logger.error('Failed to move job to failed state', {
          ...jobInfo,
          originalError: validationError.message,
          moveToFailedError: moveToFailedError instanceof Error ? moveToFailedError.message : String(moveToFailedError)
        });
        throw validationError; // Re-throw original error
      }
      
      return; // Job has been properly handled as failed
    }

    const { merchantId } = parsed.data;
    
    logger.info('Processing job with tenant context', {
      ...jobInfo,
      merchantId
    });

    try {
      // Attempt to run with proper merchant context
      const result = await withMerchantContext(merchantId, async () => {
        logger.debug('Executing job function within merchant context', {
          ...jobInfo,
          merchantId
        });
        return fn(job, token);
      });
      
      logger.info('Job completed successfully with tenant context', {
        ...jobInfo,
        merchantId
      });
      
      return result;
    } catch (contextError) {
      logger.warn('Failed to establish merchant context, attempting without context', {
        ...jobInfo,
        merchantId,
        contextError: {
          name: contextError instanceof Error ? contextError.name : 'UnknownError',
          message: contextError instanceof Error ? contextError.message : 'Context establishment failed',
          stack: contextError instanceof Error ? contextError.stack : undefined
        }
      });
      
      try {
        // Fallback: run without merchant context (for tests/degraded scenarios)
        const result = await fn(job, token);
        
        logger.warn('Job completed without tenant context (fallback mode)', {
          ...jobInfo,
          merchantId,
          fallbackReason: contextError instanceof Error ? contextError.message : 'Context establishment failed'
        });
        
        return result;
      } catch (jobError) {
        logger.error('Job failed in both context and fallback modes', {
          ...jobInfo,
          merchantId,
          contextError: contextError instanceof Error ? contextError.message : String(contextError),
          jobError: {
            name: jobError instanceof Error ? jobError.name : 'UnknownError',
            message: jobError instanceof Error ? jobError.message : 'Job execution failed',
            stack: jobError instanceof Error ? jobError.stack : undefined
          }
        });
        
        // Don't catch this error - let it bubble up to be handled by the job queue
        throw jobError;
      }
    }
  };
}
