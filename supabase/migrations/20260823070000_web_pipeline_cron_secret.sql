-- The web pipeline's stall-recovery job gets its own secret, for the same
-- reason the watchdog did.
--
-- nudge_stalled_web_pipeline() posts to web_capture_screenshots and
-- web_generate_after as the service role, reading the key from
-- vault.decrypted_secrets. That vault copy does not match the project's current
-- key: a request carrying it returns "Invalid or expired session" from both
-- functions. It only ever worked because the shared service-role check accepted
-- any UNSIGNED JWT claiming role=service_role, and removing that forgery left
-- this job unable to authenticate, so a stalled capture chain or a missing
-- after-image would never be picked back up.
--
-- Same shape as hubspot_cron_secret and watchdog_cron_secret: one random value
-- per job, sent as x-cron-secret, immune to key rotation.
create table if not exists public.web_pipeline_cron_secret (
  id text primary key default 'default',
  secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
insert into public.web_pipeline_cron_secret (id) values ('default') on conflict do nothing;

-- RLS on with no policies: unreachable from anon and authenticated clients; the
-- edge functions read it with the service role, which bypasses RLS.
alter table public.web_pipeline_cron_secret enable row level security;
