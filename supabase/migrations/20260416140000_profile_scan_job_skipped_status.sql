-- Allow profile scan jobs to be marked skipped (fast audit path; no full pagination).

ALTER TABLE public.klaviyo_profile_scan_jobs
  DROP CONSTRAINT IF EXISTS klaviyo_profile_scan_jobs_status_check;

ALTER TABLE public.klaviyo_profile_scan_jobs
  ADD CONSTRAINT klaviyo_profile_scan_jobs_status_check
  CHECK (status IN ('pending', 'running', 'complete', 'failed', 'skipped'));
