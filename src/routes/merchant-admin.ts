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
import { ingestText } from '../kb/ingest.js';
import MerchantCatalogService from '../services/catalog/merchant-catalog.service.js';
import ConversationAnalytics from '../services/analytics/conversation-analytics.js';
import { getServiceController } from '../services/service-controller.js';
import { getDLQHealth, getDLQStats } from '../queue/dead-letter.js';
import { checkPredictiveServicesHealth } from '../startup/predictive-services.js';
import { runManualPredictiveAnalytics, getSchedulerService } from '../startup/predictive-services.js';
import { getComplianceService } from '../services/compliance.js';

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
  language: z.string().min(2).max(10).optional(),
  // Merchant-driven NLP/Entity hints to avoid hardcoding
  synonyms: z.record(z.array(z.string().min(1))).optional(),
  categories: z.array(z.string().min(1)).optional(),
  brands: z.array(z.string().min(1)).optional(),
  colors: z.array(z.string().min(1)).optional(),
  genders: z.array(z.string().min(1)).optional(),
  sizeAliases: z.record(z.array(z.string().min(1))).optional(),
  // Per-merchant custom entities (e.g., سيارات: موديل/سنة/وقود)
  customEntities: z.record(z.array(z.string().min(1))).optional(),
}).strict();

const CurrencySchema = z.object({
  currency: z.string().length(3)
});

