import OpenAI from 'openai';
import { getDatabase } from '../db/adapter.js';
import { getEnv } from '../config/env.js';
import { getLogger } from '../services/logger.js';

const log = getLogger({ component: 'kb-ingest' });

export interface IngestOptions {
  chunkTokens?: number; // approximate tokens per chunk (500–800)
  overlapTokens?: number; // overlap between chunks
  tags?: Record<string, string | boolean>;
}

/**
 * Approximate tokens by characters (Arabic avg ~ 3.5–4 chars per token)
 */
function approxTokenToChars(tokens: number): number {
  return Math.max(200, Math.round(tokens * 4));
}

/**
 * Simple text chunker using approximate token sizing with optional overlap
 */
export function chunkText(
  text: string,
  opts: IngestOptions = { chunkTokens: 700, overlapTokens: 80 }
): string[] {
  const chunkChars = approxTokenToChars(opts.chunkTokens ?? 700);
  const overlapChars = approxTokenToChars(opts.overlapTokens ?? 80);

  const src = (text ?? '').replace(/\s+$/,'').replace(/^\s+/,'');
  if (!src) return [];
  if (src.length <= chunkChars) return [src];

  const chunks: string[] = [];
  let i = 0;
  while (i < src.length) {
    const end = Math.min(src.length, i + chunkChars);
    let slice = src.slice(i, end);
    // try to cut at sentence boundary near the end
    if (end < src.length) {
      const lastPunct = slice.lastIndexOf('۔');
      const lastDot = slice.lastIndexOf('.')
      const lastNL = slice.lastIndexOf('\n');
      const cut = Math.max(lastPunct, lastDot, lastNL);
      if (cut > chunkChars * 0.7) slice = slice.slice(0, cut + 1);
    }
    chunks.push(slice.trim());
    if (end >= src.length) break;
    i += Math.max(1, (slice.length - overlapChars));
  }
  return chunks.filter(Boolean);
}

/**
 * Generate an embedding vector using OpenAI; returns null if no API key
 */
export async function embed(text: string): Promise<number[] | null> {
  const apiKey = getEnv('OPENAI_API_KEY');
  if (!apiKey) return null;
  const openai = new OpenAI({ apiKey });
  const resp = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text
  });
  const v = resp.data?.[0]?.embedding;
  return Array.isArray(v) ? (v as number[]) : null;
}

/**
 * Ingest plain text as KB for a merchant: chunk → embed → insert
 */
export async function ingestText(
  merchantId: string,
  title: string,
  text: string,
  opts?: IngestOptions
): Promise<{ inserted: number }> {
  const db = getDatabase();
  const sql = db.getSQL();

  // Fetch merchant_type to tag KB docs for vertical-aware retrieval
  let merchantType: string | null = null;
  try {
    const row = await sql<{ merchant_type: string }>`
      SELECT merchant_type::text FROM public.merchants WHERE id = ${merchantId}::uuid LIMIT 1
    `;
    merchantType = row[0]?.merchant_type ?? null;
  } catch {}

  const chunks = chunkText(text, opts);
  if (chunks.length === 0) return { inserted: 0 };

  let inserted = 0;
  for (const ch of chunks) {
    try {
      const vec = await embed(ch);
      const tags = { ...(opts?.tags || {}), ...(merchantType ? { type: merchantType } : {}) };
      await sql`
        INSERT INTO public.merchant_kb_docs (merchant_id, title, chunk, embedding, tags, updated_at)
        VALUES (${merchantId}::uuid, ${title}, ${ch}, ${vec ? JSON.stringify(vec) : null}::vector, ${JSON.stringify(tags)}::jsonb, NOW())
      `;
      inserted++;
    } catch (e) {
      log.error('KB ingest failed for chunk', { error: (e as Error).message });
    }
  }

  log.info('KB ingest completed', { merchantId, title, chunks: inserted });
  return { inserted };
}

export default { ingestText };
