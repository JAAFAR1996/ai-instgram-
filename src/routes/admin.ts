/**
 * ===============================================
 * Simple Admin UI + API for Merchant Onboarding
 * Protected with Basic Auth (ADMIN_USER / ADMIN_PASS)
 * ===============================================
 */

import { Hono } from 'hono';
import { getLogger } from '../services/logger.js';
import { getDatabase } from '../db/adapter.js';
import { z } from 'zod';
import { getCache } from '../cache/index.js';
import * as jwt from 'jsonwebtoken';

const log = getLogger({ component: 'admin-routes' });

function requireAdminAuth(req: Request): void {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Basic ')) throw new Error('Unauthorized');
  const creds = Buffer.from(auth.slice(6), 'base64').toString('utf8');
  const [user, pass] = creds.split(':');
  const ADMIN_USER = process.env.ADMIN_USER || 'admin';
  const ADMIN_PASS = process.env.ADMIN_PASS || '';
  if (!ADMIN_PASS) throw new Error('Admin not configured');
  if (user !== ADMIN_USER || pass !== ADMIN_PASS) throw new Error('Unauthorized');
}

const CreateMerchantSchema = z.object({
  business_name: z.string().min(2).max(255),
  business_category: z.string().min(2).max(100).optional().default('general'),
  whatsapp_number: z.string().min(6).max(20),
  instagram_username: z.string().min(0).max(100).optional().default(''),
  email: z.string().email().optional(),
  currency: z.string().length(3).optional().default('IQD'),
  settings: z.record(z.any()).optional(),
  ai_config: z.record(z.any()).optional()
}).strict();

const SettingsPatchSchema = z.object({
  payment_methods: z.array(z.string().min(1).max(40)).max(10).optional(),
  delivery_fees: z.record(z.union([z.string(), z.number()])).optional(),
  working_hours: z.any().optional(),
  auto_responses: z.record(z.string()).optional()
}).strict();

const AIConfigPatchSchema = z.object({
  model: z.string().min(2).max(120).optional(),
  temperature: z.number().min(0).max(1).optional(),
  maxTokens: z.number().int().min(50).max(1000).optional(),
  language: z.string().min(2).max(10).optional()
}).strict();

