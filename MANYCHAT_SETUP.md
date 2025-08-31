# ManyChat Integration Setup

## Instagram Username Configuration

This system now uses **Instagram usernames** instead of user IDs for better reliability and consistency.

### Required ManyChat Configuration

1. **Create Custom Field in ManyChat:**
   - Go to ManyChat Dashboard → Audience → Custom Fields
   - Create new field: `Instagram Username` (type: Text)
   - Note the Field ID (format: `cf_xxxxxx`)

2. **Environment Variables:**
   ```bash
   MANYCHAT_IG_FIELD_ID=cf_xxxxxx  # Your custom field ID
   MANYCHAT_WEBHOOK_SECRET=your_webhook_secret  # For signature verification
   ```

3. **Webhook Configuration:**
   - URL: `https://your-domain.com/webhooks/manychat`
   - Include signature header for security
   - Send `instagram_username` instead of `instagram_user_id`

### System Flow

1. **Instagram DM received** → Username extracted/resolved from sender
2. **ManyChat search** → Find subscriber by username custom field  
3. **Message sent** → Via ManyChat API or Instagram Graph API as fallback
4. **Mapping stored** → Username ↔ ManyChat Subscriber ID

### Benefits of Username-Only Approach

- ✅ **Consistent identification** across platforms
- ✅ **User-friendly** for debugging and support
- ✅ **No ID resolution failures** breaking message flow
- ✅ **Direct ManyChat integration** without complex lookups
- ✅ **Better error handling** and fallback mechanisms

### Migration Notes

If upgrading from ID-based system:
1. Update ManyChat custom field to store usernames
2. Re-sync existing subscriber mappings
3. Test with new webhook payload format