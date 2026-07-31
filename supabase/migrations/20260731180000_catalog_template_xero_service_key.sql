-- Assign each catalog template to a Xero revenue bucket ONCE, so a proposal line
-- created from the catalog codes itself instead of relying on someone picking the
-- bucket by hand every time. The per-line field stays an override.
alter table public.revenue_opportunity_templates
  add column if not exists xero_service_key text;

comment on column public.revenue_opportunity_templates.xero_service_key is
  'Default Xero revenue bucket (xero_revenue_accounts.service_key) for lines created from this template. Copied onto proposal_line_items.xero_service_key, which remains overridable per line.';

create index if not exists idx_revenue_templates_xero_service_key
  on public.revenue_opportunity_templates (xero_service_key);
