-- Resumable full profile scan (multi Edge invocation) for Klaviyo snapshot

CREATE TABLE IF NOT EXISTS public.klaviyo_profile_scan_jobs (
  audit_id uuid PRIMARY KEY REFERENCES public.audits(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  revision text NOT NULL,
  since90_iso text NOT NULL,
  /** Relative path+query for next Klaviyo request; NULL means start at first page */
  next_path text,
  subscribed integer NOT NULL DEFAULT 0,
  active90d integer NOT NULL DEFAULT 0,
  suppressed integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'complete', 'failed')),
  error_message text,
  /** Flow RPR from reporting (set at job creation; copied to audits on completion) */
  staged_revenue_per_recipient double precision,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_klaviyo_profile_scan_jobs_status
  ON public.klaviyo_profile_scan_jobs(status);

ALTER TABLE public.klaviyo_profile_scan_jobs ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read jobs for audits they created
DO $$ BEGIN
  CREATE POLICY "Users read own audit profile scan jobs"
    ON public.klaviyo_profile_scan_jobs FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.audits a
        WHERE a.id = audit_id AND a.created_by = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admins read all profile scan jobs"
    ON public.klaviyo_profile_scan_jobs FOR SELECT
    TO authenticated
    USING (
      EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Atomic claim for Edge resume workers (service_role only)
CREATE OR REPLACE FUNCTION public.claim_profile_scan_job(p_audit_id uuid)
RETURNS SETOF public.klaviyo_profile_scan_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.klaviyo_profile_scan_jobs j
  SET status = 'running', updated_at = now()
  WHERE j.audit_id = p_audit_id
    AND (
      j.status = 'pending'
      OR (j.status = 'running' AND j.updated_at < now() - interval '3 minutes')
    )
  RETURNING j.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_profile_scan_job(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_profile_scan_job(uuid) TO service_role;
