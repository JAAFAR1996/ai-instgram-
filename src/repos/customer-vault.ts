import { getDatabase } from '../db/adapter.js';

export interface VaultPatch {
  category?: string | null;
  size?: string | null;
  color?: string | null;
  gender?: string | null;
  brand?: string | null;
  budget?: number | null;
  stage?: 'AWARE' | 'BROWSE' | 'INTENT' | 'OBJECTION' | 'CLOSE';
}

export async function upsertVault(
  merchantId: string,
  customerId: string,
  patch: VaultPatch,
  conversationId?: string,
  ttlDays: number = 30
): Promise<void> {
  const db = getDatabase();
  const sql = db.getSQL();

  const purgeAfter = sql`NOW() + (${ttlDays} || ' days')::interval` as unknown as string;

  await sql`
    INSERT INTO public.customer_vaults (merchant_id, customer_id, conversation_id, data, purge_after)
    VALUES (
      ${merchantId}::uuid,
      ${customerId},
      ${conversationId || null},
      ${JSON.stringify(patch)}::jsonb,
      ${sql.unsafe('NOW() + ($1 || \" days\")::interval', [ttlDays])}
    )
    ON CONFLICT (merchant_id, customer_id)
    DO UPDATE SET 
      data = COALESCE(public.customer_vaults.data, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb,
      conversation_id = COALESCE(EXCLUDED.conversation_id, public.customer_vaults.conversation_id),
      purge_after = GREATEST(public.customer_vaults.purge_after, EXCLUDED.purge_after),
      updated_at = NOW()
  `;
}

export async function markPurchased(
  merchantId: string,
  customerId: string
): Promise<void> {
  const db = getDatabase();
  const sql = db.getSQL();

  await sql`
    INSERT INTO public.customer_vaults (merchant_id, customer_id, status, purge_after)
    VALUES (${merchantId}::uuid, ${customerId}, 'purchased', NOW() + interval '24 hours')
    ON CONFLICT (merchant_id, customer_id)
    DO UPDATE SET status = 'purchased', purge_after = NOW() + interval '24 hours', updated_at = NOW()
  `;
}

