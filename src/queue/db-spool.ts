/**
 * Database Job Spool - Redis Fallback System
 * When Redis is rate limited or unavailable, jobs are stored in PostgreSQL
 */

import type { StatsRow } from '../types/database-rows.js';
import type { Sql } from '../types/sql.js';
import { getDatabase } from '../db/adapter.js';
import { getLogger } from '../services/logger.js';
// Removed unused import: withDbTenant

export interface SpooledJob {
  id: string;
  jobId: string;
  jobType: string;
  jobData: any;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  merchantId: string;
  scheduledAt: Date;
  createdAt: Date;
  processedAt?: Date;
}

export interface SpoolJobRequest {
  jobId: string;
  jobType: string;
  jobData: any;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  merchantId: string;
  scheduledAt?: Date;
}

export class DatabaseJobSpool {
  private sql: Sql | null = null;
  private logger = getLogger({ component: 'DatabaseJobSpool' });
  private metrics = {
    jobsProcessed: 0,
    jobsFailed: 0,
    avgProcessingTime: 0,
    lastProcessedAt: null as Date | null
  };

  constructor() {
    // تأخير تهيئة SQL حتى أول استخدام
  }

  /**
   * Get SQL connection - initialize lazily
   */
  private getSQL(): Sql {
    if (!this.sql) {
      this.sql = getDatabase().getSQL();
    }
    return this.sql;
  }

  /**
   * Record job processing metrics
   */
  async recordJobMetrics(startTime: number, success: boolean): Promise<void> {
    const processingTime = Date.now() - startTime;
    this.metrics.jobsProcessed++;
    if (!success) this.metrics.jobsFailed++;
    this.metrics.avgProcessingTime = (this.metrics.avgProcessingTime + processingTime) / 2;
    this.metrics.lastProcessedAt = new Date();
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Add job to database spool when Redis is unavailable
   */
  async spoolJob(request: SpoolJobRequest): Promise<SpooledJob> {
    const startTime = Date.now();
    let success = false;
    
    try {
      const sql = this.getSQL();
      const result = await sql`
        INSERT INTO job_spool (
          job_id, job_type, job_data, priority, merchant_id, scheduled_at
        ) VALUES (
          ${request.jobId},
          ${request.jobType},
          ${JSON.stringify(request.jobData)},
          ${request.priority || 'NORMAL'},
          ${request.merchantId},
          ${request.scheduledAt || new Date()}
        )
        ON CONFLICT (job_id) DO UPDATE SET
          job_data = EXCLUDED.job_data,
          priority = EXCLUDED.priority,
          scheduled_at = EXCLUDED.scheduled_at
        RETURNING *
      `;

      const row = result[0];
      success = true;
      
      this.logger.info('Job spooled to database', {
        jobId: request.jobId,
        jobType: request.jobType,
        merchantId: request.merchantId,
        priority: request.priority
      });

      return this.mapSpooledJob(row);
    } finally {
      await this.recordJobMetrics(startTime, success);
    }
  }

  /**
   * Get next jobs to process from spool (FIFO with priority)
   */
  async getNextJobs(limit: number = 10): Promise<SpooledJob[]> {
    const sql = this.getSQL();
    // Use admin mode to see all merchant jobs
    await sql`SELECT set_config('app.admin_mode', 'true', true)`;
    
    try {
      const result = await sql`
        UPDATE job_spool 
        SET processed_at = NOW()
        WHERE id = ANY(
          SELECT id FROM job_spool 
          WHERE processed_at IS NULL 
          AND scheduled_at <= NOW()
          ORDER BY 
            CASE priority
              WHEN 'CRITICAL' THEN 1
              WHEN 'HIGH' THEN 2  
              WHEN 'NORMAL' THEN 3
              WHEN 'LOW' THEN 4
            END,
            created_at ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *
      `;

      const jobs = result.map(row => this.mapSpooledJob(row));
      
      if (jobs.length > 0) {
        this.logger.info('Retrieved jobs from database spool', {
          count: jobs.length,
          jobIds: jobs.map(j => j.jobId)
        });
      }

      return jobs;
    } finally {
      await sql`SELECT set_config('app.admin_mode', 'false', true)`.catch(() => {});
    }
  }

  /**
   * Get spool statistics
   */
  async getSpoolStats(): Promise<{
    total: number;
    pending: number;
    processed: number;
    byPriority: Record<string, number>;
    byType: Record<string, number>;
  }> {
    const sql = this.getSQL();
    await sql`SELECT set_config('app.admin_mode', 'true', true)`;
    
    try {
      const [totalResult, priorityResult, typeResult] = await Promise.all([
        sql`
          SELECT 
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE processed_at IS NULL) as pending,
            COUNT(*) FILTER (WHERE processed_at IS NOT NULL) as processed
          FROM job_spool
        `,
        sql`
          SELECT priority, COUNT(*) as count
          FROM job_spool 
          WHERE processed_at IS NULL
          GROUP BY priority
        `,
        sql`
          SELECT job_type, COUNT(*) as count
          FROM job_spool 
          WHERE processed_at IS NULL
          GROUP BY job_type
        `
      ]);

      const totalRow = totalResult[0] as unknown as StatsRow | undefined;
      const stats = {
        total: totalRow?.total ?? 0,
        pending: totalRow?.pending ?? 0, 
        processed: totalRow?.processed ?? 0,
        byPriority: {} as Record<string, number>,
        byType: {} as Record<string, number>
      };

      priorityResult.forEach((row: any) => {
        stats.byPriority[row.priority] = parseInt(row.count);
      });

      typeResult.forEach((row: any) => {
        stats.byType[row.job_type] = parseInt(row.count);
      });

      return stats;
    } finally {
      await sql`SELECT set_config('app.admin_mode', 'false', true)`.catch(() => {});
    }
  }

  /**
   * Clean up old processed jobs
   */
  async cleanupProcessedJobs(olderThanHours: number = 24): Promise<number> {
    const sql = this.getSQL();
    await sql`SELECT set_config('app.admin_mode', 'true', true)`;
    
    try {
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - olderThanHours);
      
      const result = await sql`
        DELETE FROM job_spool 
        WHERE processed_at IS NOT NULL 
        AND processed_at < ${cutoffTime}
      `;

      const deletedCount = (result as any).count || 0;
      
      if (deletedCount > 0) {
        this.logger.info('Cleaned up processed spool jobs', {
          deletedCount,
          olderThanHours
        });
      }

      return deletedCount;
    } finally {
      await sql`SELECT set_config('app.admin_mode', 'false', true)`.catch(() => {});
    }
  }

