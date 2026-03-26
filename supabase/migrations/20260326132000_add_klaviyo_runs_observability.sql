/*
  Klaviyo fetch observability
*/

CREATE TABLE IF NOT EXISTS klaviyo_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id text NOT NULL UNIQUE,
  audit_id uuid REFERENCES public.audits(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('success', 'error')),
  revision text,
  elapsed_ms integer NOT NULL DEFAULT 0,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE klaviyo_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Admins can read klaviyo runs"
    ON klaviyo_runs FOR SELECT
    TO authenticated
    USING (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_klaviyo_runs_created_at ON klaviyo_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_klaviyo_runs_status ON klaviyo_runs(status);

