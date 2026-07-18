-- Documents core: internal WYSIWYG documents sent to a recipient to sign.
-- Mirrors the proposals stack (minus pricing/contracts/clients/second-signer).
-- SECURITY: no anon policies. Public access (view by token, signing, view
-- tracking) goes exclusively through edge functions using the service role,
-- which validate the token server-side.

create table if not exists public.document_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Untitled template',
  content text not null default '',
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  document_number integer generated always as identity,
  template_id uuid references public.document_templates(id) on delete set null,
  title text not null default '',
  content text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'viewed', 'signed', 'void')),
  recipient_name text not null default '',
  recipient_email text not null default '',
  public_token text unique,
  valid_until date,
  sent_at timestamptz,
  first_viewed_at timestamptz,
  signed_at timestamptz,
  void_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_documents_status on public.documents (status, created_at desc);

create table if not exists public.document_signatures (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  signer_name text not null,
  signer_email text not null default '',
  signature_image text not null check (length(signature_image) < 400000),
  typed_name text not null default '',
  ip_address text not null default '',
  user_agent text not null default '',
  signed_at timestamptz not null default now(),
  unique (document_id)
);

create table if not exists public.document_events (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  event_type text not null check (event_type in (
    'created', 'updated', 'sent', 'resent', 'viewed', 'signed', 'void', 'reopened'
  )),
  actor text not null default 'system' check (actor in ('admin', 'recipient', 'system')),
  actor_user_id uuid references auth.users(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_document_events_document
  on public.document_events (document_id, created_at desc);

-- Immutability: once signed, the document content/title/recipient are frozen so
-- the signature always attests to what the recipient actually saw. Status
-- transitions (e.g. void) and timestamps stay editable.
create or replace function public.documents_block_signed_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.signed_at is not null then
    if new.content is distinct from old.content
       or new.title is distinct from old.title
       or new.recipient_name is distinct from old.recipient_name
       or new.recipient_email is distinct from old.recipient_email then
      raise exception 'Document has been signed; its content and recipient are immutable';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_documents_signed_immutable on public.documents;
create trigger trg_documents_signed_immutable
  before update on public.documents
  for each row
  execute function public.documents_block_signed_mutation();

-- RLS ---------------------------------------------------------------------

alter table public.document_templates enable row level security;
alter table public.documents enable row level security;
alter table public.document_signatures enable row level security;
alter table public.document_events enable row level security;

-- document_templates: authenticated read, admin write
drop policy if exists "Authenticated users can read document templates" on public.document_templates;
create policy "Authenticated users can read document templates"
  on public.document_templates for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

drop policy if exists "Admins can write document templates" on public.document_templates;
create policy "Admins can write document templates"
  on public.document_templates for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- documents: any profile reads, admin/auditor writes, admin deletes
drop policy if exists "Authenticated users can read documents" on public.documents;
create policy "Authenticated users can read documents"
  on public.documents for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

drop policy if exists "Staff can insert documents" on public.documents;
create policy "Staff can insert documents"
  on public.documents for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor')));

drop policy if exists "Staff can update documents" on public.documents;
create policy "Staff can update documents"
  on public.documents for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor')));

drop policy if exists "Admins can delete documents" on public.documents;
create policy "Admins can delete documents"
  on public.documents for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- document_signatures: staff read-only; writes only via service role
drop policy if exists "Authenticated users can read document signatures" on public.document_signatures;
create policy "Authenticated users can read document signatures"
  on public.document_signatures for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

drop policy if exists "Admins can delete document signatures" on public.document_signatures;
create policy "Admins can delete document signatures"
  on public.document_signatures for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- document_events: staff read; staff can insert their own manual admin events
drop policy if exists "Authenticated users can read document events" on public.document_events;
create policy "Authenticated users can read document events"
  on public.document_events for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));

drop policy if exists "Staff can insert own admin document events" on public.document_events;
create policy "Staff can insert own admin document events"
  on public.document_events for insert to authenticated
  with check (
    actor = 'admin'
    and actor_user_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor'))
  );
