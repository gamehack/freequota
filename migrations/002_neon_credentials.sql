-- One Neon API key for the current FreeQuota administrator.
-- The API key is encrypted by the Worker before it is stored here.
CREATE TABLE IF NOT EXISTS neon_credentials (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  token_ciphertext text NOT NULL,
  token_iv text NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
