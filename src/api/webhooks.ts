/**
 * ===============================================
 * Unified Webhook Router - STEP 2 Implementation
 * Handles webhooks from both WhatsApp and Instagram platforms
 * ===============================================
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { validator } from 'hono/validator';
import { InstagramWebhookHandler, type InstagramWebhookEvent } from '../services/instagram-webhook';
import { getInstagramCredentialsManager } from '../services/instagram-api';
import { getServiceController } from '../services/service-controller';
import { securityHeaders, rateLimiter } from '../middleware/security';
import { getDatabase } from '../database/connection';
import { getConfig } from '../config/environment';
import { z } from 'zod';
import crypto from 'crypto';

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
    
    // CORS for webhook endpoints
    this.app.use('/webhooks/*', cors({
      origin: ['https://graph.facebook.com', 'https://api.whatsapp.com'],
      allowHeaders: ['Content-Type', 'X-Hub-Signature-256', 'X-Hub-Signature'],
      methods: ['GET', 'POST']
    }));

    // Rate limiting per platform
    this.app.use('/webhooks/*', rateLimiter);
    
    // Logging
    this.app.use('*', logger());
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
      const isValidToken = await this.verifyWebhookToken(token, 'INSTAGRAM');
      
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
      
      // Get request body and headers (RAW BYTES)
      const body = await c.req.arrayBuffer();
      const rawBody = Buffer.from(body);
      let signature = c.req.header('X-Hub-Signature-256') || c.req.header('X-Hub-Signature') || '';
      signature = signature.trim().replace(/^"+|"+$/g, '');
      
      if (!signature) {
        console.error('❌ Missing Instagram webhook signature');
        return c.text('Missing signature', 400);
      }

      // Parse webhook payload
      let event: InstagramWebhookEvent;
      try {
        event = JSON.parse(rawBody.toString('utf8')) as InstagramWebhookEvent;
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

      // Process each entry in the webhook
      for (const entry of event.entry) {
        await this.processInstagramEntry(entry, rawBody.toString('utf8'), signature);
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
      const isValidToken = await this.verifyWebhookToken(token, 'WHATSAPP');
      
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
      
      // Get request body and headers
      const body = await c.req.text();
      const signature = c.req.header('X-Hub-Signature-256');
      
      if (!signature) {
        console.error('❌ Missing WhatsApp webhook signature');
        return c.text('Missing signature', 400);
      }

      // Parse webhook payload
      let event;
      try {
        event = JSON.parse(body);
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

      // Verify webhook signature first
      const isValidSignature = await this.verifyWhatsAppSignature(body, signature);
      if (!isValidSignature) {
        console.error('❌ Invalid WhatsApp webhook signature');
        return c.text('Invalid signature', 401);
      }

      // Process WhatsApp webhook (to be implemented)
      for (const entry of event.entry) {
        await this.processWhatsAppEntry(entry, body, signature);
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
  private async processInstagramEntry(entry: any, body: string, signature: string): Promise<void> {
    try {
      // Get merchant ID from entry ID (Page ID)
      const pageId = entry.id;
      const merchantId = await this.getMerchantIdFromPageId(pageId);
      
      if (!merchantId) {
        console.error(`❌ No merchant found for Instagram Page ID: ${pageId}`);
        return;
      }

      // Check if Instagram service is enabled
      const isInstagramEnabled = await this.serviceController.isServiceEnabled(merchantId, 'instagram');
      if (!isInstagramEnabled) {
        console.log(`🛑 Instagram service disabled for merchant: ${merchantId}`);
        await this.logWebhookEvent('INSTAGRAM', merchantId, 'ERROR', {
          pageId,
          reason: 'Service disabled'
        });
        return;
      }

      // Verify webhook signature
      const isValidSignature = await this.verifyInstagramSignature(body, signature, merchantId);
      if (!isValidSignature) {
        console.error(`❌ Invalid Instagram webhook signature for merchant: ${merchantId}`);
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
        errors: result.errors.length
      });

      // Log successful processing
      await this.logWebhookEvent('INSTAGRAM', merchantId, 'SUCCESS', {
        pageId,
        messagesProcessed: result.messagesProcessed,
        conversationsCreated: result.conversationsCreated
      });

    } catch (error) {
      console.error('❌ Failed to process Instagram entry:', error);
      await this.logWebhookEvent('INSTAGRAM', 'unknown', 'ERROR', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Process WhatsApp webhook entry (placeholder implementation)
   */
  private async processWhatsAppEntry(entry: any, body: string, signature: string): Promise<void> {
    try {
      // TODO: Implement WhatsApp webhook processing
      console.log('📱 WhatsApp webhook entry received (processing to be implemented):', entry.id);
      
      // For now, just log the event
      await this.logWebhookEvent('WHATSAPP', 'unknown', 'SUCCESS', {
        entryId: entry.id,
        note: 'WhatsApp processing placeholder'
      });

    } catch (error) {
      console.error('❌ Failed to process WhatsApp entry:', error);
      await this.logWebhookEvent('WHATSAPP', 'unknown', 'ERROR', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Verify webhook token against stored credentials
   */
  private async verifyWebhookToken(token: string, platform: 'INSTAGRAM' | 'WHATSAPP'): Promise<boolean> {
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
   * Verify Instagram webhook signature using META_APP_SECRET
   */
  private async verifyInstagramSignature(body: string, signature: string, merchantId: string): Promise<boolean> {
    try {
      // Get META_APP_SECRET from configuration (NOT webhook verify token)
      const metaAppSecret = this.config.instagram.metaAppSecret;
      
      if (!metaAppSecret) {
        console.error('❌ META_APP_SECRET not configured');
        return false;
      }

      // Generate expected signature using META_APP_SECRET (RAW BYTES)
      const expected = 'sha256=' + crypto
        .createHmac('sha256', metaAppSecret)
        .update(body, 'utf8')
        .digest('hex');

      // Compare signatures using timing-safe comparison
      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
      );

      if (isValid) {
        console.log('✅ Instagram webhook signature verified successfully');
      } else {
        console.error('❌ Instagram webhook signature verification failed');
      }

      return isValid;

    } catch (error) {
      console.error('❌ Failed to verify Instagram signature:', error);
      return false;
    }
  }

  /**
   * Verify WhatsApp webhook signature using META_APP_SECRET
   */
  private async verifyWhatsAppSignature(body: string, signature: string): Promise<boolean> {
    try {
      // Get META_APP_SECRET from configuration
      const metaAppSecret = this.config.instagram.metaAppSecret;
      
      if (!metaAppSecret) {
        console.error('❌ META_APP_SECRET not configured');
        return false;
      }

      // Generate expected signature using META_APP_SECRET (RAW BYTES)
      const expected = 'sha256=' + crypto
        .createHmac('sha256', metaAppSecret)
        .update(body, 'utf8')
        .digest('hex');

      // Compare signatures using timing-safe comparison
      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
      );

      if (isValid) {
        console.log('✅ WhatsApp webhook signature verified successfully');
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
        WHERE instagram_page_id = ${pageId}
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
    platform: 'INSTAGRAM' | 'WHATSAPP',
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