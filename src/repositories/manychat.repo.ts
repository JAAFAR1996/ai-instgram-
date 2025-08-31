import { getPool } from '../db/index.js';

/**
 * Get ManyChat subscriber ID by Instagram username
 */
export async function getManychatIdByInstagramUsername(
  merchantId: string, 
  username: string
): Promise<string | null> {
  const pool = getPool();
  const { rows } = await pool.query<{ manychat_subscriber_id: string }>(
    `select manychat_subscriber_id
     from public.get_manychat_subscriber_by_instagram_username($1::uuid, $2::text)`,
    [merchantId, username]
  );
  return rows[0]?.manychat_subscriber_id ?? null;
}

/**
 * Legacy function - now uses username instead of ID
 */
export async function getManychatIdByInstagram(merchantId: string, igUserId: string): Promise<string | null> {
  // For backward compatibility, treat igUserId as username
  return getManychatIdByInstagramUsername(merchantId, igUserId);
}

/**
 * Upsert ManyChat mapping using username
 */
export async function upsertManychatMapping(
  merchantId: string, 
  username: string, 
  mcId: string
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `insert into manychat_subscribers(merchant_id, instagram_username, manychat_subscriber_id)
     values ($1,$2,$3)
     on conflict (merchant_id, instagram_username) do update
       set manychat_subscriber_id = excluded.manychat_subscriber_id`,
    [merchantId, username, mcId]
  );
}

/**
 * Get all ManyChat subscribers for a merchant
 */
export async function getManyChatSubscribers(merchantId: string): Promise<Array<{
  manychat_subscriber_id: string;
  instagram_username: string | null;
  first_name: string | null;
  last_name: string | null;
  status: string;
  created_at: Date;
}>> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select manychat_subscriber_id, instagram_username, first_name, last_name, status, created_at
     from manychat_subscribers
     where merchant_id = $1::uuid
     order by created_at desc`,
    [merchantId]
  );
  return rows;
}

/**
 * Delete ManyChat mapping
 */
export async function deleteManychatMapping(
  merchantId: string, 
  username: string
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `delete from manychat_subscribers
     where merchant_id = $1::uuid and instagram_username = $2`,
    [merchantId, username]
  );
}