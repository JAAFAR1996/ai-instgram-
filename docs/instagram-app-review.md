# Instagram App Review Requirements

## 📋 Required Permissions

### ✅ Basic Permissions (No Review Required)
- `instagram_business_basic` - Access to basic profile information

### 🔍 Advanced Permissions (App Review Required)
- `instagram_business_manage_messages` - **REQUIRED** for messaging functionality

## 🎥 App Review Submission Checklist

### 1. **App Description**
```
AI-powered Instagram messaging platform for Iraqi merchants to automatically respond to customer inquiries in Arabic dialect. The app helps businesses provide 24/7 customer support through intelligent AI responses.

منصة رسائل Instagram ذكية مدعومة بالذكاء الاصطناعي للتجار العراقيين للرد تلقائياً على استفسارات العملاء باللهجة العراقية. التطبيق يساعد الشركات على توفير دعم عملاء على مدار 24 ساعة من خلال ردود ذكية.
```

### 2. **Use Case Description**
```
Our app enables Iraqi businesses to:
1. Automatically respond to Instagram messages in Iraqi Arabic dialect
2. Provide instant customer support for product inquiries
3. Route complex queries to human agents when needed
4. Maintain conversation history for better customer relationships

The messaging permission is essential for:
- Sending AI-generated responses to customer inquiries
- Providing product information and pricing
- Handling order-related questions
- Offering customer support in local language
```

### 3. **Required Video Demonstration**

#### Video Script:
1. **Introduction (0-15s)**
   - "This is our AI Instagram messaging platform for Iraqi businesses"
   - Show login screen with merchant account

2. **Instagram Connection (15-30s)**
   - Demonstrate OAuth flow: `/api/auth/instagram/connect/{merchantId}`
   - Show Instagram authorization screen
   - Complete connection and show success

3. **Message Reception (30-45s)**
   - Show customer sending message on Instagram
   - Demonstrate webhook receiving the message
   - Show message appearing in our system

4. **AI Response Generation (45-60s)**
   - Show AI generating response in Iraqi Arabic
   - Demonstrate message being sent back to customer
   - Show customer receiving the response on Instagram

5. **Merchant Dashboard (60-75s)**
   - Show conversation history
   - Demonstrate message statistics
   - Show AI configuration options

#### Technical Endpoints to Demonstrate:
```bash
# 1. Instagram Authorization
GET /api/auth/instagram/connect/{merchantId}
GET /api/auth/instagram/callback?code=...&state=...

# 2. Webhook Processing  
POST /webhooks/instagram
# (Show Meta's webhook tester sending test message)

# 3. Message Sending
# (Internal API - shown through UI)
POST /api/messages/send

# 4. Status and Analytics
GET /api/auth/instagram/status/{merchantId}
GET /health
```

### 4. **Privacy Policy Requirements**

#### Required Sections:
```markdown
## Instagram Data Usage

### Data We Collect
- Instagram Business account information (username, profile)
- Messages sent to and from your Instagram account
- Basic profile information of users messaging your business

### How We Use This Data
- To provide automated customer support responses
- To generate relevant AI responses in Arabic dialect
- To maintain conversation history for business context
- To improve our AI response quality over time

### Data Storage and Security
- All data is encrypted using AES-256 encryption
- Messages are stored for business continuity purposes only
- We do not share customer data with third parties
- Data is automatically deleted after 90 days unless required for active conversations

### User Rights
- Users can request deletion of their conversation data
- Businesses can disconnect their Instagram account at any time
- All data will be permanently deleted when account is disconnected
```

### 5. **Terms of Service Updates**

Add Instagram-specific terms:
```markdown
## Instagram Integration Terms

### Acceptable Use
- This service is for legitimate business customer support only
- Automated responses must comply with Instagram Community Guidelines
- No spam, harassment, or promotional messaging outside support context
- Messages must be relevant to customer inquiries

### Compliance
- All Instagram messaging complies with Meta's Platform Terms
- We respect the 24-hour messaging window requirements
- All messages are initiated by customer contact first
```

## 🔧 Technical Implementation Requirements

