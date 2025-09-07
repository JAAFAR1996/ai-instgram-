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

    // Register route modules with DI
    const deps = { pool, queueManager };
    registerWebhookRoutes(app, deps);
    registerMerchantAdminRoutes(app);
    registerAdminRoutes(app);
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


