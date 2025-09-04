/**
 * ===============================================
 * Webhooks Routes Module
 * Handles Instagram webhook endpoints with security
 * ===============================================
 */

import { Hono } from 'hono';
import type { Pool } from 'pg';
import { getLogger } from '../services/logger.js';
import { telemetry } from '../services/telemetry.js';
import { z } from 'zod';
import { createHmac } from 'node:crypto';
import { getPool } from '../db/index.js';
import { getEnv } from '../config/env.js';
import type { ImageData } from '../services/ai.js';

type ManyChatWebhookBody = {
  merchant_id?: string;
  instagram_username?: string;
  merchant_username?: string;
  subscriber_id?: string;
  event_type?: string;
  data?: { text?: string };
};

const log = getLogger({ component: 'webhooks-routes' });

// Webhook validation schemas
const InstagramWebhookVerificationSchema = z.object({
  'hub.mode': z.string(),
  'hub.verify_token': z.string(),
  'hub.challenge': z.string()
});

export interface WebhookDependencies {
  pool: Pool;
}

/**
 * Register webhook routes on the app
 */
export function registerWebhookRoutes(app: Hono, _deps: WebhookDependencies): void {

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
        try { (await import('../services/compliance.js')).getComplianceService().logEvent(null, 'WEBHOOK_VERIFY', 'FAILURE', { reason: 'invalid_mode', mode }); } catch {}
        return c.text('Bad Request', 400);
      }

      const expectedToken = (getEnv('IG_VERIFY_TOKEN') || '').trim();
      if (!expectedToken || token !== expectedToken) {
        log.warn('Instagram webhook verification failed - invalid token', { 
          providedToken: token,
          expectedExists: !!expectedToken
        });
        try { (await import('../services/compliance.js')).getComplianceService().logEvent(null, 'WEBHOOK_VERIFY', 'FAILURE', { reason: 'invalid_token' }); } catch {}
        return c.text('Forbidden', 403);
      }

      log.info('Instagram webhook verification successful', { challenge });
      try { (await import('../services/compliance.js')).getComplianceService().logEvent(null, 'WEBHOOK_VERIFY', 'SUCCESS', { endpoint: 'instagram', challenge }); } catch {}
      return c.text(challenge);
    } catch (error: unknown) {
      log.error('Instagram webhook verification error:', error instanceof Error ? { message: error.message } : { error });
      try { (await import('../services/compliance.js')).getComplianceService().logEvent(null, 'WEBHOOK_VERIFY', 'FAILURE', { error: String(error) }); } catch {}
      return c.text('Internal Server Error', 500);
    }
  });

  // Instagram direct webhook - DISABLED (using ManyChat flow only)
  app.post('/webhooks/instagram', async (c) => {
    return c.text('Use ManyChat flow: Instagram → ManyChat → Server → AI → Server → ManyChat → Instagram', 410);
  });

  // ManyChat webhook route - PRODUCTION with AI integration
  app.post('/webhooks/manychat', async (c) => {
    try {
      // 🔒 PRODUCTION: Bearer token authentication
      const authHeader = c.req.header('authorization');
      const expectedBearer = (getEnv('MANYCHAT_BEARER') || '').trim();
      if (!expectedBearer) {
        log.error('❌ MANYCHAT_BEARER not configured');
        return c.json({ error: 'auth_not_configured' }, 401);
      }
      if (!authHeader?.startsWith(`Bearer ${expectedBearer}`)) {
        log.warn('❌ ManyChat webhook unauthorized', { hasAuth: !!authHeader });
        return c.json({ error: 'unauthorized' }, 401);
      }
      
      log.info('📩 ManyChat webhook received');
      const processingStartTime = Date.now();
      
      const rawBody = await c.req.text();
      // HMAC verification when secret provided
      const signature = c.req.header('x-hub-signature-256') || c.req.header('x-signature-256') || c.req.header('x-signature') || c.req.header('signature');
      const webhookSecret = (getEnv('MANYCHAT_WEBHOOK_SECRET') || '').trim();
      if (webhookSecret) {
        if (!signature) {
          log.warn('ManyChat webhook: signature missing while secret configured');
          try { (await import('../services/compliance.js')).getComplianceService().logSecurity(null, 'WEBHOOK_SIGNATURE', 'FAILURE', { endpoint: 'manychat', reason: 'missing_signature' }); } catch {}
          return c.json({ error: 'signature_required' }, 401);
        }
        try {
          const expected = createHmac('sha256', webhookSecret).update(rawBody, 'utf8').digest('hex');
          const provided = signature.replace(/^sha256=/, '').trim();
          if (expected !== provided) {
            log.warn('ManyChat webhook: signature mismatch');
            try { (await import('../services/compliance.js')).getComplianceService().logSecurity(null, 'WEBHOOK_SIGNATURE', 'FAILURE', { endpoint: 'manychat', reason: 'mismatch' }); } catch {}
            return c.json({ error: 'invalid_signature' }, 401);
          }
          try { (await import('../services/compliance.js')).getComplianceService().logSecurity(null, 'WEBHOOK_SIGNATURE', 'SUCCESS', { endpoint: 'manychat' }); } catch {}
        } catch (sigErr) {
          log.error('ManyChat webhook: signature verification error', sigErr as Error);
          try { (await import('../services/compliance.js')).getComplianceService().logSecurity(null, 'WEBHOOK_SIGNATURE', 'FAILURE', { endpoint: 'manychat', error: String(sigErr) }); } catch {}
          return c.json({ error: 'signature_error' }, 401);
        }
      }
      const body: ManyChatWebhookBody = rawBody ? JSON.parse(rawBody) : {};
      const { merchant_id, instagram_username, merchant_username, subscriber_id, event_type, data } = body;

      // 🛡️ PRODUCTION: Input validation and sanitization - use fallback for merchant_id
      const finalMerchantId = (merchant_id || '').trim();
      
      const incomingUsername = (merchant_username ?? instagram_username) as string | undefined;
      const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!incomingUsername || !finalMerchantId) {
        return c.json({ 
          ok: false, 
          error: 'username (merchant_username/instagram_username) required and merchant_id missing' 
        }, 400);
      }

      const sanitizedUsername = String(incomingUsername).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
      const sanitizedMerchantId = String(finalMerchantId).trim();
      if (!UUID_REGEX.test(sanitizedMerchantId)) {
        return c.json({ ok: false, error: 'context_error' }, 503);
      }
      
      if (!sanitizedUsername || sanitizedUsername.length < 2) {
        return c.json({ 
          ok: false, 
          error: 'invalid username format' 
        }, 400);
      }

      log.info('📩 ManyChat data', { 
        merchant_id: sanitizedMerchantId,
        instagram_username: sanitizedUsername,
        subscriber_id,
        event_type,
        hasMessage: !!data?.text
      });

      // 🔍 PROCESS MESSAGE: If this is a message from user, process with AI
      // Set RLS merchant context for this request
      try {
        const { getDatabase } = await import('../db/adapter.js');
        const db = getDatabase();
        const sql = db.getSQL();
        await sql`SELECT set_config('app.current_merchant_id', ${sanitizedMerchantId}::text, true)`;
      } catch (ctxErr) {
        log.error('Failed to set merchant context', ctxErr as Error);
        try { (await import('../services/compliance.js')).getComplianceService().logSecurity(sanitizedMerchantId, 'RLS_CONTEXT', 'FAILURE', { error: String(ctxErr) }); } catch {}
        return c.json({ ok: false, error: 'context_error' }, 503);
      }

      // Normalize attachments (images)
      const attachments = Array.isArray((data as any)?.attachments) ? (data as any).attachments : [];
      const imageData: ImageData[] = attachments
        .map((a: any) => a?.url || a?.payload?.url || a?.image_url || a?.src || null)
        .filter((u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
        .map((url: string): ImageData => ({ url }));
      const hasImages = imageData.length > 0;

      if (event_type === 'message' && (data?.text || hasImages)) {
        const messageText = String(data?.text || '').trim();
        
        if (messageText.length > 4000) {
          return c.json({
            version: "v2",
            messages: [{ type: "text", text: "رسالتك طويلة جداً، يرجى إرسال رسالة أقصر." }],
            set_attributes: { ai_reply: "message_too_long" }
          });
        }

        // 🚀 QUEUE PROCESSING: All AI processing moved to queue workers
        let queueManager: ProductionQueueManager | null = null;

        try {
          // ⚡ LIGHTWEIGHT: Only essential database operations in webhook
          const pool = getPool();
          
          // Find or create conversation
          let conversationId: string;
          let sessionData: any = {};
          try {
            const existingConversations = await pool.query(`
              SELECT id, message_count, session_data FROM conversations 
              WHERE merchant_id = $1 AND customer_instagram = $2
              ORDER BY created_at DESC LIMIT 1
            `, [sanitizedMerchantId, sanitizedUsername]);
            
            if (existingConversations.rows.length > 0) {
              conversationId = existingConversations.rows[0].id;
              // messageCount intentionally unused for orchestrator path
              try {
                sessionData = existingConversations.rows[0].session_data || {};
                if (typeof sessionData === 'string') sessionData = JSON.parse(sessionData);
              } catch {}
              // Merge with cached customer context (for faster recall)
              try {
                const { SmartCache } = await import('../services/smart-cache.js');
                const sc = new SmartCache();
                const cachedCtx = await sc.getCustomerContext(sanitizedMerchantId, sanitizedUsername);
                if (cachedCtx && typeof cachedCtx === 'object') {
                  sessionData = { ...cachedCtx, ...sessionData };
                }
              } catch {}
            } else {
              const newConversation = await pool.query(`
                INSERT INTO conversations (
                  merchant_id, customer_instagram, platform, source_channel,
                  conversation_stage, session_data, message_count, created_at, updated_at
                ) VALUES ($1, $2, 'instagram', 'manychat', 'GREETING', '{}', 0, NOW(), NOW())
                RETURNING id
              `, [sanitizedMerchantId, sanitizedUsername]);
              
              conversationId = newConversation.rows[0].id;
              sessionData = {};
              log.info('✅ Created conversation for ManyChat', { conversationId, username: sanitizedUsername });
            }
          } catch (dbError) {
            log.error('❌ Database operation failed', { error: String(dbError) });
            return c.json({
              version: "v2", 
              messages: [{ type: "text", text: "عذراً، حدث خطأ في النظام. يرجى المحاولة مرة أخرى." }],
              set_attributes: { ai_reply: "database_error" }
            });
          }

          // Load recent messages as conversation history (oldest -> newest)
          let historyIds: string[] = [];
          let preSessionPatch: Record<string, unknown> | undefined;
          try {
            const historyResult = await pool.query(
              `SELECT id, content, direction, created_at
               FROM message_logs
               WHERE conversation_id = $1
               ORDER BY created_at DESC
               LIMIT 20`,
              [conversationId]
            );
            historyIds = historyResult.rows.map((r: { id: string }) => r.id);
            // Optimize long history into a short summary for sessionData (kept small for tokens)
            try {
              const msgs = historyResult.rows
                .map((r: any) => ({
                  role: r.direction === 'INCOMING' ? 'user' : 'assistant',
                  content: String(r.content || ''),
                  timestamp: r.created_at
                }))
                .reverse(); // oldest -> newest
              const { ConversationManager } = await import('../services/conversation-manager.js');
              const cm = new ConversationManager();
              const opt = await cm.optimizeHistory(sanitizedMerchantId, sanitizedUsername, msgs as any, 6);
              if (opt.sessionPatch && Object.keys(opt.sessionPatch).length) {
                preSessionPatch = opt.sessionPatch;
                sessionData = { ...(opt.sessionPatch || {}), ...(sessionData || {}) };
              }
            } catch {}
          } catch (histErr) {
            log.warn('Failed to load conversation history, proceeding without it', { error: String(histErr) });
          }

          // Store incoming message
          // Store incoming message and get id
          let incomingMessageId: string | null = null;
          try {
            const ins = await pool.query(
              `INSERT INTO message_logs (conversation_id, content, message_type, direction, platform, source_channel, created_at)
               VALUES ($1, $2, $3, 'INCOMING', 'instagram', 'manychat', NOW()) RETURNING id`,
              [conversationId, messageText || (hasImages ? 'IMAGE_MESSAGE' : ''), hasImages ? 'IMAGE' : 'TEXT']
            );
            incomingMessageId = ins.rows?.[0]?.id || null;
          } catch (insErr) {
            log.warn('Failed to insert incoming message with RETURNING id; retrying plain insert', { error: String(insErr) });
            await pool.query(
              `INSERT INTO message_logs (conversation_id, content, message_type, direction, platform, source_channel, created_at)
               VALUES ($1, $2, 'TEXT', 'INCOMING', 'instagram', 'manychat', NOW())`,
              [conversationId, messageText || (hasImages ? 'IMAGE_MESSAGE' : '')]
            );
          }

          // ⚡ SKIP image metadata in webhook - moved to queue processing

          // 🚀 QUEUE PROCESSING: All AI processing moved to queue workers
          try {
            // Initialize queue manager for this request
            queueManager = new ProductionQueueManager(
              log,
              RedisEnvironment.PRODUCTION,
              pool,
              'ai-sales-production'
            );
            
            const initResult = await queueManager.initialize();
            if (!initResult.success) {
              throw new Error(`Queue initialization failed: ${initResult.error}`);
            }

            // Generate unique event ID for this processing
            const eventId = `manychat_${Date.now()}_${sanitizedMerchantId.slice(-8)}_${Math.random().toString(36).slice(2, 8)}`;

            // Enqueue all heavy processing
            const queueResult = await queueManager.addManyChatJob(
              eventId,
              sanitizedMerchantId,
              sanitizedUsername,
              conversationId,
              incomingMessageId,
              messageText,
              imageData,
              sessionData,
              'high' // priority based on real-time user interaction
            );

            if (!queueResult.success) {
              throw new Error(`Failed to enqueue ManyChat job: ${queueResult.error}`);
            }

            const webhookDuration = Date.now() - processingStartTime;
            log.info('⚡ [WEBHOOK-FAST] Enqueued ManyChat processing successfully', {
              eventId,
              jobId: queueResult.jobId,
              queuePosition: queueResult.queuePosition,
              webhookDuration: `${webhookDuration}ms`,
              merchantId: sanitizedMerchantId,
              username: sanitizedUsername,
              conversationId,
              messageLength: messageText.length,
              hasImages
            });

            // ⚡ IMMEDIATE RESPONSE: Return quickly while processing in background
            return c.json({
              version: "v2",
              messages: [{ 
                type: "text", 
                text: "أهلاً! سأعود إليك بعد لحظات برد مفصل 😊" 
              }],
              set_attributes: { 
                ai_reply: "PROCESSING",
                job_id: queueResult.jobId,
                event_id: eventId,
                webhook_time: webhookDuration,
                queue_position: queueResult.queuePosition || 0
              }
            });

          } catch (queueError) {
            log.error('❌ Queue processing failed, falling back to direct processing', { 
              error: String(queueError),
              fallback: 'direct'
            });
            
            // FALLBACK: Simple cached response when queue fails
            return c.json({
              version: "v2",
              messages: [{ 
                type: "text", 
                text: "أهلاً بك! أحتاج لحظة لمعالجة طلبك، يرجى المحاولة مرة أخرى." 
              }],
              set_attributes: { 
                ai_reply: "QUEUE_ERROR_FALLBACK",
                processing_time: Date.now() - processingStartTime,
                error: "queue_unavailable"
              }
            });
          } finally {
            // Cleanup queue manager
            if (queueManager) {
              try {
                await queueManager.close();
              } catch (closeErr) {
                log.warn('Failed to close queue manager', { error: String(closeErr) });
              }
            }
          }
        } catch (error) {
          log.error('❌ ManyChat webhook processing error', { 
            error: error instanceof Error ? error.message : String(error),
            merchantId: sanitizedMerchantId,
            username: sanitizedUsername 
          });
          
          return c.json({
            version: "v2",
            messages: [{ type: "text", text: "عذراً، حدث خطأ مؤقت. يرجى المحاولة مرة أخرى." }],
            set_attributes: { 
              ai_reply: "processing_error",
              processing_time: Date.now() - processingStartTime
            }
          });
        }
      }

      // Handle non-message events (mapping updates, etc.)
      if (finalMerchantId && incomingUsername && subscriber_id) {
        try {
          const { upsertManychatMapping } = await import('../repositories/manychat.repo.js');
          await upsertManychatMapping(sanitizedMerchantId, sanitizedUsername, subscriber_id);
          
          log.info('✅ Updated ManyChat mapping', {
            merchant_id: sanitizedMerchantId,
            instagram_username: sanitizedUsername,
            subscriber_id
          });
        } catch (mappingError) {
          log.warn('⚠️ ManyChat mapping failed', { error: String(mappingError) });
        }
      }

      return c.json({ 
        ok: true, 
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      log.error('❌ ManyChat webhook error', error);
      return c.json({ ok: true, error: 'acknowledged' });
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
        whatsapp: 'disabled',
        manychat: 'active'
      }
    });
  });

  // Development debug endpoint for signature verification
  if (getEnv('NODE_ENV') !== 'production') {
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

        const first = sorted?.[0];
if (!first) throw new Error('No webhook files found to dump');
const dumpPath = path.join(dir, first.f);
        const raw = await fs.promises.readFile(dumpPath);
        const exp = createHmac('sha256', (getEnv('META_APP_SECRET') || '').trim())
          .update(raw)
          .digest('hex');

        return c.text(`sha256=${exp}`);
      } catch (error: unknown) {
        log.error('Debug endpoint error:', error instanceof Error ? { message: error.message } : { error });
        return c.text('Error', 500);
      }
    });
  }

  // Secure production debug endpoint (opt-in via env)
  if (getEnv('ENABLE_PROD_DEBUG') === 'true') {
    app.get('/internal/prod/debug/last-dump-hash', async (c) => {
      try {
        // Require strong bearer token and optional IP allowlist
        const auth = c.req.header('authorization') || '';
        const expected = (getEnv('PROD_DEBUG_BEARER') || '').trim();
        if (!expected || !auth.startsWith(`Bearer ${expected}`)) {
          log.warn('Prod debug unauthorized');
          return c.text('unauthorized', 401);
        }

        const allowedIps = (getEnv('PROD_DEBUG_ALLOWED_IPS') || '').split(',').map(s => s.trim()).filter(Boolean);
        const remoteIp = (c.req.header('x-forwarded-for') || '').split(',')[0]?.trim() || c.req.header('cf-connecting-ip') || '';
        if (allowedIps.length && remoteIp && !allowedIps.includes(remoteIp)) {
          log.warn('Prod debug IP not allowed', { remoteIp });
          return c.text('forbidden', 403);
        }

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
        if (!sorted.length) return c.text('no dumps', 404);
        const first = sorted[0]!;
        const dumpPath = path.join(dir, first.f);
        const raw = await fs.promises.readFile(dumpPath);
        const exp = createHmac('sha256', (getEnv('META_APP_SECRET') || '').trim())
          .update(raw)
          .digest('hex');
        return c.text(`sha256=${exp}`);
      } catch (error: unknown) {
        log.error('Prod debug endpoint error:', error instanceof Error ? { message: error.message } : { error });
        return c.text('Error', 500);
      }
    });
  }

  // ===============================================
  // ManyChat Test Endpoint
  // ===============================================
  
  app.post('/api/test/manychat', async (c) => {
    try {
      const body = await c.req.json();
      const { merchantId, customerId, message } = body;
      // RLS safety: ensure header/JWT merchant matches body merchant
      try {
        const { requireMerchantId } = await import('../middleware/rls-merchant-isolation.js');
        const ctxMerchant = requireMerchantId(c);
        if (ctxMerchant !== merchantId) {
          return c.json({ success: false, error: 'merchant_mismatch' }, 403);
        }
      } catch {}
      
      if (!merchantId || !customerId || !message) {
        return c.json({
          success: false,
          error: 'Missing required fields: merchantId, customerId, message'
        }, 400);
      }

      // Import ManyChat Bridge
      const { getInstagramManyChatBridge } = await import('../services/instagram-manychat-bridge.js');
      const bridge = getInstagramManyChatBridge();

      // Test ManyChat processing
      const result = await bridge.processMessage({
        merchantId,
        customerId,
        message,
        interactionType: 'dm',
        platform: 'instagram'
      }, {
        useManyChat: true, // Production ManyChat enabled
        fallbackToLocalAI: true,
        priority: 'normal',
        tags: ['test', 'api_test']
      });

      return c.json({
        success: true,
        result,
        message: 'ManyChat integration test completed successfully'
      });

    } catch (error) {
      log.error('ManyChat test endpoint error:', error);
      return c.json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'ManyChat integration test failed'
      }, 500);
    }
  });

  // ManyChat Health Check Endpoint
  app.get('/api/health/manychat', async (c) => {
    try {
      const { getInstagramManyChatBridge } = await import('../services/instagram-manychat-bridge.js');
      const bridge = getInstagramManyChatBridge();
      
      const healthStatus = await bridge.getHealthStatus();
      
      return c.json({
        success: true,
        status: healthStatus.status,
        manyChat: healthStatus.manyChat,
        localAI: healthStatus.localAI,
        instagram: healthStatus.instagram,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      log.error('ManyChat health check error:', error);
      return c.json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        status: 'unhealthy',
        timestamp: new Date().toISOString()
      }, 500);
    }
  });

  log.info('Webhook routes registered successfully');
}
