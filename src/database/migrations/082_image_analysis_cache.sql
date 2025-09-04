-- 082: Image analysis cache table for performance optimization

CREATE TABLE IF NOT EXISTS public.image_analysis_cache (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_hash text UNIQUE NOT NULL,
  analysis_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  last_used_at timestamptz NOT NULL DEFAULT NOW(),
  usage_count integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_image_analysis_cache_hash ON public.image_analysis_cache(content_hash);
CREATE INDEX IF NOT EXISTS idx_image_analysis_cache_last_used ON public.image_analysis_cache(last_used_at);

-- Add content_hash index to existing message_image_metadata table if not exists
CREATE INDEX IF NOT EXISTS idx_msg_img_meta_content_hash ON public.message_image_metadata(content_hash);

COMMENT ON TABLE public.image_analysis_cache IS 'Cache for expensive image analysis operations to avoid reprocessing identical images';
COMMENT ON COLUMN public.image_analysis_cache.content_hash IS 'SHA256 hash of image content and metadata for deduplication';
COMMENT ON COLUMN public.image_analysis_cache.analysis_data IS 'Complete analysis result in JSON format';
COMMENT ON COLUMN public.image_analysis_cache.usage_count IS 'Number of times this cached result has been used';