/**
 * ===============================================
 * Enhanced Queue with DLQ & Idempotency (2025 Standards)
 * ✅ Dead Letter Queue + Idempotency Keys + Circuit Breaker
 * ===============================================
 */

import { getDatabase } from '../database/connection.js';
import { createHash } from 'crypto';
import { getLogger } from '../services/logger.js';
import { pushDLQ } from './dead-letter.js';

export interface EnhancedQueueJob {
  id: string;
  type: string;
  payload: Record<string, any>;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'DLQ';
  attempts: number;
  maxAttempts: number;
  idempotencyKey: string;
  scheduledAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  dlqAt?: Date;
  lastError?: string;
  errorHistory: string[];
  result?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface DLQEntry {
  id: string;
  originalJobId: string;
  jobType: string;
  payload: Record<string, any>;
  lastError: string;
  errorHistory: string[];
  attempts: number;
  failedAt: Date;
  requiresManualReview: boolean;
  reviewed: boolean;
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNotes?: string;
  createdAt: Date;
}

export interface CreateEnhancedJobRequest {
  type: string;
  payload: Record<string, any>;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  maxAttempts?: number;
  scheduledAt?: Date;
  idempotencyKey?: string;
}

export interface JobProcessorEnhanced {
  process(job: EnhancedQueueJob): Promise<{
    success: boolean;
    result?: any;
    error?: string;
    retry?: boolean;
    dlq?: boolean;
  }>;
}

export class EnhancedQueue {
  private db = getDatabase();
  private processors = new Map<string, JobProcessorEnhanced>();
  private isProcessing = false;
  private processingInterval?: NodeJS.Timeout;
  private circuitBreakerStates = new Map<string, {
    failures: number;
    lastFailure: Date;
    isOpen: boolean;
  }>();
  private logger = getLogger({ component: 'EnhancedQueue' });

  /**
   * Add job with idempotency check
   */
  async addJob(request: CreateEnhancedJobRequest): Promise<EnhancedQueueJob | null> {
    const sql = this.db.getSQL();
    
    // Generate idempotency key if not provided
    const idempotencyKey = request.idempotencyKey || this.generateIdempotencyKey(request);
    
    try {
      // Check for duplicate idempotency key
      const [existing] = await sql`
        SELECT * FROM queue_jobs_enhanced 
        WHERE idempotency_key = ${idempotencyKey}
        AND created_at > NOW() - INTERVAL '24 hours'
      `;

      if (existing) {
        this.logger.info('Duplicate job detected', { existingJobId: existing.id });
        return this.mapToEnhancedJob(existing);
      }

      // Create new job
      const [job] = await sql`
        INSERT INTO queue_jobs_enhanced (
          type,
          payload,
          priority,
          max_attempts,
          scheduled_at,
          idempotency_key,
          error_history
        ) VALUES (
          ${request.type},
          ${JSON.stringify(request.payload)},
          ${request.priority || 'NORMAL'},
          ${request.maxAttempts || 3},
          ${request.scheduledAt || new Date()},
          ${idempotencyKey},
          ${JSON.stringify([])}
        )
        RETURNING *
      `;

      this.logger.info('Enhanced job added', { type: job.type, jobId: job.id, idempotencyKey });
      return this.mapToEnhancedJob(job);
      
    } catch (error: any) {
      if (error.code === '23505') { // Unique constraint violation
        this.logger.warn('Idempotency collision detected', { idempotencyKey });
        return null;
      }
      throw error;
    }
  }

