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
import * as crypto from 'node:crypto';

// 4) Logger and telemetry
import { getLogger } from './services/logger.js';
import { initTelemetry, telemetry } from './services/telemetry.js';

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
    log.info('✅ Environment variables validated');

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