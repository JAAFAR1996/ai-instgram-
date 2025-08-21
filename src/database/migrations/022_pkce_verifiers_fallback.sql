-- Fallback table for PKCE verifiers when Redis is unavailable
CREATE TABLE IF NOT EXISTS pkce_verifiers (
    state VARCHAR(255) PRIMARY KEY,
    code_verifier VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '10 minutes')
);

CREATE INDEX IF NOT EXISTS idx_pkce_verifiers_expires ON pkce_verifiers(expires_at);

COMMENT ON TABLE pkce_verifiers IS 'Fallback storage for PKCE code verifiers when Redis is unavailable';