/**
 * ===============================================
 * Message Repository - Pure SQL with pg.Pool
 * Handles utility message logs and history
 * ===============================================
 */

import { Pool, PoolClient } from 'pg';
import { query } from '../db/index.js';
import { UtilityMessageType } from './template.repo.js';
import * as crypto from 'node:crypto';

export interface MessageLog {
  id: string;
  merchantId: string;
  recipientId: string;
  templateId: string;
  messageId: string;
  messageType: UtilityMessageType;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  sentAt: Date;
  deliveredAt?: Date;
  readAt?: Date;
  errorMessage?: string;
  createdAt: Date;
}

export interface LogUtilityMessageInput {
  merchantId: string;
  recipientId: string;
  templateId: string;
  messageId: string;
  messageType: UtilityMessageType;
  status?: 'sent' | 'delivered' | 'read' | 'failed';
  errorMessage?: string;
}

/**
 * Log a utility message send
 */
export async function logUtilityMessage(
  poolOrClient: Pool | PoolClient,
  input: LogUtilityMessageInput
): Promise<MessageLog> {
  const logId = crypto.randomUUID();
  
  const rows = await query<{
    id: string;
    merchant_id: string;
    recipient_id: string;
    template_id: string;
    message_id: string;
    message_type: string;
    status: string;
    sent_at: Date;
    delivered_at: Date;
    read_at: Date;
    error_message: string;
    created_at: Date;
  }>(
    poolOrClient,
    `INSERT INTO utility_message_logs (
      id, merchant_id, recipient_id, template_id, message_id, message_type, 
      status, sent_at, error_message, created_at
    ) VALUES (
      $1, $2::uuid, $3, $4, $5, $6, $7, NOW(), $8, NOW()
    ) RETURNING *`,
    [
      logId,
      input.merchantId,
      input.recipientId,
      input.templateId,
      input.messageId,
      input.messageType,
      input.status || 'sent',
      input.errorMessage || null
    ]
  );

  const row = rows[0];
  return {
    id: row.id,
    merchantId: row.merchant_id,
    recipientId: row.recipient_id,
    templateId: row.template_id,
    messageId: row.message_id,
    messageType: row.message_type as UtilityMessageType,
    status: row.status as any,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    readAt: row.read_at,
    errorMessage: row.error_message,
    createdAt: row.created_at
  };
}

/**
 * Update message delivery status
 */
export async function updateMessageStatus(
  poolOrClient: Pool | PoolClient,
  messageId: string,
  status: 'delivered' | 'read' | 'failed',
  errorMessage?: string
): Promise<boolean> {
  const updates: string[] = ['status = $2'];
  const params: any[] = [messageId, status];
  let paramIndex = 3;

  if (status === 'delivered') {
    updates.push('delivered_at = NOW()');
  } else if (status === 'read') {
    updates.push('read_at = NOW()');
  }

  if (errorMessage) {
    updates.push(`error_message = $${paramIndex}`);
    params.push(errorMessage);
    paramIndex++;
  }

  const rows = await query<{ id: string }>(
    poolOrClient,
    `UPDATE utility_message_logs 
     SET ${updates.join(', ')}
     WHERE message_id = $1
     RETURNING id`,
    params
  );

  return rows.length > 0;
}

/**
 * List utility messages for a merchant
 */
