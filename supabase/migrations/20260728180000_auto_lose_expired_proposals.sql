-- A proposal past its valid-until date is marked lost automatically, with the
-- reason recorded so an expiry is distinguishable from a real "no". Runs hourly;
-- deriveProposalStatus still shows "Expired" in the UI for the gap between the
-- date passing and the job running. Extending valid_until before the job fires
-- still revives a proposal; afterwards it needs reopening by hand.
create or replace function public.mark_expired_proposals_lost()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  affected integer;
begin
  update proposals
  set status = 'lost',
      lost_at = now(),
      lost_reason = 'Expired (validity date passed)',
      updated_at = now()
  where status in ('sent', 'viewed')
    and valid_until is not null
    and (valid_until::date + interval '1 day') <= now();
  get diagnostics affected = row_count;
  return affected;
end;
$$;

select cron.schedule(
  'mark-expired-proposals-lost',
  '10 * * * *',
  $$select public.mark_expired_proposals_lost()$$
);
