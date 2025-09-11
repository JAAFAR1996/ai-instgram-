/**
 * ===============================================
 * Production Entry Point - AI Sales Platform
 * Modular, secure, and production-ready initialization
 * ===============================================
 */

// 1) Global error handlers first
import './boot/error-handlers.js';
// Optional: Sentry error tracking (enabled only if SENTRY_DSN is set)
try {
  const dsn = process.env.SENTRY_DSN;
  if (dsn && dsn.trim()) {
    const Sentry = await import('@sentry/node');
    Sentry.init({ dsn, tracesSampleRate: 0.05 });
  }
} catch {}

// 2) Validate environment strictly before any side effects
import { assertEnvStrict } from './startup/security-validations.js';
assertEnvStrict();

// 3) Validate username-only architecture compliance
import { validateArchitectureCompliance } from './utils/architecture-guard.js';
validateArchitectureCompliance();

// 3) Core imports
import { Hono } from 'hono';

import { serve } from '@hono/node-server';

// 4) Logger and telemetry
import { getLogger } from './services/logger.js';
import { initTelemetry, telemetry } from './services/telemetry.js';
import { randomUUID } from 'crypto';
// Make prom-client optional
let promClient: typeof import('prom-client') | null = null;
try { promClient = await import('prom-client'); } catch { /* prom-client not available */ }

// 5) Startup modules
import { getPool } from './startup/database.js';
import { initializeRedisIntegration } from './startup/redis.js';
import { scheduleMaintenance } from './startup/maintenance.js';
import { initializePredictiveServices } from './startup/predictive-services.js';
import { initializeSecurityCompliance } from './startup/security-compliance.js';
import { initializeHashtagServices } from './startup/hashtag-services.js';

// 6) Middleware imports
import { securityHeaders, rateLimiter } from './middleware/security.js';
import { createIdempotencyMiddleware } from './middleware/idempotency.js';
import rlsMiddleware from './middleware/rls-merchant-isolation.js';
import { registerErrorHandler } from './middleware/error-handler.js';
// 7) Routes imports
import { registerWebhookRoutes } from './routes/webhooks.js';
import { registerMerchantAdminRoutes } from './routes/merchant-admin.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerQueueControlRoutes } from './routes/queue-admin.js';
import { registerUtilityMessageRoutes } from './routes/utility-messages.js';
import { registerImageSearchRoutes } from './routes/image-search.js';
import { registerMessageAnalyticsRoutes } from './routes/message-analytics.js';
import fs from 'node:fs';
import path from 'node:path';

// 8) Health monitoring
import { getHealthSnapshot, startHealth } from './services/health-check.js';
import { ProductionQueueManager } from './services/ProductionQueueManager.js';
import { RedisEnvironment, RedisUsageType } from './config/RedisConfigurationFactory.js';
import { getRedisConnectionManager } from './services/RedisConnectionManager.js';
import { KeepAliveService } from './services/keep-alive.js';

// Initialize logger
const log = getLogger({ component: 'bootstrap' });

