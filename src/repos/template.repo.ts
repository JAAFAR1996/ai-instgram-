/**
 * ===============================================
 * Template Repository - Pure SQL with pg.Pool
 * Handles utility message templates
 * ===============================================
 */

import { Pool, PoolClient } from 'pg';
import { query } from '../db/index.js';
import * as crypto from 'node:crypto';

export type UtilityMessageType = 
  | 'ORDER_UPDATE'
  | 'ACCOUNT_NOTIFICATION' 
  | 'APPOINTMENT_REMINDER'
  | 'DELIVERY_NOTIFICATION'
  | 'PAYMENT_UPDATE';

export interface Template {
  id: string;
  merchantId: string;
  name: string;
  type: UtilityMessageType;
  content: string;
  variables: string[];
  approved: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTemplateInput {
  merchantId: string;
  name: string;
  type: UtilityMessageType;
  content: string;
  variables: string[];
}

/**
 * Create a new utility message template
 */
export async function createTemplate(
  poolOrClient: Pool | PoolClient,
  input: CreateTemplateInput
): Promise<Template> {
  const templateId = crypto.randomUUID();
  
  const rows = await query<{
    id: string;
    merchant_id: string;
    name: string;
    type: string;
    content: string;
    variables: string[];
    approved: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    poolOrClient,
    `INSERT INTO utility_message_templates (
      id, merchant_id, name, type, content, variables, approved, created_at, updated_at
    ) VALUES (
      $1, $2::uuid, $3, $4, $5, $6::jsonb, false, NOW(), NOW()
    ) RETURNING *`,
    [
      templateId,
      input.merchantId,
      input.name,
      input.type,
      input.content,
      JSON.stringify(input.variables)
    ]
  );

  const row = rows[0];
  if (!row) throw new Error('Template not found');
  return {
    id: row!.id,
    merchantId: row!.merchant_id,
    name: row!.name,
    type: row!.type as UtilityMessageType,
    content: row!.content,
    variables: row!.variables,
    approved: row!.approved,
    createdAt: row!.created_at,
    updatedAt: row!.updated_at
  };
}

/**
 * Get template by ID
 */
export async function getTemplateById(
  poolOrClient: Pool | PoolClient,
  templateId: string,
  merchantId?: string
): Promise<Template | null> {
  const whereClause = merchantId 
    ? 'WHERE id = $1 AND merchant_id = $2::uuid'
    : 'WHERE id = $1';
    
  const params = merchantId ? [templateId, merchantId] : [templateId];
  
  const rows = await query<{
    id: string;
    merchant_id: string;
    name: string;
    type: string;
    content: string;
    variables: string[];
    approved: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    poolOrClient,
    `SELECT * FROM utility_message_templates ${whereClause} LIMIT 1`,
    params
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  if (!row) return null;
  
  return {
    id: row.id,
    merchantId: row.merchant_id,
    name: row.name,
    type: row.type as UtilityMessageType,
    content: row.content,
    variables: row.variables,
    approved: row.approved,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * List templates for a merchant
 */
export async function listTemplates(
  poolOrClient: Pool | PoolClient,
  merchantId: string,
  options: {
    type?: UtilityMessageType;
    approved?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<Template[]> {
  const { type, approved, limit = 50, offset = 0 } = options;
  
  let whereConditions = ['merchant_id = $1::uuid'];
  let params: any[] = [merchantId];
  let paramIndex = 2;
  
  if (type) {
    whereConditions.push(`type = $${paramIndex}`);
    params.push(type);
    paramIndex++;
  }
  
  if (approved !== undefined) {
    whereConditions.push(`approved = $${paramIndex}`);
    params.push(approved);
    paramIndex++;
  }
  
  params.push(limit, offset);
  
  const rows = await query<{
    id: string;
    merchant_id: string;
    name: string;
    type: string;
    content: string;
    variables: string[];
    approved: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    poolOrClient,
    `SELECT * FROM utility_message_templates 
     WHERE ${whereConditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );

  return rows.map(row => ({
    id: row.id,
    merchantId: row.merchant_id,
    name: row.name,
    type: row.type as UtilityMessageType,
    content: row.content,
    variables: row.variables,
    approved: row.approved,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

/**
 * Update template
 */
export async function updateTemplate(
  poolOrClient: Pool | PoolClient,
  templateId: string,
  merchantId: string,
  updates: {
    name?: string;
    content?: string;
    variables?: string[];
    approved?: boolean;
  }
): Promise<Template | null> {
  const updateFields: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  if (updates.name !== undefined) {
    updateFields.push(`name = $${paramIndex}`);
    params.push(updates.name);
    paramIndex++;
  }

  if (updates.content !== undefined) {
    updateFields.push(`content = $${paramIndex}`);
    params.push(updates.content);
    paramIndex++;
  }

  if (updates.variables !== undefined) {
    updateFields.push(`variables = $${paramIndex}::jsonb`);
    params.push(JSON.stringify(updates.variables));
    paramIndex++;
  }

  if (updates.approved !== undefined) {
    updateFields.push(`approved = $${paramIndex}`);
    params.push(updates.approved);
    paramIndex++;
  }

  if (updateFields.length === 0) {
    return getTemplateById(poolOrClient, templateId, merchantId);
  }

  updateFields.push('updated_at = NOW()');
  params.push(templateId, merchantId);

  const rows = await query<{
    id: string;
    merchant_id: string;
    name: string;
    type: string;
    content: string;
    variables: string[];
    approved: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    poolOrClient,
    `UPDATE utility_message_templates 
     SET ${updateFields.join(', ')}
     WHERE id = $${paramIndex} AND merchant_id = $${paramIndex + 1}::uuid
     RETURNING *`,
    params
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  if (!row) return null;
  
  return {
    id: row.id,
    merchantId: row.merchant_id,
    name: row.name,
    type: row.type as UtilityMessageType,
    content: row.content,
    variables: row.variables,
    approved: row.approved,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Delete template
 */
export async function deleteTemplate(
  poolOrClient: Pool | PoolClient,
  templateId: string,
  merchantId: string
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    poolOrClient,
    'DELETE FROM utility_message_templates WHERE id = $1 AND merchant_id = $2::uuid RETURNING id',
    [templateId, merchantId]
  );

  return rows.length > 0;
}

/**
 * Get template usage statistics
 */
export async function getTemplateStats(
  poolOrClient: Pool | PoolClient,
  merchantId: string
): Promise<Array<{
  templateId: string;
  templateName: string;
  type: UtilityMessageType;
  usageCount: number;
  lastUsed?: Date;
}>> {
  const rows = await query<{
    template_id: string;
    template_name: string;
    type: string;
    usage_count: string;
    last_used: Date;
  }>(
    poolOrClient,
    `SELECT 
       t.id as template_id,
       t.name as template_name,
       t.type,
       COUNT(l.id) as usage_count,
       MAX(l.sent_at) as last_used
     FROM utility_message_templates t
     LEFT JOIN utility_message_logs l ON t.id = l.template_id::uuid
     WHERE t.merchant_id = $1::uuid
     GROUP BY t.id, t.name, t.type
     ORDER BY usage_count DESC, t.name`,
    [merchantId]
  );

  return rows.map(row => ({
    templateId: row.template_id,
    templateName: row.template_name,
    type: row.type as UtilityMessageType,
    usageCount: parseInt(row.usage_count),
    lastUsed: row.last_used
  }));
}