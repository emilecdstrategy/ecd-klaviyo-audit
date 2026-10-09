-- Supabase warned the project was running out of Disk IO budget (Oct 9). The
-- database is ~70 MB and served from cache; the writes came from cron's own
-- bookkeeping (each run writes and updates a cron.job_run_details row 3 to 4
-- times) and from pg_net response rows, for jobs that mostly had nothing to do.
--
-- 1. profile-scan-watchdog called its edge function every 5 minutes even with
--    every scan complete. It now only calls when a scan is pending, running or
--    failed, the same statuses the watchdog itself acts on.
-- 2. nudge-stalled-web-pipeline ran every 2 minutes; its own thresholds already
--    wait 4 to 5 minutes before acting, so every 5 minutes loses nothing.
--
-- Both statements are safe to run again: the replace finds nothing to change
-- once the guard is in, and the schedule is simply set.

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'profile-scan-watchdog'),
  command := replace(
    (select command from cron.job where jobname = 'profile-scan-watchdog'),
    ') as request_id;',
    ') as request_id
  where exists (select 1 from public.klaviyo_profile_scan_jobs where status in (''pending'', ''running'', ''failed''));')
)
where exists (select 1 from cron.job where jobname = 'profile-scan-watchdog');

select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'nudge-stalled-web-pipeline'),
  schedule := '*/5 * * * *'
)
where exists (select 1 from cron.job where jobname = 'nudge-stalled-web-pipeline');
