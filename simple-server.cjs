const http = require('http');
const crypto = require('crypto');
const url = require('url');

// Environment variables
const PORT = process.env.PORT || 3000;
const IG_VERIFY_TOKEN = process.env.IG_VERIFY_TOKEN || 'test_token_123';
const META_APP_SECRET = process.env.META_APP_SECRET || 'test_secret_123';

console.log('🔧 Environment:');
console.log('  IG_VERIFY_TOKEN:', IG_VERIFY_TOKEN);
console.log('  META_APP_SECRET:', META_APP_SECRET ? '[SET]' : '[NOT SET]');

// Security headers for API-only CSP
function setSecurityHeaders(res) {
  res.setHeader('Content-Security-Policy', 
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; connect-src 'self' https://graph.facebook.com https://graph.instagram.com https://api.openai.com");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Note: X-XSS-Protection removed (deprecated as of 2025)
  // Note: HSTS only in production over HTTPS
}

// HMAC signature verification
function verifySignature(body, signature) {
  if (!signature || !signature.startsWith('sha256=')) {
    return false;
  }
  
  const providedSignature = signature.replace('sha256=', '');
  const expectedSignature = crypto
    .createHmac('sha256', META_APP_SECRET)
    .update(body, 'utf8')
    .digest('hex');
  
  try {
    return crypto.timingSafeEqual(
      Buffer.from(providedSignature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch (error) {
    return false;
  }
}

// Parse request body
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// Server
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const method = req.method;
  const pathname = parsedUrl.pathname;
  
  // Set security headers
  setSecurityHeaders(res);
  
  console.log(`${method} ${pathname}`);
  
  try {
    // Health endpoint
    if (pathname === '/health' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        server: 'simple-test-server'
      }));
      return;
    }
    
    // Instagram webhook verification (GET)
    if (pathname === '/webhooks/instagram' && method === 'GET') {
      const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = parsedUrl.query;
      
      console.log('🔍 Instagram webhook verification:', { mode, token, challenge });
      
      if (mode !== 'subscribe') {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid hub mode');
        return;
      }
      
      if (token !== IG_VERIFY_TOKEN) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Invalid verify token');
        return;
      }
      
      console.log('✅ Verification successful, returning challenge:', challenge);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(challenge);
      return;
    }
    
    // Instagram webhook events (POST)
    if (pathname === '/webhooks/instagram' && method === 'POST') {
      const body = await parseBody(req);
      const signature = req.headers['x-hub-signature-256'];
      
      console.log('📨 Instagram webhook event:');
      console.log('  Body:', body);
      console.log('  Signature:', signature);
      
      if (!signature) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing signature');
        return;
      }
      
      const isValidSignature = verifySignature(body, signature);
      console.log('  Signature valid:', isValidSignature);
      
      if (!isValidSignature) {
        res.writeHead(401, { 'Content-Type': 'text/plain' });
        res.end('Invalid signature');
        return;
      }
      
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('EVENT_RECEIVED');
      return;
    }
    
    // WhatsApp send endpoint (24h policy check)
    if (pathname === '/api/whatsapp/send' && method === 'POST') {
      const body = await parseBody(req);
      let payload;
      
      try {
        payload = JSON.parse(body);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }
      
      console.log('📱 WhatsApp send request:', payload);
      
      // Simulate 24h policy: reject free-form messages (no template)
      if (!payload.template && !payload.templateName) {
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          error: 'TEMPLATE_REQUIRED',
          message: 'Outside 24h window: template required',
          code: 'POLICY_VIOLATION'
        }));
        return;
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, messageId: 'test_123' }));
      return;
    }
    
    // Meta diagnostics endpoint
    if (pathname === '/internal/diagnostics/meta-ping' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        api_version: 'v23.0',
        rate_limit_headers: {
          'X-App-Usage': 'Simulated: {"call_count":45,"total_cputime":25,"total_time":15}',
          'X-Business-Use-Case-Usage': 'Simulated: {"123456": [{"type":"messaging","call_count":30}]}'
        },
        backoff_logic: 'Exponential backoff with jitter when usage > 90%',
        status: 'Graph API v23.0 ready'
      }));
      return;
    }
    
    // 404 for everything else
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    
  } catch (error) {
    console.error('❌ Server error:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Test server running on http://localhost:${PORT}`);
  console.log('📋 Available endpoints:');
  console.log('  GET  /health');
  console.log('  GET  /webhooks/instagram (verification)');
  console.log('  POST /webhooks/instagram (events)');
  console.log('  POST /api/whatsapp/send');
  console.log('  GET  /internal/diagnostics/meta-ping');
});