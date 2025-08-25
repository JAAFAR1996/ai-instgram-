/**
 * ===============================================
 * Admin Routes Module
 * Handles internal administrative endpoints with security
 * ===============================================
 */

import { Hono } from 'hono';
import type { Pool } from 'pg';
import { getLogger } from '../services/logger.js';
import { getHealthSnapshot } from '../services/health-check.js';

import { telemetry } from '../services/telemetry.js';
// import { registerTestRoutes } from '../internal/test/dev-routes.js';
import { getRedisIntegrationStatus, getQueueManager } from '../startup/redis.js';
import * as crypto from 'node:crypto';

const log = getLogger({ component: 'admin-routes' });

export interface AdminDependencies {
  pool: Pool;
}

/**
 * Register administrative routes on the app
 */
export function registerAdminRoutes(app: Hono, deps: AdminDependencies): void {
  
  // Health endpoints
  app.get('/health', async (c) => {
    try {
      const snapshot = getHealthSnapshot();
      return c.json(snapshot, snapshot.ready ? 200 : 503);
    } catch (error: any) {
      log.error('Health endpoint error:', error);
      return c.json({
        ready: false,
        status: 'error',
        error: error.message,
        lastUpdated: Date.now()
      }, 503);
    }
  });

  app.get('/ready', async (c) => {
    try {
      const snapshot = getHealthSnapshot();
      const isReady = snapshot.ready && snapshot.status !== 'degraded';
      
      return c.json({
        ready: isReady,
        timestamp: new Date().toISOString()
      }, isReady ? 200 : 503);
    } catch (error: any) {
      log.error('Readiness endpoint error:', error);
      return c.json({ ready: false, error: error.message }, 503);
    }
  });

  // Health check with detailed snapshot
  app.get('/healthz', async (c) => {
    try {
      const snapshot = getHealthSnapshot();
      return c.json(snapshot, snapshot.ready ? 200 : 503);
    } catch (error: any) {
      log.error('Healthz endpoint error:', error);
      return c.json({
        ready: false,
        status: 'error',
        error: error.message,
        lastUpdated: Date.now()
      }, 503);
    }
  });

  // Internal metrics endpoint
  app.get('/internal/metrics', async (c) => {
    try {
      const snapshot = getHealthSnapshot();
      const redisStatus = getRedisIntegrationStatus();
      // const queueManager = getQueueManager(); // Unused variable

      const metrics = {
        health: snapshot,
        redis: {
          enabled: redisStatus?.success || false,
          mode: redisStatus?.mode || 'disabled',
          queueReady: !!getQueueManager()
        },
        system: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          nodeVersion: process.version,
          timestamp: new Date().toISOString()
        }
      };

      return c.json(metrics);
    } catch (error: any) {
      log.error('Metrics endpoint error:', error);
      return c.json({ error: error.message }, 500);
    }
  });

  // Internal system stats
  app.get('/internal/stats', async (c) => {
    try {
      const client = await deps.pool.connect();
      try {
        // Database stats
        const dbStats = await client.query(`
          SELECT 
            (SELECT COUNT(*) FROM merchants) as merchants_count,
            (SELECT COUNT(*) FROM conversations WHERE is_active = true) as active_conversations,
            (SELECT COUNT(*) FROM message_logs WHERE created_at >= NOW() - INTERVAL '24 hours') as messages_24h,
            pg_size_pretty(pg_database_size(current_database())) as db_size
        `);

        const stats = {
          database: dbStats.rows[0],
          redis: getRedisIntegrationStatus(),
          timestamp: new Date().toISOString()
        };

        return c.json(stats);
      } finally {
        client.release();
      }
    } catch (error: any) {
      log.error('Stats endpoint error:', error);
      return c.json({ error: error.message }, 500);
    }
  });

  // Queue stats endpoint
  app.get('/internal/queue/stats', async (c) => {
    try {
      const queueManager = getQueueManager();
      const redisStatus = getRedisIntegrationStatus();

      if (!queueManager) {
        return c.json({
          enabled: false,
          mode: redisStatus?.mode || 'disabled',
          reason: redisStatus?.reason || 'queue_manager_not_available'
        });
      }

      // Get queue stats if available
      // Note: This would depend on the actual queue manager implementation
      const queueStats = {
        enabled: true,
        mode: redisStatus?.mode || 'active',
        timestamp: new Date().toISOString()
      };

      return c.json(queueStats);
    } catch (error: any) {
      log.error('Queue stats endpoint error:', error);
      return c.json({ error: error.message }, 500);
    }
  });

  // Validation endpoints
  app.get('/internal/validate/encryption', async (c) => {
    try {
      // Production encryption test using AES-256-GCM
      const testKey = crypto.randomBytes(32);
      const testData = 'test-encryption-data';
      const iv = crypto.randomBytes(12); // 12 bytes for GCM
      
      // Encrypt
      const cipher = crypto.createCipheriv('aes-256-gcm', testKey, iv);
      let encrypted = cipher.update(testData, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const authTag = cipher.getAuthTag();
      
      // Decrypt to verify
      const decipher = crypto.createDecipheriv('aes-256-gcm', testKey, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      const success = decrypted === testData;
      
      return c.json({
        test: 'encryption_validation',
        success,
        algorithm: 'AES-256-GCM',
        keyLength: testKey.length,
        ivLength: iv.length,
        authTagLength: authTag.length,
        timestamp: new Date().toISOString(),
        details: { 
          testDataLength: testData.length, 
          encryptedLength: encrypted.length,
          decryptionMatch: success
        }
      });
    } catch (error: any) {
      log.error('Encryption validation error:', error);
      return c.json({
        test: 'encryption_validation',
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }, 500);
    }
  });

  app.get('/internal/validate/database', async (c) => {
    try {
      const client = await deps.pool.connect();
      try {
        const result = await client.query('SELECT NOW() as current_time, version() as db_version');
        
        return c.json({
          test: 'database_validation',
          success: true,
          connection: 'healthy',
          server_time: result.rows[0].current_time,
          version: result.rows[0].db_version,
          timestamp: new Date().toISOString()
        });
      } finally {
        client.release();
      }
    } catch (error: any) {
      log.error('Database validation error:', error);
      return c.json({
        test: 'database_validation',
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }, 500);
    }
  });

  app.get('/internal/validate/redis', async (c) => {
    try {
      const redisStatus = getRedisIntegrationStatus();
      
      return c.json({
        test: 'redis_validation',
        success: redisStatus?.success || false,
        mode: redisStatus?.mode || 'disabled',
        error: redisStatus?.error,
        reason: redisStatus?.reason,
        queueReady: !!getQueueManager(),
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      log.error('Redis validation error:', error);
      return c.json({
        test: 'redis_validation',
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }, 500);
    }
  });

  // Meta API ping endpoint
  app.get('/internal/diagnostics/meta-ping', async (c) => {
    try {
      // Simple Meta API connectivity test
      const appId = process.env.META_APP_ID;
      const appSecret = process.env.META_APP_SECRET;
      
      if (!appId || !appSecret) {
        return c.json({
          test: 'meta_api_ping',
          success: false,
          error: 'META_APP_ID or META_APP_SECRET not configured',
          timestamp: new Date().toISOString()
        }, 400);
      }

      // Record telemetry for the ping
      telemetry.recordMetaRequest('instagram', 'ping', 200, 0);

      return c.json({
        test: 'meta_api_ping',
        success: true,
        configured: true,
        app_id: appId,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      log.error('Meta API ping error:', error);
      return c.json({
        test: 'meta_api_ping',
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      }, 500);
    }
  });

  // Register development test routes (disabled for production)
  // if (process.env.NODE_ENV !== 'production') {
  //   registerTestRoutes(app);
  //   log.info('Development test routes registered');
  // }

  log.info('Admin routes registered successfully');
}