/*
  Stage the Klaviyo snapshot + cache the conversion metric per client.

  - Add per-client cache of the Klaviyo conversion metric so we can skip the
    expensive pick/probe phase on subsequent audits.
  - Add `stage` column to klaviyo_runs so we can record per-stage success/
    failure (config | reporting | profile | resume_profile_scan) and surface
    stage-level diagnostics in the UI.
  - Widen klaviyo_runs.status check to include 'partial' and 'timeout' so
    stages can report nuanced outcomes instead of only success/error.
  - Allow authenticated users to read klaviyo_runs for audits they can see
    (today only admins can, which blocks the in-wizard run log panel).
*/

-- Cache the picked conversion metric per Klaviyo-connected client.
ALTER TABLE public.klaviyo_connections
  ADD COLUMN IF NOT EXISTS conversion_metric_id text,
  ADD COLUMN IF NOT EXISTS conversion_metric_name text,
  ADD COLUMN IF NOT EXISTS conversion_metric_verified_at timestamptz;

-- Stage tracking on klaviyo_runs.
ALTER TABLE public.klaviyo_runs
  ADD COLUMN IF NOT EXISTS stage text;

CREATE INDEX IF NOT EXISTS idx_klaviyo_runs_audit_id_created_at
  ON public.klaviyo_runs(audit_id, created_at DESC);

-- Widen status check: add 'partial' (some stage work done but not all) and
-- 'timeout' (deadline hit). Keep 'success' and 'error' for back-compat.
ALTER TABLE public.klaviyo_runs
  DROP CONSTRAINT IF EXISTS klaviyo_runs_status_check;

ALTER TABLE public.klaviyo_runs
  ADD CONSTRAINT klaviyo_runs_status_check
  CHECK (status IN ('success', 'error', 'partial', 'timeout'));

-- Let any authenticated user with a profile see runs tied to audits they can
-- see. Mirrors the audits SELECT policy. Admins keep the broader read via the
-- pre-existing policy.
DO $$ BEGIN
  CREATE POLICY "Authenticated users can read klaviyo runs"
    ON public.klaviyo_runs FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
