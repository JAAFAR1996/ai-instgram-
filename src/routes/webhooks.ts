/**
 * ===============================================
 * Webhooks Routes Module
 * Handles Instagram webhook endpoints with security
 * ===============================================
 */
import { Hono } from 'hono';
import { getLogger } from '../services/logger.js';
// import { telemetry } from '../services/telemetry.js';
import { z } from 'zod';
import { createHmac } from 'node:crypto';
import { getPool } from '../db/index.js';
// import { withRetry } from '../utils/retry.js';
import { getEnv } from '../config/env.js';
import type { ConversationMsg } from '../services/conversation-manager.js';
// import { MCEvent as MCEventSchema, type MCEvent as MCEventType } from '../types/manychat.js';
// import { ProductionQueueManager } from '../services/ProductionQueueManager.js';
// import { RedisEnvironment } from '../config/RedisConfigurationFactory.js';
// Zod schema for ManyChat webhook validation
const ManyChatAttachmentSchema = z.object({
  url: z.string().url().optional(),
  payload: z.object({ url: z.string().url().optional() }).optional(),
  image_url: z.string().url().optional(),
  src: z.string().url().optional()
}).passthrough();
const ManyChatWebhookSchema = z.object({
  merchant_id: z.string().uuid().optional(),
  instagram_username: z.string().optional(),
  merchant_username: z.string().optional(),
  subscriber_id: z.string().optional(),
  event_type: z.string().optional(),
  data: z.object({
    text: z.string().optional(),
    attachments: z.array(ManyChatAttachmentSchema).optional()
  }).optional()
}).passthrough();
type ManyChatWebhookBody = z.infer<typeof ManyChatWebhookSchema>;

// ManyChat Dynamic Block schema (External Request)
const ManyChatDynamicSchema = z.object({
  merchantId: z.string().uuid(),
  user_id: z.string().min(1),
  message: z.string().min(1).max(4000),
  history: z.array(z.object({
    role: z.enum(['user','assistant']),
    content: z.string().min(1).max(4000),
    timestamp: z.string().optional()
  })).optional(),
  user_fields: z.record(z.any()).optional(),
  conversationId: z.string().uuid().optional(),
  username: z.string().min(1).optional(),
  in_24h: z.boolean().optional(),
  request_id: z.string().optional()
}).strict();
const log = getLogger({ component: 'webhooks-routes' });
// Webhook validation schemas
const InstagramWebhookVerificationSchema = z.object({
  'hub.mode': z.string(),
  'hub.verify_token': z.string(),
  'hub.challenge': z.string()
});
// WebhookDependencies not needed after removing queue usage
/**
 * Register webhook routes on the app
 */
