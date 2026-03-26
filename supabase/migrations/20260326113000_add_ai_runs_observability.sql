/*
  AI observability and cost governance
*/

CREATE TABLE IF NOT EXISTS ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('success', 'error', 'validation_failed')),
  model text NOT NULL DEFAULT '',
  retries integer NOT NULL DEFAULT 0,
  elapsed_ms integer NOT NULL DEFAULT 0,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  schema_version text,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Admins can read ai runs"
    ON ai_runs FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'admin'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_ai_runs_created_at ON ai_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_runs_status ON ai_runs(status);
CREATE INDEX IF NOT EXISTS idx_ai_runs_model ON ai_runs(model);

