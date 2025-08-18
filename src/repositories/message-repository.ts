/**
 * ===============================================
 * Message Repository - Data Access Layer
 * Repository pattern implementation for messages
 * ===============================================
 */

import { getDatabase } from '../database/connection';

export interface Message {
  id: string;
  conversationId: string;
  direction: 'INCOMING' | 'OUTGOING';
  platform: 'whatsapp' | 'instagram';
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
  platform: 'whatsapp' | 'instagram';
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
  platform?: 'whatsapp' | 'instagram';
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
   * Create new message
   */
  async create(data: CreateMessageRequest): Promise<Message> {
    const sql = this.db.getSQL();
    
    const [message] = await sql`
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

    return this.mapToMessage(message);
  }

  /**
   * Find message by ID
   */
  async findById(id: string): Promise<Message | null> {
    const sql = this.db.getSQL();
    
    const [message] = await sql`
      SELECT * FROM message_logs
      WHERE id = ${id}::uuid
    `;

    return message ? this.mapToMessage(message) : null;
  }

  /**
   * Update message
   */
  async update(id: string, data: UpdateMessageRequest): Promise<Message | null> {
    const sql = this.db.getSQL();
    
    const updateFields: string[] = [];
    const updateValues: any[] = [];
    let paramIndex = 1;

    if (data.deliveryStatus !== undefined) {
      updateFields.push(`delivery_status = $${paramIndex++}`);
      updateValues.push(data.deliveryStatus);
    }

    if (data.aiProcessed !== undefined) {
      updateFields.push(`ai_processed = $${paramIndex++}`);
      updateValues.push(data.aiProcessed);
    }

    if (data.aiConfidence !== undefined) {
      updateFields.push(`ai_confidence = $${paramIndex++}`);
      updateValues.push(data.aiConfidence);
    }

    if (data.aiIntent !== undefined) {
      updateFields.push(`ai_intent = $${paramIndex++}`);
      updateValues.push(data.aiIntent);
    }

    if (data.processingTimeMs !== undefined) {
      updateFields.push(`processing_time_ms = $${paramIndex++}`);
      updateValues.push(data.processingTimeMs);
    }

    if (data.platformMessageId !== undefined) {
      updateFields.push(`platform_message_id = $${paramIndex++}`);
      updateValues.push(data.platformMessageId);
    }

    updateFields.push(`updated_at = NOW()`);

    if (updateFields.length === 1) { // Only updated_at
      return await this.findById(id);
    }

    const query = `
      UPDATE message_logs 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}::uuid
      RETURNING *
    `;
    
    updateValues.push(id);
    
    const [message] = await this.db.query(query, updateValues);
    return message ? this.mapToMessage(message) : null;
  }

  /**
   * Find messages with filters
   */
  async findMany(filters: MessageFilters = {}): Promise<Message[]> {
    const sql = this.db.getSQL();
    
    let whereConditions: string[] = [];
    let params: any[] = [];
    let paramIndex = 1;

    if (filters.conversationId) {
      whereConditions.push(`conversation_id = $${paramIndex++}::uuid`);
      params.push(filters.conversationId);
    }

    if (filters.direction) {
      whereConditions.push(`direction = $${paramIndex++}`);
      params.push(filters.direction);
    }

    if (filters.platform) {
      whereConditions.push(`platform = $${paramIndex++}`);
      params.push(filters.platform);
    }

    if (filters.messageType) {
      whereConditions.push(`message_type = $${paramIndex++}`);
      params.push(filters.messageType);
    }

    if (filters.aiProcessed !== undefined) {
      whereConditions.push(`ai_processed = $${paramIndex++}`);
      params.push(filters.aiProcessed);
    }

    if (filters.deliveryStatus) {
      whereConditions.push(`delivery_status = $${paramIndex++}`);
      params.push(filters.deliveryStatus);
    }

    if (filters.dateFrom) {
      whereConditions.push(`created_at >= $${paramIndex++}`);
      params.push(filters.dateFrom);
    }

    if (filters.dateTo) {
      whereConditions.push(`created_at <= $${paramIndex++}`);
      params.push(filters.dateTo);
    }

    if (filters.contentSearch) {
      whereConditions.push(`content ILIKE $${paramIndex++}`);
      params.push(`%${filters.contentSearch}%`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    const limitClause = filters.limit ? `LIMIT $${paramIndex++}` : '';
    const offsetClause = filters.offset ? `OFFSET $${paramIndex++}` : '';
    
    if (filters.limit) params.push(filters.limit);
    if (filters.offset) params.push(filters.offset);

    const query = `
      SELECT * FROM message_logs
      ${whereClause}
      ORDER BY created_at DESC
      ${limitClause}
      ${offsetClause}
    `;

    const messages = await this.db.query(query, params);
    return messages.map(m => this.mapToMessage(m));
  }

  /**
   * Get conversation history with pagination
   */
  async getConversationHistory(
    conversationId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<ConversationHistory> {
    const sql = this.db.getSQL();
    
    // Get messages
    const messages = await sql`
      SELECT * FROM message_logs
      WHERE conversation_id = ${conversationId}::uuid
      ORDER BY created_at ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    // Get total count
    const [countResult] = await sql`
      SELECT COUNT(*) as count FROM message_logs
      WHERE conversation_id = ${conversationId}::uuid
    `;

