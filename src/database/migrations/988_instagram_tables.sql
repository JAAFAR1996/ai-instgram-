
        -- Create Instagram integration tables
        CREATE TABLE IF NOT EXISTS instagram_accounts (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          merchant_id UUID NOT NULL,
          instagram_user_id VARCHAR(100) UNIQUE NOT NULL,
          username VARCHAR(100) NOT NULL,
          access_token_encrypted TEXT NOT NULL,
          page_id VARCHAR(100),
          account_type VARCHAR(20) DEFAULT 'business',
          is_active BOOLEAN DEFAULT true,
          last_sync_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS instagram_media (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          merchant_id UUID NOT NULL,
          instagram_account_id UUID REFERENCES instagram_accounts(id) ON DELETE CASCADE,
          media_id VARCHAR(100) UNIQUE NOT NULL,
          media_type VARCHAR(20) NOT NULL, -- image, video, carousel_album
          caption TEXT,
          permalink TEXT,
          thumbnail_url TEXT,
          media_url TEXT,
          like_count INTEGER DEFAULT 0,
          comments_count INTEGER DEFAULT 0,
          timestamp TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT NOW(),
          
          CONSTRAINT check_media_type CHECK (media_type IN ('IMAGE', 'VIDEO', 'CAROUSEL_ALBUM'))
        );

        -- Create indexes for performance
        CREATE INDEX IF NOT EXISTS idx_instagram_accounts_merchant_id ON instagram_accounts(merchant_id);
        CREATE INDEX IF NOT EXISTS idx_instagram_accounts_active ON instagram_accounts(is_active) WHERE is_active = true;
        CREATE INDEX IF NOT EXISTS idx_instagram_media_account_id ON instagram_media(instagram_account_id);
        CREATE INDEX IF NOT EXISTS idx_instagram_media_timestamp ON instagram_media(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_instagram_media_merchant_engagement 
          ON instagram_media(merchant_id, like_count DESC, comments_count DESC);

        -- Create function for updating timestamps
        CREATE OR REPLACE FUNCTION update_instagram_timestamp()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- Create triggers
        DROP TRIGGER IF EXISTS update_instagram_accounts_timestamp ON instagram_accounts;
        CREATE TRIGGER update_instagram_accounts_timestamp
          BEFORE UPDATE ON instagram_accounts
          FOR EACH ROW EXECUTE FUNCTION update_instagram_timestamp();
      