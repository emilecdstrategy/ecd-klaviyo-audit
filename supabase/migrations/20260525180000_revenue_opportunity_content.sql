alter table public.revenue_opportunity_templates
  add column if not exists content text not null default '';

-- Migrate legacy bullet arrays into markdown content.
update public.revenue_opportunity_templates
set content = (
  select string_agg(elem, E'\n\n')
  from jsonb_array_elements_text(bullets) as elem
  where trim(elem) <> ''
)
where coalesce(trim(content), '') = ''
  and bullets is not null
  and bullets <> '[]'::jsonb;

-- Default templates: paragraph formatting (blank lines between points, no forced bullets).
update public.revenue_opportunity_templates
set
  content = E'**Collect compliant SMS consent** at signup, checkout, and post-purchase touchpoints.

**Launch core SMS automations** for welcome, cart recovery, and post-purchase retention.

**Coordinate email + SMS messaging** to increase conversion while controlling fatigue.',
  bullets = '[]'::jsonb,
  updated_at = now()
where slug = 'klaviyo_sms';

update public.revenue_opportunity_templates
set
  content = E'**Automate common pre-purchase questions** with accurate product and policy responses.

**Escalate high-intent conversations** to human support with clear handoff rules.

**Use conversation insights** to improve flows, campaigns, and onsite messaging strategy.',
  bullets = '[]'::jsonb,
  updated_at = now()
where slug = 'klaviyo_customer_agent';