    const totalCount = parseInt(countResult.count);
    const hasMore = offset + messages.length < totalCount;

    return {
      conversationId,
      messages: messages.map(m => this.mapToMessage(m)),
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
    const sql = this.db.getSQL();
    
    const messages = await sql`
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
    const sql = this.db.getSQL();
    
    let whereConditions: string[] = [];
    let params: any[] = [];
    let paramIndex = 1;

    if (conversationId) {
      whereConditions.push(`conversation_id = $${paramIndex++}::uuid`);
      params.push(conversationId);
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
        COUNT(*) FILTER (WHERE direction = 'INCOMING') as incoming,
        COUNT(*) FILTER (WHERE direction = 'OUTGOING') as outgoing,
        platform,
        message_type,
        delivery_status,
        AVG(processing_time_ms) FILTER (WHERE processing_time_ms IS NOT NULL) as avg_processing_time,
        AVG(ai_confidence) FILTER (WHERE ai_confidence IS NOT NULL) as avg_ai_confidence
      FROM message_logs
      ${whereClause}
      GROUP BY ROLLUP(platform, message_type, delivery_status)
      ORDER BY platform, message_type, delivery_status
    `;

    const results = await this.db.query(statsQuery, params);
    
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
    const sql = this.db.getSQL();
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    
    const result = await sql`
      DELETE FROM message_logs
      WHERE created_at < ${cutoffDate}
    `;

    return result.count || 0;
  }

  /**
   * Count messages with filters
   */
  async count(filters: MessageFilters = {}): Promise<number> {
    const sql = this.db.getSQL();
    
    let whereConditions: string[] = [];
    let params: any[] = [];
    let paramIndex = 1;

    if (filters.conversationId) {
      whereConditions.push(`conversation_id = $${paramIndex++}::uuid`);
      params.push(filters.conversationId);
    }

    if (filters.direction) {
      whereConditions.push(`direction = $${paramIndex++}`);
      params.push(filters.direction);
    }

    if (filters.platform) {
      whereConditions.push(`platform = $${paramIndex++}`);
      params.push(filters.platform);
    }

    if (filters.deliveryStatus) {
      whereConditions.push(`delivery_status = $${paramIndex++}`);
      params.push(filters.deliveryStatus);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
    
    const query = `SELECT COUNT(*) as count FROM message_logs ${whereClause}`;
    const [result] = await this.db.query(query, params);
    
    return parseInt(result.count);
  }

  /**
   * Map database row to Message object
   */
  private mapToMessage(row: any): Message {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      direction: row.direction,
      platform: row.platform,
      messageType: row.message_type,
      content: row.content,
      mediaUrl: row.media_url,
      platformMessageId: row.platform_message_id,
      aiProcessed: row.ai_processed,
      deliveryStatus: row.delivery_status,
      aiConfidence: row.ai_confidence,
      aiIntent: row.ai_intent,
      processingTimeMs: row.processing_time_ms,
      mediaMetadata: row.media_metadata ? 
        (typeof row.media_metadata === 'string' ? JSON.parse(row.media_metadata) : row.media_metadata) 
        : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
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