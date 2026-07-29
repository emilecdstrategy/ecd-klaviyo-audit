-- One-time CSRF states for the Xero connect flow (deleted on use, expired after
-- 15 minutes) so a replayed callback cannot attach a different Xero org.
create table if not exists public.xero_oauth_states (
  state text primary key,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.xero_oauth_states enable row level security;
create index if not exists xero_oauth_states_created_at_idx on public.xero_oauth_states (created_at);

-- Shared secret for the keep-alive cron, generated inside Postgres so it never
-- has to be pasted anywhere. Service role only; the cron reads it at run time.
create table if not exists public.xero_cron_auth (
  id text primary key default 'default',
  secret text not null default encode(gen_random_bytes(24), 'hex'),
  constraint xero_cron_auth_single_row check (id = 'default')
);
alter table public.xero_cron_auth enable row level security;
insert into public.xero_cron_auth (id) values ('default') on conflict (id) do nothing;

-- Xero refresh tokens die after 60 days unused, and signings can be further
-- apart than that, so refresh weekly to keep the connection alive.
select cron.unschedule('xero-token-keepalive')
where exists (select 1 from cron.job where jobname = 'xero-token-keepalive');

select cron.schedule(
  'xero-token-keepalive',
  '0 6 * * 1',
  $job$
  select net.http_post(
    url := 'https://wuvqwuviwubthmuncuya.supabase.co/functions/v1/xero_admin',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-xero-cron-secret', (select secret from public.xero_cron_auth where id = 'default')
    ),
    body := '{"action":"keepalive"}'::jsonb
  )
  $job$
);
