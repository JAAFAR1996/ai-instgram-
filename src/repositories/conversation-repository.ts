/**
 * ===============================================
 * Conversation Repository - Data Access Layer
 * Repository pattern implementation for conversations
 * ===============================================
 */

import { getDatabase } from '../db/adapter.js';
import type { Sql } from 'postgres';

interface ConversationRow {
  id: string;
  merchant_id: string;
  customer_whatsapp: string | null;
  customer_instagram: string | null;
  customer_name: string | null;
  platform: 'instagram';
  conversation_stage: string;
  session_data: string;
  message_count: string;
  last_message_at: string;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

interface ConversationStatsRow {
  total: string;
  active: string;
  platform: string | null;
  conversation_stage: string | null;
  avg_messages: string;
  avg_duration_minutes: string;
}

interface CountRow {
  count: string;
}

export interface Conversation {
  id: string;
  merchantId: string;
  customerWhatsapp?: string;
  customerInstagram?: string;
  customerName?: string;
  platform: 'instagram';
  conversationStage: string;
  sessionData: Record<string, any>;
  messageCount: number;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
  endedAt?: Date;
}

export interface CreateConversationRequest {
  merchantId: string;
  customerWhatsapp?: string;
  customerInstagram?: string;
  customerName?: string;
  platform: 'instagram';
  conversationStage?: string;
  sessionData?: Record<string, any>;
}

export interface UpdateConversationRequest {
  conversationStage?: string;
  sessionData?: Record<string, any>;
  customerName?: string;
  endedAt?: Date;
}

export interface ConversationFilters {
  merchantId?: string;
  platform?: 'instagram';
  conversationStage?: string;
  isActive?: boolean;
  customerQuery?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  offset?: number;
}

export interface ConversationStats {
  total: number;
  active: number;
  byPlatform: Record<string, number>;
  byStage: Record<string, number>;
  avgMessagesPerConversation: number;
  avgDurationMinutes: number;
}

export class ConversationRepository {
  private db = getDatabase();

  /**
   * Create new conversation
   */
  async create(
    data: CreateConversationRequest
  ): Promise<{ conversation: Conversation; isNew: boolean }> {
    const sql: Sql = this.db.getSQL();

    const inserted = await sql<ConversationRow[]>`
      INSERT INTO conversations (
        merchant_id,
        customer_whatsapp,
        customer_instagram,
        customer_name,
        platform,
        conversation_stage,
        session_data,
        last_message_at
      ) VALUES (
        ${data.merchantId}::uuid,
        ${data.customerWhatsapp || null},
        ${data.customerInstagram || null},
        ${data.customerName || null},
        ${data.platform},
        ${data.conversationStage || 'GREETING'},
        ${JSON.stringify(data.sessionData || {})},
        NOW()
      )
      ON CONFLICT (merchant_id, customer_instagram, platform)
      DO NOTHING
      RETURNING *
    `;

    if (inserted.length > 0) {
      return { conversation: this.mapToConversation(inserted[0]), isNew: true };
    }

    const [existing] = await sql<ConversationRow[]>`
      SELECT * FROM conversations
      WHERE merchant_id = ${data.merchantId}::uuid
        AND customer_instagram = ${data.customerInstagram || null}
        AND platform = ${data.platform}
      LIMIT 1
    `;

    return { conversation: this.mapToConversation(existing), isNew: false };
  }

  /**
   * Find conversation by ID
   */
  async findById(id: string): Promise<Conversation | null> {
    const sql: Sql = this.db.getSQL();
    
    const [conversation] = await sql<ConversationRow[]>`
      SELECT * FROM conversations
      WHERE id = ${id}::uuid
    `;

    return conversation ? this.mapToConversation(conversation) : null;
  }

  /**
   * Find active conversation by customer and platform
   */
  async findActiveByCustomer(
    merchantId: string,
    customerIdentifier: string,
    platform: 'whatsapp' | 'instagram'
  ): Promise<Conversation | null> {
    const sql: Sql = this.db.getSQL();
    
    const whereField = platform === 'whatsapp' ? 'customer_whatsapp' : 'customer_instagram';
    
    const [conversation] = await sql<ConversationRow[]>`
      SELECT * FROM conversations
      WHERE merchant_id = ${merchantId}::uuid
      AND ${sql(whereField)} = ${customerIdentifier}
      AND platform = ${platform}
      AND ended_at IS NULL
      ORDER BY last_message_at DESC
      LIMIT 1
    `;

    return conversation ? this.mapToConversation(conversation) : null;
  }

