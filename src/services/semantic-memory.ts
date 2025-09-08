/**
 * ===============================================
 * Semantic Memory Service (pgvector)
 * - Stores message embeddings per conversation
 * - Retrieves similar memories for current query
 * ===============================================
 */

import OpenAI from 'openai';
import { getDatabase } from '../db/adapter.js';
import { getLogger } from './logger.js';
import { getEnv } from '../config/env.js';

type Role = 'user' | 'assistant' | 'system';

export class SemanticMemoryService {
  private log = getLogger({ component: 'semantic-memory' });
  private db = getDatabase();
  private openai: OpenAI;
  private dim = 1536; // text-embedding-3-small

  constructor() {
    const apiKey = getEnv('OPENAI_API_KEY');
    if (!apiKey) throw new Error('OPENAI_API_KEY is required for semantic memory');
    this.openai = new OpenAI({ apiKey });
  }

  /** Ensure pgvector extension and table exist (best-effort) */
  public async ensureSchema(): Promise<void> {
    try {
      await this.db.query('CREATE EXTENSION IF NOT EXISTS vector');
    } catch (e) {
      this.log.warn('pgvector extension ensure failed (may already exist)', { error: String(e) });
    }
    try {
      await this.db.query(`
        CREATE TABLE IF NOT EXISTS conversation_embeddings (
          id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
          merchant_id UUID NOT NULL,
          customer_id TEXT NOT NULL,
          conversation_id UUID NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
          content TEXT NOT NULL,
          embedding vector(${this.dim}) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_convem_mem ON conversation_embeddings(merchant_id, customer_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_convem_conv ON conversation_embeddings(conversation_id, created_at DESC);
      `);
    } catch (e) {
      this.log.warn('conversation_embeddings ensure failed', { error: String(e) });
    }
    // Best-effort: ensure ANN index for vector similarity (HNSW preferred, fallback to IVFFlat)
    try {
      await this.db.query(`
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
            BEGIN
              CREATE INDEX IF NOT EXISTS idx_convem_embedding_hnsw
                ON conversation_embeddings USING hnsw (embedding vector_cosine_ops);
            EXCEPTION WHEN OTHERS THEN
              BEGIN
                CREATE INDEX IF NOT EXISTS idx_convem_embedding_ivfflat
                  ON conversation_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
              EXCEPTION WHEN OTHERS THEN
                RAISE NOTICE 'Failed to create ANN index on conversation_embeddings.embedding';
              END;
            END;
          ELSE
            RAISE NOTICE 'pgvector not enabled; skipping ANN index creation';
          END IF;
        END $$;
      `);
    } catch (e) {
      this.log.debug?.('ANN index ensure skipped', { error: String(e) });
    }
  }

  /** Create vector embedding */
  private async embed(text: string): Promise<number[]> {
    const input = (text ?? '').toString().slice(0, 3000);
    const model = getEnv('OPENAI_EMBEDDING_MODEL') || 'text-embedding-3-small';
    const res = await this.openai.embeddings.create({ model, input });
    return res.data?.[0]?.embedding || [];
  }

  /** Save one message into semantic memory */
  public async saveMessage(
    merchantId: string,
    customerId: string,
    conversationId: string,
    role: Role,
    content: string
  ): Promise<boolean> {
    try {
      await this.ensureSchema();
      const emb = await this.embed(content);
      if (!Array.isArray(emb) || emb.length === 0) return false;
      const vec = `[${emb.join(',')}]`;
      await this.db.query(
        `INSERT INTO conversation_embeddings (merchant_id, customer_id, conversation_id, role, content, embedding)
         VALUES ($1::uuid, $2, $3::uuid, $4, $5, ${vec}::vector)`,
        [merchantId, customerId, conversationId, role, content]
      );
      return true;
    } catch (e) {
      this.log.warn('saveMessage failed', { error: String(e) });
      return false;
    }
  }

  /** Search similar memories by cosine distance */
  public async searchSimilar(
    merchantId: string,
    customerId: string,
    query: string,
    limit = 5
  ): Promise<Array<{ role: Role; content: string }>> {
    try {
      const emb = await this.embed(query);
      if (!Array.isArray(emb) || emb.length === 0) return [];
      const vec = `[${emb.join(',')}]`;
      const rows = await this.db.query<{ role: Role; content: string }>(
        `SELECT role, content
         FROM conversation_embeddings
         WHERE merchant_id = $1::uuid AND customer_id = $2
         ORDER BY embedding <=> ${vec}::vector ASC
         LIMIT ${limit}`,
        [merchantId, customerId]
      );
      return rows as Array<{ role: Role; content: string }>;
    } catch (e) {
      this.log.warn('searchSimilar failed', { error: String(e) });
      return [];
    }
  }
}

let __memory: SemanticMemoryService | null = null;
export function getSemanticMemoryService(): SemanticMemoryService {
  if (!__memory) __memory = new SemanticMemoryService();
  return __memory;
}

export default SemanticMemoryService;
