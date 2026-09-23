-- One owner per analysis step.
--
-- The Klaviyo and web analysis chains could run the same step twice in
-- parallel: both runners read "pending", both wrote "running". The new
-- claim_token column is set by an atomic compare-and-set when a runner takes a
-- step, and every later write about that step is conditional on it
-- (see supabase/functions/_shared/job-claim.ts).
alter table public.audit_analysis_jobs
  add column if not exists claim_token text;

-- Two jobs were left on "pending" by the losing runner of a doubled analysis.
-- Both audits finished and were published; only their job row was stale, and
-- the watchdog re-kicked each one every five minutes. Close them out.
update public.audit_analysis_jobs j
set status = 'complete', updated_at = now()
from public.audits a
where a.id = j.audit_id
  and j.status in ('pending', 'running')
  and coalesce(a.executive_summary, '') <> ''
  and coalesce(j.partial_state->>'highlightRegen', 'false') <> 'true'
  and coalesce(j.partial_state->>'web', 'false') <> 'true';