  /**
   * Process next job with circuit breaker
   */
  async processNextJob(): Promise<boolean> {
    const sql = this.db.getSQL();

    // Get next job with priority ordering
    const [job] = await sql`
      SELECT * FROM queue_jobs_enhanced
      WHERE status = 'PENDING'
      AND scheduled_at <= NOW()
      ORDER BY 
        CASE priority 
          WHEN 'CRITICAL' THEN 1
          WHEN 'HIGH' THEN 2  
          WHEN 'NORMAL' THEN 3
          WHEN 'LOW' THEN 4
        END,
        created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `;

    if (!job) {
      return false; // No jobs to process
    }

    const enhancedJob = this.mapToEnhancedJob(job);
    if (enhancedJob.payload === null) {
      await this.failJob(enhancedJob, 'Invalid JSON payload');
      return true;
    }

    // Check circuit breaker
    if (this.isCircuitBreakerOpen(enhancedJob.type)) {
      this.logger.warn('Circuit breaker open, skipping job', { type: enhancedJob.type });
      return false;
    }

    // Mark as processing
    await sql`
      UPDATE queue_jobs_enhanced 
      SET 
        status = 'PROCESSING',
        started_at = NOW(),
        attempts = attempts + 1,
        updated_at = NOW()
      WHERE id = ${enhancedJob.id}
    `;

    // Process job
    const processor = this.processors.get(enhancedJob.type);
    if (!processor) {
      await this.failJob(enhancedJob, `No processor registered for type: ${enhancedJob.type}`);
      return true;
    }

    try {
      const startTime = Date.now();
      const result = await processor.process(enhancedJob);
      const processingTime = Date.now() - startTime;

      if (result.success) {
        await this.completeJob(enhancedJob, result.result, processingTime);
        this.resetCircuitBreaker(enhancedJob.type);
      } else {
        await this.handleJobFailure(enhancedJob, result.error || 'Unknown error', result);
      }

      return true;
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : 'Processing failed';
      await this.handleJobFailure(enhancedJob, errorMessage, { retry: true });
      return true;
    }
  }

  /**
   * Handle job failure with DLQ logic
   */
  private async handleJobFailure(
    job: EnhancedQueueJob, 
    error: string, 
    result?: { retry?: boolean; dlq?: boolean }
  ): Promise<void> {
    const sql = this.db.getSQL();

    // Update error history
    const errorHistory = [...job.errorHistory, `${new Date().toISOString()}: ${error}`];

    // Determine next action
    const shouldRetry = result?.retry !== false && job.attempts < job.maxAttempts;
    const forceDLQ = result?.dlq === true;

    if (shouldRetry && !forceDLQ) {
      // Retry job with exponential backoff
      const delayMs = Math.min(1000 * Math.pow(2, job.attempts), 30000);
      const nextAttempt = new Date(Date.now() + delayMs);

      await sql`
        UPDATE queue_jobs_enhanced 
        SET 
          status = 'PENDING',
          scheduled_at = ${nextAttempt},
          last_error = ${error},
          error_history = ${JSON.stringify(errorHistory)},
          updated_at = NOW()
        WHERE id = ${job.id}
      `;

      this.logger.warn('Job retry scheduled', { jobId: job.id, attempt: job.attempts + 1, maxAttempts: job.maxAttempts });
    } else {
      // Send to DLQ
      await this.sendToDLQ(job, error, errorHistory);
    }

    // Update circuit breaker
    this.recordCircuitBreakerFailure(job.type);
  }

  /**
   * Send job to Dead Letter Queue
   */
  private async sendToDLQ(job: EnhancedQueueJob, lastError: string, errorHistory: string[]): Promise<void> {
    const sql = this.db.getSQL();

    await sql.begin(async (transaction) => {
      // Mark original job as DLQ
      await transaction`
        UPDATE queue_jobs_enhanced 
        SET 
          status = 'DLQ',
          dlq_at = NOW(),
          last_error = ${lastError},
          error_history = ${JSON.stringify(errorHistory)},
          updated_at = NOW()
        WHERE id = ${job.id}
      `;

      // Create DLQ entry
      await transaction`
        INSERT INTO job_dlq (
          original_job_id,
          job_type,
          payload,
          last_error,
          error_history,
          attempts,
          failed_at,
          requires_manual_review
        ) VALUES (
          ${job.id},
          ${job.type},
          ${JSON.stringify(job.payload)},
          ${lastError},
          ${JSON.stringify(errorHistory)},
          ${job.attempts},
          NOW(),
          ${this.requiresManualReview(job, lastError)}
        )
      `;
    });

    this.logger.error('Job sent to DLQ', { jobId: job.id, error: lastError });
  }

