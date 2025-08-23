/**
 * ===============================================
 * Webhooks Routes Module
 * Handles Instagram webhook endpoints with security
 * ===============================================
 */

import { Hono } from 'hono';
import type { Pool } from 'pg';
import { getLogger } from '../services/logger.js';
import { verifyHMACRaw, type HmacVerifyResult } from '../services/encryption.js';
import { pushDLQ } from '../queue/dead-letter.js';
import { telemetry } from '../services/telemetry.js';
import { z } from 'zod';
import * as crypto from 'node:crypto';
import { getPool } from '../db/index.js';
import * as MerchantRepo from '../repos/merchant.repo.js';
import { enqueueInstagramWebhook, type InstagramWebhookJob } from '../queue/index.js';
import { getMerchantCache } from '../cache/index.js';

const log = getLogger({ component: 'webhooks-routes' });

// Webhook validation schemas
const InstagramWebhookVerificationSchema = z.object({
  'hub.mode': z.string(),
  'hub.verify_token': z.string(),
  'hub.challenge': z.string()
});

const WebhookEventSchema = z.object({
  object: z.string(),
  entry: z.array(z.object({
    id: z.string(),
    time: z.number(),
    messaging: z.array(z.any()).optional(),
    changes: z.array(z.any()).optional()
  }))
});

