-- Server-side profile scan watchdog (no browser tab required).
-- Requires vault secret `service_role_key` (Supabase Dashboard → Project Settings → API → service_role).

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'profile-scan-watchdog') then
    perform cron.unschedule((select jobid from cron.job where jobname = 'profile-scan-watchdog' limit 1));
  end if;
exception
  when undefined_table then null;
  when undefined_object then null;
end $$;

select cron.schedule(
  'profile-scan-watchdog',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://wuvqwuviwubthmuncuya.supabase.co/functions/v1/profile_scan_watchdog',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1),
        ''
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  ) as request_id;
  $$
);
