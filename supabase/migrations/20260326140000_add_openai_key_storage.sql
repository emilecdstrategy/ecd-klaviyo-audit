/*
  Admin-managed OpenAI key storage (encrypted by Edge Function).
*/

CREATE TABLE IF NOT EXISTS app_secrets (
  key text PRIMARY KEY,
  ciphertext text,
  iv text,
  alg text NOT NULL DEFAULT 'AES-256-GCM',
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_secrets ENABLE ROW LEVEL SECURITY;

-- No direct access from client; Edge Functions use service role.
DO $$ BEGIN
  CREATE POLICY "No direct access to app_secrets"
    ON app_secrets FOR ALL
    TO authenticated
    USING (false)
    WITH CHECK (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

