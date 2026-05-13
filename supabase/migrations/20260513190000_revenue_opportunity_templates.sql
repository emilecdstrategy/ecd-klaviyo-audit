create table if not exists public.revenue_opportunity_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  bullets jsonb not null default '[]'::jsonb,
  default_revenue_monthly numeric not null default 0,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.revenue_opportunity_templates
  enable row level security;

drop policy if exists "Authenticated users can read revenue opportunity templates" on public.revenue_opportunity_templates;
create policy "Authenticated users can read revenue opportunity templates"
  on public.revenue_opportunity_templates
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
    )
  );

drop policy if exists "Admins can insert revenue opportunity templates" on public.revenue_opportunity_templates;
create policy "Admins can insert revenue opportunity templates"
  on public.revenue_opportunity_templates
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

drop policy if exists "Admins can update revenue opportunity templates" on public.revenue_opportunity_templates;
create policy "Admins can update revenue opportunity templates"
  on public.revenue_opportunity_templates
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

drop policy if exists "Admins can delete revenue opportunity templates" on public.revenue_opportunity_templates;
create policy "Admins can delete revenue opportunity templates"
  on public.revenue_opportunity_templates
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

create index if not exists idx_rev_opp_templates_active_order
  on public.revenue_opportunity_templates (is_active, display_order, name);

insert into public.revenue_opportunity_templates (
  slug,
  name,
  description,
  bullets,
  default_revenue_monthly,
  display_order,
  is_active
)
values
  (
    'klaviyo_sms',
    'Klaviyo SMS',
    'Launch Klaviyo SMS to unlock incremental lifecycle revenue from high-intent subscribers.',
    '[
      "**Collect compliant SMS consent** at signup, checkout, and post-purchase touchpoints.",
      "**Launch core SMS automations** for welcome, cart recovery, and post-purchase retention.",
      "**Coordinate email + SMS messaging** to increase conversion while controlling fatigue."
    ]'::jsonb,
    0,
    10,
    true
  ),
  (
    'klaviyo_customer_agent',
    'Klaviyo Customer Agent',
    'Deploy Klaviyo Customer Agent to improve shopper conversion and support efficiency.',
    '[
      "**Automate common pre-purchase questions** with accurate product and policy responses.",
      "**Escalate high-intent conversations** to human support with clear handoff rules.",
      "**Use conversation insights** to improve flows, campaigns, and onsite messaging strategy."
    ]'::jsonb,
    0,
    20,
    true
  )
on conflict (slug) do update
set
  name = excluded.name,
  description = excluded.description,
  bullets = excluded.bullets,
  default_revenue_monthly = excluded.default_revenue_monthly,
  display_order = excluded.display_order,
  is_active = excluded.is_active,
  updated_at = now();
