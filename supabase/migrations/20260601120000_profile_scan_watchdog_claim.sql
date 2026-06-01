-- Reclaim orphaned profile-scan workers sooner (edge isolate killed mid-chunk).
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
      OR (j.status = 'running' AND j.updated_at < now() - interval '90 seconds')
    )
  RETURNING j.*;
END;
$$;
