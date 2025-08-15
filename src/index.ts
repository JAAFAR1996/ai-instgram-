/**
 * ===============================================
 * AI Sales Platform - Main Application Entry Point
 * Enterprise AI-powered sales platform for WhatsApp & Instagram
 * ===============================================
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { getWebhookRouter } from './api/webhooks';
import { getServiceControlAPI } from './api/service-control';
import { getInstagramAuthAPI } from './api/auth/instagram';
import { securityHeaders } from './middleware/security';
import { getDatabase } from './database/connection';
import { getConfig, EnvironmentValidationError } from './config/environment';
import { runStartupValidation } from './startup/validation';
import { initializeQueueSystem, getQueueManager } from './queue/queue-manager';

// Initialize and validate environment configuration
let appConfig;
try {
  appConfig = getConfig();
  console.log('✅ Environment configuration validated successfully');
} catch (error) {
  if (error instanceof EnvironmentValidationError) {
    console.error('❌ Environment validation failed:');
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

// Run comprehensive startup validation and initialize systems
async function initializeApplication() {
  const validationReport = await runStartupValidation();
  
  if (!validationReport.overallSuccess) {
    console.error('❌ Critical startup validation errors - exiting');
    process.exit(1);
  }
  
  // Initialize queue system for async processing
  console.log('🔄 Initializing async processing queue...');
  const queueManager = await initializeQueueSystem();
  console.log('✅ Queue system initialized successfully');
  
  return { validationReport, queueManager };
}

const app = new Hono();

// Global middleware
app.use('*', logger());
app.use('*', securityHeaders);

// CORS for API endpoints - use validated configuration
app.use('/api/*', cors({
  origin: appConfig.environment === 'production' 
    ? appConfig.security.corsOrigins
    : ['https://ai-instgram.onrender.com'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Hub-Signature-256'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

// Health check endpoint with enhanced configuration info
app.get('/health', async (c) => {
  try {
    // Check database connection
    const db = getDatabase();
    const dbHealth = await db.healthCheck();

    return c.json({
      status: dbHealth.status === 'healthy' ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: appConfig.environment,
      services: {
        database: dbHealth.status,
        webhooks: 'active',
        ai: {
          provider: 'openai',
          model: appConfig.ai.model,
          maxTokens: appConfig.ai.maxTokens
        },
        security: {
          corsEnabled: appConfig.security.corsOrigins.length > 0,
          rateLimitEnabled: true
        }
      },
      performance: {
        databaseResponseTime: dbHealth.details.response_time_ms,
        activeConnections: dbHealth.details.active_connections,
        databaseSize: dbHealth.details.database_size
      }
    });
  } catch (error) {
    return c.json({
      status: 'unhealthy',
      error: 'Health check failed',
      timestamp: new Date().toISOString(),
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// API routes with configuration details
app.get('/api/status', async (c) => {
  return c.json({
    service: 'AI Sales Platform',
    version: '1.0.0',
    environment: appConfig.environment,
    platforms: ['WhatsApp', 'Instagram'],
    features: [
      'AI-powered conversations',
      'Multi-platform messaging',
      'Webhook integration',
      'Secure credential management',
      'Quality monitoring',
      'Environment validation',
      'SQL injection protection',
      'Webhook retry mechanism'
    ],
    configuration: {
      ai: {
        model: appConfig.ai.model,
        maxTokens: appConfig.ai.maxTokens,
        temperature: appConfig.ai.temperature
      },
      security: {
        encryptionEnabled: true,
        corsEnabled: appConfig.security.corsOrigins.length > 0,
        rateLimitWindow: appConfig.security.rateLimitWindow,
        rateLimitMax: appConfig.security.rateLimitMax
      },
      database: {
        maxConnections: appConfig.database.maxConnections,
        sslEnabled: appConfig.database.ssl
      }
    }
  });
});

// Configuration validation endpoint (for monitoring)
app.get('/api/config/validate', async (c) => {
  try {
    const validationReport = await runStartupValidation();
    
    return c.json({
      success: validationReport.overallSuccess,
      timestamp: new Date().toISOString(),
      totalDuration: validationReport.totalDuration,
      results: validationReport.results,
      criticalErrors: validationReport.criticalErrors,
      summary: {
        totalChecks: validationReport.results.length,
        passedChecks: validationReport.results.filter(r => r.success).length,
        failedChecks: validationReport.results.filter(r => !r.success).length,
        environment: appConfig.environment
      }
    }, validationReport.overallSuccess ? 200 : 500);
  } catch (error) {
    return c.json({
      success: false,
      error: 'Validation check failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, 500);
  }
});

// Queue management endpoints
app.get('/api/queue/stats', async (c) => {
  try {
    const queueManager = getQueueManager();
    const stats = await queueManager.getStats();
    
    return c.json({
      success: true,
      timestamp: new Date().toISOString(),
      stats
    });
  } catch (error) {
    return c.json({
      success: false,
      error: 'Failed to get queue statistics',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, 500);
  }
});

app.get('/api/queue/health', async (c) => {
  try {
    const queueManager = getQueueManager();
    const health = await queueManager.healthCheck();
    
    return c.json({
      success: true,
      timestamp: new Date().toISOString(),
      health
    }, health.status === 'healthy' ? 200 : 503);
  } catch (error) {
    return c.json({
      success: false,
      error: 'Queue health check failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, 500);
  }
});

app.post('/api/queue/retry-failed', async (c) => {
  try {
    const body = await c.req.json();
    const queueManager = getQueueManager();
    
    const retriedCount = await queueManager.retryFailedJobs(body.jobType);
    
    return c.json({
      success: true,
      message: `Retried ${retriedCount} failed jobs`,
      retriedCount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return c.json({
      success: false,
      error: 'Failed to retry failed jobs',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, 500);
  }
});

app.post('/api/queue/cleanup', async (c) => {
  try {
    const body = await c.req.json();
    const queueManager = getQueueManager();
    
    const deletedCount = await queueManager.cleanupOldJobs(body.olderThanDays || 7);
    
    return c.json({
      success: true,
      message: `Cleaned up ${deletedCount} old jobs`,
      deletedCount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return c.json({
      success: false,
      error: 'Failed to cleanup old jobs',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, 500);
  }
});

// Mount webhook router
const webhookRouter = getWebhookRouter();
app.route('/', webhookRouter.getApp());

// Mount service control API
const serviceControlAPI = getServiceControlAPI();
app.route('/', serviceControlAPI.getApp());

// Mount Instagram auth API
const instagramAuthAPI = getInstagramAuthAPI();
app.route('/api', instagramAuthAPI.getApp());

// 404 handler
app.notFound((c) => {
  return c.json({
    error: 'Endpoint not found',
    path: c.req.path,
    method: c.req.method
  }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Application error:', err);
  return c.json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  }, 500);
});

// Start server with validated configuration
const port = appConfig.port;

console.log(`🚀 Starting AI Sales Platform on port ${port}`);
console.log(`🌍 Environment: ${appConfig.environment}`);
console.log(`📱 Platforms: WhatsApp, Instagram`);
console.log(`🔗 Webhook endpoints: /webhooks/whatsapp, /webhooks/instagram`);
console.log(`💚 Health check: /health`);
console.log(`🛡️ Security: CORS enabled, Rate limiting active`);
console.log(`🧠 AI: ${appConfig.ai.model} (max tokens: ${appConfig.ai.maxTokens})`);
console.log(`🗄️ Database: ${appConfig.database.host}:${appConfig.database.port} (SSL: ${appConfig.database.ssl ? 'enabled' : 'disabled'})`);
console.log(`🔄 Queue System: Async processing active`);
console.log(`📊 Monitoring: /api/queue/stats, /api/queue/health`);
console.log(`🔧 Management: /api/config/validate, /api/status`);

export default {
  port,
  fetch: app.fetch,
};

// For development with Bun - run startup validation
if (import.meta.main) {
  initializeApplication().then((result) => {
    console.log(`🔥 AI Sales Platform running on https://ai-instgram.onrender.com (port ${port})`);
    console.log(`✅ Startup validation completed in ${result.validationReport.totalDuration}ms`);
    console.log(`✅ Queue system initialized with ${result.queueManager ? '6 processors' : 'error'}`);
    console.log(`🎯 Ready to process webhooks and AI responses asynchronously`);
  }).catch((error) => {
    console.error('❌ Application initialization failed:', error);
    process.exit(1);
  });
}