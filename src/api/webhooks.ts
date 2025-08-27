/**
 * ===============================================
 * Unified Webhook Router - STEP 2 Implementation
 * Handles webhooks from both WhatsApp and Instagram platforms
 * ===============================================
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { logger } from 'hono/logger';
import { InstagramWebhookHandler, type InstagramWebhookEvent, type InstagramWebhookEntry } from '../services/instagram-webhook.js';
import { getServiceController } from '../services/service-controller.js';
// removed unused imports
import { securityHeaders, rateLimiter } from '../middleware/security.js';
import { getConfig } from '../config/index.js';
import { verifyHMACRaw } from '../services/encryption.js';
import { pushDLQ } from '../queue/dead-letter.js';
import { z } from 'zod';
import crypto from 'node:crypto';
import { MerchantIdMissingError } from '../utils/merchant.js';
import { telemetry } from '../services/telemetry.js';
import { getLogger } from '../services/logger.js';
import { getMerchantCache } from '../cache/index.js';
import { getDatabase } from '../db/adapter.js';

// Webhook validation schemas
const InstagramWebhookVerificationSchema = z.object({
  'hub.mode': z.string(),
  'hub.verify_token': z.string(),
  'hub.challenge': z.string()
});

function mapRawToInstagramEvent(raw: any): InstagramWebhookEvent {
  // تحقق بنيوي مبسط ثم بناء النوع الدوميني
  if (!Array.isArray(raw?.entry)) throw new Error('invalid webhook payload');
  for (const e of raw.entry) {
    if (e.messaging) {
      for (const m of e.messaging) {
        if (!m.sender || !m.recipient || !m.timestamp) {
          throw new Error('invalid messaging entry');
        }
      }
    }
  }
  return raw as InstagramWebhookEvent;
}


const WebhookEventSchema = z.object({
  object: z.string(),
  entry: z.array(z.object({
    id: z.string(),
    time: z.number(),
    messaging: z.array(z.record(z.unknown())).optional(),
    changes: z.array(z.record(z.unknown())).optional()
  }))
});

// WhatsAppWebhookVerificationSchema removed - WhatsApp disabled

// Redis cache for mapping Instagram page IDs to merchant IDs
const merchantCache = getMerchantCache();

export class WebhookRouter {
  private app: Hono;
  private instagramHandler: InstagramWebhookHandler;
  private serviceController = getServiceController();
  // pool removed - not used
  private config = getConfig();
  private logger = getLogger({ component: 'WebhookRouter' });
  private db = getDatabase();

  constructor() {
    this.app = new Hono();
    this.instagramHandler = new InstagramWebhookHandler();
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup middleware for webhook security and logging
   */
  private setupMiddleware(): void {
    // Security headers
    this.app.use('*', securityHeaders);
    
    // Logging (before rate limiter to log all attempts including 401s)
    this.app.use('*', logger());

    // Rate limiting per platform
    this.app.use('/webhooks/*', rateLimiter);
  }

  // getAppSecret removed - not used

  /**
   * Setup webhook routes - Instagram only
   */
  private setupRoutes(): void {
    // Instagram webhook routes
    this.app.get('/webhooks/instagram', this.handleInstagramVerification.bind(this));
    this.app.post('/webhooks/instagram', this.handleInstagramWebhook.bind(this));
    
    // WhatsApp webhook routes - DISABLED
    this.app.get('/webhooks/whatsapp', (c) => c.text('WhatsApp features disabled', 503));
    this.app.post('/webhooks/whatsapp', (c) => c.text('WhatsApp features disabled', 503));
    
    // Health check endpoint
    this.app.get('/webhooks/health', async (c) => {
      return c.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        platforms: {
          instagram: 'active',
          whatsapp: 'disabled'
        }
      });
    });

    // Temporary debug endpoint for signature verification (development only)
    if (process.env.NODE_ENV !== 'production') {
      this.app.get('/internal/debug/last-dump-hash', async (c) => {
        const fs = await import('fs');
        const p = await import('path');
        const crypto = await import('crypto');
        const dir = '/var/tmp';

        try {
          const files = (await fs.promises.readdir(dir))
            .filter(f => /^ig_\d+\.raw$/.test(f));

          const filesWithTime = await Promise.all(
            files.map(async (f) => ({
              f,
              t: (await fs.promises.stat(p.join(dir, f))).mtimeMs
            }))
          );
          const sorted = filesWithTime.sort((a, b) => b.t - a.t);

          if (!sorted.length) {
            return c.text('no dumps', 404);
          }

          const first = sorted?.[0];
          if (!first) throw new Error('No webhook files found to dump');
          const dumpPath = p.join(dir, first.f);
          const raw = await fs.promises.readFile(dumpPath);
          const exp = crypto.createHmac('sha256', (process.env.META_APP_SECRET || '').trim())
            .update(raw)
            .digest('hex');

          return c.json({
            dumpPath,
            expected_first10: exp.slice(0, 10),
            len: raw.length
          });
        } catch (error) {
          this.logger.error('Debug endpoint error', error);
          return c.text('Error reading dumps', 500);
        }
      });
    }

    // Webhook status endpoint
    this.app.get('/webhooks/status', async (c) => {
      try {
        const stats = await this.getWebhookStats();
        return c.json(stats);
      } catch (error) {
        this.logger.error('Failed to get webhook stats', error);
        return c.json({ error: 'Failed to get webhook statistics' }, 500);
      }
    });
  }

  /**
   * Handle Instagram webhook verification (GET request)
   */
  private async handleInstagramVerification(c: Context) {
    try {
      this.logger.info('Instagram webhook verification request received');
      
      const query = c.req.query();
      const validation = InstagramWebhookVerificationSchema.safeParse(query);
      
      if (!validation.success) {
        this.logger.error('Invalid Instagram verification parameters', validation.error);
        return c.text('Invalid verification parameters', 400);
      }

      const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = validation.data;
      
      if (mode !== 'subscribe') {
        this.logger.error('Invalid hub mode', undefined, { mode });
        return c.text('Invalid hub mode', 400);
      }

      // Verify token against stored webhook verify tokens
      const isValidToken = await this.verifyWebhookToken(token, 'instagram');
      
      if (!isValidToken) {
        this.logger.error('Invalid Instagram webhook verify token');
        return c.text('Invalid verify token', 403);
      }

      this.logger.info('Instagram webhook verification successful');
      return c.text(challenge);

    } catch (error) {
      this.logger.error('Instagram webhook verification failed', error);
      return c.text('Verification failed', 500);
    }
  }

  /**
   * Handle Instagram webhook events (POST request)
   */
  private async handleInstagramWebhook(c: Context) {
    let merchantId: string | undefined;
    try {
      this.logger.info('Instagram webhook event received');

      // Get raw buffer - CRITICAL: do this before any other body parsing
      const rawAB = await c.req.arrayBuffer();
      const rawBuf = Buffer.from(rawAB);

      // Check payload size to prevent server overload
      if (rawBuf.byteLength > 512 * 1024) {
        return c.text('Payload Too Large', 413);
      }
      
      // Get critical headers and config
      const sigHeader = c.req.header('x-hub-signature-256') ?? '';
      const appId = c.req.header('x-app-id') ?? '';
      const appSecret = (this.config.instagram?.appSecret || this.config.instagram?.metaAppSecret || '').trim();
      const metaAppId = (this.config.instagram?.appId || '').trim();

      if (!metaAppId) {
        this.logger.warn('META_APP_ID not configured');
        return c.text('Server configuration error', 500);
      }

      if (!appSecret) {
        this.logger.warn('META_APP_SECRET not configured');
        return c.text('Server configuration error', 500);
      }
      
      // Optional debug dump (only if DEBUG_DUMP=1)
      if (process.env.DEBUG_DUMP === '1') {
        const dump = `/var/tmp/ig_${Date.now()}.raw`;
        try {
          const fs = await import('fs');
          await fs.promises.writeFile(dump, rawBuf);
          this.logger.info('Debug dump saved', { dump });

          // Keep debug dumps from growing without bound
          const dir = '/var/tmp';
          const maxFiles = 20;
          const p = await import('path');
          try {
            const files = (await fs.promises.readdir(dir))
              .filter(f => /^ig_\d+\.raw$/.test(f));

            if (files.length > maxFiles) {
              const stats = await Promise.all(
                files.map(async f => ({
                  f,
                  t: (await fs.promises.stat(p.join(dir, f))).mtimeMs
                }))
              );

              const toDelete = stats.sort((a, b) => b.t - a.t).slice(maxFiles);
              await Promise.all(toDelete.map(s => fs.promises.unlink(p.join(dir, s.f))));
            }
          } catch (pruneError) {
            this.logger.error('Could not prune debug dumps', pruneError);
          }
        } catch (writeError) {
          this.logger.error('Could not write debug file', writeError);
        }
      }
      
      // Log critical headers (without sensitive data)
      this.logger.info('Webhook headers', { appId, sig256Length: sigHeader.length, bodyLength: rawBuf.length });
      
      // 1. Verify App ID matches
      if (!appId || appId !== metaAppId) {
        this.logger.error('APP_ID_MISMATCH', undefined, { appId, expect: metaAppId });
        return c.text('App mismatch', 401);
      }
      
      // 2. Require proper signature header format
      if (!sigHeader || !sigHeader.startsWith('sha256=')) {
        this.logger.error('Bad signature header format');
        return c.text('Bad signature header', 401);
      }
      
      // 3. Unified HMAC verification with raw Buffer
      const verifyResult = verifyHMACRaw(rawBuf, sigHeader, appSecret);
      if (!verifyResult.ok) {
        this.logger.error('Instagram webhook signature verification failed', undefined, { reason: verifyResult.reason });
        
        // Check if HMAC verification should be skipped
        if (process.env.SKIP_HMAC_VERIFICATION !== 'true') {
          return c.text('Invalid signature', 401);
        } else {
          this.logger.warn('SKIPPING HMAC verification due to SKIP_HMAC_VERIFICATION=true');
        }
      }
      
      this.logger.info('Instagram webhook signature verified successfully');
      
      // Parse JSON only after successful verification
      let event: InstagramWebhookEvent;
      try {
        const parsedData = JSON.parse(rawBuf.toString('utf8'));
        // استخدم Zod للتحقق بدلاً من type assertion
        const parsed = WebhookEventSchema.parse(parsedData);
        event = mapRawToInstagramEvent(parsed); // دالة تحويل
      } catch (parseError) {
        this.logger.error('Invalid Instagram webhook JSON', parseError);
        return c.text('Invalid JSON', 400);
      }

      // Validate event structure
      const validation = WebhookEventSchema.safeParse(event);
      if (!validation.success) {
        this.logger.error('Invalid Instagram event structure', validation.error);
        return c.text('Invalid event structure', 400);
      }

      if (event.object !== 'instagram') return c.text('Wrong object', 400);

      // Determine merchant ID from header or page mapping
      merchantId = c.req.header('x-merchant-id') || undefined;
      if (!merchantId) {
        const firstPageId = event.entry[0]?.id;
        if (firstPageId) {
          merchantId = await this.getMerchantIdFromPageId(firstPageId) || undefined;
        }
      }
      if (!merchantId) {
        return c.json({
          error: 'Merchant ID required',
          code: 'MERCHANT_ID_MISSING'
        }, 400);
      }

      // Apply Redis sliding window rate limiting
      const { getMetaRateLimiter } = await import('../services/meta-rate-limiter.js');
      const rateLimiter = getMetaRateLimiter();
      const rateLimitKey = `webhook:instagram:${merchantId}`;
      const windowMs = 60000; // 1 minute window
      const maxRequests = 100; // 100 requests per minute per merchant
      let rateCheck: { allowed: boolean; remaining: number; resetTime: number };
      // skipRateLimitCheck removed - not used
      try {
        rateCheck = await rateLimiter.checkRedisRateLimit(rateLimitKey, windowMs, maxRequests);
      } catch (error) {
        this.logger.warn('Failed to check Redis rate limit', { err: error, merchantId });
        telemetry.recordRateLimitStoreFailure('instagram', 'webhook');
        rateCheck = { allowed: true, remaining: maxRequests, resetTime: Date.now() + windowMs };
      }

      if (!rateCheck.allowed) {
        this.logger.warn('Instagram webhook rate limit exceeded', { merchantId });
        return c.json({
          error: 'Rate limit exceeded',
          resetTime: rateCheck.resetTime,
          remaining: rateCheck.remaining
        }, 429);
      }

      this.logger.info('Rate limit check passed', { remaining: rateCheck.remaining });

      // Check for idempotency using merchant and body hash
      const idempotencyCheck = await this.checkWebhookIdempotency(merchantId, event, 'instagram');

      if (idempotencyCheck.isDuplicate) {
        this.logger.info('Duplicate Instagram webhook detected', { eventId: idempotencyCheck.eventId });
        return c.text('EVENT_RECEIVED', 200);
      }

      for (const entry of event.entry) {
        await this.processInstagramEntry(entry);
      }

      await this.markWebhookProcessed(idempotencyCheck.eventId);
      return c.text('EVENT_RECEIVED', 200);

    } catch (error) {
      if (error instanceof MerchantIdMissingError) {
        return c.json({
          error: 'Merchant ID required',
          code: 'MERCHANT_ID_MISSING'
        }, 400);
      }
      this.logger.error('Instagram webhook processing failed', error);

      pushDLQ({
        ts: Date.now(),
        reason: 'instagram-webhook-processing-failed',
        payload: {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        },
        platform: 'instagram',
        merchantId: merchantId ?? 'unknown'
      });

      return c.text('Webhook processing failed', 500);
    }
  }



  /**
   * Process Instagram webhook entry
   */
  private async processInstagramEntry(entry: InstagramWebhookEntry): Promise<void> {
    try {
      // Get merchant ID from entry ID (Page ID)
      const pageId = entry.id;
      const merchantId = await this.getMerchantIdFromPageId(pageId);
      
      if (!merchantId) {
        this.logger.error('No merchant found for Instagram Page ID', undefined, { pageId: String(pageId).replace(/[\r\n]/g, '') });
        return;
      }

      // Check if Instagram service is enabled
      const isInstagramEnabled = await this.serviceController.isServiceEnabled(merchantId, 'instagram');
      if (!isInstagramEnabled) {
        this.logger.info('Instagram service disabled', { merchantId });
        await this.logWebhookEvent('instagram', merchantId, 'ERROR', {
          pageId,
          reason: 'Service disabled'
        });
        return;
      }

      // Process the Instagram event
      const result = await this.instagramHandler.processWebhook(
        { entry: [entry] } as InstagramWebhookEvent,
        merchantId
      );

      this.logger.info('Instagram webhook processed successfully', {
        merchantId,
        messagesProcessed: result.messagesProcessed,
        conversationsCreated: result.conversationsCreated,
        errors: result.errors.length,
        timestamp: new Date().toISOString()
      });

      // Log successful processing
      await this.logWebhookEvent('instagram', merchantId, 'SUCCESS', {
        pageId,
        messagesProcessed: result.messagesProcessed,
        conversationsCreated: result.conversationsCreated
      });

    } catch (error) {
      this.logger.error('Failed to process Instagram entry', error);
      
      // Push to DLQ for analysis
      pushDLQ({
        ts: Date.now(),
        reason: 'instagram-entry-processing-failed',
        payload: {
          error: error instanceof Error ? error.message : 'Unknown error',
          entry: entry
        },
        platform: 'instagram'
      });
      
      await this.logWebhookEvent('instagram', 'unknown', 'ERROR', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // processWhatsAppEntry removed - WhatsApp disabled

  /**
   * Verify webhook token against stored credentials
   */
  private async verifyWebhookToken(token: string, platform: 'instagram' | 'whatsapp'): Promise<boolean> {
    try {
      const sql = this.db.getSQL();
      const hashed = crypto.createHash('sha256').update(token).digest('hex');

      const result = await sql`
        SELECT 1
        FROM merchant_credentials mc
        JOIN merchants m ON mc.merchant_id = m.id
        WHERE mc.webhook_verify_token = ${hashed}
          AND mc.platform = ${platform}
          AND m.subscription_status = 'ACTIVE'
        LIMIT 1
      `;

      return result.length > 0;

    } catch (error) {
      this.logger.error('Failed to verify webhook token', error);
      return false;
    }
  }

  

  /**
   * Get merchant ID from Instagram Page ID using Redis cache
   */
  private async getMerchantIdFromPageId(pageId: string): Promise<string | null> {
    try {
      // Check Redis cache first
      const cachedMerchantId = await merchantCache.getMerchantByPageId(pageId);
      if (cachedMerchantId) {
        return cachedMerchantId;
      }

      // If not in cache, query database
      const sql = this.db.getSQL();

      const result = await sql`
        SELECT merchant_id
        FROM merchant_credentials
        WHERE instagram_business_account_id = ${pageId}
           OR instagram_page_id = ${pageId}
        LIMIT 1
      `;

      interface MerchantResult {
        merchant_id: string;
      }
      
      function toMerchantResult(r: Record<string, unknown>): MerchantResult {
        return {
          merchant_id: String(r.merchant_id ?? '')
        };
      }
      
      const merchantId = result[0] ? toMerchantResult(result[0]).merchant_id || null : null;

      // Cache the result in Redis
      if (merchantId) {
        await merchantCache.setMerchantByPageId(pageId, merchantId);
      }

      return merchantId;
    } catch (error) {
      this.logger.error('Failed to get merchant ID from page ID', error);
      return null;
    }
  }

  /**
   * Log webhook events for monitoring
   */
  private async logWebhookEvent(
    platform: 'instagram' | 'whatsapp',
    merchantId: string,
    status: 'SUCCESS' | 'ERROR',
    details: Record<string, unknown>
  ): Promise<void> {
    try {
      const sql = this.db.getSQL();
      
      await sql`
        INSERT INTO webhook_logs (
          merchant_id,
          platform,
          event_type,
          status,
          details,
          processed_at
        ) VALUES (
          ${merchantId}::uuid,
          ${platform},
          'WEBHOOK_EVENT',
          ${status},
          ${JSON.stringify(details)},
          NOW()
        )
      `;

    } catch (error) {
      this.logger.error('Failed to log webhook event', error);
    }
  }

  /**
   * Generate hash for merchant and body (idempotency)
   */
  private generateMerchantBodyHash(merchantId: string, body: unknown): string {
    const content = `${merchantId}:${JSON.stringify(body)}`;
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Check if webhook is duplicate based on merchant and body hash
   */
  private async checkWebhookIdempotency(
    merchantId: string, 
    body: unknown,
    platform: 'instagram' | 'whatsapp'
  ): Promise<{ isDuplicate: boolean; eventId: string }> {
    const eventId = this.generateMerchantBodyHash(merchantId, body);
    
    try {
      const sql = this.db.getSQL();
      
      // Try to insert the webhook event with unique constraint
      const result = await sql`
        INSERT INTO webhook_events (
          event_id,
          merchant_id,
          platform,
          body_hash,
          processed_at,
          created_at
        ) VALUES (
          ${eventId},
          ${merchantId}::uuid,
          ${platform.toUpperCase()},
          ${eventId},
          NULL,
          NOW()
        )
        ON CONFLICT (merchant_id, platform, event_id) 
        DO NOTHING
        RETURNING event_id
      `;
      
      const isFirstTime = result.length > 0;
      this.logger.info('Webhook idempotency check completed', { eventId, isFirstTime });
      
      return {
        isDuplicate: !isFirstTime,
        eventId
      };
    } catch (error) {
      this.logger.error('Idempotency check failed', error);
      // Fail open - allow processing on error
      return { isDuplicate: false, eventId };
    }
  }

  /**
   * Mark webhook as processed
   */
  private async markWebhookProcessed(eventId: string): Promise<void> {
    try {
      const sql = this.db.getSQL();
      await sql`
        UPDATE webhook_events 
        SET processed_at = NOW()
        WHERE event_id = ${eventId}
      `;
      this.logger.info('Webhook marked as processed', { eventId });
    } catch (error) {
      this.logger.error('Failed to mark webhook as processed', error);
    }
  }

  /**
   * Get webhook statistics
   */
  private async getWebhookStats(): Promise<{
    summary: WebhookLogSummaryRow[];
    hourlyStats: WebhookLogHourlyRow[];
    lastUpdated: string;
  }> {
    try {
      const sql = this.db.getSQL();
      
      const stats = await sql<WebhookLogHourlyRow>`
        SELECT 
          platform,
          status,
          COUNT(*) as count,
          DATE_TRUNC('hour', processed_at) as hour
        FROM webhook_logs
        WHERE processed_at >= NOW() - INTERVAL '24 hours'
        GROUP BY platform, status, DATE_TRUNC('hour', processed_at)
        ORDER BY hour DESC
      `;

      const summary = await sql<WebhookLogSummaryRow>`
        SELECT 
          platform,
          COUNT(*) as total_events,
          COUNT(CASE WHEN status = 'SUCCESS' THEN 1 END) as successful_events,
          COUNT(CASE WHEN status = 'ERROR' THEN 1 END) as failed_events,
          ROUND(
            COUNT(CASE WHEN status = 'SUCCESS' THEN 1 END)::numeric / 
            COUNT(*)::numeric * 100, 2
          ) as success_rate
        FROM webhook_logs
        WHERE processed_at >= NOW() - INTERVAL '24 hours'
        GROUP BY platform
      `;

      // Flatten the results since sql returns T[]
      return {
        summary: summary.flat() as WebhookLogSummaryRow[],
        hourlyStats: stats.flat() as WebhookLogHourlyRow[],
        lastUpdated: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('Failed to get webhook stats', error);
      throw error;
    }
  }

  /**
   * Get the Hono app instance
   */
  public getApp(): Hono {
    return this.app;
  }
}

// Export singleton instance
let webhookRouterInstance: WebhookRouter | null = null;

export function getWebhookRouter(): WebhookRouter {
  if (!webhookRouterInstance) {
    webhookRouterInstance = new WebhookRouter();
  }
  return webhookRouterInstance;
}

export default WebhookRouter;

// --- Types ---
interface WebhookLogHourlyRow {
  platform: 'instagram' | 'whatsapp';
  status: 'SUCCESS' | 'ERROR';
  count: string;
  hour: string;
  [key: string]: unknown;
}

interface WebhookLogSummaryRow {
  platform: 'instagram' | 'whatsapp';
  total_events: string;
  successful_events: string;
  failed_events: string;
  success_rate: string;
  [key: string]: unknown;
}