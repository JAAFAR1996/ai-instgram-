/**
 * ===============================================
 * Message Queue System - Async Processing
 * Background job processing for webhooks and AI
 * ===============================================
 */

import { getDatabase } from '../database/connection.js';
import { getConfig } from '../config/environment.js';
import { getAnalyticsService } from '../services/analytics-service.js';
import { getLogger } from '../services/logger.js';
import { pushDLQ } from './dead-letter.js';
import type { Sql, Fragment } from 'postgres';

export interface QueueJob {
  id: string;
  type: QueueJobType;
  payload: Record<string, any>;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'RETRYING';
  attempts: number;
  maxAttempts: number;
  scheduledAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  error?: string;
  result?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export type QueueJobType = 
  | 'WEBHOOK_PROCESSING'
  | 'AI_RESPONSE_GENERATION'
  | 'MESSAGE_DELIVERY'
  | 'CONVERSATION_CLEANUP'
  | 'ANALYTICS_PROCESSING'
  | 'NOTIFICATION_SEND'
  | 'DATA_EXPORT'
  | 'SYSTEM_MAINTENANCE';

export interface CreateJobRequest {
  type: QueueJobType;
  payload: Record<string, any>;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  maxAttempts?: number;
  scheduledAt?: Date;
}

export interface JobProcessor {
  process(job: QueueJob): Promise<{ success: boolean; result?: any; error?: string }>;
}

export interface QueueStats {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  byType: Record<string, number>;
  byPriority: Record<string, number>;
  avgProcessingTimeMs: number;
}

interface QueueStatsRow {
  total: string;
  pending: string;
  processing: string;
  completed: string;
  failed: string;
  type: string | null;
  priority: string | null;
  avg_processing_time_ms: string;
}

export class MessageQueue {
  private db = getDatabase();
  private config = getConfig();
  private processors = new Map<QueueJobType, JobProcessor>();
  private isProcessing = false;
  private processingInterval?: NodeJS.Timeout;
  private logger = getLogger({ component: 'MessageQueue' });

  constructor() {
    this.setupDefaultProcessors();
  }

  /**
   * Add job to queue
   */
  async addJob(request: CreateJobRequest): Promise<QueueJob> {
    const sql: Sql = this.db.getSQL();
    
    const [job] = await sql`
      INSERT INTO queue_jobs (
        type,
        payload,
        priority,
        max_attempts,
        scheduled_at
      ) VALUES (
        ${request.type},
        ${JSON.stringify(request.payload)},
        ${request.priority || 'NORMAL'},
        ${request.maxAttempts || 3},
        ${request.scheduledAt || new Date()}
      )
      RETURNING *
    `;

    console.log(`📥 Job added to queue: ${job.type} (ID: ${job.id})`);
    return this.mapToQueueJob(job);
  }

  /**
   * Get next job to process
   */
  async getNextJob(): Promise<QueueJob | null> {
    const sql: Sql = this.db.getSQL();
    
    // Get highest priority job that's ready to process
    const [job] = await sql`
      UPDATE queue_jobs
      SET
        status = 'PROCESSING',
        started_at = NOW(),
        updated_at = NOW()
      WHERE id = (
        SELECT id FROM queue_jobs
        WHERE status = 'PENDING'
        AND scheduled_at <= NOW()
        AND attempts < max_attempts
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
      )
      RETURNING *
    `;

    if (!job) {
      return null;
    }

    const mapped = this.mapToQueueJob(job);
    if (mapped.payload === null) {
      pushDLQ({ reason: 'Invalid JSON in queue payload', payload: { jobId: mapped.id } });
      await this.failJob(mapped.id, 'Invalid JSON payload', false);
      return null;
    }

    return mapped;
  }

  /**
   * Mark job as completed
   */
  async completeJob(jobId: string, result?: Record<string, any>): Promise<void> {
    const sql: Sql = this.db.getSQL();
    
    await sql`
      UPDATE queue_jobs
      SET 
        status = 'COMPLETED',
        completed_at = NOW(),
        result = ${result ? JSON.stringify(result) : null},
        updated_at = NOW()
      WHERE id = ${jobId}::uuid
    `;

    console.log(`✅ Job completed: ${jobId}`);
  }

