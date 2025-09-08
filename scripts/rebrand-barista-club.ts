/**
 * Rebrand existing merchant (keep same UUID) to Barista Club
 * - Updates merchants row fields (name, category, instagram_username)
 * - Optionally seeds a few sample cup products if merchant has no products
 *
 * Usage:
 *   MERCHANT_UUID=<uuid> tsx scripts/rebrand-barista-club.ts
 *   # Or, if there is only one merchant in DB, MERCHANT_UUID is optional
 */

import { getDatabase } from '../src/db/adapter.js';

async function main(): Promise<void> {
  const db = getDatabase();
  const sql = db.getSQL();

  // 1) Resolve target merchant id
  let merchantId = (process.env.MERCHANT_UUID || '').trim();
  if (!merchantId) {
    const rows = await sql<{ id: string; business_name: string }>`
      SELECT id, business_name FROM merchants ORDER BY created_at ASC LIMIT 2
    `;
    if (rows.length === 0) throw new Error('No merchants found. Please create one or pass MERCHANT_UUID');
    if (rows.length > 1) {
      throw new Error('Multiple merchants found. Please set MERCHANT_UUID=<uuid> to choose the target merchant');
    }
    merchantId = rows[0]!.id;
  }

  console.log(`Using MERCHANT_UUID=${merchantId}`);

  // 2) Update merchant fields
  await sql`UPDATE merchants
    SET business_name = ${'Barista Club'},
        business_category = ${'home-kitchen'},
        instagram_username = ${'_barista_club'},
        updated_at = NOW()
    WHERE id = ${merchantId}::uuid`;

  // 3) If merchant has zero products, seed a few cups
  const [{ cnt }] = await sql<{ cnt: number }>`
    SELECT COUNT(*)::int AS cnt FROM products WHERE merchant_id = ${merchantId}::uuid
  `;

  if ((cnt ?? 0) === 0) {
    console.log('Seeding sample cup products...');
    const items = [
      {
        sku: 'CUP-CLASSIC-300',
        name_ar: 'كوب سيراميك كلاسيك 300ml',
        price_usd: 7.5,
        category: 'cups',
        stock_quantity: 50
      },
      {
        sku: 'MUG-HAND-400',
        name_ar: 'مَجّ يدوي 400ml',
        price_usd: 12,
        category: 'cups',
        stock_quantity: 35
      },
      {
        sku: 'CUP-DOUBLE-250',
        name_ar: 'كوب زجاجي دبل 250ml',
        price_usd: 9.9,
        category: 'cups',
        stock_quantity: 60
      }
    ];

    for (const p of items) {
      try {
        await sql`INSERT INTO products (
          id, merchant_id, sku, name_ar, price_usd, category, stock_quantity, status, created_at, updated_at
        ) VALUES (
          uuid_generate_v4(), ${merchantId}::uuid, ${p.sku}, ${p.name_ar}, ${p.price_usd}, ${p.category}, ${p.stock_quantity}, 'ACTIVE', NOW(), NOW()
        )`;
      } catch (e) {
        console.warn(`Product seed failed for ${p.sku}:`, String(e));
      }
    }
  } else {
    console.log(`Merchant already has ${cnt} products. Skipping seed.`);
  }

  console.log('Rebrand completed.');
}

main().catch((e) => {
  console.error('Rebrand failed:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});

