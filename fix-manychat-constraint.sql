-- Fix manychat_subscribers constraint for instagram_username upsert
-- Add unique constraint on (merchant_id, instagram_username)

ALTER TABLE manychat_subscribers 
ADD CONSTRAINT uk_manychat_subscribers_merchant_instagram_username 
UNIQUE (merchant_id, instagram_username);