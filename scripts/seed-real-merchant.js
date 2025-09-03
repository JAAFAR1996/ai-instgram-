#!/usr/bin/env node
// Seed a real-like merchant with products and ManyChat mapping
// Usage: DATABASE_URL=postgresql://... node scripts/seed-real-merchant.js

import { Pool } from 'pg';

const MERCHANT_ID = 'dd90061a-a1ad-42de-be9b-1c9760d0de02';
const MERCHANT_USERNAME = 'zo27j';
const MANYCHAT_SUBSCRIBER_ID = '365717805';

function getPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const ssl = /render\.com|sslmode=require/i.test(url) ? { rejectUnauthorized: false } : undefined;
  return new Pool({ connectionString: url, ssl });
}

function realSettings() {
  return {
    working_hours: {
      enabled: true,
      timezone: 'Asia/Baghdad',
      schedule: {
        sunday: { open: '10:00', close: '22:00', enabled: true },
        monday: { open: '10:00', close: '22:00', enabled: true },
        tuesday: { open: '10:00', close: '22:00', enabled: true },
        wednesday: { open: '10:00', close: '22:00', enabled: true },
        thursday: { open: '10:00', close: '22:00', enabled: true },
        friday: { open: '14:00', close: '22:00', enabled: true },
        saturday: { open: '10:00', close: '22:00', enabled: false }
      }
    },
    payment_methods: ['COD', 'ZAIN_CASH', 'ASIA_HAWALA'],
    delivery_fees: { inside_baghdad: 3, outside_baghdad: 5 },
    auto_responses: {
      welcome_message: 'أهلاً بك في ZO Boutique! كيف نساعدك اليوم؟',
      outside_hours: 'نرحب برسالتك، سنعود لك بأقرب وقت ضمن ساعات الدوام.'
    }
  };
}

function aiConfig() {
  return {
    model: 'gpt-4o-mini',
    language: 'ar',
    temperature: 0.5,
    maxTokens: 512,
    tone: 'friendly',
    productHints: true
  };
}

const products = [
  { sku: 'ZJ-1001', name_ar: 'تيشيرت قطن رجالي', category: 'fashion', price_usd: 12.5, stock: 40, tags: ['رجالي','صيفي'], desc: 'قماش قطني 100%، مريح وناعم.' },
  { sku: 'ZJ-1002', name_ar: 'قميص رسمي كلاسيك', category: 'fashion', price_usd: 24.9, stock: 25, tags: ['رجالي','رسمي'], desc: 'قصة عصرية وخياطة دقيقة، مناسب للمناسبات.' },
  { sku: 'ZJ-2001', name_ar: 'فستان كاجوال موف', category: 'fashion', price_usd: 29.0, stock: 18, tags: ['نسائي','صيفي'], desc: 'خامة خفيفة وتصميم مريح للحركة.' },
  { sku: 'ZJ-2002', name_ar: 'عباءة سوداء عملية', category: 'fashion', price_usd: 35.0, stock: 15, tags: ['نسائي','عبايات'], desc: 'قماش عملي ومناسب للاستخدام اليومي.' },
  { sku: 'ZJ-3001', name_ar: 'حقيبة كتف جلد', category: 'accessories', price_usd: 22.0, stock: 20, tags: ['حقائب'], desc: 'جلد صناعي عالي الجودة وسعة جيدة.' },
  { sku: 'ZJ-3002', name_ar: 'حذاء رياضي مريح', category: 'shoes', price_usd: 27.5, stock: 30, tags: ['رياضي'], desc: 'نعل مريح للرياضة والمشي الطويل.' },
  { sku: 'ZJ-4001', name_ar: 'قبعة كتان', category: 'accessories', price_usd: 8.5, stock: 35, tags: ['صيفي'], desc: 'تحمي من الشمس وتضفي لمسة أنيقة.' },
  { sku: 'ZJ-5001', name_ar: 'معطف شتوي', category: 'fashion', price_usd: 49.0, stock: 10, tags: ['شتوي'], desc: 'دفء ومتانة لتجربة مريحة بالشتاء.' }
];

async function upsertMerchant(client) {
  await client.query(`SELECT set_config('app.is_admin','true', true)`);
  const whatsapp = '9647701234567';
  const email = 'owner@zo-boutique.example';
  const businessName = 'ZO Boutique — زو بوتيك';
  const category = 'fashion';
  const address = 'Baghdad, Karrada, 52nd Street';

  await client.query(
    `INSERT INTO public.merchants (
       id, business_name, business_category, business_address,
       whatsapp_number, instagram_username, email, is_active,
       settings, ai_config, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,NOW(),NOW())
     ON CONFLICT (id) DO UPDATE SET
       business_name = EXCLUDED.business_name,
       business_category = EXCLUDED.business_category,
       business_address = EXCLUDED.business_address,
       whatsapp_number = EXCLUDED.whatsapp_number,
       instagram_username = EXCLUDED.instagram_username,
       email = EXCLUDED.email,
       is_active = true,
       settings = EXCLUDED.settings,
       ai_config = EXCLUDED.ai_config,
       updated_at = NOW()`,
    [
      MERCHANT_ID,
      businessName,
      category,
      address,
      whatsapp,
      MERCHANT_USERNAME,
      email,
      JSON.stringify(realSettings()),
      JSON.stringify(aiConfig())
    ]
  );
}

async function upsertManychatMapping(client) {
  // Use read-then-upsert due to unique index on (merchant_id, lower(instagram_username))
  const { rows } = await client.query(
    `SELECT id FROM public.manychat_subscribers
     WHERE merchant_id = $1 AND lower(instagram_username) = lower($2)
     LIMIT 1`,
    [MERCHANT_ID, MERCHANT_USERNAME]
  );
  if (rows.length > 0) {
    await client.query(
      `UPDATE public.manychat_subscribers
       SET manychat_subscriber_id = $3, status = 'active', updated_at = NOW()
       WHERE id = $4`,
      [MERCHANT_ID, MERCHANT_USERNAME, MANYCHAT_SUBSCRIBER_ID, rows[0].id]
    );
  } else {
    await client.query(
      `INSERT INTO public.manychat_subscribers (
         merchant_id, manychat_subscriber_id, instagram_username, status, created_at, updated_at
       ) VALUES ($1,$2,$3,'active',NOW(),NOW())`,
      [MERCHANT_ID, MANYCHAT_SUBSCRIBER_ID, MERCHANT_USERNAME]
    );
  }
}

async function upsertProducts(client) {
  for (const p of products) {
    await client.query(
      `INSERT INTO public.products (
         merchant_id, sku, name_ar, description_ar, category,
         price_usd, stock_quantity, tags, status, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE',NOW(),NOW()
       )
       ON CONFLICT (merchant_id, sku) DO UPDATE SET
         name_ar = EXCLUDED.name_ar,
         description_ar = EXCLUDED.description_ar,
         category = EXCLUDED.category,
         price_usd = EXCLUDED.price_usd,
         stock_quantity = EXCLUDED.stock_quantity,
         tags = EXCLUDED.tags,
         status = 'ACTIVE',
         updated_at = NOW()`,
      [
        MERCHANT_ID,
        p.sku,
        p.name_ar,
        p.desc,
        p.category,
        p.price_usd,
        p.stock,
        p.tags
      ]
    );
  }
}

async function main() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await upsertMerchant(client);
    await upsertManychatMapping(client);
    await upsertProducts(client);
    await client.query('COMMIT');
    console.log('✅ Seeded real merchant and catalog');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Seed failed:', err?.message || String(err));
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Fatal:', e?.message || String(e));
  process.exit(1);
});

