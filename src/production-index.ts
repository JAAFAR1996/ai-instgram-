/**
 * ===============================================
 * Production Entry Point - AI Sales Platform
 * Modular, secure, and production-ready initialization
 * ===============================================
 */

// 1) Global error handlers first
import './boot/error-handlers.js';

// 2) Validate environment strictly before any side effects
import { assertEnvStrict } from './startup/security-validations.js';
assertEnvStrict();

// 3) Core imports
import { Hono } from 'hono';

import { serve } from '@hono/node-server';

// 4) Logger and telemetry
import { getLogger } from './services/logger.js';
import { initTelemetry, telemetry } from './services/telemetry.js';
import { randomUUID } from 'crypto';
// اجعل prom-client اختيارياً
let promClient: typeof import('prom-client') | null = null;
try { promClient = await import('prom-client'); } catch {}

// 5) Startup modules
import { getPool, runDatabaseMigrations } from './startup/database.js';
import { initializeRedisIntegration } from './startup/redis.js';
import { scheduleMaintenance } from './startup/maintenance.js';

// 6) Middleware imports
import { securityHeaders, rateLimiter } from './middleware/security.js';
import { createIdempotencyMiddleware } from './middleware/idempotency.js';
import rlsMiddleware from './middleware/rls-merchant-isolation.js';
import { createInternalAuthMiddleware } from './middleware/internal-auth.js';

// 7) Routes imports
import { registerWebhookRoutes } from './routes/webhooks.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerUtilityMessageRoutes } from './routes/utility-messages.js';
import { registerLegalRoutes } from './routes/legal.js';

// 8) Health monitoring
import { getHealthSnapshot, startHealth } from './services/health-check.js';

// Initialize logger
const log = getLogger({ component: 'bootstrap' });

async function bootstrap() {
  try {
    log.info('🚀 Starting AI Sales Platform...');

    // Initialize telemetry first
    await initTelemetry();
    log.info('✅ Telemetry initialized');

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
    
    log.info('✅ Environment variables and security requirements validated');

    // Additional production checks
    if (process.env.NODE_ENV === 'production') {
      if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL required in production');
      }
      if (!process.env.REDIS_URL) {
        log.warn('REDIS_URL not set - Redis disabled');
      }
    }

    // Initialize database and run migrations
    const pool = getPool();
    await runDatabaseMigrations();
    log.info('✅ Database initialized and migrations completed');

    // Initialize Redis integration (non-blocking)
    const redisStatus = await initializeRedisIntegration(pool);
    log.info('✅ Redis integration initialized', {
      mode: redisStatus.mode,
      success: redisStatus.success,
      queueReady: !!redisStatus.queueManager
    });

    // Schedule maintenance tasks
    scheduleMaintenance(pool);
    log.info('✅ Maintenance tasks scheduled');

    // Create Hono app
    const app = new Hono();

    // Request ID لكل طلب
    app.use('*', async (c, next) => {
  const requestId = randomUUID();
  c.header('X-Request-ID', requestId);
  if (c.req.method === 'OPTIONS') {
    return new Response('', { status: 204 });
  }
  await next();
  return;
});

    // CORS محسّن لـ Render
    app.use('*', async (c, next) => {
      const allowedOrigins = process.env.CORS_ORIGINS?.split(',') || ['*'];
      const origin = c.req.header('origin') || '';
      
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        c.header('Access-Control-Allow-Origin', origin || '*');
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
    
    // Raw body middleware for webhook routes only
    app.use('/webhooks/*', async (c, next) => {
      const contentType = c.req.header('content-type');
      if (contentType?.includes('application/json')) {
        const body = await c.req.arrayBuffer();
        (c as any).rawBody = Buffer.from(body);
      }
      await next();
    });

    // Rate limiting for webhooks
    app.use('/webhooks/*', rateLimiter);

    // Idempotency middleware for webhooks
    app.use('/webhooks/*', createIdempotencyMiddleware({ ttlSeconds: 3600, keyPrefix: 'webhook' }));

    // Internal auth middleware for admin endpoints
    app.use('/internal/*', createInternalAuthMiddleware());

    // RLS (Row Level Security) middleware for data isolation
    app.use('*', rlsMiddleware());

    // Register route modules
    const deps = { pool };
    
    registerWebhookRoutes(app, deps);
    registerAdminRoutes(app, deps);
    registerUtilityMessageRoutes(app);
    registerLegalRoutes(app);

    // Prometheus Metrics (مفعّل فقط عند METRICS_ENABLED)
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
      
      // Middleware لقياس الوقت
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
        const metrics = await promClient!.register.metrics();
        return c.text(metrics, 200, {
          'Content-Type': promClient!.register.contentType
        });
      });
    }

    // Health endpoints (accessible without auth)
    app.get('/health', async (c) => {
      const snapshot = getHealthSnapshot();
      return c.json(snapshot, snapshot.ready ? 200 : 503);
    });

    app.get('/ready', async (c) => {
      const snapshot = getHealthSnapshot();
      const isReady = snapshot.ready && snapshot.status !== 'degraded';
      return c.json({
        ready: isReady,
        timestamp: new Date().toISOString()
      }, isReady ? 200 : 503);
    });

    app.get('/healthz', async (c) => {
      const snapshot = getHealthSnapshot();
      return c.json(snapshot, snapshot.ready ? 200 : 503);
    });

    // Root endpoint
    app.get('/', (c) => {
      return c.json({
        service: 'AI Sales Platform',
        version: '1.0.0',
        status: 'running',
        timestamp: new Date().toISOString(),
        endpoints: {
          webhooks: '/webhooks/instagram',
          health: '/health',
          legal: '/legal'
        }
      });
    });

    // Start health monitoring
    startHealth(2000);
    log.info('✅ Health monitoring started');

    // Start server
    const port = Number(process.env.PORT || 3000);
    
    serve({
      fetch: app.fetch,
      port
    }, (info) => {
      log.info(`🎉 AI Sales Platform ready on :${info.port}`);
      
      // Record startup telemetry
      telemetry.trackEvent('service_started', {
        port: info.port,
        redisMode: redisStatus.mode,
        timestamp: new Date().toISOString()
      });
    });

    return app;
  } catch (error: any) {
    log.error('❌ Bootstrap failed:', error);
    process.exit(1);
  }
}

// Graceful shutdown handling
async function gracefulShutdown(signal: string) {
  log.info(`${signal} received, shutting down gracefully...`);
  
  try {
    // Stop health monitoring
    const { stopHealth } = await import('./services/health-check.js');
    stopHealth();
    
    // Close database connections
    const { closeDatabase } = await import('./startup/database.js');
    await closeDatabase();
    
    // Close Redis connections
    const { closeRedisConnections } = await import('./startup/redis.js');
    await closeRedisConnections();
    
    log.info('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error: any) {
    log.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log.error('❌ Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('❌ Unhandled Rejection:', { reason, promise });
  gracefulShutdown('unhandledRejection');
});

// Start the application
const app = await bootstrap();

export default app;