  /**
   * Complete job successfully
   */
  private async completeJob(job: EnhancedQueueJob, result: any, processingTimeMs: number): Promise<void> {
    const sql = this.db.getSQL();

    await sql`
      UPDATE queue_jobs_enhanced 
      SET 
        status = 'COMPLETED',
        completed_at = NOW(),
        result = ${JSON.stringify(result || {})},
        updated_at = NOW()
      WHERE id = ${job.id}
    `;

    this.logger.info('Job completed', { jobId: job.id, processingTimeMs });
  }

  /**
   * Fail job permanently
   */
  private async failJob(job: EnhancedQueueJob, error: string): Promise<void> {
    await this.handleJobFailure(job, error, { retry: false, dlq: true });
  }

  /**
   * Generate idempotency key from job data
   */
  private generateIdempotencyKey(request: CreateEnhancedJobRequest): string {
    const data = {
      type: request.type,
      payload: request.payload,
      timestamp: Math.floor(Date.now() / (1000 * 60 * 5)) // 5-minute window
    };
    
    return createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex')
      .substring(0, 32);
  }

  /**
   * Circuit breaker logic
   */
  private isCircuitBreakerOpen(jobType: string): boolean {
    const state = this.circuitBreakerStates.get(jobType);
    if (!state) return false;

    // Reset if enough time has passed
    const now = new Date();
    const timeSinceLastFailure = now.getTime() - state.lastFailure.getTime();
    
    if (timeSinceLastFailure > 60000) { // 1 minute reset
      state.failures = 0;
      state.isOpen = false;
    }

    return state.isOpen;
  }

  private recordCircuitBreakerFailure(jobType: string): void {
    const state = this.circuitBreakerStates.get(jobType) || {
      failures: 0,
      lastFailure: new Date(),
      isOpen: false
    };

    state.failures++;
    state.lastFailure = new Date();
    
    // Open circuit after 5 failures
    if (state.failures >= 5) {
      state.isOpen = true;
      this.logger.warn('Circuit breaker opened', { jobType, failures: state.failures });
    }

    this.circuitBreakerStates.set(jobType, state);
  }

  private resetCircuitBreaker(jobType: string): void {
    const state = this.circuitBreakerStates.get(jobType);
    if (state) {
      state.failures = 0;
      state.isOpen = false;
    }
  }

  /**
   * Check if job requires manual review
   */
  private requiresManualReview(job: EnhancedQueueJob, error: string): boolean {
    // Critical jobs always need manual review
    if (job.priority === 'CRITICAL') return true;
    
    // Check for specific error patterns
    const reviewPatterns = [
      /security/i,
      /authentication/i,
      /authorization/i,
      /payment/i,
      /billing/i,
      /gdpr/i,
      /coppa/i
    ];

    return reviewPatterns.some(pattern => pattern.test(error));
  }

  /**
   * Register job processor
   */
  registerProcessor(type: string, processor: JobProcessorEnhanced): void {
    this.processors.set(type, processor);
    this.logger.info('Enhanced processor registered', { type });
  }

  /**
   * Start queue processing
   */
  startProcessing(intervalMs: number = 3000): void {
    if (this.isProcessing) {
      this.logger.warn('Enhanced queue already processing');
      return;
    }

    this.isProcessing = true;
    this.processingInterval = setInterval(async () => {
      try {
        while (await this.processNextJob()) {
          // Continue processing until no more jobs
        }
      } catch (error: any) {
        this.logger.error('Enhanced queue processing error', error);
      }
    }, intervalMs);

    this.logger.info('Enhanced queue processing started');
  }