// Queue manager singleton to avoid per-request init/close
// Queue manager disabled for ManyChat webhook path (server won't send proactively)
// let queueManagerSingleton: ProductionQueueManager | null = null;
// async function getQueueManager(pool: Pool): Promise<ProductionQueueManager> {
//   if (!queueManagerSingleton) {
//     const qLogger = {
//       info: (...args: unknown[]) => log.info(String(args[0] ?? ''), typeof args[1] === 'object' ? (args[1] as Record<string, unknown>) : undefined),
//       warn: (...args: unknown[]) => log.warn(String(args[0] ?? ''), typeof args[1] === 'object' ? (args[1] as Record<string, unknown>) : undefined),
//       error: (...args: unknown[]) => log.error(String(args[0] ?? ''), typeof args[1] === 'object' ? (args[1] as Record<string, unknown>) : undefined),
//       debug: (...args: unknown[]) => log.debug?.(String(args[0] ?? ''), typeof args[1] === 'object' ? (args[1] as Record<string, unknown>) : undefined),
//     };
//     const qm = new ProductionQueueManager(qLogger as any, RedisEnvironment.PRODUCTION, pool, 'ai-sales-production');
//     const init = await qm.initialize();
//     if (!init.success) throw new Error(`Queue initialization failed: ${init.error}`);
//     queueManagerSingleton = qm;
//   }
//   return queueManagerSingleton;
// }
export function registerWebhookRoutes(app: Hono, _deps: any): void {
  // Instagram webhook verification (GET)
      app.get('/webhooks/instagram', async (c) => {
    try {
      const query = c.req.query();
      const validation = InstagramWebhookVerificationSchema.safeParse(query);
      if (!validation.success) {
        log.warn('Instagram webhook verification failed - invalid parameters', { query, errors: validation.error.errors });
        return c.text('Bad Request');
      }
      const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = validation.data as any;
      if (mode !== 'subscribe') {
        log.warn('Instagram webhook verification failed - invalid mode', { mode });
        try { (await import('../services/compliance.js')).getComplianceService().logEvent(null, 'WEBHOOK_VERIFY', 'FAILURE', { reason: 'invalid_mode', mode }); } catch {}
        return c.text('Bad Request');
      }
      const expectedToken = (getEnv('IG_VERIFY_TOKEN') ?? '').trim();
      if (!expectedToken || token !== expectedToken) {
        log.warn('Instagram webhook verification failed - invalid token', { providedToken: token, expectedExists: !!expectedToken });
        try { (await import('../services/compliance.js')).getComplianceService().logEvent(null, 'WEBHOOK_VERIFY', 'FAILURE', { reason: 'invalid_token' }); } catch {}
        return c.text('Forbidden', 403);
      }
      log.info('Instagram webhook verification successful', { challenge });
      try { (await import('../services/compliance.js')).getComplianceService().logEvent(null, 'WEBHOOK_VERIFY', 'SUCCESS', { endpoint: 'instagram', challenge }); } catch {}
      return c.text(challenge);
    } catch (error: any) {
      log.error('Instagram webhook verification error:', error instanceof Error ? { message: error.message } : { error });
      try { (await import('../services/compliance.js')).getComplianceService().logEvent(null, 'WEBHOOK_VERIFY', 'FAILURE', { error: String(error) }); } catch {}
      return c.text('Internal Server Error', 500);
    }
  });
  app.post('/webhooks/instagram', async (c) => {
    return c.text('Use ManyChat flow: Instagram → ManyChat → Server → AI → Server → ManyChat → Instagram', 410);
  });
  // ManyChat webhook route - PRODUCTION with AI integration
  app.post('/webhooks/manychat', async (c) => {    // Prepare unified response context before entering try/catch
    const processingStartTime = Date.now();
    let conversationId: string = "";
    let currentJobId: string = "";
    let eventId: string = `manychat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const mcResponse = (attrs: Record<string, unknown> = {}) => {
      const duration = Date.now() - processingStartTime;
      const text = typeof (attrs as any).ai_reply === 'string' ? String((attrs as any).ai_reply) : 'ok';
      const msgs = [{ type: 'text', text }];
      return {
        version: "v2",
        content: { messages: msgs },
        // Back-compat for flows mapping to messages[0].text
        messages: msgs,
        set_attributes: {
          processing_time: duration,
          webhook_time: duration,
          conversation_id: conversationId,
          event_id: eventId,
          job_id: currentJobId,
          ...attrs,
        }
      };
    };
    try {
      // 🔒 PRODUCTION: Bearer token authentication
      const authHeader = c.req.header('authorization');
      const expectedBearer = (getEnv('MANYCHAT_BEARER') ?? '').trim();
      if (!expectedBearer) {
        log.error('❌ MANYCHAT_BEARER not configured');
        return c.json({ error: 'auth_not_configured' }, 401);
      }
      if (!authHeader?.startsWith(`Bearer ${expectedBearer}`)) {
        log.warn('❌ ManyChat webhook unauthorized', { hasAuth: !!authHeader });
        return c.json({ error: 'unauthorized' }, 401);
      }
      
      log.info('📩 ManyChat webhook received');
      // Prefer pre-read raw body from idempotency middleware; fallback to reading request directly
      let rawBody: string = (c.get as any)?.('rawBody') ?? '';
      if (!rawBody) {
        try { rawBody = await c.req.text(); } catch {}
      }
      // HMAC verification when secret provided
      const signature = c.req.header('x-hub-signature-256') || c.req.header('x-signature-256') || c.req.header('x-signature') || c.req.header('signature');
      const webhookSecret = (getEnv('MANYCHAT_WEBHOOK_SECRET') ?? '').trim();
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
      let body: ManyChatWebhookBody;
      try {
        const parsedBody = rawBody ? JSON.parse(rawBody) : {};
        const validation = ManyChatWebhookSchema.safeParse(parsedBody);
        
        if (!validation.success) {
          log.warn('ManyChat webhook validation failed', {
            errors: validation.error.errors,
            rawBodyLength: rawBody?.length ?? 0
          });
          return c.json(mcResponse({ 
            ai_reply: 'Invalid request. Please try again.', status_code: 400,
            error: 'invalid_payload_structure',
            details: validation.error.errors
          } as Record<string, unknown>))
        }
        
        body = validation.data;
      } catch (parseErr) {
        log.error('ManyChat webhook JSON parse error', {
          error: parseErr instanceof Error ? parseErr.message : String(parseErr),
          rawBodyLength: rawBody?.length ?? 0
        });
        return c.json(mcResponse({ ai_reply: 'Invalid JSON. Please try again.', status_code: 400, error: 'invalid_json' }))
      }
      const { merchant_id, instagram_username, merchant_username, subscriber_id, event_type, data } = body;
      // 🛡️ PRODUCTION: Input validation and sanitization - use fallback for merchant_id
      const finalMerchantId = (merchant_id ?? '').trim();
      
      const incomingUsername = (merchant_username ?? instagram_username) as string | undefined;
      const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!incomingUsername || !finalMerchantId) {
        return c.json(mcResponse({ 
          ai_reply: 'Missing account info. Please retry.', status_code: 400,
          error: 'username (merchant_username/instagram_username) required and merchant_id missing' 
        }))
      }
      const sanitizedUsername = String(incomingUsername).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
      const sanitizedMerchantId = String(finalMerchantId).trim();
      if (!UUID_REGEX.test(sanitizedMerchantId)) {
        return c.json(mcResponse({ ai_reply: 'Service error. Please try later.', status_code: 503, error: 'context_error' }));
      }
      
      if (!sanitizedUsername || sanitizedUsername.length < 2) {
        return c.json(mcResponse({ 
          ai_reply: 'Invalid username.', status_code: 400,
          error: 'invalid username format' 
        }))
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
        return c.json(mcResponse({ ai_reply: 'Service error. Please try later.', status_code: 503, error: 'context_error' }));
      }
      // Normalize attachments (images) strictly to URL list
      const attachments = Array.isArray(data?.attachments) ? data.attachments : [];
      const images: Array<{ url: string }> = attachments
        .map((attachment) => attachment.url || attachment.payload?.url || attachment.image_url || attachment.src || null)
        .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
        .map((url) => ({ url }));
      const hasImages = images.length > 0;
      if (event_type === 'message' && (data?.text || hasImages)) {
        const messageText = String(data?.text ?? '').trim();
        
        if (messageText.length > 4000) {
          return c.json(mcResponse({ ai_reply: "Message too long. Please shorten.", status_code: 400 }));
        }
        // 🚩 Human escalation keywords (Iraqi/Arabic common phrases)
        const needsHuman = /\b(اكلم|اتكلم|اتواصل)\s*(?:وي|ويا)?\s*(?:ال)?(مدير|مسؤول|مشرف|ادمن|الدعم|بشري|انسان)\b|\bاريد\s*(?:اكلم|اتكلم)\b|\bبشري\b/i.test(messageText);
        if (needsHuman) {
          try {
            // Create a manual followup ticket (best-effort)
            const { ManualFollowupRepository } = await import('../repositories/manual-followup-repository.js');
            const repo = new ManualFollowupRepository();
            await repo.create({
              merchantId: sanitizedMerchantId,
              customerId: sanitizedUsername,
              conversationId,
              originalMessage: messageText,
              reason: 'manager_request',
              priority: 'urgent'
            });
          } catch (e) {
            log.warn('Failed to create manual followup for escalation', { error: String(e) });
          }
          // Return ManyChat-friendly escalation flag so the flow can handoff
          {
            const out = mcResponse({ ai_reply: 'تم تحويلك للمسؤول، لحظة ونخدمك 🙏', escalate: true, escalate_reason: 'manager_request', in_24h: true, ai_source: 'human_escalation' } as Record<string, unknown>);
            try {
              (c as unknown as { set: (k: string, v: unknown) => void }).set('idempotencyResponse', { status: 200, body: out });
              (c as unknown as { set: (k: string, v: unknown) => void }).set('cacheIdempotency', true);
            } catch {}
            return c.json(out);
          }
        }
          // 🚫 Stop server-side sending; generate AI reply synchronously for ManyChat to send
          // Queue disabled for this endpoint
        try {
          // ⚡ LIGHTWEIGHT: Only essential database operations in webhook
          const pool = getPool();
          
          // Find or create conversation
          // conversationId is declared above and defaults to ""
          let sessionData: Record<string, unknown> = {};
          try {
            // Persist ManyChat mapping early to guarantee username→subscriber_id resolution for sending
            try {
              if (subscriber_id) {
                const { upsertManychatMapping } = await import('../repositories/manychat.repo.js');
                await upsertManychatMapping(sanitizedMerchantId, sanitizedUsername, subscriber_id);
                log.debug('ManyChat mapping upserted before enqueue', { sanitizedMerchantId, sanitizedUsername, subscriber_id });
              }
            } catch (mapErr) {
              log.warn('Failed to upsert ManyChat mapping before enqueue (will retry later)', { error: String(mapErr) });
            }
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
            return c.json(mcResponse({ ai_reply: 'Database error. Please try later.', status_code: 500 }));
          }

          // Load recent messages as conversation history (oldest -> newest)
          let historyMsgs: ConversationMsg[] = [];
          try {
            const historyResult = await pool.query(
              `SELECT id, content, direction, created_at
               FROM message_logs
               WHERE conversation_id = $1
               ORDER BY created_at DESC
               LIMIT 20`,
              [conversationId]
            );
            // collect last messages ids (unused)
            // Optimize long history into a short summary for sessionData (kept small for tokens)
            try {
              const msgs: ConversationMsg[] = historyResult.rows
                .map((r: { direction: string; content: unknown; created_at: Date | string }) => ({
                  role: r.direction === 'INCOMING' ? 'user' as const : 'assistant' as const,
                  content: String(r.content ?? ''),
                  timestamp: r.created_at,
                }))
                .reverse(); // oldest -> newest
              const { ConversationManager } = await import('../services/conversation-manager.js');
              const cm = new ConversationManager();
              const opt = await cm.optimizeHistory(sanitizedMerchantId, sanitizedUsername, msgs, 6);
              if (opt.sessionPatch && Object.keys(opt.sessionPatch).length) {
                sessionData = { ...(opt.sessionPatch || {}), ...(sessionData || {}) };
              }
              historyMsgs = Array.isArray(opt.trimmedHistory) && opt.trimmedHistory.length ? opt.trimmedHistory : msgs;
            } catch {}
          } catch (histErr) {
            log.warn('Failed to load conversation history, proceeding without it', { error: String(histErr) });
          }
          // Store incoming message
          // Store incoming message
          try {
            await pool.query(
              `INSERT INTO message_logs (conversation_id, content, message_type, direction, platform, source_channel, created_at)
               VALUES ($1, $2, $3, 'INCOMING', 'instagram', 'manychat', NOW()) RETURNING id`,
              [conversationId, messageText || (hasImages ? 'IMAGE_MESSAGE' : ''), hasImages ? 'IMAGE' : 'TEXT']
            );
            // Save semantic memory (best-effort)
            try {
              const { getSemanticMemoryService } = await import('../services/semantic-memory.js');
              const mem = getSemanticMemoryService();
              await mem.saveMessage(sanitizedMerchantId, sanitizedUsername, conversationId, 'user', messageText || (hasImages ? 'IMAGE_MESSAGE' : ''));
            } catch {}
          } catch (insErr) {
            log.warn('Failed to insert incoming message with RETURNING id; retrying plain insert', { error: String(insErr) });
            await pool.query(
              `INSERT INTO message_logs (conversation_id, content, message_type, direction, platform, source_channel, created_at)
               VALUES ($1, $2, 'TEXT', 'INCOMING', 'instagram', 'manychat', NOW())`,
              [conversationId, messageText || (hasImages ? 'IMAGE_MESSAGE' : '')]
            );
          }
          // Generate AI response with hard timeout to satisfy ManyChat 10s limit
          try {
            const { getConversationAIOrchestrator } = await import('../services/conversation-ai-orchestrator.js');
            const orchestrator = getConversationAIOrchestrator();
            const context = {
              merchantId: sanitizedMerchantId,
              customerId: sanitizedUsername,
              platform: 'instagram',
              stage: (sessionData as any)?.stage || 'GREETING',
              cart: Array.isArray((sessionData as any)?.cart) ? (sessionData as any).cart : [],
              preferences: (sessionData as any)?.preferences || {},
              conversationHistory: historyMsgs,
              interactionType: 'dm'
            } as any;
            // Check 24h message window status (Meta policy)
            let in24hWindow = true;
            try {
              const win = await pool.query(
                `SELECT can_send, window_expires_at FROM get_instagram_message_window_status($1::uuid, $2)`,
                [sanitizedMerchantId, sanitizedUsername]
              );
              in24hWindow = Boolean(win.rows?.[0]?.can_send);
            } catch (e) {
              log.warn('Failed to check 24h window status', { error: String(e) });
            }

            // Respond with pure AI (no artificial fallback text). To reduce timeouts,
            // we still bound with a soft cap if MANYCHAT_AI_TIMEOUT_MS is set; otherwise wait.
            const timeoutRaw = (getEnv('MANYCHAT_AI_TIMEOUT_MS') ?? '').trim();
            const timeoutMs = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : 0;
            let aiText: string;
            if (timeoutMs && timeoutMs > 0) {
              aiText = await Promise.race<string>([
                (async () => {
                  const ai = await orchestrator.generatePlatformResponse(messageText, context, 'instagram');
                  return (ai?.response as any)?.message || '';
                })(),
                new Promise<string>((resolve) => setTimeout(() => resolve(''), timeoutMs))
              ]).catch(() => '');
            } else {
              const ai = await orchestrator.generatePlatformResponse(messageText, context, 'instagram');
              aiText = (ai?.response as any)?.message || '';
            }
            // Enforce 24h policy: avoid promotional content outside window; add human_agent tag
            try {
              if (!in24hWindow) {
                const { looksPromotional } = await import('../services/tone-dialect.js');
                if (looksPromotional(aiText)) {
                  aiText = 'حتى نلتزم بسياسات Meta، نكدر نجاوب على سؤالك بشكل عام بدون عروض ترويجية. نقدر نخلي ممثل بشري يتابعك. 🙏';
                }
              }
            } catch {}
            // Respond with ManyChat-friendly JSON and attributes
            {
              const out = mcResponse({ ai_reply: aiText || '...', in_24h: in24hWindow, human_agent: !in24hWindow, ai_source: 'openai' } as Record<string, unknown>);
              try {
                (c as unknown as { set: (k: string, v: unknown) => void }).set('idempotencyResponse', { status: 200, body: out });
                (c as unknown as { set: (k: string, v: unknown) => void }).set('cacheIdempotency', true);
              } catch {}
              return c.json(out);
            }
          } catch (aiErr) {
            log.error('❌ AI generation failed', { error: String(aiErr) });
            return c.json(mcResponse({ ai_reply: 'عذرًا، حدث خطأ. حاول لاحقًا.', in_24h: true, status_code: 500, ai_source: 'fallback', ai_error: String(aiErr).slice(0,200) }));
          }
        } catch (error) {
          log.error('❌ ManyChat webhook processing error', { 
            error: error instanceof Error ? error.message : String(error),
            merchantId: sanitizedMerchantId,
            username: sanitizedUsername 
          });
          
          return c.json(mcResponse({ ai_reply: "Processing error. Please try later.", status_code: 500, ai_source: 'fallback', ai_error: String(error).slice(0,200) }));
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
      // Standard no-op response for non-message events
      {
        const out = mcResponse({ ai_reply: 'event_received', ai_source: 'noop' } as Record<string, unknown>);
        try {
          (c as unknown as { set: (k: string, v: unknown) => void }).set('idempotencyResponse', { status: 200, body: out });
          (c as unknown as { set: (k: string, v: unknown) => void }).set('cacheIdempotency', true);
        } catch {}
        return c.json(out);
      }
    } catch (error) {
      log.error('❌ ManyChat webhook error', error);
      return c.json(mcResponse({ ai_reply: 'Internal error. Please try later.', status_code: 500, error: 'acknowledged', ai_source: 'fallback', ai_error: String(error).slice(0,200) }));
    }
  });
  // WhatsApp webhook routes - DISABLED
  app.get('/webhooks/whatsapp', (c) => c.text('WhatsApp features disabled', 503));
  app.post('/webhooks/whatsapp', (c) => c.text('WhatsApp features disabled', 503));

  // ===============================================
  // ManyChat Dynamic Block (External Request) Endpoint
  // Accepts rich JSON: message, history, user_fields, conversationId, etc.
  // Returns ManyChat v2 response with set_attributes
  // ===============================================
  app.post('/webhooks/manychat/dynamic', async (c) => {
    const startedAt = Date.now();
    let conversationId: string = '';
    const mcResponse = (attrs: Record<string, unknown> = {}) => {
      const duration = Date.now() - startedAt;
      const text = typeof (attrs as any).ai_reply === 'string' ? String((attrs as any).ai_reply) : 'ok';
      const msgs = [{ type: 'text', text }];
      return {
        version: 'v2',
        content: { messages: msgs },
        messages: msgs,
        set_attributes: {
          processing_time: duration,
          conversation_id: conversationId,
          ...attrs
        }
      };
    };
    try {
      // Security: Bearer token
      const expectedBearer = (getEnv('MANYCHAT_BEARER') ?? '').trim();
      const authHeader = c.req.header('authorization');
      if (!expectedBearer || !authHeader?.startsWith(`Bearer ${expectedBearer}`)) {
        return c.json({ error: 'unauthorized' }, 401);
      }

      const body = await c.req.json();
      const parsed = ManyChatDynamicSchema.safeParse(body);
      if (!parsed.success) {
        return c.json(mcResponse({ ai_reply: 'invalid payload', status_code: 400, details: parsed.error.issues }));
      }
      const {
        merchantId,
        user_id,
        message,
        history: providedHistory,
        user_fields,
        conversationId: providedConvId,
        username: providedUsername,
        in_24h: providedIn24h,
        request_id
      } = parsed.data;

      // Derive username/customerId from payload
      const rawUsername = (providedUsername
        || (user_fields && (user_fields as any).instagram_username)
        || (user_fields && (user_fields as any).merchant_username)
        || '') as string;
      const sanitizedUsername = rawUsername
        ? String(rawUsername).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '')
        : `mc_${String(user_id).trim().toLowerCase()}`;

      // Set RLS merchant context
      try {
        const { getDatabase } = await import('../db/adapter.js');
        const db = getDatabase();
        const sql = db.getSQL();
        await sql`SELECT set_config('app.current_merchant_id', ${merchantId}::text, true)`;
      } catch (err) {
        log.error('Failed to set RLS context for dynamic endpoint', { err: String(err) });
        return c.json(mcResponse({ ai_reply: 'Service unavailable', status_code: 503 }));
      }

      // Find/create conversation and persist incoming message
      const pool = getPool();
      let sessionData: Record<string, unknown> = {};
      try {
        if (providedConvId) {
          conversationId = providedConvId;
        } else {
          const existing = await pool.query(
            `SELECT id, session_data FROM conversations WHERE merchant_id = $1 AND customer_instagram = $2 ORDER BY created_at DESC LIMIT 1`,
            [merchantId, sanitizedUsername]
          );
          if (existing.rows.length) {
            conversationId = existing.rows[0].id;
            try { sessionData = existing.rows[0].session_data || {}; if (typeof sessionData === 'string') sessionData = JSON.parse(sessionData); } catch {}
          } else {
            const ins = await pool.query(
              `INSERT INTO conversations (merchant_id, customer_instagram, platform, source_channel, conversation_stage, session_data, message_count, created_at, updated_at)
               VALUES ($1,$2,'instagram','manychat','GREETING','{}',0,NOW(),NOW()) RETURNING id`,
              [merchantId, sanitizedUsername]
            );
            conversationId = ins.rows[0].id;
          }
        }
        await pool.query(
          `INSERT INTO message_logs (conversation_id, content, message_type, direction, platform, source_channel, created_at)
           VALUES ($1,$2,'TEXT','INCOMING','instagram','manychat',NOW())`,
          [conversationId, message]
        );
      } catch (dbErr) {
        log.error('Dynamic endpoint DB failure', { error: String(dbErr) });
        return c.json(mcResponse({ ai_reply: 'Database error', status_code: 500 }));
      }

      // Build history for orchestrator
      let historyMsgs: ConversationMsg[] = [];
      if (Array.isArray(providedHistory) && providedHistory.length) {
        historyMsgs = providedHistory.slice(-12).map(h => ({ role: h.role, content: h.content, timestamp: h.timestamp || new Date().toISOString() }));
      } else {
        try {
          const res = await pool.query(
            `SELECT content, direction, created_at FROM message_logs WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 20`,
            [conversationId]
          );
          historyMsgs = res.rows
            .map((r: { direction: string; content: unknown; created_at: Date | string }) => ({
              role: r.direction === 'INCOMING' ? 'user' as const : 'assistant' as const,
              content: String(r.content ?? ''),
              timestamp: r.created_at
            }))
            .reverse();
        } catch {}
      }

      // 24h window status: prefer provided flag, else DB check (best-effort)
      let in24hWindow = providedIn24h ?? true;
      if (typeof providedIn24h === 'undefined') {
        try {
          const win = await pool.query(
            `SELECT can_send FROM get_instagram_message_window_status($1::uuid, $2)`,
            [merchantId, sanitizedUsername]
          );
          in24hWindow = Boolean(win.rows?.[0]?.can_send);
        } catch {}
      }

      // Compose AI context from user_fields (preferences)
      const preferences: Record<string, unknown> = {};
      try {
        if (user_fields && typeof user_fields === 'object') {
          const uf = user_fields as Record<string, unknown>;
          if (Array.isArray(uf?.preferred_categories)) preferences['categories'] = uf.preferred_categories;
          if (Array.isArray(uf?.preferred_colors)) preferences['colors'] = uf.preferred_colors;
          if (Array.isArray(uf?.preferred_sizes)) preferences['sizes'] = uf.preferred_sizes;
          if (typeof uf?.price_sensitivity === 'string') preferences['priceSensitivity'] = uf.price_sensitivity;
        }
      } catch {}

      // Generate AI response
      try {
        const { getConversationAIOrchestrator } = await import('../services/conversation-ai-orchestrator.js');
        const orchestrator = getConversationAIOrchestrator();
        const context: any = {
          merchantId,
          customerId: sanitizedUsername,
          platform: 'instagram',
          stage: (sessionData as any)?.stage || 'GREETING',
          cart: Array.isArray((sessionData as any)?.cart) ? (sessionData as any).cart : [],
          preferences,
          conversationHistory: historyMsgs,
          interactionType: 'dm'
        };
        const ai = await orchestrator.generatePlatformResponse(message, context, 'instagram');
        let aiText = (ai?.response as any)?.message || '';
        if (!in24hWindow) {
          try { const { looksPromotional } = await import('../services/tone-dialect.js'); if (looksPromotional(aiText)) aiText = 'حتى نلتزم بسياسات Meta، نجاوب بشكل عام بدون عروض ترويجية. نقدر نخلي ممثل بشري يتابعك. 🙏'; } catch {}
        }
        // Log assistant message (best-effort)
        try { await pool.query(`INSERT INTO message_logs (conversation_id, content, message_type, direction, platform, source_channel, created_at) VALUES ($1,$2,'TEXT','OUTGOING','instagram','manychat',NOW())`, [conversationId, aiText]); } catch {}
        return c.json(mcResponse({ ai_reply: aiText, in_24h: in24hWindow, ai_source: 'openai', request_id }));
      } catch (err) {
        log.error('Dynamic endpoint AI failure', { error: String(err) });
        return c.json(mcResponse({ ai_reply: 'عذرًا، صار خطأ بسيط. حاول مرة ثانية.', status_code: 500, ai_source: 'fallback', ai_error: String(err).slice(0,200), request_id }));
      }
    } catch (error) {
      log.error('Dynamic endpoint error', { error: String(error) });
      return c.json(mcResponse({ ai_reply: 'Internal error', status_code: 500 }));
    }
  });
  
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
        const exp = createHmac('sha256', (getEnv('META_APP_SECRET') ?? '').trim())
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
        const auth = c.req.header('authorization') ?? '';
        const expected = (getEnv('PROD_DEBUG_BEARER') ?? '').trim();
        if (!expected || !auth.startsWith(`Bearer ${expected}`)) {
          log.warn('Prod debug unauthorized');
          return c.text('unauthorized', 401);
        }
        const allowedIps = (getEnv('PROD_DEBUG_ALLOWED_IPS') ?? '').split(',').map(s => s.trim()).filter(Boolean);
        const remoteIp = (c.req.header('x-forwarded-for') ?? '').split(',')[0]?.trim() || (c.req.header('cf-connecting-ip') ?? '');
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
        const exp = createHmac('sha256', (getEnv('META_APP_SECRET') ?? '').trim())
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
      const body = ((c.get as any)?.('jsonBody')) ?? await c.req.json();
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
        });
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
        useManyChat: false, // تعطيل ManyChat لاستخدام Local AI
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




















