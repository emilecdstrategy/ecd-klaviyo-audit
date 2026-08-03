-- Watchdog for the after-image chain.
--
-- web_generate_after builds one (page, viewport) per invocation and then kicks
-- the next hop. If an invocation is killed at the edge function's 150s ceiling,
-- the unit it just saved is fine but the kick never happens, so the chain stops
-- and the report sits on "Generating concept images" forever. That is exactly
-- what stalled one audit after three of its eight units: resuming it by hand
-- finished each remaining unit in under a minute, so nothing was broken except
-- the handoff. The HTML engine made this likely rather than rare, because a unit
-- now takes 55 to 90 seconds instead of a few seconds of image generation.
--
-- This re-kicks auto mode for any recent web audit whose afters are unfinished
-- and which has not produced one in five minutes. Auto mode picks the next
-- undone unit, so nudging a healthy chain is a no-op, and it answers "complete"
-- once every unit is done.
create or replace function public.nudge_stalled_web_afters()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
  v_audit record;
  v_count int := 0;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if v_key is null or v_key = '' then
    raise warning 'nudge_stalled_web_afters: no service_role_key in vault';
    return 0;
  end if;

  for v_audit in
    with page_sections as (
      select
        s.audit_id,
        -- Proof the analysis actually ran, so an audit still being analysed is
        -- never nudged into generating images for findings that do not exist yet.
        count(*) filter (
          where jsonb_array_length(coalesce(s.section_details->'web'->'findings', '[]'::jsonb)) > 0
        ) as sections_with_findings,
        max(greatest(
          coalesce((s.section_details->'web'->'after_images'->'desktop'->>'generated_at')::timestamptz, 'epoch'::timestamptz),
          coalesce((s.section_details->'web'->'after_images'->'mobile'->>'generated_at')::timestamptz, 'epoch'::timestamptz)
        )) as last_after_at
      from audit_sections s
      where s.section_key in ('web_homepage', 'web_product_page', 'web_collection_page', 'web_cart')
      group by s.audit_id
    )
    select a.id
    from audits a
    join page_sections ps on ps.audit_id = a.id
    where a.audit_type = 'web'
      and coalesce(a.web_afters_ready, false) = false
      and a.created_at > now() - interval '24 hours'
      and ps.sections_with_findings >= 2
      -- Five minutes is comfortably longer than a healthy unit, so a running
      -- chain is never nudged and never double-generates a unit.
      and ps.last_after_at < now() - interval '5 minutes'
      -- Either the chain started and stalled, or it never started and the audit
      -- is old enough that finalize_analysis has certainly had its go.
      and (ps.last_after_at > 'epoch'::timestamptz or a.created_at < now() - interval '10 minutes')
    order by a.created_at desc
    limit 3
  loop
    perform net.http_post(
      url := 'https://wuvqwuviwubthmuncuya.supabase.co/functions/v1/web_generate_after',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object('audit_id', v_audit.id, 'mode', 'auto'),
      timeout_milliseconds := 15000
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.nudge_stalled_web_afters() from public, anon, authenticated;

-- Every two minutes: frequent enough that a stall costs a couple of minutes,
-- rare enough to be free when nothing is stalled.
select cron.unschedule('nudge-stalled-web-afters')
where exists (select 1 from cron.job where jobname = 'nudge-stalled-web-afters');
select cron.schedule('nudge-stalled-web-afters', '*/2 * * * *', 'select public.nudge_stalled_web_afters()');
