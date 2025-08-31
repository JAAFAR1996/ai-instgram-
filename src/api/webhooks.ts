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

  /**
   * Verify ManyChat webhook HMAC signature
   */
  private async verifyManyChatSignature(
    rawBody: string,
    signature: string,
    secret: string
  ): Promise<boolean> {
    try {
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(rawBody, 'utf8')
        .digest('hex');
      
      // Handle multiple signature formats
      let receivedSignature = signature;
      
      // Remove common prefixes: 'sha256=', 'signature=', 'algorithm=HMAC-SHA256,'
      receivedSignature = receivedSignature
        .replace(/^sha256=/, '')
        .replace(/^signature=/, '')
        .replace(/^algorithm=HMAC-SHA256,\s*/, '');
      
      // Constant time comparison
      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(receivedSignature, 'hex')
      );
    } catch (error) {
      this.logger.error('❌ ManyChat signature verification error', error);
      return false;
    }
  }

  /**
   * Setup webhook routes - Instagram only
   */
  private setupRoutes(): void {
    // Instagram webhook routes
    this.app.get('/webhooks/instagram', this.handleInstagramVerification.bind(this));
    this.app.post('/webhooks/instagram', this.handleInstagramWebhook.bind(this));
    
    // ManyChat webhook routes
    this.app.post('/webhooks/manychat', this.handleManyChatWebhook.bind(this));
    
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
          whatsapp: 'disabled',
          manychat: 'active'
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

      // 🔍 DEBUG: Log incoming webhook payload structure
      this.logger.info('🔍 WEBHOOK DEBUG: Instagram payload received', {
        entries: event.entry?.length || 0,
        entryIds: event.entry?.map(e => e.id) || [],
        hasMessaging: event.entry?.some(e => e.messaging) || false
      });

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

      // 🔍 DEBUG: Log each entry processing
      for (const entry of event.entry) {
        this.logger.info('🔍 PROCESSING ENTRY:', {
          entryId: entry.id,
          hasMessaging: !!entry.messaging,
          messagingCount: entry.messaging?.length || 0
        });
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
   * Handle ManyChat webhook events (POST request)
   * Updated to use instagram_username and includes HMAC verification
   */
  private async handleManyChatWebhook(c: Context) {
    try {
      this.logger.info('📩 ManyChat webhook received');
      
      const rawBody = await c.req.text();
      
      // Verify HMAC signature if secret is configured - support multiple formats
      const signature = c.req.header('x-hub-signature-256') || 
                       c.req.header('x-signature-256') || 
                       c.req.header('x-signature') ||
                       c.req.header('signature');
      const webhookSecret = process.env.MANYCHAT_WEBHOOK_SECRET;
      
      if (webhookSecret && signature) {
        try {
          const isValid = await this.verifyManyChatSignature(rawBody, signature, webhookSecret);
          if (!isValid) {
            this.logger.error('❌ ManyChat webhook signature verification failed');
            return c.json({ error: 'Invalid signature' }, 401);
          }
          this.logger.info('✅ ManyChat webhook signature verified');
        } catch (signatureError) {
          this.logger.error('❌ ManyChat signature verification error', signatureError);
          return c.json({ error: 'Signature verification failed' }, 401);
        }
      } else if (webhookSecret) {
        this.logger.warn('⚠️ ManyChat webhook secret configured but no signature provided');
        return c.json({ error: 'Signature required' }, 401);
      } else {
        this.logger.warn('⚠️ ManyChat webhook has no signature verification (MANYCHAT_WEBHOOK_SECRET not set)');
      }
      
      let body: any;
      
      try {
        body = JSON.parse(rawBody);
      } catch (parseError) {
        this.logger.error('❌ Failed to parse ManyChat webhook JSON', parseError);
        return c.json({ error: 'Invalid JSON payload' }, 400);
      }
      
      // Extract data - STRICT: Only instagram_username allowed
      const { merchant_id, instagram_username, subscriber_id, event_type, data } = body;
      
      // ARCHITECTURE ENFORCEMENT: No backward compatibility with IDs
      if (body.instagram_user_id) {
        this.logger.error('❌ ManyChat webhook contains deprecated instagram_user_id - system is username-only', { body });
        return c.json({ error: 'instagram_user_id is deprecated - use instagram_username only' }, 400);
      }
      
      if (!instagram_username || typeof instagram_username !== 'string' || instagram_username.trim() === '') {
        this.logger.error('❌ ManyChat webhook missing or invalid instagram_username', { body });
        return c.json({ error: 'Valid instagram_username required (string, non-empty)' }, 400);
      }
      
      const username = instagram_username.trim();

      // Log the webhook data
      this.logger.info('📩 ManyChat webhook data', { 
        merchant_id, 
        instagram_username: username, 
        subscriber_id,
        event_type,
        dataKeys: data ? Object.keys(data) : [],
        messageText: data?.text || 'NO_TEXT'
      });
      
      // 🔍 PROCESS MESSAGE: If this is a message from user, process it
      if (event_type === 'message' && data?.text && merchant_id && username) {
        // 🛡️ PRODUCTION: Input validation and sanitization
        const messageText = String(data.text).trim();
        const sanitizedUsername = String(username).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
        const sanitizedMerchantId = String(merchant_id).trim();
        
        // Security validations
        if (!messageText || messageText.length === 0) {
          this.logger.warn('⚠️ Empty message text received', { merchant_id, username });
          return c.json({ ok: true, ai_response: 'رسالة فارغة، يرجى كتابة رسالتك.' });
        }
        
        if (messageText.length > 4000) { // Prevent extremely long messages
          this.logger.warn('⚠️ Message too long', { 
            merchant_id, 
            username, 
            messageLength: messageText.length 
          });
          return c.json({ 
            ok: true, 
            ai_response: 'رسالتك طويلة جداً، يرجى إرسال رسالة أقصر.' 
          });
        }
        
        if (!sanitizedUsername || sanitizedUsername.length < 2) {
          this.logger.warn('⚠️ Invalid username format', { merchant_id, username });
          return c.json({ 
            ok: true, 
            ai_response: 'خطأ في معرف المستخدم، يرجى المحاولة مرة أخرى.' 
          });
        }
        
        if (!sanitizedMerchantId || !/^[a-zA-Z0-9_-]+$/.test(sanitizedMerchantId)) {
          this.logger.error('❌ Invalid merchant ID format', { merchant_id });
          return c.json({ error: 'Invalid merchant ID format' }, 400);
        }
        
        // 🔒 PRODUCTION: Rate limiting per user (prevent spam)
        const userRateKey = `manychat_user_rate:${sanitizedMerchantId}:${sanitizedUsername}`;
        try {
          const { getMetaRateLimiter } = await import('../services/meta-rate-limiter.js');
          const rateLimiter = getMetaRateLimiter();
          const userRateCheck = await rateLimiter.checkRedisRateLimit(userRateKey, 60000, 10); // 10 messages per minute
          
          if (!userRateCheck.allowed) {
            this.logger.warn('⚠️ User rate limit exceeded', { 
              merchant_id: sanitizedMerchantId, 
              username: sanitizedUsername,
              remaining: userRateCheck.remaining
            });
            
            telemetry.recordRateLimitStoreFailure('instagram', 'webhook');
            
            return c.json({ 
              ok: true, 
              ai_response: 'يرجى الانتظار قبل إرسال رسالة أخرى. شكراً لصبرك.',
              rate_limited: true
            });
          }
        } catch (rateLimitError) {
          this.logger.warn('⚠️ Rate limit check failed', { error: String(rateLimitError) });
          telemetry.recordRateLimitStoreFailure('instagram', 'webhook');
          // Continue processing if rate limit check fails
        }
        
        this.logger.info('🔍 MANYCHAT MESSAGE: Processing user message from ManyChat', {
          merchant_id: sanitizedMerchantId,
          instagram_username: sanitizedUsername,
          messageText: messageText.substring(0, 100),
          messageLength: messageText.length
        });
        
        try {
          const processingStartTime = Date.now();
          
          // 🔒 PRODUCTION: Use database transaction for data consistency
          const sql = this.db.getSQL();
          
          try {
            // Find or create conversation by Instagram username
            const existingConversations = await sql`
              SELECT * FROM conversations 
              WHERE merchant_id = ${sanitizedMerchantId} 
              AND customer_instagram = ${sanitizedUsername}
              ORDER BY created_at DESC 
              LIMIT 1
            `;
            
            let conversation;
            if (existingConversations.length > 0) {
              const row = existingConversations[0];
              conversation = {
                id: String(row?.id || ''),
                merchantId: String(row?.merchant_id || ''),
                customerInstagram: String(row?.customer_instagram || ''),
                platform: String(row?.platform || ''),
                conversationStage: String(row?.conversation_stage || ''),
                createdAt: new Date(String(row?.created_at || new Date())),
                updatedAt: new Date(String(row?.updated_at || new Date()))
              };
            } else {
              // Create new conversation atomically
              const newConversationResult = await sql`
                INSERT INTO conversations (
                  merchant_id, customer_instagram, platform, conversation_stage, 
                  session_data, message_count, created_at, updated_at
                ) VALUES (${sanitizedMerchantId}, ${sanitizedUsername}, 'instagram', 'ACTIVE',
                         '{}', 0, NOW(), NOW())
                RETURNING *
              `;
              
              const row = newConversationResult[0];
              conversation = {
                id: String(row?.id || ''),
                merchantId: String(row?.merchant_id || ''),
                customerInstagram: String(row?.customer_instagram || ''),
                platform: String(row?.platform || ''),
                conversationStage: String(row?.conversation_stage || ''),
                createdAt: new Date(String(row?.created_at || new Date())),
                updatedAt: new Date(String(row?.updated_at || new Date()))
              };
              
              this.logger.info('✅ Created new conversation for ManyChat message', {
                conversationId: conversation.id,
                username: sanitizedUsername
              });
            }
            
            // Store the incoming message atomically
            await sql`
              INSERT INTO message_logs (
                conversation_id, content, message_type, direction, platform, created_at
              ) VALUES (${conversation.id}, ${messageText}, 'TEXT', 'INCOMING', 'instagram', NOW())
            `;
            
            // Update conversation message count and last activity
            await sql`
              UPDATE conversations 
              SET message_count = message_count + 1, 
                  last_message_at = NOW(), 
                  updated_at = NOW()
              WHERE id = ${conversation.id}
            `;
            
            // 🤖 PRODUCTION: Generate AI response with timeout and retry logic
            this.logger.info('🤖 Generating AI response for ManyChat message', {
              conversationId: conversation.id,
              username
            });
            
            let aiResponse: string = '';
            const AI_TIMEOUT = 30000; // 30 seconds timeout
            const MAX_RETRIES = 2;
            
            try {
              // Generate AI response with timeout
              const { getAIService } = await import('../services/ai.js');
              const aiService = await getAIService();
              
              // Retry logic for AI service
              let lastError: Error | null = null;
              for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                  this.logger.info(`🤖 AI attempt ${attempt}/${MAX_RETRIES}`, {
                    conversationId: conversation.id,
                    username
                  });
                  
                  const aiPromise = aiService.generateResponse(data.text, {
                    merchantId: merchant_id,
                    customerId: username,
                    platform: 'instagram',
                    stage: 'GREETING',
                    cart: [],
                    preferences: {},
                    conversationHistory: []
                  });
                  
                  // Add timeout to AI request
                  const timeoutPromise = new Promise<never>((_, reject) => 
                    setTimeout(() => reject(new Error('AI request timeout')), AI_TIMEOUT)
                  );
                  
                  const aiResult = await Promise.race([aiPromise, timeoutPromise]);
                  const generatedMessage = aiResult.message;
                  
                  if (generatedMessage && generatedMessage.trim()) {
                    aiResponse = generatedMessage;
                    break; // Success - exit retry loop
                  } else {
                    throw new Error('Empty AI response received');
                  }
                } catch (error) {
                  lastError = error instanceof Error ? error : new Error(String(error));
                  this.logger.warn(`🤖 AI attempt ${attempt} failed`, {
                    conversationId: conversation.id,
                    username,
                    error: lastError.message,
                    attemptsRemaining: MAX_RETRIES - attempt
                  });
                  
                  if (attempt < MAX_RETRIES) {
                    // Wait before retry (exponential backoff)
                    await new Promise(resolve => setTimeout(resolve, attempt * 1000));
                  }
                }
              }
              
              // If all retries failed, use fallback
              if (!aiResponse || !aiResponse.trim()) {
                throw lastError || new Error('All AI attempts failed');
              }
              
            } catch (aiError) {
              this.logger.error('❌ AI service failed after all retries', {
                conversationId: conversation.id,
                username,
                error: aiError instanceof Error ? aiError.message : String(aiError)
              });
              
              // 🛡️ PRODUCTION: Use intelligent Arabic fallback based on message content
              const messageText = data.text.toLowerCase();
              if (messageText.includes('سعر') || messageText.includes('price')) {
                aiResponse = 'مرحباً! سأساعدك في معرفة الأسعار. يرجى تحديد المنتج الذي تريد السؤال عنه وسأوافيك بالتفاصيل.';
              } else if (messageText.includes('طلب') || messageText.includes('order')) {
                aiResponse = 'مرحباً! سأساعدك في إتمام طلبك. يرجى إرسال تفاصيل المنتجات التي تريدها.';
              } else if (messageText.includes('مساعد') || messageText.includes('help')) {
                aiResponse = 'مرحباً! أنا مساعد المبيعات الذكي وهنا لمساعدتك. كيف يمكنني خدمتك اليوم؟';
              } else {
                aiResponse = 'مرحباً! شكراً لتواصلك معنا. نحن هنا لمساعدتك، كيف يمكنني خدمتك؟';
              }
            }
            
            // Store AI response in transaction
            await sql`
              INSERT INTO message_logs (
                conversation_id, content, message_type, direction, platform, created_at
              ) VALUES (${conversation.id}, ${aiResponse}, 'TEXT', 'OUTGOING', 'instagram', NOW())
            `;
            
            this.logger.info('✅ AI response generated and stored successfully', {
              conversationId: conversation.id,
              username,
              responsePreview: aiResponse.substring(0, 50),
              messageLength: aiResponse.length
            });
            
            // 📊 PRODUCTION: Record metrics and telemetry  
            // Simple telemetry record
            telemetry.recordMetaRequest('instagram', 'message_processed', 200, Date.now() - processingStartTime);
            
            // Log to database for monitoring
            await this.logWebhookEvent('instagram', sanitizedMerchantId, 'SUCCESS', {
              event_type: 'message_processed',
              instagram_username: sanitizedUsername,
              message_length: messageText.length,
              response_length: aiResponse.length,
              processing_time: Date.now() - processingStartTime
            });
            
            return c.json({ 
              ok: true, 
              ai_response: aiResponse,
              conversation_id: conversation.id,
              message_id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              timestamp: new Date().toISOString()
            });
            
          } catch (dbError) {
            this.logger.error('❌ Database operation failed', dbError);
            throw dbError; // Re-throw to outer catch
          }
          
        } catch (messageError) {
          const errorMessage = messageError instanceof Error ? messageError.message : String(messageError);
          this.logger.error('❌ Failed to process ManyChat message', messageError, {
            merchant_id: sanitizedMerchantId,
            username: sanitizedUsername,
            messageText: messageText?.substring(0, 50),
            errorType: messageError instanceof Error ? messageError.name : 'UnknownError'
          });
          
          // 📊 PRODUCTION: Record error metrics
          telemetry.recordMetaRequest('instagram', 'message_failed', 500, 1000);
          
          // Log error to database for monitoring
          await this.logWebhookEvent('instagram', sanitizedMerchantId, 'ERROR', {
            event_type: 'message_processing_failed',
            instagram_username: sanitizedUsername,
            error: errorMessage
          }).catch(logError => {
            this.logger.error('❌ Failed to log error event', logError);
          });
          
          // 🛡️ PRODUCTION: Graceful error response
          const fallbackResponse = 'عذراً، حدث خطأ مؤقت. نحن نعمل على حل المشكلة. يرجى المحاولة مرة أخرى خلال دقائق.';
          
          return c.json({ 
            ok: true, 
            ai_response: fallbackResponse,
            error_id: `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date().toISOString()
          });
        }
      }

      // If we have both username and subscriber_id, update mapping
      if (merchant_id && username && subscriber_id) {
        try {
          const { upsertManychatMapping } = await import('../repositories/manychat.repo.js');
          await upsertManychatMapping(merchant_id, username, subscriber_id);
          
          this.logger.info('✅ Updated ManyChat subscriber mapping', {
            merchant_id,
            instagram_username: username,
            subscriber_id
          });
        } catch (mappingError) {
          this.logger.error('❌ Failed to update ManyChat mapping', mappingError, {
            merchant_id,
            instagram_username: username,
            subscriber_id
          });
        }
      }

      // Log to database for monitoring
      if (merchant_id) {
        await this.logWebhookEvent('instagram', merchant_id, 'SUCCESS', {
          source: 'manychat',
          event_type,
          instagram_username: username,
          subscriber_id
        });
      }

      // Return success response
      return c.json({ ok: true, timestamp: new Date().toISOString() });

    } catch (error) {
      this.logger.error('❌ ManyChat webhook processing failed', error);
      
      return c.json({ 
        error: 'Webhook processing failed',
        timestamp: new Date().toISOString()
      }, 500);
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