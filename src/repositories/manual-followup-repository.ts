/**
 * ===============================================
 * Manual Followup Repository
 * Handles database operations for manual followup queue
 * ===============================================
 */

import { getDatabase } from '../db/adapter.js';
import type { ManualFollowupRow } from '../types/database-rows.js';

export interface CreateManualFollowupParams {
  merchantId: string;
  customerId: string;
  conversationId?: string;
  originalMessage: string;
  reason: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  scheduledFor?: Date;
  notes?: string;
}

export interface UpdateManualFollowupParams {
  id: string;
  status?: 'pending' | 'processing' | 'completed' | 'cancelled';
  assignedTo?: string;
  notes?: string;
  scheduledFor?: Date;
}

export interface ManualFollowupFilters {
  merchantId?: string;
  status?: 'pending' | 'processing' | 'completed' | 'cancelled';
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  assignedTo?: string;
  scheduledForBefore?: Date;
  scheduledForAfter?: Date;
}

export class ManualFollowupRepository {
  private db = getDatabase();

  /**
   * Create a new manual followup entry
   */
  async create(params: CreateManualFollowupParams): Promise<ManualFollowupRow> {
    const sql = this.db.getSQL();
    
    const [result] = await sql`
      INSERT INTO manual_followup_queue (
        merchant_id,
        customer_id,
        conversation_id,
        original_message,
        reason,
        priority,
        scheduled_for,
        notes
      ) VALUES (
        ${params.merchantId}::uuid,
        ${params.customerId},
        ${params.conversationId ? params.conversationId + '::uuid' : null},
        ${params.originalMessage},
        ${params.reason},
        ${params.priority ? params.priority.toLowerCase() : 'normal'},
        ${params.scheduledFor || new Date()},
        ${params.notes || null}
      )
      RETURNING *
    `;

    return result as ManualFollowupRow;
  }

  /**
   * Get manual followup by ID
   */
  async getById(id: string): Promise<ManualFollowupRow | null> {
    const sql = this.db.getSQL();
    
    const [result] = await sql`
      SELECT * FROM manual_followup_queue 
      WHERE id = ${id}::uuid
    `;

    return result as ManualFollowupRow || null;
  }

  /**
   * Update manual followup entry
   */
  async update(params: UpdateManualFollowupParams): Promise<ManualFollowupRow | null> {
    const sql = this.db.getSQL();
    
    const updateFields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (params.status !== undefined) {
      updateFields.push(`status = $${paramIndex++}`);
      values.push(params.status);
    }

    if (params.assignedTo !== undefined) {
      updateFields.push(`assigned_to = $${paramIndex++}`);
      values.push(params.assignedTo);
    }

    if (params.notes !== undefined) {
      updateFields.push(`notes = $${paramIndex++}`);
      values.push(params.notes);
    }

    if (params.scheduledFor !== undefined) {
      updateFields.push(`scheduled_for = $${paramIndex++}`);
      values.push(params.scheduledFor);
    }

    if (updateFields.length === 0) {
      return this.getById(params.id);
    }

    const [result] = await sql`
      UPDATE manual_followup_queue 
      SET ${sql.unsafe(updateFields.join(', '))}
      WHERE id = ${params.id}::uuid
      RETURNING *
    `;

    return result as ManualFollowupRow || null;
  }

