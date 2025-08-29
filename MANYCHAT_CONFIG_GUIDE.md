# ManyChat Integration Setup Guide
# دليل تكوين ManyChat

## Required ManyChat Configuration
## التكوين المطلوب لـ ManyChat

To complete the ManyChat integration, you need to create Flows in your ManyChat Dashboard and add the following environment variables:

### 1. Environment Variables Required
```env
MANYCHAT_API_KEY=your_actual_api_key_from_manychat
MANYCHAT_DEFAULT_FLOW_ID=content20241101001122334
MANYCHAT_WELCOME_FLOW_ID=content20241101001122335  
MANYCHAT_AI_RESPONSE_FLOW_ID=content20241101001122336
MANYCHAT_WEBHOOK_SECRET=your_webhook_secret_from_manychat
```

### 2. How to Get Flow IDs from ManyChat

#### Step 1: Login to ManyChat Dashboard
- Go to https://manychat.com/
- Login to your account

#### Step 2: Create Required Flows
You need to create 3 flows:

1. **Default Flow** - Handles general interactions
2. **Welcome Flow** - For new subscribers  
3. **AI Response Flow** - For AI-generated responses

#### Step 3: Get Flow IDs
1. In ManyChat Dashboard, go to "Flows"
2. Click on each flow you created
3. Look at the URL - the Flow ID is in the format `content20241101001122334`
4. Copy each Flow ID to the corresponding environment variable

### 3. API Key Setup

1. Go to ManyChat Dashboard → Settings → API
2. Generate new API Key
3. Copy the key to `MANYCHAT_API_KEY`

### 4. Webhook Secret Setup

1. Go to ManyChat Dashboard → Settings → Webhooks  
2. Create or view webhook configuration
3. Copy the secret to `MANYCHAT_WEBHOOK_SECRET`

## Current System Status
## حالة النظام الحالية

✅ **Working without ManyChat**: System works with Local AI fallback
✅ **Database fixed**: All constraint issues resolved
✅ **Queue system**: Working properly
⚠️ **ManyChat Integration**: Needs proper Flow IDs to complete

## Deployment Instructions
## تعليمات النشر

1. Add all ManyChat environment variables to your hosting platform
2. Restart the application
3. Test the integration by sending Instagram messages

The system will automatically switch from Local AI to ManyChat once proper configuration is detected.

## Testing ManyChat Integration

Once configured, you can test by:
1. Send a message to your Instagram account
2. Check logs for ManyChat API calls
3. Verify responses come through ManyChat flows instead of Local AI

## Troubleshooting
## حل المشاكل

- **"<!DOCTYPE" error**: Invalid API key or wrong endpoint
- **Flow not found**: Check Flow IDs are correct  
- **Webhook failed**: Verify webhook secret matches
- **Falls back to Local AI**: ManyChat configuration incomplete (this is normal fallback behavior)