  /**
   * Update conversation
   */
  async update(id: string, data: UpdateConversationRequest): Promise<Conversation | null> {
    const updateFields: string[] = [];
    const updateValues: any[] = [];
    let paramIndex = 1;

    if (data.conversationStage !== undefined) {
      updateFields.push(`conversation_stage = $${paramIndex++}`);
      updateValues.push(data.conversationStage);
    }

    if (data.sessionData !== undefined) {
      updateFields.push(`session_data = $${paramIndex++}`);
      updateValues.push(JSON.stringify(data.sessionData));
    }

    if (data.customerName !== undefined) {
      updateFields.push(`customer_name = $${paramIndex++}`);
      updateValues.push(data.customerName);
    }

    if (data.endedAt !== undefined) {
      updateFields.push(`ended_at = $${paramIndex++}`);
      updateValues.push(data.endedAt);
    }

    updateFields.push(`updated_at = NOW()`);

    if (updateFields.length === 1) { // Only updated_at
      return await this.findById(id);
    }

    const query = `
      UPDATE conversations
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}::uuid
      RETURNING *
    `;

    updateValues.push(id);

    const sql: Sql = this.db.getSQL();
    const rows = await sql.unsafe<ConversationRow[]>(query, updateValues);
    const [conversation] = rows;
    return conversation ? this.mapToConversation(conversation) : null;
  }

  /**
   * Update last message time and increment message count
   */
  async updateLastMessage(id: string, timestamp?: Date): Promise<void> {
    const sql: Sql = this.db.getSQL();
    
    await sql`
      UPDATE conversations
      SET 
        last_message_at = ${timestamp || new Date()},
        message_count = message_count + 1,
        updated_at = NOW()
      WHERE id = ${id}::uuid
    `;
  }

