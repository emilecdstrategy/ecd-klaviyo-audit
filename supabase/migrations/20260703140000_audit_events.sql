-- Activity log for audits, mirroring proposal_events: audits previously had no
-- record of who edited/published them. `edited` events are throttled client-side
-- (one per audit per few minutes of active editing) so routine autosaves don't
-- flood the log; `published`/`status_changed`/`created` are discrete and always recorded.
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits(id) on delete cascade,
  event_type text not null check (event_type in (
    'created', 'edited', 'published', 'unpublished', 'status_changed'
  )),
  actor_user_id uuid references auth.users(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_events_audit
  on public.audit_events (audit_id, created_at desc);

alter table public.audit_events enable row level security;

drop policy if exists "Authenticated users can read audit events" on public.audit_events;
create policy "Authenticated users can read audit events"
  on public.audit_events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
    )
  );

drop policy if exists "Staff can insert own audit events" on public.audit_events;
create policy "Staff can insert own audit events"
  on public.audit_events
  for insert
  to authenticated
  with check (
    actor_user_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'auditor')
    )
  );
