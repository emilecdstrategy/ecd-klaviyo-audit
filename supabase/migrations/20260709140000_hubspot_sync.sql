-- HubSpot integration: link clients to HubSpot companies and track sync state.

alter table public.clients add column if not exists hubspot_company_id text;
create unique index if not exists idx_clients_hubspot_company
  on public.clients (hubspot_company_id)
  where hubspot_company_id is not null;

-- Single-row sync state. Staff can read it (Settings shows last sync);
-- writes happen only through the hubspot_sync edge function (service role).
create table if not exists public.hubspot_sync_state (
  id text primary key default 'default',
  last_synced_at timestamptz,
  backfill_cursor text,
  last_result jsonb,
  updated_at timestamptz not null default now()
);
insert into public.hubspot_sync_state (id) values ('default') on conflict do nothing;

alter table public.hubspot_sync_state enable row level security;

drop policy if exists "Staff can read hubspot sync state" on public.hubspot_sync_state;
create policy "Staff can read hubspot sync state"
  on public.hubspot_sync_state
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'auditor')
    )
  );

-- Shared secret that authorizes the pg_cron job to invoke the sync function.
-- RLS enabled with no policies: only the service role and postgres can read it.
create table if not exists public.hubspot_cron_secret (
  id text primary key default 'default',
  secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
insert into public.hubspot_cron_secret (id) values ('default') on conflict do nothing;

alter table public.hubspot_cron_secret enable row level security;
