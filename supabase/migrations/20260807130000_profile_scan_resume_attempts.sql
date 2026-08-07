-- A transient Klaviyo outage must not kill a profile scan that has hours of
-- paging behind it. Grill Rescue's scan had counted 2.45M profiles over four
-- hours when Klaviyo's API returned three 502s in a row; the job was marked
-- failed, which nothing ever retries, and the report shipped without audience
-- metrics even though the cursor to resume from was sitting right there.
--
-- resume_attempts is the budget the watchdog spends reviving such jobs, so a
-- genuinely broken account cannot loop forever.
alter table public.klaviyo_profile_scan_jobs
  add column if not exists resume_attempts integer not null default 0;
