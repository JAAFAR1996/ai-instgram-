/**
 * ===============================================
 * Unified Webhook Router - STEP 2 Implementation
 * Handles webhooks from both WhatsApp and Instagram platforms
 * ===============================================
 */

import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { InstagramWebhookHandler, type InstagramWebhookEvent } from '../services/instagram-webhook';
import { getServiceController } from '../services/service-controller';
// removed unused imports
import { securityHeaders, rateLimiter } from '../middleware/security';
import { getDatabase } from '../database/connection';
import { getConfig } from '../config/environment';
import { z } from 'zod';
import crypto from 'node:crypto';

// Webhook validation schemas
const InstagramWebhookVerificationSchema = z.object({
  'hub.mode': z.string(),
  'hub.verify_token': z.string(),
  'hub.challenge': z.string()
});

const WhatsAppWebhookVerificationSchema = z.object({
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

export class WebhookRouter {
  private app: Hono;
  private instagramHandler: InstagramWebhookHandler;
  private serviceController = getServiceController();
  private db = getDatabase();
  private config = getConfig();

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

  /**
   * Get unified app secret from config or environment
   */
  private getAppSecret(): string {
    return (this.config.instagram.metaAppSecret || process.env.META_APP_SECRET || '').trim();
  }

  /**
   * Setup webhook routes for both platforms
   */
  private setupRoutes(): void {
    // Instagram webhook routes
    this.app.get('/webhooks/instagram', this.handleInstagramVerification.bind(this));
    this.app.post('/webhooks/instagram', this.handleInstagramWebhook.bind(this));
    
    // WhatsApp webhook routes
    this.app.get('/webhooks/whatsapp', this.handleWhatsAppVerification.bind(this));
    this.app.post('/webhooks/whatsapp', this.handleWhatsAppWebhook.bind(this));
    
    // Health check endpoint
    this.app.get('/webhooks/health', async (c) => {
      return c.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        platforms: {
          instagram: 'active',
          whatsapp: 'active'
        }
      });
    });

    // Temporary debug endpoint for signature verification
    this.app.get('/internal/debug/last-dump-hash', async (c) => {
      const fs = await import('fs'); 
      const p = await import('path'); 
      const crypto = await import('crypto');
      const dir = '/var/tmp';
      
      try {
        const files = (await fs.promises.readdir(dir))
          .filter(f => /^ig_\d+\.raw$/.test(f))
          .map(f => ({ f, t: fs.statSync(p.join(dir, f)).mtimeMs }))
          .sort((a, b) => b.t - a.t);
        
        if (!files.length) {
          return c.text('no dumps', 404);
        }
        
        const dumpPath = p.join(dir, files[0].f);
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
        console.error('Debug endpoint error:', error);
        return c.text('Error reading dumps', 500);
      }
    });

    // Webhook status endpoint
    this.app.get('/webhooks/status', async (c) => {
      try {
        const stats = await this.getWebhookStats();
        return c.json(stats);
      } catch (error) {
        console.error('❌ Failed to get webhook stats:', error);
        return c.json({ error: 'Failed to get webhook statistics' }, 500);
      }
    });
  }

  /**
   * Handle Instagram webhook verification (GET request)
   */
  private async handleInstagramVerification(c: any) {
    try {
      console.log('🔍 Instagram webhook verification request received');
      
      const query = c.req.query();
      const validation = InstagramWebhookVerificationSchema.safeParse(query);
      
      if (!validation.success) {
        console.error('❌ Invalid Instagram verification parameters:', validation.error);
        return c.text('Invalid verification parameters', 400);
      }

      const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = validation.data;
      
      if (mode !== 'subscribe') {
        console.error('❌ Invalid hub mode:', mode);
        return c.text('Invalid hub mode', 400);
      }

      // Verify token against stored webhook verify tokens
      const isValidToken = await this.verifyWebhookToken(token, 'instagram');
      
      if (!isValidToken) {
        console.error('❌ Invalid Instagram webhook verify token');
        return c.text('Invalid verify token', 403);
      }

      console.log('✅ Instagram webhook verification successful');
      return c.text(challenge);

    } catch (error) {
      console.error('❌ Instagram webhook verification failed:', error);
      return c.text('Verification failed', 500);
    }
  }

  /**
   * Handle Instagram webhook events (POST request)
   */
  private async handleInstagramWebhook(c: any) {
    try {
      console.log('📨 Instagram webhook event received');
      
      // Get raw buffer - CRITICAL: do this before any other body parsing
      const rawAB = await c.req.arrayBuffer();
      const rawBuf = Buffer.from(rawAB);
      
      // Get critical headers and config
      const sigHeader = c.req.header('x-hub-signature-256') ?? '';
      const appId = c.req.header('x-app-id') ?? '';
      const appSecret = (process.env.META_APP_SECRET || '').trim();
      const metaAppId = (process.env.META_APP_ID || '').trim();
      
      // Optional debug dump (only if DEBUG_DUMP=1)
      if (process.env.DEBUG_DUMP === '1') {
        const dump = `/var/tmp/ig_${Date.now()}.raw`;
        try {
          const fs = await import('fs');
          await fs.promises.writeFile(dump, rawBuf);
          console.log('Debug dump saved:', dump);
        } catch (writeError) {
          console.error('❌ Could not write debug file:', writeError);
        }
      }
      
      // Log critical headers (without sensitive data)
      console.log('X-App-Id:', appId, 'Sig256 length:', sigHeader.length, 'Body length:', rawBuf.length);
      
      // 1. Verify App ID matches
      if (!appId || appId !== metaAppId) {
        console.error('APP_ID_MISMATCH', { appId, expect: metaAppId });
        return c.text('App mismatch', 401);
      }
      
      // 2. Require proper signature header format
      if (!sigHeader || !sigHeader.startsWith('sha256=')) {
        console.error('❌ Bad signature header format');
        return c.text('Bad signature header', 401);
      }
      
      if (!appSecret) {
        console.error('❌ META_APP_SECRET not configured');
        return c.text('Server configuration error', 500);
      }
      
      // 3. Calculate HMAC-SHA256 and convert to lowercase
      const expected = crypto.createHmac('sha256', appSecret).update(rawBuf).digest('hex').toLowerCase();
      const received = sigHeader.slice(7).trim().toLowerCase();
      
      // 4. Timing-safe comparison
      let ok = false;
      if (received.length === expected.length) {
        try {
          ok = crypto.timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
        } catch {}
      }
      
      if (!ok) {
        // Safe logging - only show first 8 characters
        console.error('❌ Instagram webhook signature verification failed');
        console.error('Signature mismatch', {
          received8: received.slice(0, 8),
          expected8: expected.slice(0, 8)
        });
        return c.text('Invalid signature', 401);
      }
      
      console.log('✅ Instagram webhook signature verified successfully');
      
      // Parse JSON only after successful verification
      let event: InstagramWebhookEvent;
      try {
        event = JSON.parse(rawBuf.toString('utf8')) as InstagramWebhookEvent;
      } catch (parseError) {
        console.error('❌ Invalid Instagram webhook JSON:', parseError);
        return c.text('Invalid JSON payload', 400);
      }

      // Validate event structure
      const validation = WebhookEventSchema.safeParse(event);
      if (!validation.success) {
        console.error('❌ Invalid Instagram event structure:', validation.error);
        return c.text('Invalid event structure', 400);
      }

      if (event.object !== 'instagram') return c.text('Wrong object', 400);

      for (const entry of event.entry) {
        await this.processInstagramEntry(entry);
      }

      return c.text('EVENT_RECEIVED', 200);

    } catch (error) {
      console.error('❌ Instagram webhook processing failed:', error);
      return c.text('Webhook processing failed', 500);
    }
  }

  /**
   * Handle WhatsApp webhook verification (GET request)
   */
  private async handleWhatsAppVerification(c: any) {
    try {
      console.log('🔍 WhatsApp webhook verification request received');
      
      const query = c.req.query();
      const validation = WhatsAppWebhookVerificationSchema.safeParse(query);
      
      if (!validation.success) {
        console.error('❌ Invalid WhatsApp verification parameters:', validation.error);
        return c.text('Invalid verification parameters', 400);
      }

      const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = validation.data;
      
      if (mode !== 'subscribe') {
        console.error('❌ Invalid hub mode:', mode);
        return c.text('Invalid hub mode', 400);
      }

      // Verify token against stored webhook verify tokens
      const isValidToken = await this.verifyWebhookToken(token, 'whatsapp');
      
      if (!isValidToken) {
        console.error('❌ Invalid WhatsApp webhook verify token');
        return c.text('Invalid verify token', 403);
      }

      console.log('✅ WhatsApp webhook verification successful');
      return c.text(challenge);

    } catch (error) {
      console.error('❌ WhatsApp webhook verification failed:', error);
      return c.text('Verification failed', 500);
    }
  }

  /**
   * Handle WhatsApp webhook events (POST request)
   */
  private async handleWhatsAppWebhook(c: any) {
    try {
      console.log('📨 WhatsApp webhook event received');
      
      const rawBody = Buffer.from(await c.req.arrayBuffer()); // RAW
      const signature = (c.req.header('X-Hub-Signature-256') || c.req.header('X-Hub-Signature') || '').trim();
      if (!signature) {
        console.error('❌ Missing WhatsApp webhook signature');
        return c.text('Missing signature', 400);
      }
      // ✅ verify BEFORE parsing
      const ok = await this.verifyWhatsAppSignature(rawBody, signature);
      if (!ok) return c.text('Invalid signature', 401);

      // Parse after verification
      let event;
      try {
        event = JSON.parse(rawBody.toString('utf8'));
      } catch (parseError) {
        console.error('❌ Invalid WhatsApp webhook JSON:', parseError);
        return c.text('Invalid JSON payload', 400);
      }

      // Validate event structure
      const validation = WebhookEventSchema.safeParse(event);
      if (!validation.success) {
        console.error('❌ Invalid WhatsApp event structure:', validation.error);
        return c.text('Invalid event structure', 400);
      }

      if (event.object !== 'whatsapp_business_account') return c.text('Wrong object', 400);

      for (const entry of event.entry) {
        await this.processWhatsAppEntry(entry);
      }

      return c.text('EVENT_RECEIVED', 200);

    } catch (error) {
      console.error('❌ WhatsApp webhook processing failed:', error);
      return c.text('Webhook processing failed', 500);
    }
  }

  /**
   * Process Instagram webhook entry
   */
  private async processInstagramEntry(entry: any): Promise<void> {
    try {
      // Get merchant ID from entry ID (Page ID)
      const pageId = entry.id;
      const merchantId = await this.getMerchantIdFromPageId(pageId);
      
      if (!merchantId) {
    console.error(`❌ No merchant found for Instagram Page ID: ${String(pageId).replace(/[\r\n]/g, '')}`);
        return;
      }

      // Check if Instagram service is enabled
      const isInstagramEnabled = await this.serviceController.isServiceEnabled(merchantId, 'instagram');
      if (!isInstagramEnabled) {
        console.log(`🛑 Instagram service disabled for merchant: ${merchantId}`);
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

      console.log(`✅ Instagram webhook processed for merchant ${merchantId}:`, {
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
      console.error('❌ Failed to process Instagram entry:', error);
      await this.logWebhookEvent('instagram', 'unknown', 'ERROR', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Process WhatsApp webhook entry (placeholder implementation)
   */
  private async processWhatsAppEntry(entry: any): Promise<void> {
    try {
      // TODO: Implement WhatsApp webhook processing
      console.log('📱 WhatsApp webhook entry received (processing to be implemented):', entry.id ? String(entry.id).replace(/[\r\n]/g, '') : '');
      
      // For now, just log the event
      await this.logWebhookEvent('whatsapp', 'unknown', 'SUCCESS', {
        entryId: entry.id,
        note: 'WhatsApp processing placeholder'
      });

    } catch (error) {
      console.error('❌ Failed to process WhatsApp entry:', error);
      await this.logWebhookEvent('whatsapp', 'unknown', 'ERROR', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Verify webhook token against stored credentials
   */
  private async verifyWebhookToken(token: string, platform: 'instagram' | 'whatsapp'): Promise<boolean> {
    try {
      const sql = this.db.getSQL();
      
      const result = await sql`
        SELECT mc.webhook_verify_token
        FROM merchant_credentials mc
        JOIN merchants m ON mc.merchant_id = m.id
        WHERE mc.webhook_verify_token = ${token}
        AND m.subscription_status = 'ACTIVE'
        LIMIT 1
      `;

      return result.length > 0;

    } catch (error) {
      console.error('❌ Failed to verify webhook token:', error);
      return false;
    }
  }

  
  /**
   * Verify WhatsApp webhook signature using META_APP_SECRET (2025 Enhanced Security)
   * Implements timing-safe comparison and enforces SHA-256 only
   */
  private async verifyWhatsAppSignature(rawBody: Buffer, signature: string): Promise<boolean> {
    try {
      const metaAppSecret = this.config.instagram.metaAppSecret.trim();
      if (!metaAppSecret) { 
        console.error('❌ META_APP_SECRET not configured'); 
        return false; 
      }

      // 2025 Security: Enforce SHA-256 only (prevent downgrade attacks)
      if (!signature.startsWith('sha256=')) {
        console.error('❌ Invalid WhatsApp signature format - SHA-256 required (2025 security standard)');
        return false;
      }

      const provided = signature.replace('sha256=', '').toLowerCase();
      
      // Validate signature format (must be 64 hex characters for SHA-256)
      if (!/^[a-f0-9]{64}$/.test(provided)) {
        console.error('❌ Invalid WhatsApp signature format - must be 64 hex characters');
        return false;
      }

      const expected = crypto.createHmac('sha256', metaAppSecret).update(rawBody).digest('hex').toLowerCase();
      
      // 2025 Security: Use timing-safe comparison to prevent timing attacks
      const providedBuffer = Buffer.from(provided, 'hex');
      const expectedBuffer = Buffer.from(expected, 'hex');
      
      if (providedBuffer.length !== expectedBuffer.length) {
        console.error('❌ WhatsApp signature length mismatch');
        return false;
      }

      const isValid = crypto.timingSafeEqual(providedBuffer, expectedBuffer);
      
      if (isValid) {
        console.log('✅ WhatsApp webhook signature verified successfully (SHA-256)');
      } else {
        console.error('❌ WhatsApp webhook signature verification failed');
      }
      return isValid;
    } catch (error) {
      console.error('❌ Failed to verify WhatsApp signature:', error);
      return false;
    }
  }

  /**
   * Get merchant ID from Instagram Page ID
   */
  private async getMerchantIdFromPageId(pageId: string): Promise<string | null> {
    try {
      const sql = this.db.getSQL();
      
      const result = await sql`
        SELECT merchant_id
        FROM merchant_credentials
        WHERE instagram_business_account_id = ${pageId}
           OR instagram_page_id = ${pageId}
        LIMIT 1
      `;

      return result[0]?.merchant_id || null;

    } catch (error) {
      console.error('❌ Failed to get merchant ID from page ID:', error);
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
    details: any
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
      console.error('❌ Failed to log webhook event:', error);
    }
  }

  /**
   * Get webhook statistics
   */
  private async getWebhookStats(): Promise<any> {
    try {
      const sql = this.db.getSQL();
      
      const stats = await sql`
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

      const summary = await sql`
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

      return {
        summary: summary,
        hourlyStats: stats,
        lastUpdated: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ Failed to get webhook stats:', error);
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