  /**
   * Mark job as failed
   */
  async failJob(jobId: string, error: string, canRetry: boolean = true): Promise<void> {
    const sql: Sql = this.db.getSQL();
    
    if (canRetry) {
      // Check if we should retry
      const [job] = await sql`
        SELECT attempts, max_attempts FROM queue_jobs
        WHERE id = ${jobId}::uuid
      `;

      if (job && job.attempts + 1 < job.max_attempts) {
        // Schedule retry with exponential backoff
        const delayMinutes = Math.pow(2, job.attempts) * 5; // 5, 10, 20 minutes
        const retryAt = new Date();
        retryAt.setMinutes(retryAt.getMinutes() + delayMinutes);

        await sql`
          UPDATE queue_jobs
          SET 
            status = 'RETRYING',
            attempts = attempts + 1,
            scheduled_at = ${retryAt},
            error = ${error},
            updated_at = NOW()
          WHERE id = ${jobId}::uuid
        `;

        console.log(`🔄 Job scheduled for retry: ${jobId} (attempt ${job.attempts + 1})`);
        return;
      }
    }

    // Mark as permanently failed
    await sql`
      UPDATE queue_jobs
      SET 
        status = 'FAILED',
        failed_at = NOW(),
        error = ${error},
        updated_at = NOW()
      WHERE id = ${jobId}::uuid
    `;

    console.log(`❌ Job failed permanently: ${jobId}`);
  }

  /**
   * Register job processor
   */
  registerProcessor(type: QueueJobType, processor: JobProcessor): void {
    this.processors.set(type, processor);
    console.log(`🔧 Processor registered for job type: ${type}`);
  }

  /**
   * Start processing jobs
   */
  startProcessing(intervalMs: number = 5000): void {
    if (this.isProcessing) {
      console.log('⚠️ Queue processing is already running');
      return;
    }

    this.isProcessing = true;
    console.log('🚀 Starting queue processing...');

    this.processingInterval = setInterval(async () => {
      try {
        await this.processNextJob();
      } catch (error) {
        console.error('❌ Queue processing error:', error);
      }
    }, intervalMs);
  }

  /**
   * Stop processing jobs
   */
  stopProcessing(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }
    
    this.isProcessing = false;
    console.log('🛑 Queue processing stopped');
  }

