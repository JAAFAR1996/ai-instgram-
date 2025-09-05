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
import { randomUUID } from 'crypto';

const log = getLogger({ component: 'merchant-admin-routes' });

// Professional TypeScript interfaces for Product Analytics
interface ProductAnalyticsOverview {
  readonly merchant_id: string;
  readonly period: '7d' | '30d' | '90d' | '1y';
  readonly total_products: number;
  readonly active_products: number;
  readonly total_revenue: number;
  readonly units_sold: number;
  readonly avg_order_value: number;
  readonly inventory_value: number;
  readonly low_stock_alerts: number;
  readonly top_category: string;
  readonly best_seller_name: string;
  readonly performance_score: number;
  readonly growth_rate: number;
  readonly metadata: {
    readonly query_time_ms: number;
    readonly cached: boolean;
    readonly data_freshness: string;
  };
}

interface TopPerformingProduct {
  readonly product_id: string;
  readonly product_name: string;
  readonly sku: string | null;
  readonly total_revenue: number;
  readonly units_sold: number;
  readonly profit_margin: number;
  readonly stock_quantity: number;
  readonly performance_rank: number;
  readonly revenue_share_percent: number;
}

interface InventoryAlert {
  readonly product_id: string;
  readonly product_name: string;
  readonly sku: string | null;
  readonly stock_quantity: number;
  readonly alert_type: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'OVERSTOCK';
  readonly severity: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly days_until_stockout: number | null;
  readonly suggested_reorder_qty: number | null;
  readonly priority_score: number;
}

// Input validation schemas
const AnalyticsQuerySchema = z.object({
  period: z.enum(['7d', '30d', '90d', '1y']).default('30d'),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  category: z.string().optional(),
  sort: z.enum(['revenue', 'units_sold', 'profit_margin', 'performance_rank']).default('revenue'),
  order: z.enum(['asc', 'desc']).default('desc')
});

// Cache configuration
const CACHE_CONFIG = {
  overview: { ttl: 300, key: (merchantId: string, period: string) => `analytics:overview:${merchantId}:${period}` },
  topPerformers: { ttl: 600, key: (merchantId: string, period: string) => `analytics:top:${merchantId}:${period}` },
  alerts: { ttl: 120, key: (merchantId: string) => `analytics:alerts:${merchantId}` }
} as const;

// Working hours schema with proper type validation
const WorkingHoursSchema = z.object({
  monday: z.object({ open: z.string(), close: z.string(), closed: z.boolean().optional() }).optional(),
  tuesday: z.object({ open: z.string(), close: z.string(), closed: z.boolean().optional() }).optional(),
  wednesday: z.object({ open: z.string(), close: z.string(), closed: z.boolean().optional() }).optional(),
  thursday: z.object({ open: z.string(), close: z.string(), closed: z.boolean().optional() }).optional(),
  friday: z.object({ open: z.string(), close: z.string(), closed: z.boolean().optional() }).optional(),
  saturday: z.object({ open: z.string(), close: z.string(), closed: z.boolean().optional() }).optional(),
  sunday: z.object({ open: z.string(), close: z.string(), closed: z.boolean().optional() }).optional(),
}).optional();

const SettingsSchema = z.object({
  payment_methods: z.array(z.string().min(1).max(40)).max(10).optional(),
  delivery_fees: z.record(z.union([z.string(), z.number()])).optional(),
  working_hours: WorkingHoursSchema,
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
  // Per-merchant custom entities (e.g., ??????: ?????/???/????)
  customEntities: z.record(z.array(z.string().min(1))).optional(),
}).strict();

const CurrencySchema = z.object({
  currency: z.string().length(3)
});