// In-memory cache for mapping Instagram page IDs to merchant IDs
const pageMerchantCache = new Map<string, { merchantId: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface WebhookDependencies {
  pool: Pool;
}

/**
 * Extract merchant ID from Instagram webhook by looking up Page ID
 */
async function extractMerchantId(webhookEvent: any): Promise<string> {
  try {
    // Get the first entry's Instagram Business Account ID
    if (webhookEvent.entry && webhookEvent.entry.length > 0) {
      const pageId = webhookEvent.entry[0].id;
      const merchantCache = getMerchantCache();
      
      // Check Redis cache first using new cache layer
      let merchantId = await merchantCache.getMerchantByPageId(pageId);
      
      if (!merchantId) {
        // Cache miss - lookup in database using repository
        const pool = getPool();
        merchantId = await MerchantRepo.getMerchantIdByPageId(pool, pageId);
        
        if (merchantId) {
          // Cache the result for future lookups
          await merchantCache.setMerchantByPageId(pageId, merchantId);
        }
      }
      
      if (merchantId) {
        return merchantId;
      }
    }
    
    // Fallback to default merchant if no mapping found
    log.warn('No merchant mapping found for Instagram webhook', {
      pageId: webhookEvent.entry?.[0]?.id,
      entryCount: webhookEvent.entry?.length
    });
    
    return 'default-merchant-id';
  } catch (error: any) {
    log.error('Error extracting merchant ID:', error);
    return 'default-merchant-id';
  }
}

/**
 * Register webhook routes on the app
 */
export function registerWebhookRoutes(app: Hono, deps: WebhookDependencies): void {

  // Instagram webhook verification (GET)
  app.get('/webhooks/instagram', async (c) => {
    try {
      const query = c.req.query();
      const validation = InstagramWebhookVerificationSchema.safeParse(query);
      
      if (!validation.success) {
        log.warn('Instagram webhook verification failed - invalid parameters', {
          query,
          errors: validation.error.errors
        });
        return c.text('Bad Request', 400);
      }

      const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = validation.data;

      if (mode !== 'subscribe') {
        log.warn('Instagram webhook verification failed - invalid mode', { mode });
        return c.text('Bad Request', 400);
      }

      const expectedToken = (process.env.IG_VERIFY_TOKEN || '').trim();
      if (!expectedToken || token !== expectedToken) {
        log.warn('Instagram webhook verification failed - invalid token', { 
          providedToken: token,
          expectedExists: !!expectedToken
        });
        return c.text('Forbidden', 403);
      }

      log.info('Instagram webhook verification successful', { challenge });
      return c.text(challenge);
    } catch (error: any) {
      log.error('Instagram webhook verification error:', error);
      return c.text('Internal Server Error', 500);
    }
  });

  // Instagram webhook event handler (POST)
  app.post('/webhooks/instagram', async (c) => {
    try {
      // Get raw body for HMAC verification
      const rawBody = (c as any).rawBody;
      if (!rawBody) {
        log.error('No raw body available for HMAC verification');
        return c.text('Bad Request - Raw body required', 400);
      }

      // Verify HMAC signature
      const signature = c.req.header('x-hub-signature-256');
      if (!signature) {
        log.warn('Instagram webhook missing signature header');
        return c.text('Unauthorized - Missing signature', 401);
      }

      const appSecret = (process.env.META_APP_SECRET || '').trim();
      if (!appSecret) {
        log.error('META_APP_SECRET not configured');
        return c.text('Internal Server Error', 500);
      }

      const verification: HmacVerifyResult = verifyHMACRaw(rawBody, signature, appSecret);
      if (!verification.ok) {
        log.warn('Instagram webhook HMAC verification failed', {
          reason: verification.reason,
          signatureLength: signature.length,
          bodyLength: rawBody.length
        });
        
        // Log the event for debugging (in development only)
        if (process.env.NODE_ENV !== 'production') {
          await logInstagramEvent(rawBody, signature, appSecret);
        }
        
        return c.text('Unauthorized - Invalid signature', 401);
      }

      // Parse webhook payload
      const body = await c.req.json();
      const validation = WebhookEventSchema.safeParse(body);
      
      if (!validation.success) {
        log.warn('Instagram webhook payload validation failed', {
          errors: validation.error.errors,
          body
        });
        return c.text('Bad Request - Invalid payload', 400);
      }

      const webhookEvent = validation.data;
      
      // Log successful webhook reception
      log.info('Instagram webhook received', {
        object: webhookEvent.object,
        entryCount: webhookEvent.entry.length,
        timestamp: new Date().toISOString()
      });

      // Extract merchant ID for routing
      const merchantId = await extractMerchantId(webhookEvent);
      
      // Queue-first pattern: Only verify HMAC and enqueue
      const requestStartTime = Date.now();
      
      try {
        const jobPayload: InstagramWebhookJob = {
          merchantId,
          webhookEvent,
          signature: signature,
          timestamp: Date.now(),
          headers: {
            'x-hub-signature-256': signature,
            'content-type': c.req.header('content-type') || 'application/json'
          }
        };

        // Enqueue for background processing
        const jobId = await enqueueInstagramWebhook(jobPayload, 0);
        
        const processingTime = Date.now() - requestStartTime;
        
        // Record fast webhook acceptance telemetry
        telemetry.recordMetaRequest('instagram', 'webhook', 200, processingTime, false);
        
        log.info('Instagram webhook enqueued successfully', {
          jobId,
          merchantId,
          entryCount: webhookEvent.entry.length,
          processingTimeMs: processingTime
        });
        
        // Fast response (target: < 150ms)
        return c.text('OK', 200);
        
      } catch (enqueueError: any) {
        const processingTime = Date.now() - requestStartTime;
        
        log.error('Failed to enqueue Instagram webhook', {
          error: enqueueError.message,
          merchantId,
          processingTimeMs: processingTime
        });
        
        telemetry.recordMetaRequest('instagram', 'webhook', 500, processingTime, false);
        return c.text('Service Temporarily Unavailable', 503);
      }
    } catch (error: any) {
      log.error('Instagram webhook processing error:', error);
      
      // Push to dead letter queue for retry
      try {
        await Promise.resolve(pushDLQ({
          reason: 'webhook_processing_failed',
          payload: {
            platform: 'instagram',
            error: error.message,
            timestamp: new Date().toISOString()
          }
        }));
      } catch (dlqError: any) {
        log.error('Failed to push to DLQ:', dlqError);
      }

      return c.text('Internal Server Error', 500);
    }
  });

  // WhatsApp webhook routes - DISABLED
  app.get('/webhooks/whatsapp', (c) => c.text('WhatsApp features disabled', 503));
  app.post('/webhooks/whatsapp', (c) => c.text('WhatsApp features disabled', 503));
  
  // Webhook health check endpoint
  app.get('/webhooks/health', async (c) => {
    return c.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      platforms: {
        instagram: 'active',
        whatsapp: 'disabled'
      }
    });
  });

  // Development debug endpoint for signature verification
  if (process.env.NODE_ENV !== 'production') {
    app.get('/internal/debug/last-dump-hash', async (c) => {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const dir = '/var/tmp';

        const files = (await fs.promises.readdir(dir))
          .filter(f => /^ig_\d+\.raw$/.test(f));

        const filesWithTime = await Promise.all(
          files.map(async (f) => ({
            f,
            t: (await fs.promises.stat(path.join(dir, f))).mtimeMs
          }))
        );
        const sorted = filesWithTime.sort((a, b) => b.t - a.t);

        if (!sorted.length) {
          return c.text('no dumps', 404);
        }

        const dumpPath = path.join(dir, sorted[0].f);
        const raw = await fs.promises.readFile(dumpPath);
        const exp = crypto.createHmac('sha256', (process.env.META_APP_SECRET || '').trim())
          .update(raw)
          .digest('hex');

        return c.text(`sha256=${exp}`);
      } catch (error: any) {
        log.error('Debug endpoint error:', error);
        return c.text('Error', 500);
      }
    });
  }

  log.info('Webhook routes registered successfully');
}

/**
 * Log Instagram event for debugging (development only)
 */
async function logInstagramEvent(rawBody: Buffer, signature: string, appSecret: string): Promise<void> {
  try {
    const fs = await import('fs');
    const path = await import('path');
    
    const timestamp = Date.now();
    const dumpPath = path.join('/var/tmp', `ig_${timestamp}.raw`);
    
    await fs.promises.writeFile(dumpPath, rawBody);
    
    const expected = crypto.createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');
    
    log.debug('Instagram event logged for debugging', {
      dumpPath,
      signature,
      expected: `sha256=${expected}`,
      bodyLength: rawBody.length
    });
  } catch (error: any) {
    log.error('Failed to log Instagram event:', error);
  }
}