  /**
   * Remove specific job from spool (when successfully processed)
   */
  async removeJob(jobId: string, merchantId: string): Promise<boolean> {
    const sql = this.getSQL();
    const result = await sql`
      DELETE FROM job_spool 
      WHERE job_id = ${jobId} 
      AND merchant_id = ${merchantId}
    `;

    return ((result as any).count || 0) > 0;
  }

  /**
   * Check if Redis fallback mode should be activated
   */
  async shouldActivateFallback(): Promise<boolean> {
    const stats = await this.getSpoolStats();
    
    // If we have many pending jobs in spool, Redis might be down
    // This indicates we're already in fallback mode
    return stats.pending > 50;
  }

  private mapSpooledJob(row: any): SpooledJob {
    let jobData: any;
    try {
      if (typeof row.job_data === 'string') {
        if (!row.job_data.trim()) {
          throw new Error('Empty job_data string');
        }
        jobData = JSON.parse(row.job_data);
      } else {
        jobData = row.job_data;
      }
      
      // Additional validation for webhook jobs
      if (row.job_type === 'WEBHOOK_PROCESSING' && jobData) {
        if (!jobData.payload) {
          this.logger.error('Webhook job missing payload', {
            jobId: row.job_id,
            jobDataKeys: Object.keys(jobData),
            jobDataType: typeof jobData,
            rawJobData: typeof row.job_data === 'string' ? row.job_data.substring(0, 200) : row.job_data
          });
        }
      }
    } catch (error) {
      this.logger.error('Failed to parse spooled job data', {
        jobId: row.job_id,
        jobType: row.job_type,
        error: error instanceof Error ? error.message : String(error),
        rawJobData: typeof row.job_data === 'string' ? row.job_data.substring(0, 500) : row.job_data,
        jobDataType: typeof row.job_data
      });
      jobData = null; // Use null instead of {} to clearly indicate parsing failure
    }

    const result: SpooledJob = {
      id: row.id,
      jobId: row.job_id,
      jobType: row.job_type,
      jobData,
      priority: row.priority,
      merchantId: row.merchant_id,
      scheduledAt: new Date(row.scheduled_at),
      createdAt: new Date(row.created_at)
    };
    
    if (row.processed_at) {
      result.processedAt = new Date(row.processed_at);
    }
    
    return result;
  }
}

// Singleton instance
let spoolInstance: DatabaseJobSpool | null = null;

export function getDatabaseJobSpool(): DatabaseJobSpool {
  if (!spoolInstance) {
    spoolInstance = new DatabaseJobSpool();
  }
  return spoolInstance;
}