  /**
   * Process next job in queue
   */
  private async processNextJob(): Promise<void> {
    const job = await this.getNextJob();
    
    if (!job) {
      return; // No jobs to process
    }

    const processor = this.processors.get(job.type);
    
    if (!processor) {
      await this.failJob(job.id, `No processor registered for job type: ${job.type}`, false);
      return;
    }

    console.log(`🔄 Processing job: ${job.type} (ID: ${job.id})`);
    const startTime = Date.now();

    try {
      const result = await processor.process(job);
      
      if (result.success) {
        await this.completeJob(job.id, result.result);
        const duration = Date.now() - startTime;
        console.log(`✅ Job processed successfully in ${duration}ms: ${job.id}`);
      } else {
        await this.failJob(job.id, result.error || 'Unknown processing error');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.failJob(job.id, errorMessage);
      console.error(`❌ Job processing failed: ${job.id}`, error);
    }
  }

  /**
   * Get queue statistics
   */
  async getStats(): Promise<QueueStats> {
    const sql: Sql = this.db.getSQL();
    
    const results = await this.db.query<QueueStatsRow>`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'PENDING') as pending,
        COUNT(*) FILTER (WHERE status = 'PROCESSING') as processing,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') as completed,
        COUNT(*) FILTER (WHERE status = 'FAILED') as failed,
        type,
        priority,
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000) FILTER (WHERE status = 'COMPLETED') as avg_processing_time_ms
      FROM queue_jobs
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY ROLLUP(type, priority)
      ORDER BY type, priority
    `;
    
    const stats: QueueStats = {
      total: 0,
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      byType: {},
      byPriority: {},
      avgProcessingTimeMs: 0
    };

    for (const row of results) {
      if (!row.type && !row.priority) {
        // Overall stats
        stats.total = parseInt(row.total);
        stats.pending = parseInt(row.pending);
        stats.processing = parseInt(row.processing);
        stats.completed = parseInt(row.completed);
        stats.failed = parseInt(row.failed);
        stats.avgProcessingTimeMs = parseFloat(row.avg_processing_time_ms) || 0;
      } else if (row.type && !row.priority) {
        // By type
        stats.byType[row.type] = parseInt(row.total);
      } else if (row.type && row.priority) {
        // By priority
        stats.byPriority[row.priority] = parseInt(row.total);
      }
    }

    return stats;
  }

  /**
   * Clean up old completed jobs
   */
  async cleanupOldJobs(olderThanDays: number = 7): Promise<number> {
    const sql: Sql = this.db.getSQL();
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    
    const result = await sql`
      DELETE FROM queue_jobs
      WHERE status IN ('COMPLETED', 'FAILED')
      AND updated_at < ${cutoffDate}
    `;

    const deletedCount = result.count || 0;
    console.log(`🧹 Cleaned up ${deletedCount} old jobs`);
    
    return deletedCount;
  }

  /**
   * Retry failed jobs
   */
  async retryFailedJobs(jobType?: QueueJobType): Promise<number> {
    const sql: Sql = this.db.getSQL();

    const conditions: Fragment[] = [
      sql`status = 'FAILED'`,
      sql`attempts < max_attempts`
    ];

    if (jobType) {
      conditions.push(sql`type = ${jobType}`);
    }

    const result = await sql`
      UPDATE queue_jobs
      SET
        status = 'PENDING',
        scheduled_at = NOW(),
        error = NULL,
        updated_at = NOW()
      WHERE ${(sql as any).join(conditions, sql` AND `)}
    `;
    const retriedCount = result.count || 0;
    
    console.log(`🔄 Retried ${retriedCount} failed jobs`);
    return retriedCount;
  }

  /**
   * Get jobs by status
   */
  async getJobsByStatus(status: QueueJob['status'], limit: number = 100): Promise<QueueJob[]> {
    const sql: Sql = this.db.getSQL();
    
    const jobs = await sql`
      SELECT * FROM queue_jobs
      WHERE status = ${status}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return jobs.map(job => this.mapToQueueJob(job));
  }

  /**
   * Setup default processors for common job types
   */
  private setupDefaultProcessors(): void {
    // System maintenance processor
    this.registerProcessor('SYSTEM_MAINTENANCE', {
      async process(job: QueueJob) {
        console.log(`🔧 Running system maintenance: ${job.payload.type}`);
        
        switch (job.payload.type) {
          case 'cleanup_old_jobs':
            const queue = getMessageQueue();
            const cleaned = await queue.cleanupOldJobs(job.payload.days || 7);
            return { success: true, result: { cleaned } };
            
          default:
            return { success: false, error: `Unknown maintenance type: ${job.payload.type}` };
        }
      }
    });

    // Analytics processing processor
    this.registerProcessor('ANALYTICS_PROCESSING', {
      async process(job: QueueJob) {
        console.log(`📊 Processing analytics: ${job.payload.type}`);

        try {
          const analytics = getAnalyticsService();
          const recordResult = await analytics.recordEvent({
            type: job.payload.type,
            merchantId: job.payload.merchantId,
            data: job.payload.data
          });

          if (!recordResult.success) {
            return { success: false, error: recordResult.error || 'Analytics recording failed' };
          }

          return {
            success: true,
            result: {
              eventType: job.payload.type,
              total: recordResult.total
            }
          };
        } catch (error) {
          console.error('❌ Analytics processing error:', error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown analytics error'
          };
        }
      }
    });
  }

  /**
   * Map database row to QueueJob object
   */
  private mapToQueueJob(row: any): QueueJob {
    let payload: any;
    try {
      payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    } catch {
      payload = null;
      this.logger.warn('Invalid JSON in queue payload', { rowId: row.id });
    }

    let result: any;
    try {
      result = row.result ?
        (typeof row.result === 'string' ? JSON.parse(row.result) : row.result)
        : undefined;
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
      attempts: parseInt(row.attempts) || 0,
      maxAttempts: parseInt(row.max_attempts) || 3,
      scheduledAt: new Date(row.scheduled_at),
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      failedAt: row.failed_at ? new Date(row.failed_at) : undefined,
      error: row.error,
      result,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }
}

// Singleton instance
let messageQueueInstance: MessageQueue | null = null;

/**
 * Get message queue instance
 */
export function getMessageQueue(): MessageQueue {
  if (!messageQueueInstance) {
    messageQueueInstance = new MessageQueue();
  }
  return messageQueueInstance;
}

/**
 * Initialize and start queue processing
 */
export async function initializeMessageQueue(): Promise<MessageQueue> {
  const queue = getMessageQueue();
  
  // Start processing jobs
  queue.startProcessing();
  
  // Schedule cleanup jobs
  await queue.addJob({
    type: 'SYSTEM_MAINTENANCE',
    payload: { type: 'cleanup_old_jobs', days: 7 },
    priority: 'LOW',
    scheduledAt: new Date(Date.now() + 60000) // Start in 1 minute
  });

  console.log('✅ Message queue initialized and started');
  return queue;
}