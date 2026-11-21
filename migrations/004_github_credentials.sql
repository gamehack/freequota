-- One GitHub personal account for the current FreeQuota administrator.
-- The fine-grained PAT is validated, encrypted by the Worker, and stored here.
CREATE TABLE IF NOT EXISTS github_credentials (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  username text NOT NULL CHECK (length(username) BETWEEN 1 AND 39),
  token_ciphertext text NOT NULL,
  token_iv text NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
