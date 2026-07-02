-- Proposals core: proposals, line items, signatures, events.
-- SECURITY NOTE: no anon policies on any of these tables. Public access
-- (view by token, signing, view tracking) goes exclusively through edge
-- functions using the service role, which validate the token server-side.

create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  proposal_number integer generated always as identity,
  client_id uuid not null references public.clients(id) on delete restrict,
  audit_id uuid references public.audits(id) on delete set null,
  template_id uuid references public.proposal_templates(id) on delete set null,
  title text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'viewed', 'won', 'lost')),
  cover jsonb not null default '{}'::jsonb,
  content_blocks jsonb not null default '[]'::jsonb,
  include_contracts jsonb not null default '[]'::jsonb,
  contracts_snapshot jsonb,
  discount_type text not null default 'none'
    check (discount_type in ('none', 'fixed', 'percent')),
  discount_value numeric not null default 0 check (discount_value >= 0),
  discount_applies_to text not null default 'one_time'
    check (discount_applies_to in ('one_time', 'monthly', 'both')),
  discount_label text,
  recipient_name text not null default '',
  recipient_email text not null default '',
  public_token text unique,
  valid_until date,
  sent_at timestamptz,
  first_viewed_at timestamptz,
  client_signed_at timestamptz,
  countersigned_at timestamptz,
  won_at timestamptz,
  lost_at timestamptz,
  lost_reason text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_proposals_client on public.proposals (client_id);
create index if not exists idx_proposals_status on public.proposals (status, created_at desc);
create index if not exists idx_proposals_audit on public.proposals (audit_id) where audit_id is not null;

create table if not exists public.proposal_line_items (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  template_slug text,
  name text not null,
  description text not null default '',
  content text not null default '',
  one_time_price numeric,
  one_time_label text,
  monthly_price numeric,
  monthly_label text,
  image_url text,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_proposal_line_items_proposal
  on public.proposal_line_items (proposal_id, display_order);

create table if not exists public.proposal_signatures (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  role text not null check (role in ('client', 'agency')),
  signer_name text not null,
  signer_email text not null default '',
  signer_user_id uuid references auth.users(id),
  signature_image text not null check (length(signature_image) < 400000),
  typed_name text not null default '',
  ip_address text not null default '',
  user_agent text not null default '',
  signed_at timestamptz not null default now(),
  unique (proposal_id, role)
);

create table if not exists public.proposal_events (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  event_type text not null check (event_type in (
    'created', 'updated', 'sent', 'resent', 'viewed',
    'signed', 'countersigned', 'won', 'lost', 'reopened'
  )),
  actor text not null default 'system' check (actor in ('admin', 'client', 'system')),
  actor_user_id uuid references auth.users(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_proposal_events_proposal
  on public.proposal_events (proposal_id, created_at desc);

-- Immutability: once the client has signed, line items are frozen.
create or replace function public.proposal_line_items_block_signed_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_proposal_id uuid;
  signed_at timestamptz;
begin
  target_proposal_id := coalesce(new.proposal_id, old.proposal_id);
  select p.client_signed_at into signed_at
  from public.proposals p
  where p.id = target_proposal_id;
  if signed_at is not null then
    raise exception 'Proposal has been signed; line items are immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proposal_line_items_immutable on public.proposal_line_items;
create trigger trg_proposal_line_items_immutable
  before insert or update or delete on public.proposal_line_items
  for each row
  execute function public.proposal_line_items_block_signed_mutation();

-- RLS ---------------------------------------------------------------------

alter table public.proposals enable row level security;
alter table public.proposal_line_items enable row level security;
alter table public.proposal_signatures enable row level security;
alter table public.proposal_events enable row level security;

-- proposals: any profile reads, admin/auditor writes, admin deletes
drop policy if exists "Authenticated users can read proposals" on public.proposals;
create policy "Authenticated users can read proposals"
  on public.proposals
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
    )
  );

drop policy if exists "Staff can insert proposals" on public.proposals;
create policy "Staff can insert proposals"
  on public.proposals
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'auditor')
    )
  );

drop policy if exists "Staff can update proposals" on public.proposals;
create policy "Staff can update proposals"
  on public.proposals
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'auditor')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'auditor')
    )
  );

drop policy if exists "Admins can delete proposals" on public.proposals;
create policy "Admins can delete proposals"
  on public.proposals
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  );

-- proposal_line_items: same as proposals for read/write; staff delete
drop policy if exists "Authenticated users can read proposal line items" on public.proposal_line_items;
create policy "Authenticated users can read proposal line items"
  on public.proposal_line_items
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
    )
  );

drop policy if exists "Staff can insert proposal line items" on public.proposal_line_items;
create policy "Staff can insert proposal line items"
  on public.proposal_line_items
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'auditor')
    )
  );

drop policy if exists "Staff can update proposal line items" on public.proposal_line_items;
create policy "Staff can update proposal line items"
  on public.proposal_line_items
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'auditor')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'auditor')
    )
  );

drop policy if exists "Staff can delete proposal line items" on public.proposal_line_items;
create policy "Staff can delete proposal line items"
  on public.proposal_line_items
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'auditor')
    )
  );

-- proposal_signatures: read-only for staff; writes only via service role
drop policy if exists "Authenticated users can read proposal signatures" on public.proposal_signatures;
create policy "Authenticated users can read proposal signatures"
  on public.proposal_signatures
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
    )
  );

drop policy if exists "Admins can delete proposal signatures" on public.proposal_signatures;
create policy "Admins can delete proposal signatures"
  on public.proposal_signatures
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  );

-- proposal_events: staff read; staff can insert their own manual events
drop policy if exists "Authenticated users can read proposal events" on public.proposal_events;
create policy "Authenticated users can read proposal events"
  on public.proposal_events
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
    )
  );

drop policy if exists "Staff can insert own admin proposal events" on public.proposal_events;
create policy "Staff can insert own admin proposal events"
  on public.proposal_events
  for insert
  to authenticated
  with check (
    actor = 'admin'
    and actor_user_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'auditor')
    )
  );
