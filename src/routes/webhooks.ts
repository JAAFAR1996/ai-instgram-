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
    log.info('🚫 Instagram direct webhook disabled - using ManyChat flow only');
    return c.text('Gone - Using ManyChat integration only', 410);
  });

  // ManyChat webhook route - PRODUCTION with AI integration
  app.post('/webhooks/manychat', async (c) => {
    try {
      // 🔒 PRODUCTION: Bearer token authentication
      const authHeader = c.req.header('authorization');
      const expectedBearer = (getEnv('MANYCHAT_BEARER') || '').trim();
      if (expectedBearer && !authHeader?.startsWith(`Bearer ${expectedBearer}`)) {
        log.warn('❌ ManyChat webhook unauthorized', { hasAuth: !!authHeader });
        return c.json({ error: 'unauthorized' }, 401);
      }
      
      log.info('📩 ManyChat webhook received');
      const processingStartTime = Date.now();
      
      const body = await c.req.json();
      const { merchant_id, instagram_username, subscriber_id, event_type, data } = body;

      // 🛡️ PRODUCTION: Input validation and sanitization - use fallback for merchant_id
      const fallbackMerchantId = getEnv('MERCHANT_ID') || 'merchant-default-001';
      const finalMerchantId = merchant_id || fallbackMerchantId;
      
      if (!instagram_username || !finalMerchantId) {
        return c.json({ 
          ok: false, 
          error: 'instagram_username required and merchant_id missing (no fallback available)' 
        }, 400);
      }

      const sanitizedUsername = String(instagram_username).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
      const sanitizedMerchantId = String(finalMerchantId).trim();
      
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
          try {
            const existingConversations = await pool.query(`
              SELECT id FROM conversations 
              WHERE merchant_id = $1 AND customer_instagram = $2
              ORDER BY created_at DESC LIMIT 1
            `, [sanitizedMerchantId, sanitizedUsername]);
            
            if (existingConversations.rows.length > 0) {
              conversationId = existingConversations.rows[0].id;
            } else {
              const newConversation = await pool.query(`
                INSERT INTO conversations (
                  merchant_id, customer_instagram, platform, conversation_stage, 
                  session_data, message_count, created_at, updated_at
                ) VALUES ($1, $2, 'instagram', 'ACTIVE', '{}', 0, NOW(), NOW())
                RETURNING id
              `, [sanitizedMerchantId, sanitizedUsername]);
              
              conversationId = newConversation.rows[0].id;
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

          // Store incoming message
          await pool.query(`
            INSERT INTO message_history (conversation_id, content, message_type, direction, created_at)
            VALUES ($1, $2, 'TEXT', 'INCOMING', NOW())
          `, [conversationId, messageText]);

          // 🤖 PRODUCTION: Generate AI response
          let aiResponse: string;
          try {
            const { getAIService } = await import('../services/ai.js');
            const aiService = await getAIService();
            
            const aiResult = await Promise.race([
              aiService.generateResponse(messageText, {
                merchantId: sanitizedMerchantId,
                customerId: sanitizedUsername,
                platform: 'instagram',
                stage: 'GREETING',
                cart: [],
                preferences: {},
                conversationHistory: []
              }),
              new Promise<never>((_, reject) => 
                setTimeout(() => reject(new Error('AI timeout')), 30000)
              )
            ]);
            
            aiResponse = aiResult.message || 'مرحباً! شكراً لتواصلك معنا.';
            
          } catch (aiError) {
            log.error('❌ AI service failed', { error: String(aiError) });
            
            // 🛡️ Intelligent Arabic fallback based on message content
            const lowerText = messageText.toLowerCase();
            if (lowerText.includes('سعر') || lowerText.includes('price')) {
              aiResponse = 'مرحباً! سأساعدك في معرفة الأسعار. يرجى تحديد المنتج الذي تريد السؤال عنه.';
            } else if (lowerText.includes('طلب') || lowerText.includes('order')) {
              aiResponse = 'مرحباً! سأساعدك في إتمام طلبك. يرجى إرسال تفاصيل المنتجات التي تريدها.';
            } else {
              aiResponse = 'مرحباً! شكراً لتواصلك معنا. نحن هنا لمساعدتك، كيف يمكنني خدمتك؟';
            }
          }

          // Store AI response
          await pool.query(`
            INSERT INTO message_history (conversation_id, content, message_type, direction, created_at)
            VALUES ($1, $2, 'TEXT', 'OUTGOING', NOW())
          `, [conversationId, aiResponse]);

          // Update conversation stats
          await pool.query(`
            UPDATE conversations 
            SET message_count = message_count + 2, last_message_at = NOW(), updated_at = NOW()
            WHERE id = $1
          `, [conversationId]);

          // Update ManyChat mapping
          if (subscriber_id) {
            try {
              const { upsertManychatMapping } = await import('../repositories/manychat.repo.js');
              await upsertManychatMapping(sanitizedMerchantId, sanitizedUsername, subscriber_id);
            } catch (mappingError) {
              log.warn('⚠️ ManyChat mapping failed', { error: String(mappingError) });
            }
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

          // 🎯 PRODUCTION: Return ManyChat-compatible response
          return c.json({
            version: "v2",
            messages: [{ type: "text", text: aiResponse }],
            set_attributes: { 
              ai_reply: aiResponse.substring(0, 100),
              conversation_id: conversationId,
              processing_time: processingTime
            }
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
      if (finalMerchantId && instagram_username && subscriber_id) {
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