export function registerMerchantAdminRoutes(app: Hono) {
  const db = getDatabase();
  const sql = db.getSQL();
  const cache = getCache();
  async function activateRLS(merchantId: string) {
    try { await sql`SELECT set_merchant_context(${merchantId}::uuid)`; } catch {}
  }

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
      await activateRLS(merchantId);
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
      await activateRLS(merchantId);
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
      await activateRLS(merchantId);
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
      await activateRLS(merchantId);
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

  // ===============================================
  // Knowledge Base Ingest (Text)
  // ===============================================
  const KBIngestSchema = z.object({
    title: z.string().min(1).max(200),
    text: z.string().min(1).max(200_000), // 200k chars safety limit
    chunkTokens: z.number().int().min(300).max(1200).optional(),
    overlapTokens: z.number().int().min(0).max(300).optional(),
    tags: z.record(z.union([z.string(), z.boolean()])).optional()
  });

  app.post('/api/kb/ingest-text', async (c) => {
    try {
      const merchantId = requireMerchantId(c);
      const body = await c.req.json();
      const parsed = KBIngestSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ ok: false, error: 'validation_error', details: parsed.error.issues }, 400);
      }

      // Ensure RLS context is set for this request (defensive)
      try {
        await sql`SELECT set_merchant_context(${merchantId}::uuid)`;
      } catch (ctxErr) {
        log.warn('Failed to set merchant context for kb ingest', { error: String(ctxErr) });
      }

      const { title, text, chunkTokens, overlapTokens, tags } = parsed.data;
      const opts: import('../kb/ingest.js').IngestOptions = {};
      if (typeof chunkTokens === 'number') opts.chunkTokens = chunkTokens;
      if (typeof overlapTokens === 'number') opts.overlapTokens = overlapTokens;
      if (tags && typeof tags === 'object') opts.tags = tags;
      const result = await ingestText(merchantId, title, text, opts);

      return c.json({ ok: true, inserted: result.inserted });
    } catch (error) {
      log.error('KB ingest API failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  // ===============================================
  // Merchant Catalog Analysis
  // ===============================================
  app.get('/api/merchant/catalog', async (c) => {
    try {
      const merchantId = requireMerchantId(c);
      await activateRLS(merchantId);
      const svc = new MerchantCatalogService();
      const profile = await svc.analyzeMerchantInventory(merchantId);
      return c.json({ ok: true, catalog: profile });
    } catch (error) {
      log.error('Get merchant catalog failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  // ===============================================
  // Merchant Analytics Dashboard (summary)
  // ===============================================
  app.get('/api/analytics/dashboard', async (c) => {
    try {
      const merchantId = requireMerchantId(c);
      await activateRLS(merchantId);
      const daysParam = c.req.query('days');
      const days = daysParam ? Math.max(1, Math.min(90, parseInt(daysParam))) : 30;
      const analytics = new ConversationAnalytics();
      const dashboard = await analytics.generateMerchantDashboard(merchantId, { days });
  // Additional analytics endpoints (time series, response time, intents)
  app.get('/api/analytics/conversations/timeseries', async (c) => {
    try {
      const merchantId = requireMerchantId(c);
      await activateRLS(merchantId);
      const days = Math.max(1, Math.min(180, parseInt(c.req.query('days') || '30')));
      const analytics = new ConversationAnalytics();
      const series = await analytics.getTimeSeries(merchantId, { days });
      return c.json({ ok: true, series });
    } catch (error) {
      log.error('Get analytics timeseries failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  app.get('/api/analytics/conversations/response-times', async (c) => {
    try {
      const merchantId = requireMerchantId(c);
      await activateRLS(merchantId);
      const days = Math.max(1, Math.min(180, parseInt(c.req.query('days') || '30')));
      const analytics = new ConversationAnalytics();
      const byHour = await analytics.getResponseTimeByHour(merchantId, { days });
      return c.json({ ok: true, byHour });
    } catch (error) {
      log.error('Get response times failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  app.get('/api/analytics/conversations/intents', async (c) => {
    try {
      const merchantId = requireMerchantId(c);
      await activateRLS(merchantId);
      const days = Math.max(1, Math.min(180, parseInt(c.req.query('days') || '30')));
      const limit = Math.max(1, Math.min(50, parseInt(c.req.query('limit') || '10')));
      const analytics = new ConversationAnalytics();
      const intents = await analytics.getTopIntents(merchantId, { days }, limit);
      return c.json({ ok: true, intents });
    } catch (error) {
      log.error('Get intents analytics failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });
      return c.json({ ok: true, dashboard });
    } catch (error) {
      log.error('Get analytics dashboard failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  // ===============================================
  // Service Management (toggle, status, health)
  // ===============================================
  app.get('/api/services/status', async (c) => {
    try {
      const merchantId = requireMerchantId(c);
      await activateRLS(merchantId);
      const sc = getServiceController();
      const services = await sc.getAllServicesStatus(merchantId);
      return c.json({ ok: true, services });
    } catch (error) {
      log.error('Get services status failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  app.get('/api/services/health', async (c) => {
    try {
      const merchantId = requireMerchantId(c);
      await activateRLS(merchantId);
      const sc = getServiceController();
      const health = await sc.getServicesHealth(merchantId);
      return c.json({ ok: true, health });
    } catch (error) {
      log.error('Get services health failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  app.post('/api/services/toggle', async (c) => {
    try {
      const merchantId = requireMerchantId(c);
      await activateRLS(merchantId);
      const body = await c.req.json();
      const sc = getServiceController();
      const req = {
        merchantId,
        service: String(body?.service || '').trim(),
        enabled: !!body?.enabled,
        toggledBy: String((body?.toggledBy || 'admin')).trim(),
        reason: String((body?.reason || '')).trim()
      } as any;
      if (!req.service) return c.json({ ok: false, error: 'service_required' }, 400);
      const result = await sc.toggleService(req);
      return c.json({ ok: result.success, message: result.message, previous: result.previousState });
    } catch (error) {
      log.error('Toggle service failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  // ===============================================
  // Performance Overview (DLQ, Predictive, basic counters)
  // ===============================================
  app.get('/api/performance/overview', async (c) => {
    try {
      const merchantId = requireMerchantId(c);
      await activateRLS(merchantId);
      const sql = db.getSQL();

      // Basic counters from message_logs
      const [msgStats] = await sql<{ total_7d: number; incoming_7d: number; outgoing_7d: number; avg_latency_ms: number }>`
        WITH window AS (
          SELECT * FROM message_logs ml
          JOIN conversations c ON c.id = ml.conversation_id
          WHERE c.merchant_id = ${merchantId}::uuid
            AND ml.created_at >= NOW() - INTERVAL '7 days'
        )
        SELECT 
          COUNT(*)::int as total_7d,
          COUNT(*) FILTER (WHERE direction = 'INCOMING')::int as incoming_7d,
          COUNT(*) FILTER (WHERE direction = 'OUTGOING')::int as outgoing_7d,
          COALESCE(AVG(processing_time_ms)::int, 0) as avg_latency_ms
        FROM window
      `;

      const dlq = getDLQHealth();
      const dlqStats = getDLQStats();
      const predictive = checkPredictiveServicesHealth();

      return c.json({
        ok: true,
        message_logs: msgStats || { total_7d: 0, incoming_7d: 0, outgoing_7d: 0, avg_latency_ms: 0 },
        dlq,
        dlqStats,
        predictive
      });
    } catch (error) {
      log.error('Get performance overview failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  // ===============================================
  // ML Performance Tracking (status, metrics, manual run)
  // ===============================================
  app.get('/api/predictive/status', async (c) => {
    try {
      const health = checkPredictiveServicesHealth();
      const running = !!getSchedulerService()?.getStatus().isRunning;
      return c.json({ ok: true, health, running });
    } catch (error) {
      log.error('Predictive status failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  app.post('/api/predictive/run-manual', async (c) => {
    try {
      const result = await runManualPredictiveAnalytics();
      return c.json({ ok: result.success, results: result.results, error: result.error });
    } catch (error) {
      log.error('Manual predictive analytics failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  app.get('/api/predictive/metrics', async (c) => {
    try {
      const merchantId = requireMerchantId(c);
      await activateRLS(merchantId);
      const daysParam = c.req.query('days');
      const modelParam = c.req.query('model');
      const days = daysParam ? Math.max(1, Math.min(180, parseInt(daysParam))) : 60;

      const sql = db.getSQL();
      if (modelParam) {
        const rows = await sql<{
          model_type: string; accuracy_score: number; training_data_size: number; evaluation_date: string; model_version: string;
        }>`
          SELECT model_type, accuracy_score, training_data_size, evaluation_date, model_version
          FROM ml_model_performance
          WHERE evaluation_date >= NOW() - INTERVAL '${days} days'
            AND model_type = ${modelParam}
          ORDER BY evaluation_date DESC
          LIMIT 1000
        `;
        return c.json({ ok: true, metrics: rows });
      } else {
        const rows = await sql<{
          model_type: string; accuracy_score: number; training_data_size: number; evaluation_date: string; model_version: string;
        }>`
          SELECT model_type, accuracy_score, training_data_size, evaluation_date, model_version
          FROM ml_model_performance
          WHERE evaluation_date >= NOW() - INTERVAL '${days} days'
          ORDER BY evaluation_date DESC
          LIMIT 1000
        `;
        return c.json({ ok: true, metrics: rows });
      }
    } catch (error) {
      log.error('Get predictive metrics failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  // ===============================================
  // Compliance Logs (view) and Manual Security Check
  // ===============================================
  app.get('/api/compliance/logs', async (c) => {
    try {
      const merchantId = requireMerchantId(c);
      await activateRLS(merchantId);
      const daysParam = c.req.query('days');
      const days = daysParam ? Math.max(1, Math.min(180, parseInt(daysParam))) : 30;
      const rows = await sql<{
        id: string; compliance_type: string; status: string; event_data: any; created_at: string;
      }>`
        SELECT id, compliance_type, status, event_data, created_at
        FROM compliance_logs
        WHERE merchant_id = ${merchantId}::uuid
          AND created_at >= NOW() - INTERVAL '${days} days'
        ORDER BY created_at DESC
        LIMIT 1000
      `;
      return c.json({ ok: true, logs: rows });
    } catch (error) {
      log.error('Get compliance logs failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  app.post('/api/security/runtime-check', async (c) => {
    try {
      const merchantId = requireMerchantId(c);
      await activateRLS(merchantId);
      const svc = getComplianceService();
      // Minimal quick checks: JWT length and IG token presence
      const jwtOk = !!process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32;
      const igOk = !!process.env.META_APP_SECRET && (process.env.META_APP_SECRET || '').length >= 32;
      const status = jwtOk && igOk ? 'SUCCESS' : 'FAILURE';
      await svc.logSecurity(merchantId, 'RUNTIME_QUICK_CHECK', status as any, { jwtOk, igOk });
      return c.json({ ok: true, result: { jwtOk, igOk, status } });
    } catch (error) {
      log.error('Runtime quick security check failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  // ===============================================
  // Instagram Business API Admin Helpers
  // ===============================================
  app.get('/api/instagram/health', async (c) => {
    try {
      const merchantId = requireMerchantId(c);
      const { getInstagramClient } = await import('../services/instagram-api.js');
      const client = await getInstagramClient(merchantId);
      const creds = await client.loadMerchantCredentials(merchantId);
      const health = await client.healthCheck(creds, merchantId);
      return c.json({ ok: true, health, hasCredentials: !!creds });
    } catch (error) {
      log.error('Instagram health failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  app.get('/api/instagram/profile', async (c) => {
    try {
      const merchantId = requireMerchantId(c);
      const { getInstagramClient } = await import('../services/instagram-api.js');
      const client = await getInstagramClient(merchantId);
      const creds = await client.loadMerchantCredentials(merchantId);
      if (!creds) return c.json({ ok: false, error: 'not_connected' }, 404);
      const profile = await client.getBusinessAccountInfo(creds, merchantId);
      return c.json({ ok: true, profile });
    } catch (error) {
      log.error('Instagram profile failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  app.post('/api/instagram/send-test', async (c) => {
    try {
      const merchantId = requireMerchantId(c);
      const body = await c.req.json();
      const recipientId = String(body?.recipientId || '').trim();
      const message = String(body?.message || 'Test from admin').trim();
      if (!recipientId) return c.json({ ok: false, error: 'recipientId_required' }, 400);

      const { getInstagramClient } = await import('../services/instagram-api.js');
      const client = await getInstagramClient(merchantId);
      const creds = await client.loadMerchantCredentials(merchantId);
      if (!creds) return c.json({ ok: false, error: 'not_connected' }, 404);

      const res = await client.sendMessage(creds, merchantId, { recipientId, content: message });
      return c.json({ ok: res.success, result: res });
    } catch (error) {
      log.error('Instagram send-test failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });
}

export default registerMerchantAdminRoutes;
