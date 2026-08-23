-- A dedicated secret for the profile-scan watchdog's pg_cron schedule.
--
-- The watchdog was the last cron job authenticating with a Supabase
-- service_role key, read from vault.decrypted_secrets. That vault copy went
-- stale when the project's keys were refreshed (proven live: a request carrying
-- it returned 401 "Invalid or expired session"), and the only reason the
-- watchdog kept running was that the shared service-role check accepted any
-- UNSIGNED JWT claiming role=service_role. That fallback was forgeable by
-- anyone, so it had to go, which meant the watchdog needed its own way in.
--
-- Same shape as hubspot_cron_secret and the Xero keepalive secret: a random
-- value the cron job sends in a header and the function compares. No Supabase
-- key involved, so nothing here can be invalidated by a key rotation.
create table if not exists public.watchdog_cron_secret (
  id text primary key default 'default',
  secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
insert into public.watchdog_cron_secret (id) values ('default') on conflict do nothing;

-- RLS on with no policies: unreachable from anon and authenticated clients, and
-- the service role (which the edge function uses) bypasses RLS entirely.
alter table public.watchdog_cron_secret enable row level security;
