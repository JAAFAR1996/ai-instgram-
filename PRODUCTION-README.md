# 🚀 AI Sales Platform - Production Deployment Guide

## 📋 Environment Variables Setup

All production environment variables have been configured in `.env.production`:

### ✅ **Required Variables (All Set)**
- `NODE_ENV=production`
- `META_APP_SECRET` - Facebook/Meta app secret
- `IG_VERIFY_TOKEN` - Instagram webhook verification token
- `OPENAI_API_KEY` - OpenAI API key for AI features
- `DATABASE_URL` - PostgreSQL production database
- `ENCRYPTION_KEY` - AES-256 encryption key
- `JWT_SECRET` - JWT signing secret (must be set separately; no fallback to ENCRYPTION_KEY) (must be set separately; no fallback to ENCRYPTION_KEY)

### 📱 **Platform Configuration**
- **Instagram Business Account ID**: `17841405545604018`
- **Meta App ID**: `1086023127068503`
- **Page ID**: `772043875986598`
- **Webhook URL**: `https://ai-instgram.onrender.com/webhooks/instagram`

### 🗄️ **Database Configuration**
- **PostgreSQL**: Configured with SSL enabled
- **Credentials Required**: You must explicitly set database host, user, and `DB_PASSWORD` in environment variables; the application will exit if credentials are missing.
- **Connection Pool**: 5-20 connections
- **Redis**: Configured for caching

### 🔒 **Security Features Enabled**
- CORS protection
- Rate limiting (100 requests/user/hour)
- HMAC-SHA256 webhook verification
- AES-256-GCM encryption
- JWT authentication

## 🔍 **Validation Commands**

```bash
# Check all environment variables
npm run check-env

# Check production environment specifically  
npm run check-env:prod
```

## 🚀 **Deployment Steps**

1. **Verify Environment**:
   ```bash
   npm run check-env
   ```

2. **Build Application**:
   ```bash
   npm run build
   ```

3. **Start Production Server**:
   ```bash
   npm run start:production
   ```

## 📡 **Available Endpoints**

- `GET /health` - Health check
- `GET /webhooks/instagram` - Instagram webhook verification
- `POST /webhooks/instagram` - Instagram webhook events
- `POST /api/whatsapp/send` - WhatsApp message sending
- `GET /internal/diagnostics/meta-ping` - Meta API diagnostics

## 🔧 **Production Features**

### **Instagram Integration**
- ✅ Webhook verification with HMAC-SHA256
- ✅ DM processing with 24h window
- ✅ Story replies and mentions
- ✅ Comment management
- ✅ OAuth 2.0 flow

### **WhatsApp Integration**  
- ✅ Business API integration
- ✅ 24-hour policy enforcement
- ✅ Template message support
- ✅ Media handling

### **AI Features**
- ✅ OpenAI GPT-4o-mini integration
- ✅ Iraqi Arabic conversation support
- ✅ Context-aware responses
- ✅ Intent recognition

### **Security & Compliance**
- ✅ Meta Graph API v23.0 compliant
- ✅ HMAC-SHA256 signature verification
- ✅ Rate limiting (200 calls/user/hour)
- ✅ Content Security Policy (no unsafe-inline)
- ✅ HTTPS enforcement in production

## 📊 **Monitoring**

The application includes comprehensive monitoring:
- Health checks on `/health`
- Meta API diagnostics on `/internal/diagnostics/meta-ping`
- Structured logging to `/app/logs/app.log`
- Metrics collection (if enabled)

## ⚠️ **Important Notes**

1. **Never commit `.env.production`** to git (it contains secrets)
2. **Instagram Access Token** may need periodic refresh
3. **WhatsApp tokens** are set to placeholder values - update as needed
4. **Database SSL** is enabled for production security
 5. **CORS** is restricted to `https://ai-instgram.onrender.com`
+6. **Set `REDIS_PASSWORD`** in your environment before deployment

## 🆘 **Troubleshooting**

### Environment Issues
```bash
# Check if all required vars are set
npm run check-env

# View current environment
echo $NODE_ENV
```

### Webhook Issues
```bash
# Test Instagram webhook verification
curl "https://ai-instgram.onrender.com/webhooks/instagram?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=test"

# Check webhook URL in Meta Developer Console
```

### Database Issues
```bash
# Check database connectivity in application logs
# Verify DATABASE_URL format
# Ensure SSL is supported by database provider
```

---

**🎯 Status**: Ready for production deployment with all required configurations in place!