  /**
   * Find conversations with filters
   */
  async findMany(filters: ConversationFilters = {}): Promise<Conversation[]> {
    let whereConditions: string[] = [];
    let params: any[] = [];
    let paramIndex = 1;

    if (filters.merchantId) {
      whereConditions.push(`merchant_id = $${paramIndex++}::uuid`);
      params.push(filters.merchantId);
    }

    if (filters.platform) {
      whereConditions.push(`platform = $${paramIndex++}`);
      params.push(filters.platform);
    }

    if (filters.conversationStage) {
      whereConditions.push(`conversation_stage = $${paramIndex++}`);
      params.push(filters.conversationStage);
    }

    if (filters.isActive !== undefined) {
      if (filters.isActive) {
        whereConditions.push('ended_at IS NULL');
      } else {
        whereConditions.push('ended_at IS NOT NULL');
      }
    }

    if (filters.customerQuery) {
      whereConditions.push(`(customer_name ILIKE $${paramIndex++} OR customer_whatsapp LIKE $${paramIndex++} OR customer_instagram LIKE $${paramIndex++})`);
      const searchQuery = `%${filters.customerQuery}%`;
      params.push(searchQuery, searchQuery, searchQuery);
      paramIndex += 2; // Added 2 more params
    }

    if (filters.dateFrom) {
      whereConditions.push(`created_at >= $${paramIndex++}`);
      params.push(filters.dateFrom);
    }

    if (filters.dateTo) {
      whereConditions.push(`created_at <= $${paramIndex++}`);
      params.push(filters.dateTo);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    const limitClause = filters.limit ? `LIMIT $${paramIndex++}` : '';
    const offsetClause = filters.offset ? `OFFSET $${paramIndex++}` : '';
    
    if (filters.limit) params.push(filters.limit);
    if (filters.offset) params.push(filters.offset);

    const query = `
      SELECT * FROM conversations
      ${whereClause}
      ORDER BY last_message_at DESC
      ${limitClause}
      ${offsetClause}
    `;

    const sql: Sql = this.db.getSQL();
    const conversations = await sql.unsafe<ConversationRow[]>(query, params);
    return conversations.map(c => this.mapToConversation(c));
  }

  /**
   * Get conversation statistics
   */
  async getStats(merchantId?: string, dateFrom?: Date, dateTo?: Date): Promise<ConversationStats> {
    let whereConditions: string[] = [];
    let params: any[] = [];
    let paramIndex = 1;

    if (merchantId) {
      whereConditions.push(`merchant_id = $${paramIndex++}::uuid`);
      params.push(merchantId);
    }

    if (dateFrom) {
      whereConditions.push(`created_at >= $${paramIndex++}`);
      params.push(dateFrom);
    }

    if (dateTo) {
      whereConditions.push(`created_at <= $${paramIndex++}`);
      params.push(dateTo);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const statsQuery = `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE ended_at IS NULL) as active,
        platform,
        conversation_stage,
        AVG(message_count) as avg_messages,
        AVG(EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - created_at)) / 60) as avg_duration_minutes
      FROM conversations
      ${whereClause}
      GROUP BY ROLLUP(platform, conversation_stage)
      ORDER BY platform, conversation_stage
    `;

    const sql: Sql = this.db.getSQL();
    const results = await sql.unsafe<ConversationStatsRow[]>(statsQuery, params);
    
    const stats: ConversationStats = {
      total: 0,
      active: 0,
      byPlatform: {},
      byStage: {},
      avgMessagesPerConversation: 0,
      avgDurationMinutes: 0
    };

    for (const row of results) {
      if (!row.platform && !row.conversation_stage) {
        // Overall totals
        stats.total = parseInt(row.total);
        stats.active = parseInt(row.active);
        stats.avgMessagesPerConversation = parseFloat(row.avg_messages) || 0;
        stats.avgDurationMinutes = parseFloat(row.avg_duration_minutes) || 0;
      } else if (row.platform && !row.conversation_stage) {
        // Platform totals
        stats.byPlatform[row.platform] = parseInt(row.total);
      } else if (row.platform && row.conversation_stage) {
        // Stage totals
        const key = `${row.platform}:${row.conversation_stage}`;
        stats.byStage[key] = parseInt(row.total);
      }
    }

    return stats;
  }

  /**
   * End conversation
   */
  async endConversation(id: string, endTime?: Date): Promise<boolean> {
    const updated = await this.update(id, { endedAt: endTime || new Date() });
    return updated !== null;
  }

  /**
   * Delete conversation (soft delete by ending it)
   */
  async delete(id: string): Promise<boolean> {
    return await this.endConversation(id);
  }

  /**
   * Count conversations with filters
   */
  async count(filters: ConversationFilters = {}): Promise<number> {
    let whereConditions: string[] = [];
    let params: any[] = [];
    let paramIndex = 1;

    if (filters.merchantId) {
      whereConditions.push(`merchant_id = $${paramIndex++}::uuid`);
      params.push(filters.merchantId);
    }

    if (filters.platform) {
      whereConditions.push(`platform = $${paramIndex++}`);
      params.push(filters.platform);
    }

    if (filters.isActive !== undefined) {
      if (filters.isActive) {
        whereConditions.push('ended_at IS NULL');
      } else {
        whereConditions.push('ended_at IS NOT NULL');
      }
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const query = `SELECT COUNT(*) as count FROM conversations ${whereClause}`;
    const sql: Sql = this.db.getSQL();
    const rows = await sql.unsafe<CountRow[]>(query, params);
    const [result] = rows;
    return parseInt(result.count);
  }

  /**
   * Get recent conversations for merchant
   */
  async getRecentConversations(merchantId: string, limit: number = 10): Promise<Conversation[]> {
    return await this.findMany({
      merchantId,
      isActive: true,
      limit,
      offset: 0
    });
  }

  /**
   * Map database row to Conversation object
   */
  private mapToConversation(row: ConversationRow): Conversation {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      customerWhatsapp: row.customer_whatsapp ?? undefined,
      customerInstagram: row.customer_instagram ?? undefined,
      customerName: row.customer_name ?? undefined,
      platform: row.platform,
      conversationStage: row.conversation_stage,
      sessionData: typeof row.session_data === 'string' ? JSON.parse(row.session_data) : row.session_data,
      messageCount: parseInt(row.message_count) || 0,
      lastMessageAt: new Date(row.last_message_at),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      endedAt: row.ended_at ? new Date(row.ended_at) : undefined
    };
  }
}

// Singleton instance
let conversationRepositoryInstance: ConversationRepository | null = null;

/**
 * Get conversation repository instance
 */
export function getConversationRepository(): ConversationRepository {
  if (!conversationRepositoryInstance) {
    conversationRepositoryInstance = new ConversationRepository();
  }
  return conversationRepositoryInstance;
}