async function bootstrap() {
  try {
    log.info('Starting AI Sales Platform...');

    // Initialize telemetry first
    await initTelemetry();
    log.info('Telemetry initialized');

    // Validate required environment variables
    const requiredEnvVars = ['META_APP_SECRET', 'IG_VERIFY_TOKEN', 'ENCRYPTION_KEY_HEX'];
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Required environment variable missing: ${envVar}`);
      }
    }

    // Critical JWT Secret validation
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters long for production security');
    }
    
    // Additional security validations for production
    if (process.env.NODE_ENV === 'production') {
      if (process.env.ENCRYPTION_KEY_HEX && process.env.ENCRYPTION_KEY_HEX.length < 64) {
        throw new Error('ENCRYPTION_KEY_HEX must be at least 64 characters (32 bytes) for production');
      }
      
      if (process.env.IG_VERIFY_TOKEN && process.env.IG_VERIFY_TOKEN.length < 20) {
        throw new Error('IG_VERIFY_TOKEN must be at least 20 characters for production security');
      }
    }
    
    log.info('Environment variables and security requirements validated');

    // Additional production checks
    if (process.env.NODE_ENV === 'production') {
      if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL required in production');
      }
      if (!process.env.REDIS_URL) {
        log.warn('REDIS_URL not set - Redis features disabled, continuing without Redis');
      }
    }

    // Initialize database (migrations disabled for production safety)
    const pool = getPool();
    // Sanity check: sql helpers are present in runtime (prevents fragment execution issues)
    try {
      const { getDatabase } = await import('./db/adapter.js');
      const db = getDatabase();
      const tag: any = db.getSQL();
      if (typeof tag.where !== 'function' || typeof tag.or !== 'function' || typeof tag.and !== 'function') {
        log.error('SQL composition helpers missing at runtime', {
          hasWhere: typeof tag.where,
          hasOr: typeof tag.or,
          hasAnd: typeof tag.and
        });
        throw new Error('SQL helpers missing: build artifact is stale. Rebuild with npm run build.');
      }
    } catch (e) {
      throw e instanceof Error ? e : new Error(String(e));
    }
    // await runDatabaseMigrations(); // DISABLED: Run migrations manually before deployment
    log.info('Database initialized (migrations skipped for production safety)');

    // Initialize Redis integration (non-blocking)
    const redisStatus = await initializeRedisIntegration(pool);
    log.info('Redis integration initialized', {
      mode: redisStatus.mode,
      success: redisStatus.success
    });

    // Print key Redis env flags (masked)
    try {
      const maskRedisUrl = (u?: string) => {
        if (!u) return 'not_set';
        try {
          const url = new URL(u);
          return `${url.protocol}//${url.hostname}:${url.port || '6379'}`;
        } catch {
          return 'invalid_url';
        }
      };
      log.info('Redis environment', {
        DISABLE_REDIS: process.env.DISABLE_REDIS === 'true' ? 'true' : 'false',
        SKIP_REDIS_HEALTH_CHECK: process.env.SKIP_REDIS_HEALTH_CHECK === 'true' ? 'true' : 'false',
        REDIS_URL: maskRedisUrl(process.env.REDIS_URL),
        REDIS_MAX_RETRIES: process.env.REDIS_MAX_RETRIES ?? 'default',
        REDIS_COMMAND_TIMEOUT: process.env.REDIS_COMMAND_TIMEOUT ?? 'default'
      });
    } catch {}

    // Start Database Job Processor if Redis is not active
    if (redisStatus.mode !== 'active') {
      const { startDatabaseJobProcessor } = await import('./services/database-job-processor.js');
      startDatabaseJobProcessor();
      log.info('Database job processor started');
    }

    // Schedule maintenance tasks
    scheduleMaintenance(pool);
    log.info('Maintenance tasks scheduled');

    // Initialize predictive analytics services
    await initializePredictiveServices();
    log.info('Predictive analytics services initialized');

    // Initialize security + compliance monitoring (runtime)
    initializeSecurityCompliance();
    log.info('Security compliance monitors initialized');

    // Initialize hashtag monitoring services
    await initializeHashtagServices();
    log.info('Hashtag monitoring services initialized');

    // Create Hono app
    const app = new Hono();

    // Add a Request ID header for each request
    app.use('*', async (c, next) => {
  const requestId = randomUUID();
  c.header('X-Request-ID', requestId);
  if (c.req.method === 'OPTIONS') {
    return new Response('', { status: 204 });
  }
  await next();
  return;
});

    // CORS optimized for Render
    app.use('*', async (c, next) => {
      const allowedOrigins = process.env.CORS_ORIGINS?.split(',') ?? ['*'];
      const origin = c.req.header('origin') ?? '';
      
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        c.header('Access-Control-Allow-Origin', origin ?? '*');
        c.header('Access-Control-Allow-Credentials', 'true');
        c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
        c.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Merchant-Id,X-Request-Id');
      }
      
      if (c.req.method === 'OPTIONS') {
        return c.status(204);
      }
      
      await next();
    });

    // Global middleware
    app.use('*', securityHeaders);
    
    // Conditional Idempotency middleware loading (place BEFORE any body parsers for webhooks)
    if (redisStatus.success && redisStatus.mode === 'active') {
      app.use('/webhooks/*', createIdempotencyMiddleware({ ttlSeconds: 3600, keyPrefix: 'webhook' }));
      log.info('Idempotency middleware enabled');
    } else {
      log.info('Idempotency middleware disabled - Redis not available');
    }

    // Rate limiting for webhooks (after idempotency)
    app.use('/webhooks/*', rateLimiter);

    // RLS (Row Level Security) middleware for data isolation
    app.use('*', rlsMiddleware());

    // Prepare Queue Manager singleton (DI into routes)
    const queueBaseLogger = getLogger({ component: 'queue' });
    const queueLogger = {
      info: (...args: unknown[]) => queueBaseLogger.info(String(args[0] ?? ''), typeof args[1] === 'object' ? args[1] as Record<string, unknown> : undefined),
      warn: (...args: unknown[]) => queueBaseLogger.warn(String(args[0] ?? ''), typeof args[1] === 'object' ? args[1] as Record<string, unknown> : undefined),
      error: (...args: unknown[]) => queueBaseLogger.error(String(args[0] ?? ''), typeof args[1] === 'object' ? args[1] as Record<string, unknown> : undefined),
      debug: (...args: unknown[]) => queueBaseLogger.debug(String(args[0] ?? ''), typeof args[1] === 'object' ? args[1] as Record<string, unknown> : undefined),
    };
    const queueManager = new ProductionQueueManager(queueLogger, RedisEnvironment.PRODUCTION, pool, 'ai-sales-production');

    // Respect STARTUP_SKIP_QUEUE_AUTO for web-only deployments
    const skipQueueAuto = process.env.STARTUP_SKIP_QUEUE_AUTO === 'true';

    // Initialize queue if Redis is active and auto-start not skipped
    if (!skipQueueAuto && redisStatus.mode === 'active' && process.env.DISABLE_REDIS !== 'true') {
      const qmInit = await queueManager.initialize();

      // Explicit production health check if not skipped
      const skipRedisHealth = process.env.SKIP_REDIS_HEALTH_CHECK === 'true';
      if (process.env.NODE_ENV === 'production' && !skipRedisHealth) {
        if (!qmInit.success) {
          throw new Error(`Queue/Redis initialization failed: ${qmInit.error ?? 'unknown'}`);
        }
        try {
          const mgr = getRedisConnectionManager();
          const conn = await mgr.getConnection(RedisUsageType.QUEUE_SYSTEM);
          const healthy = await mgr.isConnectionHealthy(conn, 2000);
          if (!healthy) throw new Error('Redis health check failed');
        } catch (e: unknown) {
          const err = e instanceof Error ? e.message : String(e);
          throw new Error(`Redis not ready: ${err}`);
        }
      }
    } else if (skipQueueAuto) {
      log.info('Queue auto start skipped (STARTUP_SKIP_QUEUE_AUTO=true)');
    }

    // ===============================================
    // ADMIN AUTHENTICATION MIDDLEWARE
    // ===============================================
    
    // Admin authentication middleware
    const adminAuth = async (c: any, next: any) => {
      const authHeader = c.req.header('authorization');
      const adminKey = process.env.ADMIN_API_KEY || 'admin-key-2025';
      
      // Check for API key in header or query
      const providedKey = authHeader?.replace('Bearer ', '') || c.req.query('key');
      
      // Debug logging for authentication
      log.info('Admin auth attempt', {
        providedKey: providedKey ? 'provided' : 'missing',
        expectedKey: adminKey ? 'configured' : 'default',
        match: providedKey === adminKey
      });
      
      if (providedKey !== adminKey) {
        return c.json({ 
          error: 'Unauthorized access to admin interface',
          message: 'Invalid or missing admin key'
        }, 401);
      }
      
      await next();
    };

    // Register route modules with DI
    const deps = { pool, queueManager };
    registerWebhookRoutes(app, deps);
    registerMerchantAdminRoutes(app);
    registerAdminRoutes(app);
    
    // ===============================================
    // PRODUCTION MERCHANT CREATION SYSTEM
    // نظام إنشاء التجار للإنتاج مع التحقق الشامل
    // ===============================================
    
    app.post('/admin/merchants', adminAuth, async (c) => {
      const startTime = Date.now();
      const traceId = randomUUID();
      
      try {
        log.info('Merchant creation request started', { traceId });
        
        // 1. Parse and validate request data
        const rawData = await c.req.json();
        
        // 2. Comprehensive data validation
        const validationResult = await validateMerchantData(rawData);
        if (!validationResult.success) {
          log.warn('Merchant validation failed', { traceId, errors: validationResult.errors });
          return c.json({
            success: false,
            error: 'Validation failed',
            details: validationResult.errors
          }, 400);
        }
        
        const data = validationResult.data;
        const merchantId = randomUUID();
        const now = new Date();
        
        // 3. Database transaction with comprehensive error handling
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          
          // Insert merchant with full data structure
          await client.query(`
            INSERT INTO merchants (
              id, business_name, business_category, business_address, business_description,
              whatsapp_number, instagram_username, email, phone,
              currency, timezone, language, subscription_status, subscription_tier,
              settings, ai_config, created_at, updated_at, last_activity_at,
              subscription_started_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
          `, [
            merchantId,
            data.business_name,
            data.business_category || 'general',
            data.business_address || null,
            data.business_description || null,
            data.whatsapp_number,
            data.instagram_username || null,
            data.email || null,
            data.phone || null,
            data.currency || 'IQD',
            data.timezone || 'Asia/Baghdad',
            data.language || 'ar',
            'ACTIVE',
            'BASIC',
            JSON.stringify({
              working_hours: data.working_hours || getDefaultWorkingHours(),
              payment_methods: data.payment_methods || ['COD'],
              delivery_fees: data.delivery_fees || { inside_baghdad: 3, outside_baghdad: 5 },
              auto_responses: {
                welcome_message: data.response_templates?.welcome_message || 'أهلاً بك! كيف يمكنني مساعدتك اليوم؟',
                outside_hours: data.response_templates?.outside_hours_message || 'نرحب برسالتك، سنعود لك بأقرب وقت ضمن ساعات الدوام.'
              }
            }),
            JSON.stringify(data.ai_config || getDefaultAIConfig()),
            now, now, now, now
          ]);
          
          // Insert response templates if provided
          if (data.response_templates) {
            const templates = [
              { type: 'greeting', content: data.response_templates.welcome_message },
              { type: 'fallback', content: data.response_templates.fallback_message },
              { type: 'outside_hours', content: data.response_templates.outside_hours_message }
            ];
            
            for (const template of templates) {
              if (template.content) {
                await client.query(`
                  INSERT INTO dynamic_response_templates (merchant_id, template_type, content, priority, created_at)
                  VALUES ($1, $2, $3, 1, $4)
                `, [merchantId, template.type, template.content, now]);
              }
            }
          }
          
          // Insert products if provided
          if (data.products && data.products.length > 0) {
            for (const product of data.products) {
              await client.query(`
                INSERT INTO products (
                  id, merchant_id, sku, name_ar, name_en, description_ar,
                  category, price_usd, stock_quantity, tags, status,
                  created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
              `, [
                randomUUID(),
                merchantId,
                product.sku,
                product.name_ar,
                product.name_en || null,
                product.description_ar || null,
                product.category || 'general',
                product.price_usd || 0,
                product.stock_quantity || 0,
                product.tags || null,
                (product.is_active !== false) ? 'ACTIVE' : 'INACTIVE',
                now, now
              ]);
            }
          }
          
          await client.query('COMMIT');
          
          const executionTime = Date.now() - startTime;
          log.info('Merchant created successfully', {
            traceId,
            merchantId,
            executionTime,
            productsCount: data.products?.length || 0
          });
          
          // Calculate completeness score
          const completenessScore = calculateMerchantCompleteness(data);
          
          return c.json({
            success: true,
            merchant_id: merchantId,
            completeness_score: completenessScore,
            message: 'تم إنشاء التاجر بنجاح',
            execution_time_ms: executionTime,
            security_notice: 'هذا المعرف سري جداً ولا تشاركه مع أي شخص آخر'
          });
          
        } catch (dbError) {
          await client.query('ROLLBACK');
          throw dbError;
        } finally {
          client.release();
        }
        
      } catch (error) {
        const executionTime = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        log.error('Merchant creation failed', {
          traceId,
          error: errorMessage,
          executionTime,
          stack: error instanceof Error ? error.stack : undefined
        });
        
        return c.json({
          success: false,
          error: 'Failed to create merchant',
          message: 'حدث خطأ في إنشاء التاجر',
          trace_id: traceId
        }, 500);
      }
    });
    
    // Helper functions for merchant creation
    function getDefaultWorkingHours() {
      return {
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
      };
    }
    
    function getDefaultAIConfig() {
      return {
        model: 'gpt-4o-mini',
        language: 'ar',
        temperature: 0.7,
        max_tokens: 600,
        tone: 'friendly',
        product_hints: true,
        auto_responses: true
      };
    }
    
    async function validateMerchantData(data: any) {
      const errors: string[] = [];
      
      // Required fields validation
      if (!data.business_name || data.business_name.trim().length < 2) {
        errors.push('اسم العمل مطلوب ويجب أن يكون على الأقل حرفين');
      }
      
      if (!data.whatsapp_number || !/^\+?[1-9]\d{1,14}$/.test(data.whatsapp_number.replace(/\s/g, ''))) {
        errors.push('رقم الواتساب مطلوب ويجب أن يكون صحيح');
      }
      
      // Email validation (if provided)
      if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
        errors.push('البريد الإلكتروني غير صحيح');
      }
      
      // Instagram username validation (if provided)
      if (data.instagram_username && !/^[a-zA-Z0-9._]+$/.test(data.instagram_username)) {
        errors.push('اسم المستخدم في إنستغرام غير صحيح');
      }
      
      // Business category validation
      const validCategories = ['general', 'fashion', 'electronics', 'beauty', 'home', 'sports', 'grocery', 'automotive', 'health', 'education'];
      if (data.business_category && !validCategories.includes(data.business_category)) {
        errors.push('فئة العمل غير صحيحة');
      }
      
      return {
        success: errors.length === 0,
        errors,
        data
      };
    }
    
    function calculateMerchantCompleteness(data: any): number {
      const requiredFields = ['business_name', 'whatsapp_number'];
      const importantFields = ['business_category', 'instagram_username', 'email', 'business_address'];
      const optionalFields = ['working_hours', 'payment_methods', 'ai_config', 'response_templates', 'products'];
      
      let score = 0;
      let totalWeight = 0;
      
      // Required fields (weight 3)
      requiredFields.forEach(field => {
        totalWeight += 3;
        if (data[field] && data[field].toString().trim() !== '') {
          score += 3;
        }
      });
      
      // Important fields (weight 2)
      importantFields.forEach(field => {
        totalWeight += 2;
        if (data[field] && data[field].toString().trim() !== '') {
          score += 2;
        }
      });
      
      // Optional fields (weight 1)
      optionalFields.forEach(field => {
        totalWeight += 1;
        if (data[field]) {
          score += 1;
        }
      });
      
      return Math.round((score / totalWeight) * 100);
    }
    registerQueueControlRoutes(app, { queueManager });
    
    // Register utility messages routes
    try {
      registerUtilityMessageRoutes(app);
      log.info('Utility message routes registered');
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      log.warn('Failed to register utility message routes', { err });
    }
    
    // Register image search routes
    try {
      registerImageSearchRoutes(app);
      log.info('Image search routes registered');
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      log.warn('Failed to register image search routes', { err });
    }

    // Centralized error handler
    registerErrorHandler(app);

    // Register message analytics routes
    try {
      registerMessageAnalyticsRoutes(app);
      log.info('Message analytics routes registered');
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      log.warn('Failed to register message analytics routes', { err });
    }

    // Prometheus Metrics (enabled only when METRICS_ENABLED)
    const metricsEnabled = process.env.METRICS_ENABLED === 'true';
    if (metricsEnabled && promClient) {
      const collectDefaultMetrics = promClient.collectDefaultMetrics;
      collectDefaultMetrics({ prefix: 'ai_sales_' });
      
      // HTTP request duration histogram
      const httpDuration = new promClient.Histogram({
        name: 'ai_sales_http_request_duration_seconds',
        help: 'Duration of HTTP requests in seconds',
        labelNames: ['method', 'route', 'status']
      });
      
      // Middleware for timing requests
      app.use('*', async (c, next) => {
        const start = Date.now();
        await next();
        const duration = (Date.now() - start) / 1000;
        httpDuration.observe(
          { 
            method: c.req.method, 
            route: c.req.path, 
            status: String(c.res.status) 
          }, 
          duration
        );
      });
      
      app.get('/metrics', async (c) => {
        if (!promClient) {
          return c.json({ error: 'Metrics not available - prom-client not loaded' }, 503);
        }
        
        try {
          const metrics = await promClient.register.metrics();
          return c.text(metrics, 200, {
            'Content-Type': promClient.register.contentType
          });
        } catch (error) {
          log.error('Failed to retrieve metrics', { error: error instanceof Error ? error.message : String(error) });
          return c.json({ error: 'Failed to retrieve metrics' }, 500);
        }
      });
    }

    // Health endpoints (accessible without auth)
    app.get('/health', async (c) => {
      const snapshot = getHealthSnapshot();
      if (snapshot.ready && snapshot.status === 'ok') {
        return c.json({ status: 'ok' }, 200);
      }
      const reasons: string[] = [];
      try {
        const d = snapshot.details;
        if (!d.redis.ok) reasons.push(d.redis.error ? `redis:${d.redis.error}` : 'redis');
        if (!d.database.ok) reasons.push(d.database.error ? `db:${d.database.error}` : 'database');
        if (!d.memory.ok) reasons.push('memory');
        if (d.manychat && !d.manychat.ok) reasons.push(d.manychat.error ? `manychat:${d.manychat.error}` : 'manychat');
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        log.warn("Health check details parsing failed", { err });
      }
      return c.json({ status: 'degraded', reasons }, 503);
    });

    app.get('/ready', async (c) => {
      const snapshot = getHealthSnapshot();
      if (snapshot.ready && snapshot.status === 'ok') {
        return c.json({ status: 'ok' }, 200);
      }
      const reasons: string[] = [];
      try {
        const d = snapshot.details;
        if (!d.database.ok) reasons.push(d.database.error ? `db:${d.database.error}` : 'database');
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        log.warn("Ready check details parsing failed", { err });
      }
      return c.json({ status: 'degraded', reasons }, 503);
    });

    app.get('/healthz', async (c) => {
      const snapshot = getHealthSnapshot();
      if (snapshot.ready && snapshot.status === 'ok') {
        return c.json({ status: 'ok' }, 200);
      }
      const reasons: string[] = [];
      try {
        const d = snapshot.details;
        if (!d.redis.ok) reasons.push(d.redis.error ? `redis:${d.redis.error}` : 'redis');
        if (!d.database.ok) reasons.push(d.database.error ? `db:${d.database.error}` : 'database');
        if (!d.memory.ok) reasons.push('memory');
        if (d.manychat && !d.manychat.ok) reasons.push(d.manychat.error ? `manychat:${d.manychat.error}` : 'manychat');
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        log.warn("Healthz check details parsing failed", { err });
      }
      return c.json({ status: 'degraded', reasons }, 503);
    });

    // Serve simple legal pages (static files)
    const legalDir = path.join(process.cwd(), 'legal');
    const serveHtml = (file: string) => {
      try {
        const fp = path.join(legalDir, file);
        if (fs.existsSync(fp)) {
          const html = fs.readFileSync(fp, 'utf8');
          return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        log.warn("Legal file read failed", { err });
      }
      return new Response('Not Found', { status: 404 });
    };

    app.get('/legal', () => serveHtml('index.html'));
    app.get('/legal/privacy', () => serveHtml('privacy.html'));
    app.get('/legal/deletion', () => serveHtml('deletion.html'));

    // ===============================================
    // PRODUCTION ADMIN INTERFACE SYSTEM
    // نظام الواجهات الإدارية للإنتاج
    // ===============================================
    
    // Static file serving with security
    const publicDir = path.join(process.cwd(), 'public');
    const serveSecureStatic = (file: string, contentType: string = 'text/html; charset=utf-8') => {
      try {
        const fp = path.join(publicDir, file);
        
        // Security: Prevent directory traversal
        const resolvedPath = path.resolve(fp);
        const resolvedPublicDir = path.resolve(publicDir);
        
        if (!resolvedPath.startsWith(resolvedPublicDir)) {
          log.warn('Directory traversal attempt blocked', { file, resolvedPath });
          return new Response('Access Denied', { status: 403 });
        }
        
        // Debug logging
        log.info('Attempting to serve file', { file, fp, exists: fs.existsSync(fp), publicDir });
        
        if (fs.existsSync(fp)) {
          const content = fs.readFileSync(fp, 'utf8');
          
          // Add security headers for admin interfaces
          const headers = {
            'Content-Type': contentType,
            'X-Frame-Options': 'DENY',
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          };
          
          return new Response(content, { status: 200, headers });
        }
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        log.error('Static file serving error', { file, error: err.message });
      }
      log.warn('File not found', { file, publicDir, fullPath: path.join(publicDir, file) });
      return new Response('Resource Not Found', { status: 404 });
    };

    // ===============================================
    // ADMIN ROUTES WITH AUTHENTICATION
    // ===============================================
    
    // Admin dashboard main page
    app.get('/admin', adminAuth, (c) => {
      const dashboardHtml = `
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>لوحة التحكم الإدارية - منصة المبيعات الذكية</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
                .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                h1 { color: #1e3c72; text-align: center; margin-bottom: 30px; }
                .admin-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-top: 30px; }
                .admin-card { background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #1e3c72; }
                .admin-card h3 { color: #1e3c72; margin-top: 0; }
                .admin-link { display: inline-block; background: #1e3c72; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 5px 0; }
                .admin-link:hover { background: #2a5298; }
                .status-good { color: #28a745; font-weight: bold; }
                .status-warning { color: #ffc107; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🚀 لوحة التحكم الإدارية</h1>
                <p style="text-align: center; color: #666;">منصة المبيعات الذكية - إدارة شاملة للنظام</p>
                
                <div class="admin-grid">
                    <div class="admin-card">
                        <h3>📊 إدارة التجار</h3>
                        <p>إضافة وإدارة التجار في النظام</p>
                        <a href="/admin/merchants/new?key=${c.req.query('key') || ''}" class="admin-link">إضافة تاجر جديد</a>
                        <a href="/admin/merchants?key=${c.req.query('key') || ''}" class="admin-link">إدارة التجار</a>
                    </div>
                    
                    <div class="admin-card">
                        <h3>🔍 مراقبة النظام</h3>
                        <p>مراقبة صحة النظام والأداء</p>
                        <a href="/health" class="admin-link" target="_blank">صحة النظام</a>
                        <a href="/api/queue/stats" class="admin-link" target="_blank">إحصائيات Queue</a>
                    </div>
                    
                    <div class="admin-card">
                        <h3>⚙️ إعدادات النظام</h3>
                        <p>إعدادات متقدمة للنظام</p>
                        <a href="/api/config/validate" class="admin-link" target="_blank">التحقق من التكوين</a>
                        <a href="/api/status" class="admin-link" target="_blank">حالة النظام</a>
                    </div>
                    
                    <div class="admin-card">
                        <h3>📈 التقارير والإحصائيات</h3>
                        <p>تقارير مفصلة عن الأداء</p>
                        <a href="/api/analytics/merchants" class="admin-link" target="_blank">إحصائيات التجار</a>
                        <a href="/api/analytics/messages" class="admin-link" target="_blank">إحصائيات الرسائل</a>
                    </div>
                </div>
                
                <div style="margin-top: 40px; padding: 20px; background: #e9ecef; border-radius: 8px;">
                    <h3>🔐 معلومات الأمان</h3>
                    <p><strong>الحالة:</strong> <span class="status-good">آمن ومحمي</span></p>
                    <p><strong>آخر تحديث:</strong> ${new Date().toLocaleString('ar-IQ')}</p>
                    <p><strong>البيئة:</strong> ${process.env.NODE_ENV || 'development'}</p>
                </div>
            </div>
        </body>
        </html>
      `;
      
      return new Response(dashboardHtml, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Frame-Options': 'DENY',
          'X-Content-Type-Options': 'nosniff'
        }
      });
    });
    
    // Merchant entry interface
    app.get('/admin/merchants/new', adminAuth, () => serveSecureStatic('merchant-entry.html'));
    app.get('/admin/merchants', adminAuth, () => serveSecureStatic('merchants-management.html'));
    
    // Static assets for admin interfaces (serve JS files directly)
    app.get('/admin/assets/merchant-entry.js', adminAuth, () => serveSecureStatic('merchant-entry.js', 'application/javascript'));
    app.get('/admin/assets/merchants-management.js', adminAuth, () => serveSecureStatic('merchants-management.js', 'application/javascript'));
    
    // Alternative direct JS serving
    app.get('/merchant-entry.js', adminAuth, () => serveSecureStatic('merchant-entry.js', 'application/javascript'));
    app.get('/merchants-management.js', adminAuth, () => serveSecureStatic('merchants-management.js', 'application/javascript'));
    
    // Upload endpoint for product images
    app.post('/admin/upload', adminAuth, async (c) => {
      try {
        const formData = await c.req.formData();
        const file = formData.get('file') as File;
        
        if (!file) {
          return c.json({ success: false, error: 'No file provided' }, 400);
        }
        
        // Validate file type
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!allowedTypes.includes(file.type)) {
          return c.json({ success: false, error: 'Invalid file type' }, 400);
        }
        
        // Validate file size (5MB max)
        if (file.size > 5 * 1024 * 1024) {
          return c.json({ success: false, error: 'File too large' }, 400);
        }
        
        // Generate unique filename
        const timestamp = Date.now();
        const extension = file.name.split('.').pop();
        const filename = `product_${timestamp}.${extension}`;
        
        // Create uploads directory if it doesn't exist
        const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'products');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        
        // Save file
        const filePath = path.join(uploadDir, filename);
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(filePath, buffer);
        
        return c.json({
          success: true,
          filename,
          url: `/uploads/products/${filename}`,
          size: file.size,
          type: file.type
        });
      } catch (error) {
        log.error('File upload failed', { error });
        return c.json({ success: false, error: 'Upload failed' }, 500);
      }
    });
    
    // Legacy public routes (deprecated but maintained for compatibility)
    app.get('/public/merchant-entry.html', () => {
      return new Response('This endpoint has been moved to /admin/merchants/new', { status: 301, headers: { 'Location': '/admin/merchants/new' } });
    });
    app.get('/public/merchants-management.html', () => {
      return new Response('This endpoint has been moved to /admin/merchants', { status: 301, headers: { 'Location': '/admin/merchants' } });
    });

    // ===============================================
    // PRODUCTION MONITORING AND ANALYTICS ENDPOINTS
    // ===============================================
    
    // Import monitoring service
    let monitoringService: any = null;
    try {
      const { getMonitoringService } = await import('./services/production-monitoring.js');
      monitoringService = getMonitoringService(pool);
      log.info('Production monitoring service initialized');
    } catch (error) {
      log.warn('Production monitoring service not available', { error });
      // Create mock service for fallback
      monitoringService = {
        getSystemMetrics: async () => ({ timestamp: new Date(), uptime_seconds: Math.floor(process.uptime()) }),
        getMerchantMetrics: async () => [],
        getPlatformHealth: async () => ({ status: 'healthy', components: {}, alerts: [] }),
        getQuickStats: async () => ({ merchants: 0, conversations_today: 0, messages_today: 0, ai_responses_today: 0, uptime_hours: Math.floor(process.uptime() / 3600) })
      };
    }
    
    // System metrics endpoint
    app.get('/api/metrics/system', adminAuth, async (c) => {
      try {
        const metrics = await monitoringService.getSystemMetrics();
        return c.json({
          success: true,
          data: metrics,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        log.error('Failed to get system metrics', { error });
        return c.json({
          success: false,
          error: 'Failed to retrieve system metrics'
        }, 500);
      }
    });
    
    // Merchant metrics endpoint
    app.get('/api/metrics/merchants', adminAuth, async (c) => {
      try {
        const limit = parseInt(c.req.query('limit') || '50');
        const metrics = await monitoringService.getMerchantMetrics(limit);
        return c.json({
          success: true,
          data: metrics,
          count: metrics.length,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        log.error('Failed to get merchant metrics', { error });
        return c.json({
          success: false,
          error: 'Failed to retrieve merchant metrics'
        }, 500);
      }
    });
    
    // Platform health endpoint
    app.get('/api/health/detailed', adminAuth, async (c) => {
      try {
        const health = await monitoringService.getPlatformHealth();
        return c.json({
          success: true,
          data: health,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        log.error('Failed to get platform health', { error });
        return c.json({
          success: false,
          error: 'Failed to retrieve platform health'
        }, 500);
      }
    });
    
    // Quick stats endpoint (lightweight)
    app.get('/api/stats/quick', adminAuth, async (c) => {
      try {
        const stats = await monitoringService.getQuickStats();
        return c.json({
          success: true,
          data: stats,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        log.error('Failed to get quick stats', { error });
        return c.json({
          success: false,
          error: 'Failed to retrieve quick stats'
        }, 500);
      }
    });
    
    // Analytics dashboard data
    app.get('/api/analytics/dashboard', adminAuth, async (c) => {
      try {
        const [systemMetrics, quickStats, platformHealth] = await Promise.all([
          monitoringService.getSystemMetrics(),
          monitoringService.getQuickStats(),
          monitoringService.getPlatformHealth()
        ]);
        
        return c.json({
          success: true,
          data: {
            system: systemMetrics,
            quick_stats: quickStats,
            health: platformHealth,
            performance: {
              uptime_hours: Math.floor(process.uptime() / 3600),
              memory_usage_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
              cpu_usage_percent: process.cpuUsage ? Math.round(process.cpuUsage().user / 1000000) : null
            }
          },
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        log.error('Failed to get dashboard analytics', { error });
        return c.json({
          success: false,
          error: 'Failed to retrieve dashboard analytics'
        }, 500);
      }
    });
    
    // Merchant list with pagination
    app.get('/api/merchants', adminAuth, async (c) => {
      try {
        const page = parseInt(c.req.query('page') || '1');
        const limit = parseInt(c.req.query('limit') || '20');
        const offset = (page - 1) * limit;
        
        const client = await pool.connect();
        try {
          const [merchantsResult, countResult] = await Promise.all([
            client.query(`
              SELECT 
                id, business_name, business_category, whatsapp_number,
                instagram_username, email, subscription_status,
                created_at, last_activity_at
              FROM merchants 
              ORDER BY created_at DESC 
              LIMIT $1 OFFSET $2
            `, [limit, offset]),
            client.query('SELECT COUNT(*) as total FROM merchants')
          ]);
          
          return c.json({
            success: true,
            data: merchantsResult.rows,
            pagination: {
              page,
              limit,
              total: parseInt(countResult.rows[0].total),
              pages: Math.ceil(parseInt(countResult.rows[0].total) / limit)
            },
            timestamp: new Date().toISOString()
          });
        } finally {
          client.release();
        }
      } catch (error) {
        log.error('Failed to get merchants list', { error });
        return c.json({
          success: false,
          error: 'Failed to retrieve merchants'
        }, 500);
      }
    });
    
    // System configuration validation
    app.get('/api/config/validate', adminAuth, async (c) => {
      const config = {
        environment: process.env.NODE_ENV || 'development',
        database_connected: false,
        redis_connected: false,
        required_env_vars: {
          DATABASE_URL: !!process.env.DATABASE_URL,
          META_APP_SECRET: !!process.env.META_APP_SECRET,
          IG_VERIFY_TOKEN: !!process.env.IG_VERIFY_TOKEN,
          ENCRYPTION_KEY_HEX: !!process.env.ENCRYPTION_KEY_HEX,
          JWT_SECRET: !!process.env.JWT_SECRET,
          OPENAI_API_KEY: !!process.env.OPENAI_API_KEY
        },
        optional_env_vars: {
          REDIS_URL: !!process.env.REDIS_URL,
          CORS_ORIGINS: !!process.env.CORS_ORIGINS,
          ADMIN_API_KEY: !!process.env.ADMIN_API_KEY
        }
      };
      
      // Test database connection
      try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        config.database_connected = true;
      } catch (error) {
        log.warn('Database connection test failed', { error });
      }
      
      // Test Redis connection
      const health = getHealthSnapshot();
      config.redis_connected = health.details.redis.ok;
      
      const allRequired = Object.values(config.required_env_vars).every(Boolean);
      const configValid = config.database_connected && allRequired;
      
      return c.json({
        success: true,
        valid: configValid,
        data: config,
        warnings: [
          ...(!config.redis_connected ? ['Redis not connected - some features may be limited'] : []),
          ...(!config.optional_env_vars.CORS_ORIGINS ? ['CORS_ORIGINS not set - using default'] : []),
          ...(!config.optional_env_vars.ADMIN_API_KEY ? ['ADMIN_API_KEY not set - using default'] : [])
        ],
        timestamp: new Date().toISOString()
      });
    });
    
    // System status endpoint
    app.get('/api/status', async (c) => {
      const health = getHealthSnapshot();
      const uptime = process.uptime();
      const memUsage = process.memoryUsage();
      
      return c.json({
        service: 'AI Sales Platform',
        version: '1.0.0',
        status: health.status === 'ok' ? 'operational' : 'degraded',
        uptime_seconds: Math.floor(uptime),
        uptime_human: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
        memory_usage_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
        environment: process.env.NODE_ENV || 'development',
        components: {
          database: health.details.database.ok ? 'operational' : 'degraded',
          redis: health.details.redis.ok ? 'operational' : 'degraded',
          queue: 'operational'
        },
        timestamp: new Date().toISOString()
      });
    });
    
    // API endpoints with admin authentication
    app.get('/api/merchants/search', adminAuth, async (c) => {
      try {
        const search = c.req.query('search') || '';
        const category = c.req.query('category') || '';
        const status = c.req.query('status') || '';
        const page = parseInt(c.req.query('page') || '1');
        const limit = parseInt(c.req.query('limit') || '50');
        const offset = (page - 1) * limit;
        
        const client = await pool.connect();
        try {
          let whereConditions = ['1=1'];
          let params = [];
          let paramIndex = 1;
          
          if (search) {
            whereConditions.push(`(
              business_name ILIKE $${paramIndex} OR 
              whatsapp_number ILIKE $${paramIndex} OR 
              instagram_username ILIKE $${paramIndex} OR 
              email ILIKE $${paramIndex}
            )`);
            params.push(`%${search}%`);
            paramIndex++;
          }
          
          if (category) {
            whereConditions.push(`business_category = $${paramIndex}`);
            params.push(category);
            paramIndex++;
          }
          
          if (status) {
            whereConditions.push(`subscription_status = $${paramIndex}`);
            params.push(status);
            paramIndex++;
          }
          
          const whereClause = whereConditions.join(' AND ');
          
          const merchantsQuery = `
            SELECT 
              m.*,
              COUNT(p.id) as products_count,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', p.id,
                    'sku', p.sku,
                    'name_ar', p.name_ar,
                    'name_en', p.name_en,
                    'price_usd', p.price_usd,
                    'stock_quantity', p.stock_quantity,
                    'category', p.category,
                    'is_active', (p.status = 'ACTIVE')
                  )
                ) FILTER (WHERE p.id IS NOT NULL),
                '[]'::json
              ) as products
            FROM merchants m
            LEFT JOIN products p ON m.id = p.merchant_id
            WHERE ${whereClause}
            GROUP BY m.id
            ORDER BY m.created_at DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
          `;
          
          params.push(limit, offset);
          const merchantsResult = await client.query(merchantsQuery, params);
          
          const totalQuery = `SELECT COUNT(*) as total FROM merchants m WHERE ${whereClause}`;
          const totalResult = await client.query(totalQuery, params.slice(0, -2));
          const total = parseInt(totalResult.rows[0].total);
          
          return c.json({
            success: true,
            merchants: merchantsResult.rows,
            pagination: {
              page,
              limit,
              total,
              pages: Math.ceil(total / limit)
            }
          });
        } finally {
          client.release();
        }
      } catch (error) {
        log.error('Failed to search merchants', { error });
        return c.json({ success: false, error: 'Failed to search merchants' }, 500);
      }
    });
    
    app.get('/api/merchants/:id', adminAuth, async (c) => {
      try {
        const merchantId = c.req.param('id');
        const client = await pool.connect();
        
        try {
          const result = await client.query(`
            SELECT 
              m.*,
              COUNT(p.id) as products_count,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', p.id,
                    'sku', p.sku,
                    'name_ar', p.name_ar,
                    'name_en', p.name_en,
                    'description_ar', p.description_ar,
                    'category', p.category,
                    'price_usd', p.price_usd,
                    'stock_quantity', p.stock_quantity,
                    'tags', p.tags,
                    'is_active', (p.status = 'ACTIVE'),
                    'created_at', p.created_at
                  )
                ) FILTER (WHERE p.id IS NOT NULL),
                '[]'::json
              ) as products
            FROM merchants m
            LEFT JOIN products p ON m.id = p.merchant_id
            WHERE m.id = $1
            GROUP BY m.id
          `, [merchantId]);
          
          if (result.rows.length === 0) {
            return c.json({ success: false, error: 'Merchant not found' }, 404);
          }
          
          return c.json({ success: true, merchant: result.rows[0] });
        } finally {
          client.release();
        }
      } catch (error) {
        log.error('Failed to get merchant', { error });
        return c.json({ success: false, error: 'Failed to get merchant' }, 500);
      }
    });
    
    app.put('/api/merchants/:id', adminAuth, async (c) => {
      try {
        const merchantId = c.req.param('id');
        const body = await c.req.json();
        
        if (!body.business_name || !body.whatsapp_number) {
          return c.json({ success: false, error: 'Business name and WhatsApp number are required' }, 400);
        }
        
        const client = await pool.connect();
        try {
          const result = await client.query(`
            UPDATE merchants 
            SET 
              business_name = $1,
              business_category = $2,
              whatsapp_number = $3,
              instagram_username = $4,
              email = $5,
              currency = $6,
              subscription_status = CASE WHEN LOWER(COALESCE($8, '')) = 'inactive' THEN 'SUSPENDED' ELSE 'ACTIVE' END,
              updated_at = NOW()
            WHERE id = $7
            RETURNING *
          `, [
            body.business_name,
            body.business_category || 'general',
            body.whatsapp_number,
            body.instagram_username || '',
            body.email || '',
            body.currency || 'IQD',
            merchantId,
            body.status || null
          ]);
          
          if (result.rows.length === 0) {
            return c.json({ success: false, error: 'Merchant not found' }, 404);
          }
          
          return c.json({ success: true, merchant: result.rows[0] });
        } finally {
          client.release();
        }
      } catch (error) {
        log.error('Failed to update merchant', { error });
        return c.json({ success: false, error: 'Failed to update merchant' }, 500);
      }
    });
    
    app.delete('/api/merchants/:id', adminAuth, async (c) => {
      try {
        const merchantId = c.req.param('id');
        const client = await pool.connect();
        
        try {
          const result = await client.query(`
            DELETE FROM merchants 
            WHERE id = $1
            RETURNING id
          `, [merchantId]);
          
          if (result.rows.length === 0) {
            return c.json({ success: false, error: 'Merchant not found' }, 404);
          }
          
          // Products are deleted automatically via ON DELETE CASCADE
          
          return c.json({ success: true, message: 'Merchant deleted successfully' });
        } finally {
          client.release();
        }
      } catch (error) {
        log.error('Failed to delete merchant', { error });
        return c.json({ success: false, error: 'Failed to delete merchant' }, 500);
      }
    });
    
    app.get('/api/analytics/summary', adminAuth, async (c) => {
      try {
        const client = await pool.connect();
        try {
          const [merchantsResult, productsResult, inventoryResult] = await Promise.all([
            client.query('SELECT COUNT(*) as total FROM merchants'),
            client.query('SELECT COUNT(*) as total FROM products'),
            client.query("SELECT COALESCE(SUM(price_usd * stock_quantity), 0) as total FROM products WHERE status = 'ACTIVE'")
          ]);
          
          return c.json({
            success: true,
            total_merchants: parseInt(merchantsResult.rows[0].total),
            total_products: parseInt(productsResult.rows[0].total),
            total_inventory_value: parseFloat(inventoryResult.rows[0].total)
          });
        } finally {
          client.release();
        }
      } catch (error) {
        log.error('Failed to get analytics summary', { error });
        return c.json({ success: false, error: 'Failed to get analytics summary' }, 500);
      }
    });
    
    // Serve uploaded files
    app.get('/uploads/*', async (c) => {
      const filePath = c.req.path.replace('/uploads/', '');
      const fullPath = path.join(process.cwd(), 'public', 'uploads', filePath);
      
      try {
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath);
          const ext = path.extname(fullPath).toLowerCase();
          
          let contentType = 'application/octet-stream';
          if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
          else if (ext === '.png') contentType = 'image/png';
          else if (ext === '.gif') contentType = 'image/gif';
          else if (ext === '.webp') contentType = 'image/webp';
          
          return new Response(content, {
            status: 200,
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'public, max-age=31536000'
            }
          });
        }
      } catch (error) {
        log.error('Failed to serve upload', { error, filePath });
      }
      
      return c.text('File not found', 404);
    });
    
    // Root endpoint with admin access
    app.get('/', (c) => {
      const adminKey = c.req.query('key');
      const isAdmin = adminKey === (process.env.ADMIN_API_KEY || 'admin-key-2025');
      
      return c.json({
        service: 'AI Sales Platform',
        version: '1.0.0',
        status: 'running',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        endpoints: {
          webhooks: '/webhooks/instagram',
          health: '/health',
          legal: '/legal',
          status: '/api/status',
          ...(isAdmin ? {
            admin: '/admin',
            merchantEntry: '/admin/merchants/new',
            merchantsManagement: '/admin/merchants',
            systemMetrics: '/api/metrics/system',
            merchantMetrics: '/api/metrics/merchants',
            platformHealth: '/api/health/detailed',
            quickStats: '/api/stats/quick',
            dashboard: '/api/analytics/dashboard'
          } : {
            admin: '/admin?key=YOUR_ADMIN_KEY'
          })
        },
        features: {
          instagram_integration: true,
          ai_responses: true,
          queue_processing: true,
          multi_tenant: true,
          security_enabled: true,
          monitoring_enabled: true,
          analytics_enabled: true
        }
      });
    });

    // Start health monitoring
    startHealth(2000);
    
    // Keep-alive pinger (starts after server is ready)
    let keepAlive: KeepAliveService | null = new KeepAliveService();
    log.info('Health monitoring started');

    // Start server
    const port = Number(process.env.PORT ?? 10000);
    
    serve({
      fetch: app.fetch,
      port,
      hostname: '0.0.0.0'
    }, (info) => {
      log.info(`AI Sales Platform ready on :${info.port}`);
      
      // Record startup telemetry
      telemetry.trackEvent('service_started', {
        port: info.port,
        redisMode: redisStatus.mode,
        timestamp: new Date().toISOString()
      });
      // Start keep-alive after server is bound
      keepAlive?.start();
    });

    return app;
  } catch (error) {
    log.error('Bootstrap failed:', { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
  }
}

// Graceful shutdown handling
let isShuttingDown = false;

async function gracefulShutdown(signal: string, exitCode: number = 0) {
  if (isShuttingDown) {
    log.warn('Shutdown already in progress, ignoring duplicate signal');
    return;
  }
  
  isShuttingDown = true;
  const startTime = Date.now();
  
  log.info(`${signal} received, initiating graceful shutdown...`);
  
  try {
    // Set a timeout for shutdown operations
    const shutdownTimeout = setTimeout(() => {
      log.error('Shutdown timeout reached, forcing exit');
      process.exit(1);
    }, 30000); // 30 seconds timeout
    
    // Stop accepting new requests
    log.info('Stopping new request acceptance...');
    
    // Stop keep-alive pinger
    try {
      // Lazy import to get same instance scope
      const { KeepAliveService } = await import('./services/keep-alive.js');
      // No global singleton; just ensure timers are cleared by creating and stopping
      // because our KeepAliveService uses setInterval without external refs
      const ka = new KeepAliveService();
      ka.stop();
    } catch {}
    
    // Stop health monitoring
    try {
      const { stopHealth } = await import('./services/health-check.js');
      stopHealth();
      log.info('Health monitoring stopped');
    } catch (error) {
      log.warn('Failed to stop health monitoring:', { error });
    }
    
    // Close database connections
    try {
      const { closeDatabase } = await import('./startup/database.js');
      await closeDatabase();
      log.info('Database connections closed');
    } catch (error) {
      log.warn('Failed to close database connections:', { error });
    }
    
    // Close Redis connections
    try {
      const { closeRedisConnections } = await import('./startup/redis.js');
      await closeRedisConnections();
      log.info('Redis connections closed');
    } catch (error) {
      log.warn('Failed to close Redis connections:', { error });
    }
    
    // Stop telemetry
    try {
      telemetry.trackEvent('service_shutdown', {
        signal,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString()
      });
      log.info('Telemetry recorded');
    } catch (error) {
      log.warn('Failed to record telemetry:', { error });
    }
    
    clearTimeout(shutdownTimeout);
    
    const shutdownDuration = Date.now() - startTime;
    log.info(`Graceful shutdown completed in ${shutdownDuration}ms`);
    
    process.exit(exitCode);
  } catch (error) {
    log.error('Error during shutdown:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    process.exit(1);
  }
}

// Enhanced signal handlers
process.on('SIGTERM', async () => {
  log.info('SIGTERM received from container orchestrator');
  await gracefulShutdown('SIGTERM', 0);
});

process.on('SIGINT', async () => {
  log.info('SIGINT received (Ctrl+C)');
  await gracefulShutdown('SIGINT', 0);
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  log.error('Uncaught Exception:', error);
  await gracefulShutdown('uncaughtException', 1);
});

// Debounced soft-cooldown for unhandled rejections (avoid cascading restarts)
let lastUnhandledAt = 0;
let coolingDown = false;
async function softCooldown(reason: unknown) {
  const now = Date.now();
  if (coolingDown || (now - lastUnhandledAt) < 5000) {
    return; // debounce 5s
  }
  coolingDown = true;
  lastUnhandledAt = now;
  try {
    log.error('Unhandled Rejection (soft cooldown)', { reason: String(reason ?? '') });
    // Stop accepting requests (no-op marker here; app server uses external orchestrator)
    // Stop keep-alive
    try {
      const { KeepAliveService } = await import('./services/keep-alive.js');
      const ka = new KeepAliveService();
      ka.stop();
    } catch {}
    // Stop health
    try {
      const { stopHealth } = await import('./services/health-check.js');
      stopHealth();
    } catch {}
    // Close DB
    try {
      const { closeDatabase } = await import('./startup/database.js');
      await closeDatabase();
    } catch {}
    // Close Redis
    try {
      const { closeRedisConnections } = await import('./startup/redis.js');
      await closeRedisConnections();
    } catch {}
  } finally {
    // allow future recovery attempts
    coolingDown = false;
  }
}

process.on('unhandledRejection', async (reason ) => {
  log.error('Unhandled Rejection:', { reason, promise: 'Promise' });
  await softCooldown(reason);
});

// Additional signal handlers for different environments
process.on('SIGUSR1', async () => {
  log.info('SIGUSR1 received (debug signal)');
  // Don't shutdown, just log current state
  const { getHealthSnapshot } = await import('./services/health-check.js');
  const health = getHealthSnapshot();
  log.info('Current health status:', health);
});

process.on('SIGUSR2', async () => {
  log.info('SIGUSR2 received (reload signal)');
  // Could implement hot reload here if needed
  log.info('Hot reload not implemented, ignoring SIGUSR2');
});

// Start the application
const app = await bootstrap();

export default app;