export function registerAdminRoutes(app: Hono) {
  const db = getDatabase();
  const sql = db.getSQL();
  const cache = getCache();

  async function invalidate(merchantId: string) {
    try {
      await cache.delete(`merchant:ctx:${merchantId}`, { prefix: 'ctx' });
      await cache.delete(`merchant:cats:${merchantId}`, { prefix: 'ctx' });
    } catch (e) {
      log.warn('Cache invalidation failed', { merchantId, error: String(e) });
    }
  }

  // Admin UI (very small HTML form page)
  app.get('/admin', async (c) => {
    try {
      requireAdminAuth(c.req.raw);
    } catch (e) {
      return c.text('Unauthorized', 401, { 'WWW-Authenticate': 'Basic realm="admin"' });
    }

    const html = `<!doctype html>
<meta charset="utf-8" />
<title>Merchant Admin</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:900px;margin:40px auto;padding:0 16px;color:#222}
  h1,h2{margin:16px 0}
  form{border:1px solid #ddd;padding:16px;border-radius:8px;margin:16px 0}
  label{display:block;margin:8px 0 4px}
  input,select,textarea{width:100%;padding:8px;border:1px solid #ccc;border-radius:6px}
  button{padding:10px 14px;border:0;border-radius:6px;background:#1f6feb;color:#fff;cursor:pointer}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .mono{font-family:ui-monospace,Consolas,monospace;background:#f6f8fa;padding:8px;border-radius:6px}
  small{color:#555}
  .ok{color:#116329}
  .err{color:#d73a49}
  .card{background:#fff;border:1px solid #eaecef;border-radius:8px;padding:12px}
  .section{margin:24px 0}
  .muted{color:#666}
</style>
<h1>Merchant Admin</h1>

<div class="section">
  <h2>1) Create Merchant</h2>
  <form id="createForm">
    <div class="row">
      <div>
        <label>Business Name</label>
        <input name="business_name" required />
      </div>
      <div>
        <label>Business Category</label>
        <input name="business_category" value="general" />
      </div>
    </div>
    <div class="row">
      <div>
        <label>WhatsApp Number</label>
        <input name="whatsapp_number" required />
      </div>
      <div>
        <label>Instagram Username</label>
        <input name="instagram_username" />
      </div>
    </div>
    <div class="row">
      <div>
        <label>Email</label>
        <input name="email" type="email" />
      </div>
      <div>
        <label>Currency</label>
        <input name="currency" value="IQD" />
      </div>
    </div>
    <label>Settings (JSON optional)</label>
    <textarea name="settings" rows="4" placeholder='{"payment_methods":["COD"],"delivery_fees":{"inside_baghdad":0}}'></textarea>
    <label>AI Config (JSON optional)</label>
    <textarea name="ai_config" rows="3" placeholder='{"model":"gpt-4o-mini","temperature":0.3,"maxTokens":200}'></textarea>
    <button type="submit">Create</button>
    <div id="createOut" class="muted"></div>
  </form>
</div>

<div class="section card">
  <h2>2) Generate Merchant JWT</h2>
  <form id="jwtForm">
    <label>Merchant ID (UUID)</label>
    <input name="merchant_id" required />
    <button type="submit">Generate JWT</button>
    <div id="jwtOut" class="mono"></div>
    <small>Header: Authorization: Bearer &lt;token&gt;</small>
  </form>
</div>

<div class="section">
  <h2>3) Update Settings / AI / Currency</h2>
  <form id="patchForm">
    <label>Merchant ID (UUID)</label>
    <input name="merchant_id" required />
    <label>Patch Type</label>
    <select name="type">
      <option value="settings">settings</option>
      <option value="ai-config">ai-config</option>
      <option value="currency">currency</option>
    </select>
    <label>Payload (JSON or {"currency":"IQD"})</label>
    <textarea name="payload" rows="4"></textarea>
    <button type="submit">Apply Patch</button>
    <div id="patchOut" class="muted"></div>
  </form>
</div>

<script>
async function post(path, body) {
  const res = await fetch(path, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  return res.json();
}
async function patch(path, body) {
  const res = await fetch(path, {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  return res.json();
}
const out = (id, html) => document.getElementById(id).innerHTML = html;

document.getElementById('createForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries(fd.entries());
  try { if (body.settings) body.settings = JSON.parse(body.settings); else delete body.settings; } catch { alert('Invalid settings JSON'); return; }
  try { if (body.ai_config) body.ai_config = JSON.parse(body.ai_config); else delete body.ai_config; } catch { alert('Invalid ai_config JSON'); return; }
  const res = await post('/admin/api/merchants', body);
  out('createOut', res.ok ? '<span class="ok">Created</span>: ' + res.id : '<span class="err">Error</span>: ' + (res.error||'failed'));
});

document.getElementById('jwtForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const res = await post('/admin/api/merchants/'+fd.get('merchant_id')+'/jwt', {});
  out('jwtOut', res.ok ? res.token : (res.error||'failed'));
});

document.getElementById('patchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const id = fd.get('merchant_id');
  const type = fd.get('type');
  let payload = {};
  try { payload = JSON.parse(fd.get('payload')); } catch { alert('Invalid JSON payload'); return; }
  const res = await patch('/admin/api/merchants/'+id+'/'+type, payload);
  out('patchOut', res.ok ? '<span class="ok">Updated</span>' : '<span class="err">Error</span>: ' + (res.error||'failed'));
});
</script>`;

    return c.html(html);
  });

  // Create merchant
  app.post('/admin/api/merchants', async (c) => {
    try {
      try { requireAdminAuth(c.req.raw); } catch { return c.json({ ok:false, error:'unauthorized' }, 401); }
      const body = await c.req.json();
      const parsed = CreateMerchantSchema.safeParse(body);
      if (!parsed.success) return c.json({ ok:false, error:'validation_error', details: parsed.error.issues }, 400);
      const d = parsed.data;

      const rows = await sql<{ id: string }>`
        INSERT INTO merchants (
          business_name, business_category, whatsapp_number, instagram_username, email, currency, settings, last_activity_at
        ) VALUES (
          ${d.business_name}, ${d.business_category}, ${d.whatsapp_number}, ${d.instagram_username || null}, ${d.email || null}, ${d.currency?.toUpperCase() || 'IQD'}, ${JSON.stringify(d.settings || {})}::jsonb, NOW()
        )
        ON CONFLICT (whatsapp_number) DO UPDATE SET business_name = EXCLUDED.business_name
        RETURNING id
      `;

      if (d.ai_config) {
        await sql`UPDATE merchants SET ai_config = ${JSON.stringify(d.ai_config)}::jsonb WHERE id = ${rows[0]!.id}::uuid`;
      }

      await invalidate(rows[0]!.id);
      return c.json({ ok: true, id: rows[0]!.id });
    } catch (error) {
      log.error('Create merchant failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  // Generate JWT for merchant
  app.post('/admin/api/merchants/:id/jwt', async (c) => {
    try {
      try { requireAdminAuth(c.req.raw); } catch { return c.json({ ok:false, error:'unauthorized' }, 401); }
      const merchantId = c.req.param('id');
      const secret = process.env.JWT_SECRET;
      if (!secret) return c.json({ ok:false, error:'missing_jwt_secret' }, 500);
      const token = jwt.sign({ merchantId }, secret, { expiresIn: '365d' });
      return c.json({ ok: true, token });
    } catch (error) {
      log.error('Generate merchant JWT failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  // Patch settings
  app.patch('/admin/api/merchants/:id/settings', async (c) => {
    try {
      try { requireAdminAuth(c.req.raw); } catch { return c.json({ ok:false, error:'unauthorized' }, 401); }
      const merchantId = c.req.param('id');
      const body = await c.req.json();
      const parsed = SettingsPatchSchema.safeParse(body);
      if (!parsed.success) return c.json({ ok:false, error:'validation_error', details: parsed.error.issues }, 400);
      const patch = parsed.data;
      await sql`UPDATE merchants SET settings = COALESCE(settings,'{}'::jsonb) || ${JSON.stringify(patch)}::jsonb, updated_at = NOW() WHERE id = ${merchantId}::uuid`;
      await invalidate(merchantId);
      return c.json({ ok: true });
    } catch (error) {
      log.error('Patch merchant settings failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  // Patch AI config
  app.patch('/admin/api/merchants/:id/ai-config', async (c) => {
    try {
      try { requireAdminAuth(c.req.raw); } catch { return c.json({ ok:false, error:'unauthorized' }, 401); }
      const merchantId = c.req.param('id');
      const body = await c.req.json();
      const parsed = AIConfigPatchSchema.safeParse(body);
      if (!parsed.success) return c.json({ ok:false, error:'validation_error', details: parsed.error.issues }, 400);
      const patch = parsed.data;
      await sql`UPDATE merchants SET ai_config = COALESCE(ai_config,'{}'::jsonb) || ${JSON.stringify(patch)}::jsonb, updated_at = NOW() WHERE id = ${merchantId}::uuid`;
      await invalidate(merchantId);
      return c.json({ ok: true });
    } catch (error) {
      log.error('Patch merchant ai_config failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });

  // Patch currency
  app.patch('/admin/api/merchants/:id/currency', async (c) => {
    try {
      try { requireAdminAuth(c.req.raw); } catch { return c.json({ ok:false, error:'unauthorized' }, 401); }
      const merchantId = c.req.param('id');
      const body = await c.req.json();
      const currency = typeof body?.currency === 'string' ? String(body.currency).toUpperCase() : '';
      if (!/^\w{3}$/.test(currency)) return c.json({ ok:false, error:'invalid_currency' }, 400);
      await sql`UPDATE merchants SET currency = ${currency}, updated_at = NOW() WHERE id = ${merchantId}::uuid`;
      await invalidate(merchantId);
      return c.json({ ok: true, currency });
    } catch (error) {
      log.error('Patch merchant currency failed', { error: String(error) });
      return c.json({ ok: false, error: 'internal_error' }, 500);
    }
  });
}

export default registerAdminRoutes;

