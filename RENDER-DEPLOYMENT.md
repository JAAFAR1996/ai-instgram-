# 🚀 Render.com Deployment Guide

## Domain: https://ai-instgram.onrender.com

### Pre-configured Settings ✅

| Setting | Value |
|---------|--------|
| **Port** | 10000 (Render standard) |
| **Domain** | https://ai-instgram.onrender.com |
| **Database** | PostgreSQL (Render managed) |
| **Redis** | Redis (Render managed) |
| **CORS** | Enabled for production domain |

---

## 1. Environment Variables (Copy to Render Dashboard)

```env
NODE_ENV=production
PORT=10000
API_VERSION=v1

# Meta/Facebook Credentials
META_APP_SECRET=e7f6750636baccdd3bd1f8cc948b4bd9
IG_VERIFY_TOKEN=iHNDoPLa9sH8v59z5Twq+V5sVl1fzVyRzg6G9NpvjXAnF4kadaKlJKki0nmtNZpd
IG_APP_SECRET=e7f6750636baccdd3bd1f8cc948b4bd9
IG_API_VERSION=v23.0
GRAPH_API_VERSION=v23.0

# Security
JWT_SECRET=XFS9r+TWhQG6kKBiPDI5FNEeErcj7OULcIuRQ3nsFFiSCeZ51XwRSms46VOYj1p3
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d
ENCRYPTION_KEY=3fefda6b93cdd186666018e221aad68473612dfeed1416e93f2f1fc8f7202d80
BCRYPT_ROUNDS=12

# Database (Render will auto-populate)
DATABASE_URL=${DATABASE_URL}
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10
DATABASE_SSL=true

# Redis (Render will auto-populate)  
REDIS_URL=${REDIS_URL}
REDIS_POOL_MIN=2
REDIS_POOL_MAX=8
REDIS_COMMAND_TIMEOUT=5000

# AI Configuration
OPENAI_API_KEY=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
OPENAI_MODEL=gpt-4o-mini
OPENAI_MAX_TOKENS=500
OPENAI_TEMPERATURE=0.7

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=50
RATE_LIMIT_WEBHOOK_MAX=200

# Admin
ADMIN_PHONE_NUMBER=+9647716666543
ADMIN_EMAIL=jaafarhabash@yahoo.com

# CORS
CORS_ORIGINS=https://ai-instgram.onrender.com,https://graph.facebook.com,https://api.whatsapp.com
ENABLE_CORS=true

# Webhooks (Auto-configured)
INSTAGRAM_WEBHOOK_URL=https://ai-instgram.onrender.com/webhooks/instagram
WHATSAPP_WEBHOOK_URL=https://ai-instgram.onrender.com/webhooks/whatsapp

# Logging
LOG_LEVEL=info
ENABLE_SWAGGER=false
ENABLE_DEBUG_ROUTES=false
TZ=UTC

# Optional Tokens (Update when available)
WHATSAPP_ACCESS_TOKEN=YOUR_WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID=YOUR_PHONE_NUMBER_ID
INSTAGRAM_ACCESS_TOKEN=YOUR_INSTAGRAM_ACCESS_TOKEN
```

---

## 2. Render Configuration

### Build Command:
```bash
npm install --production
```

### Start Command:
```bash
node production-server.cjs
```

### Health Check URL:
```
https://ai-instgram.onrender.com/health
```

---

## 3. Required Services on Render

1. **Web Service** (Main app)
   - Repository: `https://github.com/JAAFAR1996/ai-instgram-.git`
   - Branch: `release/prod-ready`
   - Build Command: `npm install --production`
   - Start Command: `node production-server.cjs`

2. **PostgreSQL Database**
   - Name: `ai-instagram-db`
   - Auto-populated: `DATABASE_URL`

3. **Redis Instance**  
   - Name: `ai-instagram-redis`
   - Auto-populated: `REDIS_URL`

---

## 4. Webhook URLs for Meta/WhatsApp

### Instagram Webhooks:
```
https://ai-instgram.onrender.com/webhooks/instagram
```

### WhatsApp Webhooks:
```
https://ai-instgram.onrender.com/webhooks/whatsapp
```

---

## 5. Testing After Deployment

```bash
# Health Check
curl https://ai-instgram.onrender.com/health

# Instagram Webhook Test
curl -X GET "https://ai-instgram.onrender.com/webhooks/instagram?hub.mode=subscribe&hub.verify_token=iHNDoPLa9sH8v59z5Twq+V5sVl1fzVyRzg6G9NpvjXAnF4kadaKlJKki0nmtNZpd&hub.challenge=test123"

# WhatsApp Policy Test
curl -X POST https://ai-instgram.onrender.com/api/whatsapp/send \
  -H "Content-Type: application/json" \
  -d '{"to": "+1234567890", "text": "test message"}'
```

---

## 6. Post-Deployment Checklist

- [ ] Health endpoint returns 200
- [ ] Instagram webhook verification works
- [ ] WhatsApp 24h policy enforcement active
- [ ] Database connection established
- [ ] Redis connection established  
- [ ] All security headers present
- [ ] CORS configured for production domain
- [ ] Webhook URLs configured in Meta Developer Console

---

**Status:** 🟢 Ready for Render deployment  
**Domain:** https://ai-instgram.onrender.com  
**Repository:** https://github.com/JAAFAR1996/ai-instgram-.git