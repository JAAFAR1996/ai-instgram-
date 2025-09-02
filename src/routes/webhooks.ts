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
import { orchestrate } from '../services/smart-orchestrator.js';
import ConstitutionalAI from '../services/constitutional-ai.js';

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
        return c.text('Bad Request', 400);
      }

      const expectedToken = (getEnv('IG_VERIFY_TOKEN') || '').trim();
      if (!expectedToken || token !== expectedToken) {
        log.warn('Instagram webhook verification failed - invalid token', { 
          providedToken: token,
          expectedExists: !!expectedToken
        });
        return c.text('Forbidden', 403);
      }

      log.info('Instagram webhook verification successful', { challenge });
      return c.text(challenge);
    } catch (error: unknown) {
      log.error('Instagram webhook verification error:', error instanceof Error ? { message: error.message } : { error });
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
          return c.json({ error: 'signature_required' }, 401);
        }
        try {
          const expected = createHmac('sha256', webhookSecret).update(rawBody, 'utf8').digest('hex');
          const provided = signature.replace(/^sha256=/, '').trim();
          if (expected !== provided) {
            log.warn('ManyChat webhook: signature mismatch');
            return c.json({ error: 'invalid_signature' }, 401);
          }
        } catch (sigErr) {
          log.error('ManyChat webhook: signature verification error', sigErr as Error);
          return c.json({ error: 'signature_error' }, 401);
        }
      }
      const body = rawBody ? JSON.parse(rawBody) : {};
      const { merchant_id, instagram_username, merchant_username, subscriber_id, event_type, data } = body as any;

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
        return c.json({ ok: false, error: 'context_error' }, 503);
      }

      if (event_type === 'message' && data?.text) {
        const messageText = String(data.text).trim();
        
        if (messageText.length > 4000) {
          return c.json({
            version: "v2",
            messages: [{ type: "text", text: "رسالتك طويلة جداً، يرجى إرسال رسالة أقصر." }],
            set_attributes: { ai_reply: "message_too_long" }
          });
        }

        try {
          // 🔒 PRODUCTION: Database operations with proper error handling
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

          // Load last 100 messages as conversation history (oldest -> newest)
          let historyIds: string[] = [];
          try {
            const historyResult = await pool.query(
              `SELECT id, content, direction, created_at
               FROM message_logs
               WHERE conversation_id = $1
               ORDER BY created_at DESC
               LIMIT 20`,
              [conversationId]
            );
            historyIds = historyResult.rows.map((r: any) => r.id);
            // conversationHistory not required for orchestrator path
          } catch (histErr) {
            log.warn('Failed to load conversation history, proceeding without it', { error: String(histErr) });
          }

          // Store incoming message
          await pool.query(`
            INSERT INTO message_logs (conversation_id, content, message_type, direction, platform, source_channel, created_at)
            VALUES ($1, $2, 'TEXT', 'INCOMING', 'instagram', 'manychat', NOW())
          `, [conversationId, messageText]);

          // 🤖 PRODUCTION: Generate AI response
          let aiResponse: string;
          let aiIntent: string | undefined;
          let aiConfidence: number | undefined;
          let decisionPath: string[] = [];
          let kbSource: { id: string; title: string } | undefined;
          let sessionPatch: Record<string, unknown> | undefined;
          let stage: 'AWARE' | 'BROWSE' | 'INTENT' | 'OBJECTION' | 'CLOSE' | undefined;
          let thinkingMeta: any | undefined;
          try {
            const orchResult = await Promise.race([
              orchestrate(sanitizedMerchantId, sanitizedUsername, messageText, { askAtMostOneFollowup: true, session: sessionData, showThinking: true }),
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error('AI timeout')), 8000))
            ]);

            aiResponse = orchResult.text;
            aiIntent = orchResult.intent;
            aiConfidence = orchResult.confidence;
            decisionPath = orchResult.decision_path;
            kbSource = orchResult.kb_source;
            sessionPatch = orchResult.session_patch || undefined;
            stage = orchResult.stage;
            thinkingMeta = (orchResult as any)?.thinking_chain as any | undefined;

            // If objection intent -> generate smarter counter response and record
            if (aiIntent === 'OBJECTION') {
              try {
                const { IntelligentRejectionHandler } = await import('../services/rejection/intelligent-rejection-handler.js');
                const handler = new IntelligentRejectionHandler();
                const analysis = await handler.analyzeRejection(messageText, {
                  merchantId: sanitizedMerchantId,
                  customerId: sanitizedUsername,
                  platform: 'instagram',
                  stage: 'BROWSE',
                  cart: [],
                  preferences: {},
                  conversationHistory: []
                } as any);
                aiResponse = await handler.generateCounterResponse(analysis);
                await handler.recordRejection(sanitizedMerchantId, sanitizedUsername, conversationId, {
                  type: analysis.rejectionType,
                  reason: analysis.suggestedApproach,
                  customerMessage: messageText,
                  strategiesUsed: [analysis.suggestedApproach],
                  context: { stage }
                });
              } catch (rejErr) {
                log.warn('Rejection handling failed', { error: String(rejErr) });
              }
            }

            try {
              if (decisionPath.some(d => String(d).startsWith('clarify='))) {
                telemetry.trackEvent('followup_question', { platform: 'instagram', merchant_id: sanitizedMerchantId });
                telemetry.kpi.followupAsked();
              }
              if (decisionPath.includes('sql=hit')) telemetry.kpi.priceHit();
              if (decisionPath.includes('sql=miss')) telemetry.kpi.priceMiss();
              if (decisionPath.includes('sql=hit_no_price')) telemetry.kpi.managerHandoff();
            } catch {}
            
            // Validate AI response
            if (!aiResponse || aiResponse.trim().length === 0) {
              log.warn('Empty AI response received', { orchResult });
              return c.json({
                version: "v2",
                messages: [{ type: "text", text: "تعذر توليد رد مناسب. جرّب رسالة أخرى." }],
                set_attributes: { ai_reply: "EMPTY_RESPONSE", processing_time: Date.now() - processingStartTime }
              });
            }

            // Constitutional AI critique and improvement
            let qualityScore: number | undefined;
            let qualityImproved = false;
            let qualityDelta: number | undefined;
            try {
              const consAI = new ConstitutionalAI();
              const critique = await consAI.critiqueResponse(aiResponse, {
                merchantId: sanitizedMerchantId,
                username: sanitizedUsername,
                intent: aiIntent,
                stage,
                session: sessionData,
                kbSourceTitle: kbSource?.title
              });
              if (!critique.meetsThreshold) {
                const { improved, record } = await consAI.improveResponse(aiResponse, critique, {
                  merchantId: sanitizedMerchantId,
                  username: sanitizedUsername,
                  intent: aiIntent,
                  stage,
                  session: sessionData,
                });
                qualityImproved = true;
                qualityDelta = record.newScore - record.prevScore;
                qualityScore = record.newScore;
                aiResponse = improved;
              } else {
                qualityScore = critique.score;
              }
            } catch (qErr) {
              log.warn('Constitutional AI improvement failed', { error: String(qErr) });
            }
            
          } catch (aiError) {
            log.error('❌ AI service failed', { error: String(aiError) });
            
            // لا ترجع محتوى بديل. أعطِ إشارة فشل واضحة للمراقبة
            return c.json({
              version: "v2",
              messages: [{ type: "text", text: "تعذر توليد رد الآن. جرّب رسالة أقصر." }],
              set_attributes: { ai_reply: "AI_ERROR", processing_time: Date.now() - processingStartTime }
            });
          }

          // Store AI response
          // Compute vault_hit based on existing session data presence
          const vaultHit = Boolean((sessionData && (sessionData.category || sessionData.size || sessionData.color || sessionData.gender || sessionData.brand)));
          if (decisionPath.includes('sql=miss')) { try { telemetry.kpi.altSuggested(); } catch {} }

          await pool.query(`
            INSERT INTO message_logs (
              conversation_id, content, message_type, direction, platform, source_channel,
              ai_intent, ai_confidence, processing_time_ms, metadata, created_at
            )
            VALUES ($1, $2, 'TEXT', 'OUTGOING', 'instagram', 'manychat', $3, $4, $5, $6, NOW())
          `, [
            conversationId,
            aiResponse,
            aiIntent ?? null,
            typeof aiConfidence === 'number' ? aiConfidence : null,
            Date.now() - processingStartTime,
            JSON.stringify({ 
              decision_path: decisionPath, 
              kb_source: kbSource || null,
              stage: stage || null,
              sql_hit: decisionPath.includes('sql=hit'),
              rag_used: decisionPath.includes('rag=hit'),
              vault_hit: vaultHit,
              quality_score: typeof qualityScore === 'number' ? qualityScore : undefined,
              quality_improved: qualityImproved,
              quality_delta: typeof qualityDelta === 'number' ? qualityDelta : undefined,
              thinking: thinkingMeta ? {
                id: thinkingMeta.id,
                steps_count: Array.isArray(thinkingMeta.steps) ? thinkingMeta.steps.length : 0,
                overall_confidence: typeof thinkingMeta.overallConfidence === 'number' ? thinkingMeta.overallConfidence : undefined,
              } : undefined
            })
          ]);

          // Update session_data incrementally with sessionPatch (if provided)
          try {
            if (sessionPatch && Object.keys(sessionPatch).length > 0) {
              await pool.query(
                `UPDATE conversations SET session_data = COALESCE(session_data, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE id = $2`,
                [JSON.stringify(sessionPatch), conversationId]
              );
            }
          } catch (sessErr) {
            log.warn('Failed to update session_data', { error: String(sessErr) });
          }

          // Update Customer Vault (per-merchant per-customer context)
          try {
            if (sessionPatch && Object.keys(sessionPatch).length > 0) {
              const { upsertVault } = await import('../repos/customer-vault.ts');
              const vaultPatch: Record<string, unknown> = {
                ...(sessionPatch?.gender ? { gender: (sessionPatch as any).gender } : {}),
                ...(sessionPatch?.size ? { size: (sessionPatch as any).size } : {}),
                ...(sessionPatch?.color ? { color: (sessionPatch as any).color } : {}),
                ...(sessionPatch?.category ? { category: (sessionPatch as any).category } : {}),
                ...(typeof aiConfidence === 'number' ? { confidence: aiConfidence } : {}),
                ...(stage ? { stage } : {})
              };
              await upsertVault(sanitizedMerchantId, sanitizedUsername, vaultPatch as any, conversationId, 30);
            }
          } catch (vaultErr) {
            log.warn('Failed to update customer vault', { error: String(vaultErr) });
          }

          // Update conversation stats
          await pool.query(`
            UPDATE conversations 
            SET message_count = message_count + 2, last_message_at = NOW(), updated_at = NOW()
            WHERE id = $1
          `, [conversationId]);

          // Delete the consumed history messages (keep DB light as requested)
          try {
            // Keep only the latest 100 messages per conversation
            await pool.query(
              `DELETE FROM message_logs 
               WHERE conversation_id = $1 
                 AND id IN (
                   SELECT id FROM message_logs 
                   WHERE conversation_id = $1 
                   ORDER BY created_at DESC 
                   OFFSET 100
                 )`,
              [conversationId]
            );
          } catch (delErr) {
            log.warn('Failed to delete consumed history messages', { error: String(delErr), count: historyIds.length });
          }

          // Update ManyChat mapping
          if (subscriber_id) {
            try {
              const { upsertManychatMapping } = await import('../repositories/manychat.repo.js');
              await upsertManychatMapping(sanitizedMerchantId, sanitizedUsername, subscriber_id);
            } catch (mappingError) {
              log.warn('⚠️ ManyChat mapping failed', { error: String(mappingError) });
            }
          }

          // Learning: track interaction outcome (reply sent) with quality/thinking signals
          try {
            const { SelfLearningSystem } = await import('../services/learning-analytics.js');
            const learner = new SelfLearningSystem();
            const strategies: string[] = [];
            if (Array.isArray(decisionPath) && decisionPath.some(d => String(d).startsWith('thinking='))) strategies.push('extended-thinking');
            if (typeof qualityImproved === 'boolean') strategies.push('constitutional-ai');
            await learner.trackConversationOutcome(conversationId, {
              type: 'REPLY_SENT',
              converted: false,
              satisfaction: undefined,
              qualityScore: typeof qualityScore === 'number' ? qualityScore : undefined,
              strategiesUsed: strategies,
              stage,
              intent: aiIntent || undefined,
              metadata: { has_kb: !!kbSource, steps: decisionPath?.length || 0 }
            });
          } catch (learnErr) {
            log.warn('Learning analytics tracking failed', { error: String(learnErr) });
          }

          const processingTime = Date.now() - processingStartTime;
          log.info('✅ ManyChat message processed successfully', {
            conversationId,
            username: sanitizedUsername,
            responseLength: aiResponse.length,
            processingTime
          });

          // 📊 Record telemetry
          telemetry.recordMetaRequest('instagram', 'manychat_processed', 200, processingTime);

          // 🎯 PRODUCTION: Return ManyChat-compatible response (JSON v2 content only)
          // Build ManyChat attributes with optional quality/thinking metadata
          const attrs: Record<string, unknown> = {
            ai_reply: aiResponse ?? 'AI_ERROR',
            intent: aiIntent ?? null,
            conversation_id: conversationId,
            processing_time: processingTime,
          };
          try {
            if (typeof qualityScore === 'number') attrs['quality_score'] = Math.round(qualityScore);
            if (typeof qualityImproved === 'boolean') attrs['quality_improved'] = qualityImproved;
            if (typeof qualityDelta === 'number') attrs['quality_delta'] = Math.round(qualityDelta);
          } catch {}
          try {
            const t = thinkingMeta;
            if (t) {
              attrs['thinking_enabled'] = true;
              attrs['thinking_steps'] = Array.isArray(t.steps) ? t.steps.length : 0;
              if (typeof t.overallConfidence === 'number') attrs['thinking_confidence'] = Math.round((t.overallConfidence || 0) * 100);
              if (typeof t.summary === 'string') attrs['thinking_summary'] = String(t.summary).slice(0, 240);
            }
          } catch {}

          return c.json({
            version: 'v2',
            messages: [{ type: 'text', text: aiResponse ?? 'تعذر توليد رد.' }],
            set_attributes: attrs,
          });

        } catch (error) {
          log.error('❌ ManyChat message processing failed', error);
          telemetry.recordMetaRequest('instagram', 'manychat_error', 500, Date.now() - processingStartTime);
          
          return c.json({
            version: "v2",
            messages: [{ type: "text", text: "عذراً، حدث خطأ مؤقت. يرجى المحاولة مرة أخرى." }],
            set_attributes: { ai_reply: "processing_error" }
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

  // ===============================================
  // ManyChat Test Endpoint
  // ===============================================
  
  app.post('/api/test/manychat', async (c) => {
    try {
      const body = await c.req.json();
      const { merchantId, customerId, message } = body;
      
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