export async function listUtilityMessages(
  poolOrClient: Pool | PoolClient,
  merchantId: string,
  options: {
    recipientId?: string;
    templateId?: string;
    messageType?: UtilityMessageType;
    status?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  } = {}
): Promise<Array<MessageLog & { templateName?: string }>> {
  const { recipientId, templateId, messageType, status, startDate, endDate, limit = 50, offset = 0 } = options;
  
  let whereConditions = ['l.merchant_id = $1::uuid'];
  let params: any[] = [merchantId];
  let paramIndex = 2;
  
  if (recipientId) {
    whereConditions.push(`l.recipient_id = $${paramIndex}`);
    params.push(recipientId);
    paramIndex++;
  }
  
  if (templateId) {
    whereConditions.push(`l.template_id = $${paramIndex}`);
    params.push(templateId);
    paramIndex++;
  }
  
  if (messageType) {
    whereConditions.push(`l.message_type = $${paramIndex}`);
    params.push(messageType);
    paramIndex++;
  }
  
  if (status) {
    whereConditions.push(`l.status = $${paramIndex}`);
    params.push(status);
    paramIndex++;
  }
  
  if (startDate) {
    whereConditions.push(`l.sent_at >= $${paramIndex}`);
    params.push(startDate);
    paramIndex++;
  }
  
  if (endDate) {
    whereConditions.push(`l.sent_at <= $${paramIndex}`);
    params.push(endDate);
    paramIndex++;
  }
  
  params.push(limit, offset);
  
  const rows = await query<{
    id: string;
    merchant_id: string;
    recipient_id: string;
    template_id: string;
    message_id: string;
    message_type: string;
    status: string;
    sent_at: Date;
    delivered_at: Date;
    read_at: Date;
    error_message: string;
    created_at: Date;
    template_name: string;
  }>(
    poolOrClient,
    `SELECT 
       l.*,
       t.name as template_name
     FROM utility_message_logs l
     LEFT JOIN utility_message_templates t ON l.template_id::uuid = t.id
     WHERE ${whereConditions.join(' AND ')}
     ORDER BY l.sent_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );

  return rows.map(row => ({
    id: row.id,
    merchantId: row.merchant_id,
    recipientId: row.recipient_id,
    templateId: row.template_id,
    messageId: row.message_id,
    messageType: row.message_type as UtilityMessageType,
    status: row.status as any,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    readAt: row.read_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    templateName: row.template_name
  }));
}

/**
 * Get message statistics for a merchant
 */
export async function getMessageStats(
  poolOrClient: Pool | PoolClient,
  merchantId: string,
  options: {
    startDate?: Date;
    endDate?: Date;
    groupBy?: 'day' | 'week' | 'month';
  } = {}
): Promise<Array<{
  period: string;
  totalSent: number;
  delivered: number;
  read: number;
  failed: number;
  deliveryRate: number;
  readRate: number;
}>> {
  const { startDate, endDate, groupBy = 'day' } = options;
  
  let dateFormat: string;
  switch (groupBy) {
    case 'week':
      dateFormat = 'YYYY-"W"WW';
      break;
    case 'month':
      dateFormat = 'YYYY-MM';
      break;
    default:
      dateFormat = 'YYYY-MM-DD';
  }
  
  let whereConditions = ['merchant_id = $1::uuid'];
  let params: any[] = [merchantId];
  let paramIndex = 2;
  
  if (startDate) {
    whereConditions.push(`sent_at >= $${paramIndex}`);
    params.push(startDate);
    paramIndex++;
  }
  
  if (endDate) {
    whereConditions.push(`sent_at <= $${paramIndex}`);
    params.push(endDate);
    paramIndex++;
  }
  
  const rows = await query<{
    period: string;
    total_sent: string;
    delivered: string;
    read: string;
    failed: string;
  }>(
    poolOrClient,
    `SELECT 
       TO_CHAR(sent_at, '${dateFormat}') as period,
       COUNT(*) as total_sent,
       COUNT(CASE WHEN status IN ('delivered', 'read') THEN 1 END) as delivered,
       COUNT(CASE WHEN status = 'read' THEN 1 END) as read,
       COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
     FROM utility_message_logs
     WHERE ${whereConditions.join(' AND ')}
     GROUP BY TO_CHAR(sent_at, '${dateFormat}')
     ORDER BY period DESC`,
    params
  );

  return rows.map(row => {
    const totalSent = parseInt(row.total_sent);
    const delivered = parseInt(row.delivered);
    const read = parseInt(row.read);
    const failed = parseInt(row.failed);
    
    return {
      period: row.period,
      totalSent,
      delivered,
      read,
      failed,
      deliveryRate: totalSent > 0 ? Math.round((delivered / totalSent) * 100) : 0,
      readRate: totalSent > 0 ? Math.round((read / totalSent) * 100) : 0
    };
  });
}

/**
 * Get recent message activity
 */
export async function getRecentActivity(
  poolOrClient: Pool | PoolClient,
  merchantId: string,
  hours = 24
): Promise<Array<{
  messageId: string;
  recipientId: string;
  messageType: UtilityMessageType;
  status: string;
  sentAt: Date;
  templateName?: string;
}>> {
  const rows = await query<{
    message_id: string;
    recipient_id: string;
    message_type: string;
    status: string;
    sent_at: Date;
    template_name: string;
  }>(
    poolOrClient,
    `SELECT 
       l.message_id,
       l.recipient_id,
       l.message_type,
       l.status,
       l.sent_at,
       t.name as template_name
     FROM utility_message_logs l
     LEFT JOIN utility_message_templates t ON l.template_id::uuid = t.id
     WHERE l.merchant_id = $1::uuid
       AND l.sent_at >= NOW() - INTERVAL '${hours} hours'
     ORDER BY l.sent_at DESC
     LIMIT 100`,
    [merchantId]
  );

  return rows.map(row => ({
    messageId: row.message_id,
    recipientId: row.recipient_id,
    messageType: row.message_type as UtilityMessageType,
    status: row.status,
    sentAt: row.sent_at,
    templateName: row.template_name
  }));
}