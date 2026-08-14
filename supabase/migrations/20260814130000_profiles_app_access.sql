-- Per-user area access for the three main areas: Audits, Proposals, Documents.
--
-- Until now access was all-or-nothing: every staff account was an admin, and
-- Proposals/Documents visibility hung on hard-coded email lists in the client
-- bundle. Admins ignore app_access entirely (an admin can never lock themselves
-- out); members (role 'auditor') get whatever their checkboxes grant. Clients,
-- the Dashboard, the Line Item Catalog and API Connection stay open to all
-- staff by design and have no flag here.
--
-- Default is all-true, decided explicitly: a NEW invite starts able to work
-- everywhere and an admin unchecks per person, and rows predating this column
-- must not lose access on deploy.
alter table public.profiles
  add column if not exists app_access jsonb not null
    default '{"audits": true, "proposals": true, "documents": true}'::jsonb;

-- Backfill to preserve today's reality exactly. Everyone is currently an
-- admin only because accounts defaulted that way, and Proposals is visible
-- only to the beta list (emil, zak, xiomara) that this feature replaces.
-- So: the beta trio keep admin (they were the intended power users); the
-- other accounts become members whose checkboxes match what they can see
-- today, which is Audits and Documents but not Proposals. Nothing changes on
-- anyone's screen the moment this deploys, except that members lose the
-- Users tab they almost certainly never used.
update public.profiles
set role = 'auditor',
    app_access = '{"audits": true, "proposals": false, "documents": true}'::jsonb
where lower(email) not in (
  'emil@ecdigitalstrategy.com',
  'zak@ecdigitalstrategy.com',
  'xiomara@ecdigitalstrategy.com'
)
and role = 'admin';

-- The Line Item Catalog is now open to every staff account, so its write
-- policies widen from admin-only to admin + auditor. Reads were already open
-- to all authenticated users.
drop policy if exists "Admins can insert revenue opportunity templates" on public.revenue_opportunity_templates;
create policy "Staff can insert revenue opportunity templates"
  on public.revenue_opportunity_templates for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor')));

drop policy if exists "Admins can update revenue opportunity templates" on public.revenue_opportunity_templates;
create policy "Staff can update revenue opportunity templates"
  on public.revenue_opportunity_templates for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor')));

drop policy if exists "Admins can delete revenue opportunity templates" on public.revenue_opportunity_templates;
create policy "Staff can delete revenue opportunity templates"
  on public.revenue_opportunity_templates for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor')));
