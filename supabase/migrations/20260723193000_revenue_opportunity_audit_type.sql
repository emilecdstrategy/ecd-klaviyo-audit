-- Categorize catalog line items / services by which audit type they apply to:
-- 'web', 'klaviyo', or 'both'. Defaults to 'both' so anything unspecified keeps
-- surfacing everywhere.
alter table public.revenue_opportunity_templates
  add column if not exists audit_type text not null default 'both';

alter table public.revenue_opportunity_templates
  drop constraint if exists revenue_opportunity_templates_audit_type_check;
alter table public.revenue_opportunity_templates
  add constraint revenue_opportunity_templates_audit_type_check
  check (audit_type in ('web', 'klaviyo', 'both'));

-- Existing catalog is Klaviyo-focused, except the two cross-channel products which
-- apply to both Klaviyo and Website audits.
update public.revenue_opportunity_templates
  set audit_type = 'klaviyo'
  where slug not in ('klaviyo_customer_agent', 'klaviyo_customer_hub');

update public.revenue_opportunity_templates
  set audit_type = 'both'
  where slug in ('klaviyo_customer_agent', 'klaviyo_customer_hub');
