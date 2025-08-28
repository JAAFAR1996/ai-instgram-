# ManyChat Environment Variables Example

Copy these variables to your `.env` file:

```env
# ===============================================
# ManyChat Integration Configuration
# ===============================================

# ManyChat API Configuration
MANYCHAT_API_KEY=your_manychat_api_key_here
MANYCHAT_BASE_URL=https://api.manychat.com
MANYCHAT_WEBHOOK_SECRET=your_webhook_secret_here

# ManyChat Flow IDs (Optional but recommended)
MANYCHAT_DEFAULT_FLOW_ID=your_default_flow_id
MANYCHAT_WELCOME_FLOW_ID=your_welcome_flow_id
MANYCHAT_AI_RESPONSE_FLOW_ID=your_ai_response_flow_id
MANYCHAT_COMMENT_RESPONSE_FLOW_ID=your_comment_response_flow_id
MANYCHAT_STORY_RESPONSE_FLOW_ID=your_story_response_flow_id

# ManyChat Rate Limiting (Advanced)
MANYCHAT_RATE_LIMIT_RPS=10
MANYCHAT_RATE_LIMIT_WINDOW_MS=1000

# ManyChat Retry Configuration (Advanced)
MANYCHAT_MAX_RETRIES=3
MANYCHAT_RETRY_DELAY_MS=1000

# ManyChat Circuit Breaker (Advanced)
MANYCHAT_FAILURE_THRESHOLD=5
MANYCHAT_RESET_TIMEOUT_MS=30000

# ManyChat Cache Configuration (Advanced)
MANYCHAT_CREDENTIALS_CACHE_TTL_MS=3600000
MANYCHAT_SUBSCRIBER_CACHE_TTL_MS=1800000
```

## How to get these values:

### 1. MANYCHAT_API_KEY
- Go to ManyChat Dashboard
- Navigate to Settings > API
- Copy your API Key

### 2. MANYCHAT_FLOW_IDS
- Go to ManyChat Dashboard
- Navigate to Flows
- Create or select your flows
- Copy the Flow IDs from the URL or flow settings

### 3. MANYCHAT_WEBHOOK_SECRET
- Create a secure random string
- Use for webhook signature verification
- Recommended: 32+ characters

## Required vs Optional:

**Required:**
- `MANYCHAT_API_KEY` - Must be set for ManyChat integration to work

**Optional but Recommended:**
- `MANYCHAT_DEFAULT_FLOW_ID` - Default flow for AI responses
- `MANYCHAT_WELCOME_FLOW_ID` - Flow for new subscribers
- `MANYCHAT_WEBHOOK_SECRET` - For webhook security

**Advanced (Optional):**
- All other variables have sensible defaults
- Only change if you need custom rate limiting or retry behavior
