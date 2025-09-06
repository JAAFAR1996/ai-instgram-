/**
 * Queue Control Routes (Admin)
 * Adds endpoints + a minimal UI to pause/resume queue processing.
 */

import { Hono } from 'hono';
import { ProductionQueueManager } from '../services/ProductionQueueManager.js';

function requireAdminAuth(req: Request): void {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Basic ')) throw new Error('Unauthorized');
  const creds = Buffer.from(auth.slice(6), 'base64').toString('utf8');
  const [user, pass] = creds.split(':');
  const ADMIN_USER = process.env.ADMIN_USER || 'admin';
  const ADMIN_PASS = process.env.ADMIN_PASS ?? '';
  if (!ADMIN_PASS) throw new Error('Admin not configured');
  if (user !== ADMIN_USER || pass !== ADMIN_PASS) throw new Error('Unauthorized');
}

export function registerQueueControlRoutes(app: Hono, deps: { queueManager: ProductionQueueManager }) {
  const { queueManager } = deps;

  // Minimal HTML UI
  app.get('/admin/queue', async (c) => {
    try { requireAdminAuth(c.req.raw); } catch { return c.text('Unauthorized', 401, { 'WWW-Authenticate': 'Basic realm="admin"' }); }

    const html = `<!doctype html>
<meta charset="utf-8" />
<title>Queue Control</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;max-width:700px;margin:40px auto;padding:0 16px;color:#222}
  button{padding:10px 14px;border:0;border-radius:6px;background:#1f6feb;color:#fff;cursor:pointer}
  .danger{background:#d73a49}
  .muted{color:#666}
  .card{background:#fff;border:1px solid #eaecef;border-radius:8px;padding:16px}
  .row{display:flex;gap:12px;align-items:center}
  .mono{font-family:ui-monospace,Consolas,monospace;background:#f6f8fa;padding:8px;border-radius:6px}
</style>
<h1>Queue Control</h1>
<div class="card">
  <div class="row">
    <div>Status: <span id="status" class="mono">loading...</span></div>
    <div>
      <button id="toggleBtn">Loading...</button>
    </div>
  </div>
  <div class="muted" id="stats"></div>
  <div id="out" class="muted" style="margin-top:8px"></div>
  <div style="margin-top:12px"><a href="/admin">← Back to Admin</a></div>
  </div>
<script>
async function getStatus(){
  const r = await fetch('/admin/api/queue/status');
  return r.json();
}
async function act(path){
  const r = await fetch(path,{method:'POST'});
  return r.json();
}
function set(el, t){ document.getElementById(el).innerText = t; }
async function refresh(){
  const s = await getStatus();
  const running = s.status === 'running';
  set('status', s.status + (s.uninitialized ? ' (not initialized)' : ''));
  const btn = document.getElementById('toggleBtn');
  btn.textContent = running ? '⏸️ Pause' : '▶️ Resume';
  btn.className = running ? 'danger' : '';
  const st = s.stats || {};
  document.getElementById('stats').innerText = 'waiting: ' + (st.waiting||0) + ', active: ' + (st.active||0) + ', failed: ' + (st.failed||0);
}
document.getElementById('toggleBtn').addEventListener('click', async () => {
  const s = await getStatus();
  const running = s.status === 'running';
  const res = await act(running ? '/admin/api/queue/pause' : '/admin/api/queue/resume');
  document.getElementById('out').innerText = res.ok ? 'OK' : ('Error: ' + (res.reason||'unknown'));
  await refresh();
});
refresh();
</script>`;

    return c.html(html);
  });

  // Status endpoint
  app.get('/admin/api/queue/status', async (c) => {
    try { requireAdminAuth(c.req.raw); } catch { return c.json({ ok:false, error:'unauthorized' }, 401); }
    const status = queueManager.getProcessingState();
    let stats = null;
    try { stats = await queueManager.getQueueStats(); } catch { /* ignore */ }
    return c.json({ ok: true, status, uninitialized: status === 'uninitialized', stats });
  });

  // Pause endpoint
  app.post('/admin/api/queue/pause', async (c) => {
    try { requireAdminAuth(c.req.raw); } catch { return c.json({ ok:false, error:'unauthorized' }, 401); }
    const r = await queueManager.pauseProcessing();
    if (!r.ok) return c.json({ ok:false, reason: r.reason }, 400);
    return c.json({ ok: true });
  });

  // Resume endpoint
  app.post('/admin/api/queue/resume', async (c) => {
    try { requireAdminAuth(c.req.raw); } catch { return c.json({ ok:false, error:'unauthorized' }, 401); }
    const r = await queueManager.resumeProcessing();
    if (!r.ok) return c.json({ ok:false, reason: r.reason }, 400);
    return c.json({ ok: true });
  });
}

export default registerQueueControlRoutes;
