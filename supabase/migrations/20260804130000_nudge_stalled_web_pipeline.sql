-- Watchdog for the whole web-audit pipeline, not just its last phase.
--
-- Both phases run one unit per invocation and then kick the next: capture does a
-- screenshot then kicks, and generate_after does one page-and-viewport then kicks.
-- If an invocation is killed at the edge function's 150s ceiling, the unit it
-- finished is saved but the kick never happens, and the pipeline stops.
--
-- The after-image chain already had a watchdog. The capture chain did not, and it
-- stalled the same way: a storefront 429 forced a Browserless retry, that hop ran
-- long, and an audit sat at 7 of 8 screenshots for two and a half hours. Resuming
-- it by hand finished the last shot in 41 seconds, so again only the handoff was
-- broken. One watchdog now covers both phases.
create or replace function public.nudge_stalled_web_pipeline()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
  v_row record;
  v_count int := 0;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  if v_key is null or v_key = '' then
    raise warning 'nudge_stalled_web_pipeline: no service_role_key in vault';
    return 0;
  end if;

  -- PHASE 1: captures. A row still pending, whose last attempt is old enough that
  -- no invocation can still be working on it, means the chain died holding it.
  -- fetched_at is stamped on every attempt including a requeue, so it is exactly
  -- the "last touched" signal needed here.
  for v_row in
    select a.id as audit_id, a.client_id
    from audits a
    where a.audit_type = 'web'
      and a.created_at > now() - interval '24 hours'
      and a.client_id is not null
      and exists (
        select 1 from web_page_snapshots s
        where s.audit_id = a.id
          and s.status = 'pending'
          and coalesce(s.fetched_at, a.created_at) < now() - interval '4 minutes'
      )
    order by a.created_at desc
    limit 3
  loop
    perform net.http_post(
      url := 'https://wuvqwuviwubthmuncuya.supabase.co/functions/v1/web_capture_screenshots',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object(
        'action', 'run',
        'audit_id', v_row.audit_id,
        'client_id', v_row.client_id
      ),
      timeout_milliseconds := 15000
    );
    v_count := v_count + 1;
  end loop;

  -- PHASE 2: after-images. Auto mode picks the next undone unit, so nudging a
  -- healthy chain is a no-op and it answers "complete" once every unit is done.
  for v_row in
    with page_sections as (
      select
        s.audit_id,
        -- Proof the analysis ran, so an audit still being analysed is never
        -- nudged into generating images for findings that do not exist yet.
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
    select a.id as audit_id
    from audits a
    join page_sections ps on ps.audit_id = a.id
    where a.audit_type = 'web'
      and coalesce(a.web_afters_ready, false) = false
      and a.created_at > now() - interval '24 hours'
      and ps.sections_with_findings >= 2
      -- Longer than a healthy unit (55 to 130 seconds), so a running chain is
      -- never nudged and never double-generates a unit.
      and ps.last_after_at < now() - interval '5 minutes'
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
      body := jsonb_build_object('audit_id', v_row.audit_id, 'mode', 'auto'),
      timeout_milliseconds := 15000
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.nudge_stalled_web_pipeline() from public, anon, authenticated;

-- One job for the whole pipeline, replacing the after-images-only watchdog.
select cron.unschedule('nudge-stalled-web-afters')
where exists (select 1 from cron.job where jobname = 'nudge-stalled-web-afters');
select cron.unschedule('nudge-stalled-web-pipeline')
where exists (select 1 from cron.job where jobname = 'nudge-stalled-web-pipeline');
select cron.schedule('nudge-stalled-web-pipeline', '*/2 * * * *', 'select public.nudge_stalled_web_pipeline()');

drop function if exists public.nudge_stalled_web_afters();
