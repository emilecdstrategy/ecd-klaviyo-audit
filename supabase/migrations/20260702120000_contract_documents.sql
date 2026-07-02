create table if not exists public.contract_documents (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  content text not null default '',
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.contract_documents
  enable row level security;

drop policy if exists "Authenticated users can read contract documents" on public.contract_documents;
create policy "Authenticated users can read contract documents"
  on public.contract_documents
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
    )
  );

drop policy if exists "Admins can insert contract documents" on public.contract_documents;
create policy "Admins can insert contract documents"
  on public.contract_documents
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  );

drop policy if exists "Admins can update contract documents" on public.contract_documents;
create policy "Admins can update contract documents"
  on public.contract_documents
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  );

drop policy if exists "Admins can delete contract documents" on public.contract_documents;
create policy "Admins can delete contract documents"
  on public.contract_documents
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  );

insert into public.contract_documents (slug, name, content, display_order)
values
  ('msa', 'Master Services Agreement', '', 10),
  ('operating_agreement', 'Operating Agreement', '', 20)
on conflict (slug) do nothing;