const SalesStyleSchema = z.object({
  salesStyle: z.string().min(1).max(50)
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
        sales_style: string | null;
        settings: Record<string, unknown> | null;
        ai_config: Record<string, unknown> | null;
      }>`
        SELECT id, business_name, currency, sales_style, settings, ai_config
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

  // Update merchant sales style
  app.patch('/api/merchant/sales-style', async (c) => {
    try {
      const merchantId = requireMerchantId(c);
      await activateRLS(merchantId);
      const body = await c.req.json();
      const parsed = SalesStyleSchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ ok: false, error: 'validation_error', details: parsed.error.issues }, 400);
      }
      const salesStyle = parsed.data.salesStyle;
      const rows = await sql<{ sales_style: string }>`
        UPDATE merchants
        SET sales_style = ${salesStyle}, updated_at = NOW()
        WHERE id = ${merchantId}::uuid
        RETURNING sales_style
      `;

      await invalidateMerchantCache(merchantId);
      return c.json({ ok: true, salesStyle: rows[0]?.sales_style ?? salesStyle });
    } catch (error) {
      log.error('Update merchant sales style failed', { error: String(error) });
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
      const req: import('../types/service-control.js').ServiceToggleRequest = {
        merchantId,
        service: String(body?.service ?? '').trim() as import('../types/service-control.js').ServiceName,
        enabled: !!body?.enabled,
        toggledBy: String((body?.toggledBy || 'admin')).trim(),
        reason: String((body?.reason ?? '')).trim()
      };
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
        id: string; compliance_type: string; status: string; event_data: Record<string, unknown>; created_at: string;
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
      const igOk = !!process.env.META_APP_SECRET && (process.env.META_APP_SECRET ?? '').length >= 32;
      const status = jwtOk && igOk ? 'SUCCESS' : 'FAILURE';
      await svc.logSecurity(merchantId, 'RUNTIME_QUICK_CHECK', status, { jwtOk, igOk });
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
      const recipientId = String(body?.recipientId ?? '').trim();
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

  // Product Performance Analytics Endpoints
  app.get('/api/merchant/product-analytics/overview', async (c) => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    
    try {
      const merchantId = (c as any).get('merchantId') as string | undefined;
      if (!merchantId) {
        log.warn('Product analytics overview - missing merchant ID', { requestId });
        return c.json({ error: 'Merchant ID required', requestId }, 401);
      }

      // Input validation with comprehensive schema
      const periodParam = c.req.query('period') || '30d';
      const validPeriods = ['7d', '30d', '90d', '1y'] as const;
      const period = (validPeriods as readonly string[]).includes(periodParam) ? periodParam as typeof validPeriods[number] : '30d';
      const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365;

      log.info('Product analytics overview request', { merchantId, period, requestId });

      // Check cache first for production performance
      const cache = getCache();
      const cacheKey = CACHE_CONFIG.overview.key(merchantId, period);
      try {
        const cachedResult = await cache.get<ProductAnalyticsOverview>(cacheKey);
        if (cachedResult) {
          const result = cachedResult;
          log.info('Product analytics overview served from cache', { merchantId, period, requestId, cacheHit: true });
          return c.json({ success: true, data: result, cached: true }, 200);
        }
      } catch (cacheError) {
        log.warn('Cache read failed for product analytics', { merchantId, requestId, error: String(cacheError) });
      }

      // Advanced SQL query with performance optimizations
      const overview = await sql<{
        total_products: number;
        active_products: number;
        total_revenue: number;
        units_sold: number;
        avg_order_value: number;
        inventory_value: number;
        low_stock_alerts: number;
        top_category: string;
        best_seller_name: string;
        performance_score: number;
        growth_rate: number;
      }>`
        WITH product_stats AS (
          SELECT 
            COUNT(DISTINCT p.id) as total_products,
            COUNT(DISTINCT CASE WHEN p.stock_quantity > 0 THEN p.id END) as active_products,
            COALESCE(SUM(p.stock_quantity * COALESCE(p.price, 0)), 0) as inventory_value,
            COUNT(CASE WHEN p.stock_quantity > 0 AND p.stock_quantity <= 5 THEN 1 END) as low_stock_alerts
          FROM products p
          WHERE p.merchant_id = ${merchantId}::uuid
            AND p.deleted_at IS NULL
        ),
        sales_stats AS (
          SELECT 
            COALESCE(SUM(oi.quantity * oi.unit_price), 0) as total_revenue,
            COALESCE(SUM(oi.quantity), 0) as units_sold,
            COUNT(DISTINCT o.id) as total_orders,
            MODE() WITHIN GROUP (ORDER BY p.category) as top_category
          FROM orders o
          JOIN order_items oi ON o.id = oi.order_id
          JOIN products p ON oi.product_id = p.id
          WHERE o.merchant_id = ${merchantId}::uuid
            AND o.created_at >= NOW() - INTERVAL '${periodDays} days'
            AND o.status NOT IN ('cancelled', 'refunded')
        ),
        best_seller AS (
          SELECT 
            p.name as best_seller_name,
            SUM(oi.quantity) as total_units
          FROM products p
          JOIN order_items oi ON p.id = oi.product_id
          JOIN orders o ON oi.order_id = o.id
          WHERE o.merchant_id = ${merchantId}::uuid
            AND o.created_at >= NOW() - INTERVAL '${periodDays} days'
            AND o.status NOT IN ('cancelled', 'refunded')
            AND p.deleted_at IS NULL
          GROUP BY p.name
          ORDER BY total_units DESC
          LIMIT 1
        ),
        performance_metrics AS (
          SELECT 
            CASE 
              WHEN ps.total_products > 0 AND ps.active_products > 0 THEN 
                LEAST(100, (ps.active_products::numeric / ps.total_products) * 100)
              ELSE 0 
            END as performance_score,
            CASE 
              WHEN ss.total_revenue > 0 THEN (
                SELECT COALESCE(
                  ((ss.total_revenue - prev.prev_revenue) / NULLIF(prev.prev_revenue, 0)) * 100,
                  0
                )
                FROM (
                  SELECT COALESCE(SUM(oi.quantity * oi.unit_price), 0) as prev_revenue
                  FROM orders o
                  JOIN order_items oi ON o.id = oi.order_id
                  WHERE o.merchant_id = ${merchantId}::uuid
                    AND o.created_at >= NOW() - INTERVAL '${periodDays * 2} days'
                    AND o.created_at < NOW() - INTERVAL '${periodDays} days'
                    AND o.status NOT IN ('cancelled', 'refunded')
                ) prev
              )
              ELSE 0
            END as growth_rate
          FROM product_stats ps
          CROSS JOIN sales_stats ss
        )
        SELECT 
          ps.total_products::int,
          ps.active_products::int,
          ss.total_revenue::numeric,
          ss.units_sold::int,
          CASE WHEN ss.total_orders > 0 THEN ROUND(ss.total_revenue / ss.total_orders, 2) ELSE 0 END::numeric as avg_order_value,
          ps.inventory_value::numeric,
          ps.low_stock_alerts::int,
          COALESCE(ss.top_category, 'N/A') as top_category,
          COALESCE(bs.best_seller_name, 'N/A') as best_seller_name,
          ROUND(pm.performance_score, 2)::numeric as performance_score,
          ROUND(pm.growth_rate, 2)::numeric as growth_rate
        FROM product_stats ps
        CROSS JOIN sales_stats ss
        CROSS JOIN performance_metrics pm
        LEFT JOIN best_seller bs ON true
      `;

      const queryTime = Date.now() - startTime;
      
      const result: ProductAnalyticsOverview = {
        merchant_id: merchantId,
        period: period as '7d' | '30d' | '90d' | '1y',
        ...( overview[0] || {
          total_products: 0, active_products: 0, total_revenue: 0,
          units_sold: 0, avg_order_value: 0, inventory_value: 0,
          low_stock_alerts: 0, top_category: 'N/A', best_seller_name: 'N/A',
          performance_score: 0, growth_rate: 0
        }),
        metadata: {
          query_time_ms: queryTime,
          cached: false,
          data_freshness: new Date().toISOString()
        }
      };

      // Cache the result for future requests
      try {
        await cache.set(cacheKey, result, { ttl: CACHE_CONFIG.overview.ttl });
        log.debug('Product analytics overview cached', { merchantId, period, requestId, ttl: CACHE_CONFIG.overview.ttl });
      } catch (cacheError) {
        log.warn('Failed to cache product analytics overview', { merchantId, requestId, error: String(cacheError) });
      }

      log.info('Product analytics overview completed', {
        merchantId, period, requestId, queryTimeMs: queryTime,
        totalProducts: result.total_products, totalRevenue: result.total_revenue
      });

      return c.json({ success: true, data: result }, 200);
    } catch (error) {
      const queryTime = Date.now() - startTime;
      log.error('Product analytics overview failed', { 
        merchantId: ((c as any).get('merchantId') as string | undefined), 
        requestId, 
        error: String(error), 
        queryTimeMs: queryTime,
        stack: error instanceof Error ? error.stack : undefined
      });
      return c.json({ 
        error: 'Failed to fetch analytics overview', 
        requestId, 
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined 
      }, 500);
    }
  });

  app.get('/api/merchant/product-analytics/top-performers', async (c) => {
    const requestId = randomUUID();
    const startTime = Date.now();
    
    try {
      const merchantId = (c as any).get('merchantId') as string | undefined;
      if (!merchantId) {
        log.warn('Top performers analytics - missing merchant ID', { requestId });
        return c.json({ error: 'Merchant ID required', requestId }, 401);
      }

      // Comprehensive input validation
      const queryValidation = AnalyticsQuerySchema.safeParse(c.req.query());
      if (!queryValidation.success) {
        log.warn('Top performers analytics - invalid parameters', { 
          merchantId, requestId, errors: queryValidation.error.issues 
        });
        return c.json({ 
          error: 'Invalid query parameters', 
          requestId, 
          details: queryValidation.error.issues 
        }, 400);
      }

      const { period, limit, category, sort, order } = queryValidation.data;
      const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 365;

      log.info('Top performers analytics request', { merchantId, period, limit, category, requestId });

      // Cache implementation
      const cache = getCache();
      const cacheKey = CACHE_CONFIG.topPerformers.key(merchantId, period) + `:${limit}:${category || 'all'}:${sort}:${order}`;
      
      try {
        const cachedResult = await cache.get<{ products: TopPerformingProduct[]; metadata: Record<string, unknown> }>(cacheKey);
        if (cachedResult) {
          const result = cachedResult;
          log.info('Top performers served from cache', { merchantId, requestId, cacheHit: true });
          return c.json({ success: true, data: result.products, metadata: { ...result.metadata, cached: true } }, 200);
        }
      } catch (cacheError) {
        log.warn('Cache read failed for top performers', { merchantId, requestId, error: String(cacheError) });
      }

      // Advanced analytics query with ranking and performance metrics
      const topProducts = await sql<{
        product_id: string;
        product_name: string;
        sku: string | null;
        total_revenue: number;
        units_sold: number;
        profit_margin: number;
        stock_quantity: number;
        performance_rank: number;
        revenue_share_percent: number;
      }>`
        WITH total_revenue_context AS (
          SELECT SUM(oi.quantity * oi.unit_price) as total_merchant_revenue
          FROM orders o
          JOIN order_items oi ON o.id = oi.order_id
          JOIN products p ON oi.product_id = p.id
          WHERE o.merchant_id = ${merchantId}::uuid
            AND o.created_at >= NOW() - INTERVAL '${periodDays} days'
            AND o.status NOT IN ('cancelled', 'refunded')
            AND p.deleted_at IS NULL
        ),
        product_performance AS (
          SELECT 
            p.id,
            p.name,
            p.sku,
            p.stock_quantity,
            p.price,
            p.cost_price,
            ${category ? sql`p.category = ${category} as category_match,` : sql``}
            COALESCE(SUM(oi.quantity * oi.unit_price), 0) as total_revenue,
            COALESCE(SUM(oi.quantity), 0) as units_sold,
            COUNT(DISTINCT o.id) as order_count,
            AVG(oi.unit_price) as avg_unit_price
          FROM products p
          LEFT JOIN order_items oi ON p.id = oi.product_id
          LEFT JOIN orders o ON oi.order_id = o.id 
            AND o.created_at >= NOW() - INTERVAL '${periodDays} days'
            AND o.status NOT IN ('cancelled', 'refunded')
          WHERE p.merchant_id = ${merchantId}::uuid
            AND p.deleted_at IS NULL
            ${category ? sql`AND p.category = ${category}` : sql``}
          GROUP BY p.id, p.name, p.sku, p.stock_quantity, p.price, p.cost_price
        )
        SELECT 
          pp.id::text as product_id,
          pp.name as product_name,
          pp.sku,
          pp.total_revenue::numeric,
          pp.units_sold::int,
          CASE 
            WHEN pp.cost_price > 0 AND pp.price > pp.cost_price THEN 
              ROUND(((pp.price - pp.cost_price) / pp.price) * 100, 2)
            ELSE 0 
          END::numeric as profit_margin,
          pp.stock_quantity::int,
          ROW_NUMBER() OVER (ORDER BY 
            CASE WHEN ${sort} = 'revenue' THEN pp.total_revenue
                 WHEN ${sort} = 'units_sold' THEN pp.units_sold
                 WHEN ${sort} = 'profit_margin' THEN 
                   CASE WHEN pp.cost_price > 0 THEN ((pp.price - pp.cost_price) / pp.price) * 100 ELSE 0 END
                 ELSE pp.total_revenue END 
            ${order === 'desc' ? sql`DESC` : sql`ASC`}
          )::int as performance_rank,
          CASE 
            WHEN trc.total_merchant_revenue > 0 THEN 
              ROUND((pp.total_revenue / trc.total_merchant_revenue) * 100, 2)
            ELSE 0 
          END::numeric as revenue_share_percent
        FROM product_performance pp
        CROSS JOIN total_revenue_context trc
        WHERE pp.total_revenue > 0
        ORDER BY 
          CASE WHEN ${sort} = 'revenue' THEN pp.total_revenue
               WHEN ${sort} = 'units_sold' THEN pp.units_sold
               WHEN ${sort} = 'profit_margin' THEN 
                 CASE WHEN pp.cost_price > 0 THEN ((pp.price - pp.cost_price) / pp.price) * 100 ELSE 0 END
               WHEN ${sort} = 'performance_rank' THEN pp.total_revenue
               ELSE pp.total_revenue END 
          ${order === 'desc' ? sql`DESC` : sql`ASC`}
        LIMIT ${limit}
      `;

      const queryTime = Date.now() - startTime;
      const result = {
        products: topProducts as TopPerformingProduct[],
        metadata: {
          query_time_ms: queryTime,
          cached: false,
          period,
          total_results: topProducts.length,
          filters: { category, sort, order },
          data_freshness: new Date().toISOString()
        }
      };

      // Cache the result
      try {
        await cache.set(cacheKey, result, { ttl: CACHE_CONFIG.topPerformers.ttl });
        log.debug('Top performers cached', { merchantId, requestId, ttl: CACHE_CONFIG.topPerformers.ttl });
      } catch (cacheError) {
        log.warn('Failed to cache top performers', { merchantId, requestId, error: String(cacheError) });
      }

      log.info('Top performers analytics completed', {
        merchantId, requestId, queryTimeMs: queryTime, resultsCount: topProducts.length
      });

      return c.json({ success: true, data: result.products, metadata: result.metadata }, 200);
    } catch (error) {
      const queryTime = Date.now() - startTime;
      log.error('Top performers analytics failed', { 
        merchantId: ((c as any).get('merchantId') as string | undefined), 
        requestId, 
        error: String(error), 
        queryTimeMs: queryTime,
        stack: error instanceof Error ? error.stack : undefined
      });
      return c.json({ 
        error: 'Failed to fetch top performers', 
        requestId, 
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined 
      }, 500);
    }
  });

  app.get('/api/merchant/product-analytics/inventory-alerts', async (c) => {
    const requestId = randomUUID();
    const startTime = Date.now();
    
    try {
      const merchantId = (c as any).get('merchantId') as string | undefined;
      if (!merchantId) {
        log.warn('Inventory alerts - missing merchant ID', { requestId });
        return c.json({ error: 'Merchant ID required', requestId }, 401);
      }

      log.info('Inventory alerts request', { merchantId, requestId });

      // Cache implementation for alerts
      const cache = getCache();
      const cacheKey = CACHE_CONFIG.alerts.key(merchantId);
      
      try {
        const cachedResult = await cache.get<{ alerts: InventoryAlert[]; metadata: Record<string, unknown> }>(cacheKey);
        if (cachedResult) {
          const result = cachedResult;
          log.info('Inventory alerts served from cache', { merchantId, requestId, cacheHit: true });
          return c.json({ success: true, data: result.alerts, metadata: { ...result.metadata, cached: true } }, 200);
        }
      } catch (cacheError) {
        log.warn('Cache read failed for inventory alerts', { merchantId, requestId, error: String(cacheError) });
      }

      // Advanced inventory analysis with predictive metrics
      const alerts = await sql<{
        product_id: string;
        product_name: string;
        sku: string | null;
        stock_quantity: number;
        alert_type: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'OVERSTOCK';
        severity: 'HIGH' | 'MEDIUM' | 'LOW';
        days_until_stockout: number | null;
        suggested_reorder_qty: number | null;
        priority_score: number;
      }>`
        WITH sales_velocity AS (
          SELECT 
            oi.product_id,
            AVG(oi.quantity) as avg_daily_sales,
            COUNT(*) as order_frequency
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          WHERE o.merchant_id = ${merchantId}::uuid
            AND o.created_at >= NOW() - INTERVAL '30 days'
            AND o.status NOT IN ('cancelled', 'refunded')
          GROUP BY oi.product_id
        ),
        inventory_analysis AS (
          SELECT 
            p.id,
            p.name,
            p.sku,
            p.stock_quantity,
            p.price,
            COALESCE(sv.avg_daily_sales, 0) as avg_daily_sales,
            CASE 
              WHEN p.stock_quantity <= 0 THEN 'OUT_OF_STOCK'
              WHEN p.stock_quantity <= 5 THEN 'LOW_STOCK'
              WHEN p.stock_quantity >= 100 THEN 'OVERSTOCK'
              ELSE 'NORMAL'
            END as alert_type,
            CASE 
              WHEN p.stock_quantity <= 0 THEN 'HIGH'
              WHEN p.stock_quantity <= 2 THEN 'HIGH'
              WHEN p.stock_quantity <= 5 THEN 'MEDIUM'
              WHEN p.stock_quantity >= 100 THEN 'LOW'
              ELSE 'NONE'
            END as severity,
            CASE 
              WHEN COALESCE(sv.avg_daily_sales, 0) > 0 THEN 
                CEIL(p.stock_quantity / sv.avg_daily_sales)
              ELSE NULL
            END as days_until_stockout,
            CASE 
              WHEN COALESCE(sv.avg_daily_sales, 0) > 0 AND p.stock_quantity <= 10 THEN 
                GREATEST(20, CEIL(sv.avg_daily_sales * 14)) -- 14 days supply
              ELSE NULL
            END as suggested_reorder_qty,
            -- Priority scoring: stock level (40%) + sales velocity (30%) + value (30%)
            (
              CASE 
                WHEN p.stock_quantity <= 0 THEN 100
                WHEN p.stock_quantity <= 2 THEN 90
                WHEN p.stock_quantity <= 5 THEN 70
                WHEN p.stock_quantity >= 100 THEN 30
                ELSE 50
              END * 0.4 +
              LEAST(100, COALESCE(sv.avg_daily_sales, 0) * 10) * 0.3 +
              LEAST(100, (p.price / 1000)) * 0.3
            ) as priority_score
          FROM products p
          LEFT JOIN sales_velocity sv ON p.id = sv.product_id
          WHERE p.merchant_id = ${merchantId}::uuid
            AND p.deleted_at IS NULL
            AND (
              p.stock_quantity <= 5 
              OR p.stock_quantity >= 100 
              OR (COALESCE(sv.avg_daily_sales, 0) > 0 AND p.stock_quantity / sv.avg_daily_sales <= 7)
            )
        )
        SELECT 
          id::text as product_id,
          name as product_name,
          sku,
          stock_quantity::int,
          alert_type::text as alert_type,
          severity::text as severity,
          days_until_stockout::int,
          suggested_reorder_qty::int,
          ROUND(priority_score, 2)::numeric as priority_score
        FROM inventory_analysis
        ORDER BY priority_score DESC, stock_quantity ASC
        LIMIT 50
      `;

      const queryTime = Date.now() - startTime;
      const result = {
        alerts: alerts as InventoryAlert[],
        metadata: {
          query_time_ms: queryTime,
          cached: false,
          total_alerts: alerts.length,
          alert_breakdown: {
            high_priority: alerts.filter(a => a.severity === 'HIGH').length,
            medium_priority: alerts.filter(a => a.severity === 'MEDIUM').length,
            low_priority: alerts.filter(a => a.severity === 'LOW').length,
            out_of_stock: alerts.filter(a => a.alert_type === 'OUT_OF_STOCK').length,
            low_stock: alerts.filter(a => a.alert_type === 'LOW_STOCK').length,
            overstock: alerts.filter(a => a.alert_type === 'OVERSTOCK').length
          },
          data_freshness: new Date().toISOString()
        }
      };

      // Cache the result
      try {
        await cache.set(cacheKey, result, { ttl: CACHE_CONFIG.alerts.ttl });
        log.debug('Inventory alerts cached', { merchantId, requestId, ttl: CACHE_CONFIG.alerts.ttl });
      } catch (cacheError) {
        log.warn('Failed to cache inventory alerts', { merchantId, requestId, error: String(cacheError) });
      }

      log.info('Inventory alerts completed', {
        merchantId, requestId, queryTimeMs: queryTime, 
        alertsCount: alerts.length, 
        highPriority: result.metadata.alert_breakdown.high_priority
      });

      return c.json({ success: true, data: result.alerts, metadata: result.metadata }, 200);
    } catch (error) {
      const queryTime = Date.now() - startTime;
      log.error('Inventory alerts failed', { 
        merchantId: ((c as any).get('merchantId') as string | undefined), 
        requestId, 
        error: String(error), 
        queryTimeMs: queryTime,
        stack: error instanceof Error ? error.stack : undefined
      });
      return c.json({ 
        error: 'Failed to fetch inventory alerts', 
        requestId, 
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined 
      }, 500);
    }
  });
}

export default registerMerchantAdminRoutes;
