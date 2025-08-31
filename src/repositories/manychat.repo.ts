import { getPool } from '../db/index.js';

export async function getManychatIdByInstagram(merchantId: string, igUserId: string): Promise<string | null> {
  const pool = getPool();
  const { rows } = await pool.query<{ manychat_subscriber_id: string }>(
    `select manychat_subscriber_id
     from public.get_manychat_subscriber_by_instagram($1::uuid, $2::text)`,
    [merchantId, igUserId]
  );
  return rows[0]?.manychat_subscriber_id ?? null;
}

export async function upsertManychatMapping(merchantId: string, igUserId: string, mcId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `insert into manychat_subscribers(merchant_id, instagram_user_id, manychat_subscriber_id)
     values ($1,$2,$3)
     on conflict (merchant_id, manychat_subscriber_id) do update
       set instagram_user_id = excluded.instagram_user_id`,
    [merchantId, igUserId, mcId]
  );
}