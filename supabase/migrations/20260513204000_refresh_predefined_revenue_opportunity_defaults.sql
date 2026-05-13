update public.revenue_opportunity_templates
set
  name = 'Klaviyo SMS',
  description = 'Launch Klaviyo SMS to unlock incremental lifecycle revenue from high-intent subscribers.',
  bullets = '[
    "**Collect compliant SMS consent** at signup, checkout, and post-purchase touchpoints.",
    "**Launch core SMS automations** for welcome, cart recovery, and post-purchase retention.",
    "**Coordinate email + SMS messaging** to increase conversion while controlling fatigue."
  ]'::jsonb,
  updated_at = now()
where slug = 'klaviyo_sms';

update public.revenue_opportunity_templates
set
  name = 'Klaviyo Customer Agent',
  description = 'Deploy Klaviyo Customer Agent to improve shopper conversion and support efficiency.',
  bullets = '[
    "**Automate common pre-purchase questions** with accurate product and policy responses.",
    "**Escalate high-intent conversations** to human support with clear handoff rules.",
    "**Use conversation insights** to improve flows, campaigns, and onsite messaging strategy."
  ]'::jsonb,
  updated_at = now()
where slug = 'klaviyo_customer_agent';
