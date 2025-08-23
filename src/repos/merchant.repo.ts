/**
 * ===============================================
 * Merchant Repository - Pure SQL with pg.Pool
 * Handles merchant-Instagram page mapping
 * ===============================================
 */

import { Pool, PoolClient } from 'pg';
import { query } from '../db/index.js';

export interface MerchantMapping {
  merchantId: string;
  pageId: string;
  businessAccountId?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Get merchant ID by Instagram page ID
 */
export async function getMerchantIdByPageId(
  poolOrClient: Pool | PoolClient, 
  pageId: string
): Promise<string | null> {
  const rows = await query<{ merchant_id: string }>(
    poolOrClient,
    'SELECT merchant_id FROM merchant_instagram_mapping WHERE page_id = $1 AND is_active = true LIMIT 1',
    [pageId]
  );
  
  return rows[0]?.merchant_id ?? null;
}

/**
 * Get merchant by ID
 */
export async function getMerchantById(
  poolOrClient: Pool | PoolClient,
  merchantId: string
): Promise<{ id: string; name: string; status: string } | null> {
  const rows = await query<{ id: string; name: string; status: string }>(
    poolOrClient,
    'SELECT id, name, status FROM merchants WHERE id = $1::uuid LIMIT 1',
    [merchantId]
  );
  
  return rows[0] ?? null;
}

/**
 * Create merchant-Instagram mapping
 */
export async function createMerchantMapping(
  poolOrClient: Pool | PoolClient,
  mapping: {
    merchantId: string;
    pageId: string;
    businessAccountId?: string;
  }
): Promise<void> {
  await query(
    poolOrClient,
    `INSERT INTO merchant_instagram_mapping (
      merchant_id, page_id, business_account_id, is_active, created_at, updated_at
    ) VALUES (
      $1::uuid, $2, $3, true, NOW(), NOW()
    ) ON CONFLICT (page_id) 
    DO UPDATE SET 
      merchant_id = EXCLUDED.merchant_id,
      business_account_id = EXCLUDED.business_account_id,
      is_active = EXCLUDED.is_active,
      updated_at = NOW()`,
    [mapping.merchantId, mapping.pageId, mapping.businessAccountId]
  );
}

/**
 * Get all mappings for a merchant
 */
export async function getMerchantMappings(
  poolOrClient: Pool | PoolClient,
  merchantId: string
): Promise<MerchantMapping[]> {
  const rows = await query<{
    merchant_id: string;
    page_id: string;
    business_account_id: string;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    poolOrClient,
    `SELECT merchant_id, page_id, business_account_id, is_active, created_at, updated_at 
     FROM merchant_instagram_mapping 
     WHERE merchant_id = $1::uuid 
     ORDER BY created_at DESC`,
    [merchantId]
  );

  return rows.map(row => ({
    merchantId: row.merchant_id,
    pageId: row.page_id,
    businessAccountId: row.business_account_id,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

/**
 * Deactivate merchant mapping
 */
export async function deactivateMerchantMapping(
  poolOrClient: Pool | PoolClient,
  pageId: string
): Promise<void> {
  await query(
    poolOrClient,
    'UPDATE merchant_instagram_mapping SET is_active = false, updated_at = NOW() WHERE page_id = $1',
    [pageId]
  );
}

/**
 * Get active merchant count
 */
export async function getActiveMerchantCount(
  poolOrClient: Pool | PoolClient
): Promise<number> {
  const rows = await query<{ count: string }>(
    poolOrClient,
    'SELECT COUNT(*) as count FROM merchants WHERE status = $1',
    ['active']
  );
  
  return parseInt(rows[0]?.count || '0');
}

/**
 * Search merchants by name or page ID
 */
export async function searchMerchants(
  poolOrClient: Pool | PoolClient,
  searchTerm: string,
  limit = 50
): Promise<Array<{
  merchantId: string;
  merchantName: string;
  pageId?: string;
  status: string;
}>> {
  const rows = await query<{
    merchant_id: string;
    merchant_name: string;
    page_id: string;
    status: string;
  }>(
    poolOrClient,
    `SELECT DISTINCT 
       m.id as merchant_id,
       m.name as merchant_name,
       mim.page_id,
       m.status
     FROM merchants m
     LEFT JOIN merchant_instagram_mapping mim ON m.id = mim.merchant_id AND mim.is_active = true
     WHERE m.name ILIKE $1 
       OR mim.page_id ILIKE $1
     ORDER BY m.name
     LIMIT $2`,
    [`%${searchTerm}%`, limit]
  );

  return rows.map(row => ({
    merchantId: row.merchant_id,
    merchantName: row.merchant_name,
    pageId: row.page_id,
    status: row.status
  }));
}