  /**
   * Get manual followups with filters
   */
  async find(filters: ManualFollowupFilters = {}, limit = 100, offset = 0): Promise<ManualFollowupRow[]> {
    const sql = this.db.getSQL();
    
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (filters.merchantId) {
      conditions.push(`merchant_id = $${paramIndex++}`);
      values.push(filters.merchantId);
    }

    if (filters.status) {
      conditions.push(`status = $${paramIndex++}`);
      values.push(filters.status);
    }

    if (filters.priority) {
      conditions.push(`priority = $${paramIndex++}`);
      values.push(filters.priority);
    }

    if (filters.assignedTo) {
      conditions.push(`assigned_to = $${paramIndex++}`);
      values.push(filters.assignedTo);
    }

    if (filters.scheduledForBefore) {
      conditions.push(`scheduled_for <= $${paramIndex++}`);
      values.push(filters.scheduledForBefore);
    }

    if (filters.scheduledForAfter) {
      conditions.push(`scheduled_for >= $${paramIndex++}`);
      values.push(filters.scheduledForAfter);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const results = await sql`
      SELECT * FROM manual_followup_queue 
      ${sql.unsafe(whereClause)}
      ORDER BY priority DESC, scheduled_for ASC
      LIMIT ${limit} OFFSET ${offset}
    `;

    return results as ManualFollowupRow[];
  }

  /**
   * Get pending followups for a merchant
   */
  async getPendingForMerchant(merchantId: string, limit = 50): Promise<ManualFollowupRow[]> {
    return this.find({ merchantId, status: 'pending' }, limit);
  }

  /**
   * Get urgent followups for a merchant
   */
  async getUrgentForMerchant(merchantId: string, limit = 20): Promise<ManualFollowupRow[]> {
    return this.find({ merchantId, priority: 'urgent' }, limit);
  }

  /**
   * Get overdue followups (scheduled_for < now)
   */
  async getOverdue(merchantId?: string, limit = 50): Promise<ManualFollowupRow[]> {
    const sql = this.db.getSQL();
    
    const conditions: string[] = ['scheduled_for < NOW()', 'status = \'PENDING\''];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (merchantId) {
      conditions.push(`merchant_id = $${paramIndex++}`);
      values.push(merchantId);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const results = await sql`
      SELECT * FROM manual_followup_queue 
      ${sql.unsafe(whereClause)}
      ORDER BY scheduled_for ASC
      LIMIT ${limit}
    `;

    return results as ManualFollowupRow[];
  }

  /**
   * Assign followup to staff member
   */
  async assign(id: string, assignedTo: string): Promise<ManualFollowupRow | null> {
    return this.update({ id, status: 'processing', assignedTo });
  }

  /**
   * Mark followup as completed
   */
  async complete(id: string, notes?: string): Promise<ManualFollowupRow | null> {
    const updateParams: UpdateManualFollowupParams = { id, status: 'completed' };
    if (notes !== undefined) {
      updateParams.notes = notes;
    }
    return this.update(updateParams);
  }

  /**
   * Cancel followup
   */
  async cancel(id: string, notes?: string): Promise<ManualFollowupRow | null> {
    const updateParams: UpdateManualFollowupParams = { id, status: 'cancelled' };
    if (notes !== undefined) {
      updateParams.notes = notes;
    }
    return this.update(updateParams);
  }

  /**
   * Get followup statistics for a merchant
   */
  async getStats(merchantId: string): Promise<{
    total: number;
    pending: number;
    assigned: number;
    completed: number;
    cancelled: number;
    urgent: number;
    overdue: number;
  }> {
    const sql = this.db.getSQL();
    
    const [stats] = await sql`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'processing') as assigned,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
        COUNT(*) FILTER (WHERE priority = 'urgent') as urgent,
        COUNT(*) FILTER (WHERE scheduled_for < NOW() AND status = 'pending') as overdue
      FROM manual_followup_queue 
      WHERE merchant_id = ${merchantId}::uuid
    `;

    if (!stats) {
      return {
        total: 0,
        pending: 0,
        assigned: 0,
        completed: 0,
        cancelled: 0,
        urgent: 0,
        overdue: 0
      };
    }

    return {
      total: Number(stats.total),
      pending: Number(stats.pending),
      assigned: Number(stats.assigned),
      completed: Number(stats.completed),
      cancelled: Number(stats.cancelled),
      urgent: Number(stats.urgent),
      overdue: Number(stats.overdue)
    };
  }

  /**
   * Delete followup entry
   */
  async delete(id: string): Promise<boolean> {
    const sql = this.db.getSQL();
    
    const [result] = await sql`
      DELETE FROM manual_followup_queue 
      WHERE id = ${id}::uuid
      RETURNING id
    `;

    return !!result;
  }

  /**
   * Bulk delete completed followups older than specified date
   */
  async deleteOldCompleted(olderThan: Date): Promise<number> {
    const sql = this.db.getSQL();
    
    const [result] = await sql`
      DELETE FROM manual_followup_queue 
      WHERE status = 'completed' 
        AND completed_at < ${olderThan}
      RETURNING COUNT(*) as deleted_count
    `;

    return result ? Number(result.deleted_count) : 0;
  }
}

// Singleton instance
let manualFollowupRepositoryInstance: ManualFollowupRepository | null = null;

/**
 * Get manual followup repository instance
 */
export function getManualFollowupRepository(): ManualFollowupRepository {
  if (!manualFollowupRepositoryInstance) {
    manualFollowupRepositoryInstance = new ManualFollowupRepository();
  }
  return manualFollowupRepositoryInstance;
}

export default ManualFollowupRepository;
