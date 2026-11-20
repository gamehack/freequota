-- One Cloudflare account for the current FreeQuota administrator.
-- The API Token is encrypted by the Worker before it is stored here.
CREATE TABLE IF NOT EXISTS cloudflare_credentials (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  account_id char(32) NOT NULL CHECK (account_id ~ '^[0-9a-f]{32}$'),
  token_ciphertext text NOT NULL,
  token_iv text NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
