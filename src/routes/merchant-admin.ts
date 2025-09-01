/**
 * ===============================================
 * Merchant Admin Routes (Production-ready)
 * Secure endpoints to manage merchant context/settings/AI config
 * Requires JWT auth + x-merchant-id header for RLS
 * ===============================================
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { getLogger } from '../services/logger.js';
import { getDatabase } from '../db/adapter.js';
import { getCache } from '../cache/index.js';
import { requireMerchantId } from '../middleware/rls-merchant-isolation.js';

const log = getLogger({ component: 'merchant-admin-routes' });

const SettingsSchema = z.object({
  payment_methods: z.array(z.string().min(1).max(40)).max(10).optional(),
  delivery_fees: z.record(z.union([z.string(), z.number()])).optional(),
  working_hours: z.any().optional(),
  auto_responses: z.record(z.string()).optional()
}).strict();

const AIConfigSchema = z.object({
  model: z.string().min(2).max(120).optional(),
  temperature: z.number().min(0).max(1).optional(),
  maxTokens: z.number().int().min(50).max(1000).optional(),
  language: z.string().min(2).max(10).optional()
}).strict();

const CurrencySchema = z.object({
  currency: z.string().length(3)
});

export function registerMerchantAdminRoutes(app: Hono) {
  const db = getDatabase();
  const sql = db.getSQL();
  const cache = getCache();

  // Helper to invalidate merchant caches used by AI layer
  async function invalidateMerchantCache(merchantId: string) {
    try {
      await cache.delete(`merchant:ctx:${merchantId}`, { prefix: 'ctx' });
      await cache.delete(`merchant:cats:${merchantId}`, { prefix: 'ctx' });
    } catch (e) {
      log.warn('Cache invalidation failed', { merchantId, error: String(e) });
    }
  }

  // Get current merchant context (currency/settings/ai_config)
  app.get('/api/merchant/context', async (c) => {
    try {
      const merchantId = requireMerchantId(c);
      const rows = await sql<{
        id: string;
        business_name: string;
        currency: string | null;
        settings: Record<string, unknown> | null;
        ai_config: Record<string, unknown> | null;
      }>`
        SELECT id, business_name, currency, settings, ai_config
        FROM merchants
        WHERE id = ${merchantId}::uuid
        LIMIT 1
      `;
      if (!rows.length) return c.json({ ok: false, error: 'merchant_not_found' }, 404);
      return c.json({ ok: true, merchant: rows[0] });
    } catch (error) {
      log.error('Get merchant context failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  // Partially update merchant.settings (top-level merge)
  app.patch('/api/merchant/settings', async (c) => {
    try {
      const merchantId = requireMerchantId(c);
      const body = await c.req.json();
      const parsed = SettingsSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ ok: false, error: 'validation_error', details: parsed.error.issues }, 400);
      }

      const patch = parsed.data;
      const rows = await sql<{ settings: Record<string, unknown> }>`
        UPDATE merchants
        SET settings = COALESCE(settings, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb,
            updated_at = NOW()
        WHERE id = ${merchantId}::uuid
        RETURNING settings
      `;

      await invalidateMerchantCache(merchantId);
      return c.json({ ok: true, settings: rows[0]?.settings ?? {} });
    } catch (error) {
      log.error('Update merchant settings failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  // Partially update merchant.ai_config
  app.patch('/api/merchant/ai-config', async (c) => {
    try {
      const merchantId = requireMerchantId(c);
      const body = await c.req.json();
      const parsed = AIConfigSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ ok: false, error: 'validation_error', details: parsed.error.issues }, 400);
      }

      const patch = parsed.data;
      const rows = await sql<{ ai_config: Record<string, unknown> }>`
        UPDATE merchants
        SET ai_config = COALESCE(ai_config, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb,
            updated_at = NOW()
        WHERE id = ${merchantId}::uuid
        RETURNING ai_config
      `;

      await invalidateMerchantCache(merchantId);
      return c.json({ ok: true, ai_config: rows[0]?.ai_config ?? {} });
    } catch (error) {
      log.error('Update merchant ai_config failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  // Update merchant currency (ISO 4217)
  app.patch('/api/merchant/currency', async (c) => {
    try {
      const merchantId = requireMerchantId(c);
      const body = await c.req.json();
      const parsed = CurrencySchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ ok: false, error: 'validation_error', details: parsed.error.issues }, 400);
      }
      const currency = parsed.data.currency.toUpperCase();
      const rows = await sql<{ currency: string }>`
        UPDATE merchants
        SET currency = ${currency}, updated_at = NOW()
        WHERE id = ${merchantId}::uuid
        RETURNING currency
      `;

      await invalidateMerchantCache(merchantId);
      return c.json({ ok: true, currency: rows[0]?.currency ?? currency });
    } catch (error) {
      log.error('Update merchant currency failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });
}

export default registerMerchantAdminRoutes;

