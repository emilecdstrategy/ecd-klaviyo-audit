-- Expire proposals at the end of the valid_until day in the BUSINESS timezone.
--
-- valid_until is a DATE, so the deadline is the end of that day. The previous
-- version compared `valid_until + 1 day <= now()` which is midnight UTC, and
-- that lands BEFORE the end of the day anywhere west of UTC. A US client could
-- therefore be marked lost while the app still showed the proposal as live with
-- hours to go.
--
-- ECD operates in US Eastern, so that is the reference. Anchoring to one zone
-- also keeps the result stable no matter where the person reading it happens to
-- be, and never expires a proposal early.
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
    -- Midnight at the start of the following day, in US Eastern.
    and ((valid_until::date + interval '1 day')::timestamp
          at time zone 'America/New_York') <= now();
  get diagnostics affected = row_count;
  return affected;
end;
$$;

comment on function public.mark_expired_proposals_lost is
  'Marks sent/viewed proposals lost once the valid_until day has fully passed in US Eastern. valid_until stays null until the client first opens the proposal, so an unopened proposal never expires.';
