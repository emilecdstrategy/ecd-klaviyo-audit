/*
  Server-side AI analysis pipeline — tracks staged OpenAI work so audits
  can finish after the browser tab is closed.
*/

CREATE TABLE IF NOT EXISTS audit_analysis_jobs (
  audit_id uuid PRIMARY KEY REFERENCES audits(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'complete', 'failed')),
  step_index integer NOT NULL DEFAULT 0,
  partial_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_analysis_jobs_status ON audit_analysis_jobs(status);
CREATE INDEX IF NOT EXISTS idx_audit_analysis_jobs_updated_at ON audit_analysis_jobs(updated_at DESC);

ALTER TABLE audit_analysis_jobs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Authenticated users can read audit analysis jobs"
    ON audit_analysis_jobs FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM audits a
        WHERE a.id = audit_analysis_jobs.audit_id
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
