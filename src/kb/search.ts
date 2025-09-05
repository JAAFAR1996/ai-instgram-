import OpenAI from 'openai';
import { getDatabase } from '../db/adapter.js';
import { getEnv } from '../config/env.js';

export interface KBHit {
  id: string;
  title: string;
  chunk: string;
  score: number;
}

export async function kbSearch(
  merchantId: string,
  query: string,
  k = 5,
  opts?: { merchantType?: string; tags?: Record<string, string | boolean> }
): Promise<KBHit[]> {
  const db = getDatabase();
  const sql = db.getSQL();

  // Guard: enforce RLS context presence and match
  try {
    const ctx = await sql<{ merchant_id: string }>`SELECT current_setting('app.current_merchant_id', true) as merchant_id`;
    const mid = (ctx[0]?.merchant_id ?? '').trim();
    if (!mid || mid !== merchantId) {
      throw new Error('RLS context mismatch or not set');
    }
  } catch (_e) {
    throw new Error('security_context_missing');
  }

  // If vector extension is not installed or no API key, fallback to simple ILIKE
  const apiKey = getEnv('OPENAI_API_KEY');
  if (!apiKey) {
    const rows = await sql<{ id: string; title: string; chunk: string }>`
      SELECT id, title, chunk
      FROM public.merchant_kb_docs
      WHERE merchant_id = ${merchantId}::uuid
        ${opts?.merchantType ? sql`AND (tags ->> 'type') = ${opts.merchantType}` : sql``}
      AND (title ILIKE ${'%' + query + '%'} OR chunk ILIKE ${'%' + query + '%'})
      ORDER BY updated_at DESC
      LIMIT ${k}
    `;
    return rows.map((r, i) => ({ id: r.id, title: r.title, chunk: r.chunk, score: 1 - i * 0.1 }));
  }

  const openai = new OpenAI({ apiKey });
  const embedding = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
  });
  const data0 = embedding.data && embedding.data[0];
  if (!data0 || !Array.isArray(data0.embedding)) {
    return [];
  }
  const vec = data0.embedding as number[];

  // Similarity search with pgvector
  const rows = await sql<{ id: string; title: string; chunk: string; distance: number }>`
    SELECT id, title, chunk,
           (embedding <=> ${JSON.stringify(vec)}::vector) AS distance
    FROM public.merchant_kb_docs
    WHERE merchant_id = ${merchantId}::uuid
      ${opts?.merchantType ? sql`AND (tags ->> 'type') = ${opts.merchantType}` : sql``}
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${JSON.stringify(vec)}::vector
    LIMIT ${k}
  `;
  return rows.map(r => ({ id: r.id, title: r.title, chunk: r.chunk, score: 1 - r.distance }));
}
