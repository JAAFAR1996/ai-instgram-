// Production-grade tenant isolation context
import { Pool } from 'pg';
import { z } from 'zod';

// Error serialization helper
export function serr(e: any) {
  return { 
    name: e?.name, 
    message: e?.message, 
    code: e?.code, 
    stack: e?.stack, 
    cause: e?.cause?.message 
  };
}

// Base job data schema validation
export const JobSchema = z.object({ 
  merchantId: z.string().uuid('merchantId must be a valid UUID'),
  eventId: z.string().optional(),
  timestamp: z.number().optional()
});

// Webhook job schema
export const WebhookJobSchema = JobSchema.extend({
  platform: z.enum(['INSTAGRAM', 'WHATSAPP', 'FACEBOOK']),
  payload: z.record(z.any()).describe('Webhook payload from social platform'),
  signature: z.string().optional(),
  eventId: z.string().min(1, 'eventId is required for webhooks')
});

// AI response job schema  
export const AIJobSchema = JobSchema.extend({
  conversationId: z.string().uuid('conversationId must be a valid UUID'),
  message: z.string().min(1, 'message cannot be empty'),
  context: z.record(z.any()).optional(),
  priority: z.enum(['low', 'normal', 'high']).default('normal')
});

// Cleanup job schema (no merchant isolation needed)
export const CleanupJobSchema = z.object({
  type: z.enum(['logs', 'cache', 'analytics']),
  olderThanDays: z.number().min(1).max(365),
  force: z.boolean().default(false)
});

export type JobData = z.infer<typeof JobSchema>;
export type WebhookJobData = z.infer<typeof WebhookJobSchema>;
export type AIJobData = z.infer<typeof AIJobSchema>;
export type CleanupJobData = z.infer<typeof CleanupJobSchema>;

// Database tenant isolation with PostgreSQL RLS and proper transactions
export async function withDbTenant<T>(
  pool: Pool,
  merchantId: string,
  fn: (client: any) => Promise<T>
): Promise<T> {
  if (!merchantId) {
    throw new Error('MISSING_MERCHANT_ID');
  }
  
  const client = await pool.connect();
  try {
    // Begin transaction to ensure all operations use same connection context
    await client.query('BEGIN');
    
    // Set tenant context for RLS policies within transaction
    await client.query('SET LOCAL app.current_merchant_id = $1', [merchantId]);
    await client.query('SET LOCAL app.admin_mode = $1', ['false']);
    
    // Execute function within tenant context with same client
    const result = await fn(client);
    
    // Commit transaction if successful
    await client.query('COMMIT');
    return result;
    
  } catch (error) {
    // Rollback transaction on error
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Failed to rollback transaction:', rollbackError);
    }
    
    // Re-throw original error
    throw error;
  } finally {
    // Clear context and release connection
    await client.query('RESET app.current_merchant_id').catch(() => {});
    await client.query('RESET app.admin_mode').catch(() => {});
    client.release();
  }
}

// Worker job wrapper with tenant isolation
export function withTenantJob<T>(
  pool: Pool,
  logger: any,
  handler: (job: any, data: JobData, client: any) => Promise<T>
) {
  return async (job: any) => {
    try {
      // Validate job data schema
      const data = JobSchema.parse(job.data);
      
      logger.debug('Processing job with tenant isolation', {
        jobId: job.id,
        jobName: job.name,
        merchantId: data.merchantId
      });
      
      // Execute with database tenant isolation
      return await withDbTenant(pool, data.merchantId, (client) => 
        handler(job, data, client)
      );
      
    } catch (error) {
      if (error instanceof z.ZodError) {
        const validationError = new Error('INVALID_JOB_DATA');
        logger.error({
          err: serr(validationError),
          jobId: job.id,
          jobName: job.name,
          validation: error.errors
        }, 'Job data validation failed');
        
        await job.moveToFailed(validationError, false); // no retry
        throw validationError;
      }
      
      if (error?.message === 'MISSING_MERCHANT_ID') {
        logger.error({
          err: serr(error),
          jobId: job.id,
          jobName: job.name,
          merchantId: null
        }, 'Merchant isolation failed - missing ID');
        
        await job.moveToFailed(error, false); // no retry
        throw error;
      }
      
      logger.error({
        err: serr(error),
        jobId: job.id,
        jobName: job.name,
        merchantId: job.data?.merchantId
      }, 'Job execution failed');
      
      throw error;
    }
  };
}

// Webhook-specific tenant job wrapper
export function withWebhookTenantJob<T>(
  pool: Pool,
  logger: any,
  handler: (job: any, data: WebhookJobData, client: any) => Promise<T>
) {
  return async (job: any) => {
    try {
      // Validate webhook job data schema
      const data = WebhookJobSchema.parse(job.data);
      
      logger.debug('Processing webhook job with tenant isolation', {
        jobId: job.id,
        jobName: job.name,
        merchantId: data.merchantId,
        platform: data.platform,
        eventId: data.eventId
      });
      
      // Execute with database tenant isolation
      return await withDbTenant(pool, data.merchantId, (client) => 
        handler(job, data, client)
      );
      
    } catch (error) {
      return handleTenantJobError(error, job, logger);
    }
  };
}

// AI-specific tenant job wrapper
export function withAITenantJob<T>(
  pool: Pool,
  logger: any,
  handler: (job: any, data: AIJobData, client: any) => Promise<T>
) {
  return async (job: any) => {
    try {
      // Validate AI job data schema
      const data = AIJobSchema.parse(job.data);
      
      logger.debug('Processing AI job with tenant isolation', {
        jobId: job.id,
        jobName: job.name,
        merchantId: data.merchantId,
        conversationId: data.conversationId,
        priority: data.priority
      });
      
      // Execute with database tenant isolation
      return await withDbTenant(pool, data.merchantId, (client) => 
        handler(job, data, client)
      );
      
    } catch (error) {
      return handleTenantJobError(error, job, logger);
    }
  };
}

// Common error handler for tenant jobs
async function handleTenantJobError(error: any, job: any, logger: any) {
  if (error instanceof z.ZodError) {
    const validationError = new Error('INVALID_JOB_DATA');
    logger.error({
      err: serr(validationError),
      jobId: job.id,
      jobName: job.name,
      validation: error.errors
    }, 'Job data validation failed');
    
    await job.moveToFailed(validationError, false); // no retry
    throw validationError;
  }
  
  if (error?.message === 'MISSING_MERCHANT_ID') {
    logger.error({
      err: serr(error),
      jobId: job.id,
      jobName: job.name,
      merchantId: null
    }, 'Merchant isolation failed - missing ID');
    
    await job.moveToFailed(error, false); // no retry
    throw error;
  }
  
  logger.error({
    err: serr(error),
    jobId: job.id,
    jobName: job.name,
    merchantId: job.data?.merchantId
  }, 'Job execution failed');
  
  throw error;
}