create table if not exists public.proposal_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  content_blocks jsonb not null default '[]'::jsonb,
  default_line_items jsonb not null default '[]'::jsonb,
  default_contracts jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.proposal_templates
  enable row level security;

drop policy if exists "Authenticated users can read proposal templates" on public.proposal_templates;
create policy "Authenticated users can read proposal templates"
  on public.proposal_templates
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
    )
  );

drop policy if exists "Admins can insert proposal templates" on public.proposal_templates;
create policy "Admins can insert proposal templates"
  on public.proposal_templates
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

drop policy if exists "Admins can update proposal templates" on public.proposal_templates;
create policy "Admins can update proposal templates"
  on public.proposal_templates
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

drop policy if exists "Admins can delete proposal templates" on public.proposal_templates;
create policy "Admins can delete proposal templates"
  on public.proposal_templates
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

create index if not exists idx_proposal_templates_active_order
  on public.proposal_templates (is_active, display_order, name);

insert into public.proposal_templates (name, content_blocks, default_contracts, display_order)
select
  'Standard Proposal',
  '[
    {"key": "intro", "title": "Introduction", "content": "Thank you for the opportunity to work together. This proposal outlines the services, investment, and terms for the engagement described below."},
    {"key": "terms", "title": "Terms & Next Steps", "content": "Upon acceptance, we will schedule a kickoff call to align on timelines and access. Invoicing begins at project start unless otherwise noted."}
  ]'::jsonb,
  '["msa", "operating_agreement"]'::jsonb,
  10
where not exists (select 1 from public.proposal_templates);
