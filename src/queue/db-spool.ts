/**
 * Database Job Spool - Redis Fallback System
 * When Redis is rate limited or unavailable, jobs are stored in PostgreSQL
 */

import type { Sql } from 'postgres';
import { getDatabase } from '../database/connection.js';
import { getLogger } from '../services/logger.js';
import { withDbTenant } from '../isolation/context.js';

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
  private sql: Sql;
  private logger = getLogger({ component: 'DatabaseJobSpool' });

  constructor() {
    this.sql = getDatabase().getSQL();
  }

  /**
   * Add job to database spool when Redis is unavailable
   */
  async spoolJob(request: SpoolJobRequest): Promise<SpooledJob> {
    const result = await this.sql`
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
    this.logger.info('Job spooled to database', {
      jobId: request.jobId,
      jobType: request.jobType,
      merchantId: request.merchantId,
      priority: request.priority
    });

    return this.mapSpooledJob(row);
  }

  /**
   * Get next jobs to process from spool (FIFO with priority)
   */
  async getNextJobs(limit: number = 10): Promise<SpooledJob[]> {
    // Use admin mode to see all merchant jobs
    await this.sql`SELECT set_config('app.admin_mode', 'true', true)`;
    
    try {
      const result = await this.sql`
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
      await this.sql`SELECT set_config('app.admin_mode', 'false', true)`.catch(() => {});
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
    await this.sql`SELECT set_config('app.admin_mode', 'true', true)`;
    
    try {
      const [totalResult, priorityResult, typeResult] = await Promise.all([
        this.sql`
          SELECT 
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE processed_at IS NULL) as pending,
            COUNT(*) FILTER (WHERE processed_at IS NOT NULL) as processed
          FROM job_spool
        `,
        this.sql`
          SELECT priority, COUNT(*) as count
          FROM job_spool 
          WHERE processed_at IS NULL
          GROUP BY priority
        `,
        this.sql`
          SELECT job_type, COUNT(*) as count
          FROM job_spool 
          WHERE processed_at IS NULL
          GROUP BY job_type
        `
      ]);

      const stats = {
        total: parseInt(totalResult[0]?.total || '0'),
        pending: parseInt(totalResult[0]?.pending || '0'),
        processed: parseInt(totalResult[0]?.processed || '0'),
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
      await this.sql`SELECT set_config('app.admin_mode', 'false', true)`.catch(() => {});
    }
  }

  /**
   * Clean up old processed jobs
   */
  async cleanupProcessedJobs(olderThanHours: number = 24): Promise<number> {
    await this.sql`SELECT set_config('app.admin_mode', 'true', true)`;
    
    try {
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - olderThanHours);
      
      const result = await this.sql`
        DELETE FROM job_spool 
        WHERE processed_at IS NOT NULL 
        AND processed_at < ${cutoffTime}
      `;

      const deletedCount = result.count || 0;
      
      if (deletedCount > 0) {
        this.logger.info('Cleaned up processed spool jobs', {
          deletedCount,
          olderThanHours
        });
      }

      return deletedCount;
    } finally {
      await this.sql`SELECT set_config('app.admin_mode', 'false', true)`.catch(() => {});
    }
  }

  /**
   * Remove specific job from spool (when successfully processed)
   */
  async removeJob(jobId: string, merchantId: string): Promise<boolean> {
    const result = await this.sql`
      DELETE FROM job_spool 
      WHERE job_id = ${jobId} 
      AND merchant_id = ${merchantId}
    `;

    return (result.count || 0) > 0;
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
      jobData = typeof row.job_data === 'string' ? 
        JSON.parse(row.job_data) : row.job_data;
    } catch {
      jobData = {};
      this.logger.warn('Invalid JSON in spooled job data', { 
        jobId: row.job_id 
      });
    }

    return {
      id: row.id,
      jobId: row.job_id,
      jobType: row.job_type,
      jobData,
      priority: row.priority,
      merchantId: row.merchant_id,
      scheduledAt: new Date(row.scheduled_at),
      createdAt: new Date(row.created_at),
      processedAt: row.processed_at ? new Date(row.processed_at) : undefined
    };
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