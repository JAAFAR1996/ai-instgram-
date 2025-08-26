/**
 * ===============================================
 * Message Repository - Data Access Layer
 * Repository pattern implementation for messages
 * ===============================================
 */

import { getDatabase } from '../db/adapter.js';
import type { Sql } from '../types/sql.js';
import type { DatabaseRow } from '../types/db.js';

interface MessageDbRow extends DatabaseRow {
  id: string;
  conversation_id: string;
  direction: 'INCOMING' | 'OUTGOING';
  platform: 'instagram';
  message_type: string;
  content: string;
  media_url: string | null;
  platform_message_id: string | null;
  ai_processed: boolean;
  delivery_status: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  ai_confidence: number | null;
  ai_intent: string | null;
  processing_time_ms: number | null;
  media_metadata: string | null;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

interface CountRow extends DatabaseRow {
  count: string;
  [key: string]: unknown;
}

interface MessageStatsRow extends DatabaseRow {
  total: string;
  incoming: string;
  outgoing: string;
  platform: string | null;
  message_type: string | null;
  delivery_status: string | null;
  avg_processing_time: string;
  avg_ai_confidence: string;
  [key: string]: unknown;
}

interface ConversationHistoryRow extends DatabaseRow {
  id: string;
  conversation_id: string;
  direction: 'INCOMING' | 'OUTGOING';
  platform: 'instagram';
  message_type: string;
  content: string;
  media_url: string | null;
  platform_message_id: string | null;
  ai_processed: boolean;
  delivery_status: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  ai_confidence: number | null;
  ai_intent: string | null;
  processing_time_ms: number | null;
  media_metadata: string | null;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface Message {
  id: string;
  conversationId: string;
  direction: 'INCOMING' | 'OUTGOING';
  platform: 'instagram';
  messageType: string;
  content: string;
  mediaUrl?: string;
  platformMessageId?: string;
  aiProcessed: boolean;
  deliveryStatus: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  aiConfidence?: number;
  aiIntent?: string;
  processingTimeMs?: number;
  mediaMetadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMessageRequest {
  conversationId: string;
  direction: 'INCOMING' | 'OUTGOING';
  platform: 'instagram';
  messageType: string;
  content: string;
  mediaUrl?: string;
  platformMessageId?: string;
  aiProcessed?: boolean;
  deliveryStatus?: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  aiConfidence?: number;
  aiIntent?: string;
  processingTimeMs?: number;
  mediaMetadata?: Record<string, any>;
}

export interface UpdateMessageRequest {
  deliveryStatus?: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  aiProcessed?: boolean;
  aiConfidence?: number;
  aiIntent?: string;
  processingTimeMs?: number;
  platformMessageId?: string;
}

export interface MessageFilters {
  conversationId?: string;
  direction?: 'INCOMING' | 'OUTGOING';
  platform?: 'instagram';
  messageType?: string;
  aiProcessed?: boolean;
  deliveryStatus?: 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  dateFrom?: Date;
  dateTo?: Date;
  contentSearch?: string;
  limit?: number;
  offset?: number;
}

export interface MessageStats {
  total: number;
  incoming: number;
  outgoing: number;
  byPlatform: Record<string, number>;
  byType: Record<string, number>;
  byDeliveryStatus: Record<string, number>;
  avgProcessingTime: number;
  avgAiConfidence: number;
}

export interface ConversationHistory {
  conversationId: string;
  messages: Message[];
  totalCount: number;
  hasMore: boolean;
}

export class MessageRepository {
  private db = getDatabase();

  /**
   * Helper method to safely get first row from SQL result
   */
  private getFirstRow<T>(rows: T[]): T | null {
    return rows.length > 0 ? rows[0]! : null;
  }

  /**
   * Create new message
   */
  async create(data: CreateMessageRequest): Promise<Message> {
    const sql: Sql = this.db.getSQL();
    
    const rows = await sql<MessageDbRow>`
      INSERT INTO message_logs (
        conversation_id,
        direction,
        platform,
        message_type,
        content,
        media_url,
        platform_message_id,
        ai_processed,
        delivery_status,
        ai_confidence,
        ai_intent,
        processing_time_ms,
        media_metadata
      ) VALUES (
        ${data.conversationId}::uuid,
        ${data.direction},
        ${data.platform},
        ${data.messageType},
        ${data.content},
        ${data.mediaUrl || null},
        ${data.platformMessageId || null},
        ${data.aiProcessed || false},
        ${data.deliveryStatus || 'PENDING'},
        ${data.aiConfidence || null},
        ${data.aiIntent || null},
        ${data.processingTimeMs || null},
        ${data.mediaMetadata ? JSON.stringify(data.mediaMetadata) : null}
      )
      RETURNING *
    `;

    const message = this.getFirstRow(rows);
    if (!message) {
      throw new Error('Failed to create message');
    }
    return this.mapToMessage(message);
  }

  /**
   * Find message by ID
   */
  async findById(id: string): Promise<Message | null> {
    const sql: Sql = this.db.getSQL();
    
    const rows = await sql<MessageDbRow>`
      SELECT * FROM message_logs
      WHERE id = ${id}::uuid
    `;

    const message = this.getFirstRow(rows);
    return message ? this.mapToMessage(message) : null;
  }

  /**
   * Update message
   */
  async update(id: string, data: UpdateMessageRequest): Promise<Message | null> {
    const sql: Sql = this.db.getSQL();
    const fields: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (data.deliveryStatus !== undefined) { fields.push(`delivery_status = $${i++}`); params.push(data.deliveryStatus); }
    if (data.aiProcessed     !== undefined) { fields.push(`ai_processed = $${i++}`);     params.push(data.aiProcessed); }
    if (data.aiConfidence    !== undefined) { fields.push(`ai_confidence = $${i++}`);    params.push(data.aiConfidence); }
    if (data.aiIntent        !== undefined) { fields.push(`ai_intent = $${i++}`);        params.push(data.aiIntent); }
    if (data.processingTimeMs!== undefined) { fields.push(`processing_time_ms = $${i++}`); params.push(data.processingTimeMs); }
    if (data.platformMessageId!== undefined){ fields.push(`platform_message_id = $${i++}`); params.push(data.platformMessageId); }
    fields.push(`updated_at = NOW()`);

    if (fields.length === 1) return await this.findById(id);

    const q = `UPDATE message_logs SET ${fields.join(', ')} WHERE id = $${i}::uuid RETURNING *`;
    params.push(id);
    const rows = await sql.unsafe<MessageDbRow>(q, params);
    const row = rows[0];
    return row ? this.mapToMessage(row) : null;
  }

  /**
   * Find messages with filters
   */
  async findMany(filters: MessageFilters = {}): Promise<Message[]> {
    const sql: Sql = this.db.getSQL();
    const where: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (filters.conversationId) { where.push(`conversation_id = $${i++}::uuid`); params.push(filters.conversationId); }
    if (filters.direction)      { where.push(`direction = $${i++}`);             params.push(filters.direction); }
    if (filters.platform)       { where.push(`platform = $${i++}`);              params.push(filters.platform); }
    if (filters.messageType)    { where.push(`message_type = $${i++}`);          params.push(filters.messageType); }
    if (filters.aiProcessed!==undefined){ where.push(`ai_processed = $${i++}`);  params.push(filters.aiProcessed); }
    if (filters.deliveryStatus) { where.push(`delivery_status = $${i++}`);       params.push(filters.deliveryStatus); }
    if (filters.dateFrom)       { where.push(`created_at >= $${i++}`);           params.push(filters.dateFrom); }
    if (filters.dateTo)         { where.push(`created_at <= $${i++}`);           params.push(filters.dateTo); }
    if (filters.contentSearch)  { where.push(`content ILIKE $${i++}`);           params.push(`%${filters.contentSearch}%`); }

    let query = 'SELECT * FROM message_logs';
    if (where.length) query += ' WHERE ' + where.join(' AND ');
    query += ' ORDER BY created_at DESC';
    if (filters.limit)  query += ` LIMIT ${filters.limit}`;
    if (filters.offset) query += ` OFFSET ${filters.offset}`;

    const messages = await sql.unsafe<MessageDbRow>(query, params);
    return messages.map((m: MessageDbRow) => this.mapToMessage(m));
  }

  /**
   * Get conversation history with pagination
   */
  async getConversationHistory(
    conversationId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<ConversationHistory> {
    const sql: Sql = this.db.getSQL();
    
    // Get messages
    const messages = await sql<ConversationHistoryRow>`
      SELECT * FROM message_logs
      WHERE conversation_id = ${conversationId}::uuid
      ORDER BY created_at ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    // Get total count
    const countRows = await sql<CountRow>`
      SELECT COUNT(*) as count FROM message_logs
      WHERE conversation_id = ${conversationId}::uuid
    `;

    const countResult = this.getFirstRow(countRows);
    const totalCount = countResult ? parseInt(countResult.count) : 0;
    const hasMore = offset + messages.length < totalCount;

    return {
      conversationId,
      messages: messages.map((m: ConversationHistoryRow) => this.mapToMessage(m)),
      totalCount,
      hasMore
    };
  }

  /**
   * Get recent messages for AI context
   */
  async getRecentMessagesForContext(
    conversationId: string,
    limit: number = 10
  ): Promise<Message[]> {
    const sql: Sql = this.db.getSQL();
    
    const messages = await sql<MessageDbRow>`
      SELECT * FROM message_logs
      WHERE conversation_id = ${conversationId}::uuid
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return messages.reverse().map(m => this.mapToMessage(m));
  }

  /**
   * Mark message as delivered
   */
  async markAsDelivered(id: string, platformMessageId?: string): Promise<boolean> {
    const updateData: UpdateMessageRequest = { deliveryStatus: 'DELIVERED' };
    if (platformMessageId) {
      updateData.platformMessageId = platformMessageId;
    }
    
    const updated = await this.update(id, updateData);
    return updated !== null;
  }

  /**
   * Mark message as failed
   */
  async markAsFailed(id: string): Promise<boolean> {
    const updated = await this.update(id, { deliveryStatus: 'FAILED' });
    return updated !== null;
  }

  /**
   * Update AI processing results
   */
  async updateAIResults(
    id: string,
    confidence: number,
    intent: string,
    processingTimeMs: number
  ): Promise<boolean> {
    const updated = await this.update(id, {
      aiProcessed: true,
      aiConfidence: confidence,
      aiIntent: intent,
      processingTimeMs
    });
    return updated !== null;
  }

  /**
   * Get message statistics
   */
  async getStats(
    conversationId?: string,
    dateFrom?: Date,
    dateTo?: Date
  ): Promise<MessageStats> {
    const sql: Sql = this.db.getSQL();
    const where: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (conversationId) { where.push(`conversation_id = $${i++}::uuid`); params.push(conversationId); }
    if (dateFrom)       { where.push(`created_at >= $${i++}`);           params.push(dateFrom); }
    if (dateTo)         { where.push(`created_at <= $${i++}`);           params.push(dateTo); }

    let q = `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE direction = 'INCOMING') as incoming,
        COUNT(*) FILTER (WHERE direction = 'OUTGOING') as outgoing,
        platform,
        message_type,
        delivery_status,
        AVG(processing_time_ms) FILTER (WHERE processing_time_ms IS NOT NULL) as avg_processing_time,
        AVG(ai_confidence)      FILTER (WHERE ai_confidence IS NOT NULL)      as avg_ai_confidence
      FROM message_logs`;
    if (where.length) q += ` WHERE ${where.join(' AND ')}`;
    q += ` GROUP BY ROLLUP(platform, message_type, delivery_status)
           ORDER BY platform, message_type, delivery_status`;

    const results = await sql.unsafe<MessageStatsRow>(q, params);
    
    const stats: MessageStats = {
      total: 0,
      incoming: 0,
      outgoing: 0,
      byPlatform: {},
      byType: {},
      byDeliveryStatus: {},
      avgProcessingTime: 0,
      avgAiConfidence: 0
    };

    for (const row of results) {
      if (!row.platform && !row.message_type && !row.delivery_status) {
        // Overall totals
        stats.total = parseInt(row.total);
        stats.incoming = parseInt(row.incoming);
        stats.outgoing = parseInt(row.outgoing);
        stats.avgProcessingTime = parseFloat(row.avg_processing_time) || 0;
        stats.avgAiConfidence = parseFloat(row.avg_ai_confidence) || 0;
      } else if (row.platform && !row.message_type && !row.delivery_status) {
        // Platform totals
        stats.byPlatform[row.platform] = parseInt(row.total);
      } else if (row.platform && row.message_type && !row.delivery_status) {
        // Type totals
        stats.byType[row.message_type] = parseInt(row.total);
      } else if (row.platform && row.message_type && row.delivery_status) {
        // Delivery status totals
        stats.byDeliveryStatus[row.delivery_status] = parseInt(row.total);
      }
    }

    return stats;
  }

  /**
   * Get failed messages for retry
   */
  async getFailedMessages(limit: number = 100): Promise<Message[]> {
    return await this.findMany({
      deliveryStatus: 'FAILED',
      limit
    });
  }

  /**
   * Get pending messages
   */
  async getPendingMessages(limit: number = 100): Promise<Message[]> {
    return await this.findMany({
      deliveryStatus: 'PENDING',
      limit
    });
  }

  /**
   * Delete old messages (cleanup)
   */
  async deleteOldMessages(olderThanDays: number): Promise<number> {
    const sql: Sql = this.db.getSQL();
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    
    const rows = await sql<{ id: string }>`
      DELETE FROM message_logs
      WHERE created_at < ${cutoffDate}
      RETURNING id
    `;
    return rows.length;
  }

  /**
   * Count messages with filters
   */
  async count(filters: MessageFilters = {}): Promise<number> {
    const sql: Sql = this.db.getSQL();
    const where: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (filters.conversationId) { where.push(`conversation_id = $${i++}::uuid`); params.push(filters.conversationId); }
    if (filters.direction)      { where.push(`direction = $${i++}`);             params.push(filters.direction); }
    if (filters.platform)       { where.push(`platform = $${i++}`);              params.push(filters.platform); }
    if (filters.deliveryStatus) { where.push(`delivery_status = $${i++}`);       params.push(filters.deliveryStatus); }
    let q = 'SELECT COUNT(*) as count FROM message_logs';
    if (where.length) q += ' WHERE ' + where.join(' AND ');
    const rows = await sql.unsafe<CountRow>(q, params);
    return rows.length ? parseInt(String(rows[0]?.count ?? 0)) : 0;
  }

  /**
   * Map database row to Message object
   */
  private mapToMessage(row: MessageDbRow | ConversationHistoryRow): Message {
    const message: Message = {
      id: row.id,
      conversationId: row.conversation_id,
      direction: row.direction,
      platform: row.platform,
      messageType: row.message_type,
      content: row.content,
      aiProcessed: row.ai_processed,
      deliveryStatus: row.delivery_status,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
    
    if (row.media_url) message.mediaUrl = row.media_url;
    if (row.platform_message_id) message.platformMessageId = row.platform_message_id;
    if (row.ai_confidence !== null && row.ai_confidence !== undefined) message.aiConfidence = row.ai_confidence;
    if (row.ai_intent) message.aiIntent = row.ai_intent;
    if (row.processing_time_ms !== null && row.processing_time_ms !== undefined) message.processingTimeMs = row.processing_time_ms;
    
    if (row.media_metadata) {
      message.mediaMetadata = typeof row.media_metadata === 'string' 
        ? JSON.parse(row.media_metadata) 
        : row.media_metadata;
    }
    
    return message;
  }
}

// Singleton instance
let messageRepositoryInstance: MessageRepository | null = null;

/**
 * Get message repository instance
 */
export function getMessageRepository(): MessageRepository {
  if (!messageRepositoryInstance) {
    messageRepositoryInstance = new MessageRepository();
  }
  return messageRepositoryInstance;
}