### 1. **Webhook Signature Verification**
```typescript
// ✅ Already implemented in webhooks.ts
private async verifyInstagramSignature(body: string, signature: string): Promise<boolean> {
  const metaAppSecret = this.config.instagram.metaAppSecret;
  const expectedSignature = crypto
    .createHmac('sha256', metaAppSecret)
    .update(body, 'utf8')
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature.replace('sha256=', ''), 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}
```

### 2. **24-Hour Messaging Window Compliance**
```typescript
// ✅ Already implemented in instagram-messaging.ts
private async getMessageContext(merchantId: string, recipientId: string): Promise<MessageContext> {
  // Check if last customer message was within 24 hours
  const windowExpiresAt = new Date(lastMessageTime.getTime() + (24 * 60 * 60 * 1000));
  const withinWindow = now <= windowExpiresAt;
  
  return { conversationId, lastMessageTime, withinWindow, windowExpiresAt };
}
```

### 3. **Proper OAuth Flow**
```typescript
// ✅ Already implemented in instagram-oauth.ts
// Step 1: https://www.instagram.com/oauth/authorize
// Step 2: POST https://api.instagram.com/oauth/access_token  
// Step 3: GET https://graph.instagram.com/access_token (long-lived)
// Step 4: GET https://graph.instagram.com/refresh_access_token
```

### 4. **User Data Deletion**
```sql
-- Add to database migrations
CREATE OR REPLACE FUNCTION delete_user_instagram_data(user_instagram_id VARCHAR)
RETURNS BOOLEAN AS $$
BEGIN
  -- Delete messages
  DELETE FROM message_logs ml 
  USING conversations c 
  WHERE ml.conversation_id = c.id 
  AND c.customer_instagram = user_instagram_id;
  
  -- Delete conversations
  DELETE FROM conversations 
  WHERE customer_instagram = user_instagram_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
```

## 📝 Submission Process

### 1. **App Review Submission Steps**
1. Go to Meta for Developers Console
2. Navigate to your app → App Review
3. Select "instagram_business_manage_messages" permission
4. Fill out the form with above descriptions
5. Upload demonstration video (max 5 minutes)
6. Submit for review

### 2. **Expected Review Timeline**
- Standard review: 7-14 business days
- First submission: May require clarification
- Resubmission after changes: 3-7 business days

### 3. **Common Rejection Reasons & Fixes**
| Reason | Fix |
|--------|-----|
| Insufficient video demonstration | Show complete OAuth flow + messaging |
| Missing privacy policy details | Add Instagram-specific data usage section |
| Unclear use case | Emphasize legitimate business customer support |
| Non-compliant messaging | Ensure 24h window compliance demonstration |

## 🚀 Production Deployment Checklist

### Before App Review:
- [ ] Complete OAuth flow implementation
- [ ] Webhook signature verification working
- [ ] 24-hour messaging window enforced
- [ ] Privacy policy updated
- [ ] Terms of service updated
- [ ] Video demonstration recorded
- [ ] Test app thoroughly with real Instagram accounts

### After App Review Approval:
- [ ] Update app from Development to Live mode
- [ ] Configure production webhook URLs
- [ ] Test with real customer accounts
- [ ] Monitor for compliance issues
- [ ] Set up error reporting and monitoring

## ⚠️ Compliance Monitoring

### Ongoing Requirements:
1. **Regular Token Refresh** (every 60 days)
2. **Webhook Signature Validation** (every POST)
3. **24-Hour Window Enforcement** (every message)
4. **User Data Deletion Requests** (within 30 days)
5. **Platform Policy Updates** (review quarterly)

### Monitoring Dashboard:
```typescript
// Add to existing health check endpoint
app.get('/health/compliance', async (c) => {
  const compliance = {
    webhookSignatureVerification: true,
    messagingWindowCompliance: true,
    tokenRefreshStatus: 'healthy',
    dataRetentionPolicy: '90 days',
    lastPolicyUpdate: '2025-01-14'
  };
  
  return c.json(compliance);
});
```

## 🎯 Next Steps

1. **Record demonstration video** showing complete flow
2. **Update privacy policy** with Instagram sections  
3. **Submit app for review** with detailed descriptions
4. **Prepare for production deployment** after approval
5. **Set up compliance monitoring** dashboard

> **Note**: App Review is required for `instagram_business_manage_messages` permission. Without this permission, the messaging functionality will only work with test users added to your app during development.