  /**
   * Stop queue processing
   */
  stopProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }
    this.isProcessing = false;
    this.logger.info('Enhanced queue processing stopped');
  }

  /**
   * Get DLQ entries for review
   */
  async getDLQEntries(limit: number = 50): Promise<DLQEntry[]> {
    const sql = this.db.getSQL();
    
    const entries = await sql`
      SELECT * FROM job_dlq
      WHERE reviewed = false
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return entries.map(entry => {
      let payload: any;
      try {
        payload = JSON.parse(entry.payload);
      } catch {
        payload = null;
        this.logger.warn('Invalid JSON in DLQ payload', { entryId: entry.id });
      }

      let errorHistory: any[];
      try {
        errorHistory = JSON.parse(entry.error_history);
      } catch {
        errorHistory = [];
        this.logger.warn('Invalid JSON in DLQ error history', { entryId: entry.id });
      }

      return {
        id: entry.id,
        originalJobId: entry.original_job_id,
        jobType: entry.job_type,
        payload,
        lastError: entry.last_error,
        errorHistory,
        attempts: entry.attempts,
        failedAt: new Date(entry.failed_at),
        requiresManualReview: entry.requires_manual_review,
        reviewed: entry.reviewed,
        reviewedBy: entry.reviewed_by,
        reviewedAt: entry.reviewed_at ? new Date(entry.reviewed_at) : undefined,
        reviewNotes: entry.review_notes,
        createdAt: new Date(entry.created_at)
      };
    });
  }

  /**
   * Review DLQ entry
   */
  async reviewDLQEntry(entryId: string, action: 'retry' | 'discard', reviewedBy: string, notes?: string): Promise<void> {
    const sql = this.db.getSQL();

    if (action === 'retry') {
      // Move back to queue
      const [dlqEntry] = await sql`
        SELECT * FROM job_dlq WHERE id = ${entryId}
      `;

      if (dlqEntry) {
        let payload: any;
        try {
          payload = JSON.parse(dlqEntry.payload);
        } catch {
          payload = null;
          this.logger.warn('Invalid JSON in DLQ payload', { entryId });
        }

        if (payload) {
          await this.addJob({
            type: dlqEntry.job_type,
            payload,
            priority: 'NORMAL',
            maxAttempts: 3
          });
        } else {
          pushDLQ({ reason: 'Invalid JSON in DLQ payload during review', payload: { entryId } });
        }
      }
    }

    // Mark as reviewed
    await sql`
      UPDATE job_dlq 
      SET 
        reviewed = true,
        reviewed_by = ${reviewedBy},
        reviewed_at = NOW(),
        review_notes = ${notes || null}
      WHERE id = ${entryId}
    `;

    this.logger.info('DLQ entry reviewed', { entryId, action });
  }

  /**
   * Map database row to enhanced job
   */
  private mapToEnhancedJob(row: any): EnhancedQueueJob {
    let payload: any;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      payload = null;
      this.logger.warn('Invalid JSON in queue payload', { rowId: row.id });
      pushDLQ({ reason: 'Invalid JSON in queue payload', payload: { rowId: row.id } });
    }

    let errorHistory: any[];
    try {
      errorHistory = JSON.parse(row.error_history || '[]');
    } catch {
      errorHistory = [];
      this.logger.warn('Invalid JSON in queue error history', { rowId: row.id });
    }

    let result: any;
    try {
      result = row.result ? JSON.parse(row.result) : undefined;
    } catch {
      result = undefined;
      this.logger.warn('Invalid JSON in queue result', { rowId: row.id });
    }

    return {
      id: row.id,
      type: row.type,
      payload,
      priority: row.priority,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      idempotencyKey: row.idempotency_key,
      scheduledAt: new Date(row.scheduled_at),
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      failedAt: row.failed_at ? new Date(row.failed_at) : undefined,
      dlqAt: row.dlq_at ? new Date(row.dlq_at) : undefined,
      lastError: row.last_error,
      errorHistory,
      result,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}

// Singleton instance
let enhancedQueueInstance: EnhancedQueue | null = null;

/**
 * Get enhanced queue instance
 */
export function getEnhancedQueue(): EnhancedQueue {
  if (!enhancedQueueInstance) {
    enhancedQueueInstance = new EnhancedQueue();
  }
  return enhancedQueueInstance;
}

export default EnhancedQueue;