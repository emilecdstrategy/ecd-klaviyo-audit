-- Refresh add-on template copy: bullet lists instead of **bold** markdown paragraphs.
update public.revenue_opportunity_templates
set
  content = E'- Collect compliant SMS consent at signup, checkout, and post-purchase touchpoints.
- Launch core SMS automations for welcome, cart recovery, and post-purchase retention.
- Coordinate email and SMS messaging to increase conversion while controlling send fatigue.',
  bullets = '[]'::jsonb,
  updated_at = now()
where slug = 'klaviyo_sms';

update public.revenue_opportunity_templates
set
  content = E'- Automate common pre-purchase questions with accurate product and policy responses.
- Escalate high-intent conversations to human support with clear handoff rules.
- Use conversation insights to improve flows, campaigns, and onsite messaging.',
  bullets = '[]'::jsonb,
  updated_at = now()
where slug = 'klaviyo_customer_agent';

-- Sync add-on body copy for the shared audit report from updated templates.
update public.audits a
set
  layout = jsonb_set(
    a.layout,
    '{revenue_summary,blocks,addOns,items}',
    (
      select coalesce(jsonb_agg(
        case
          when t.slug is not null then
            item || jsonb_build_object('content', t.content, 'bullets', '[]'::jsonb)
          else item
        end
        order by ord
      ), '[]'::jsonb)
      from jsonb_array_elements(a.layout->'revenue_summary'->'blocks'->'addOns'->'items')
        with ordinality as x(item, ord)
      left join public.revenue_opportunity_templates t
        on t.slug = item->>'template_slug'
    ),
    true
  ),
  updated_at = now()
where a.public_share_token = 'ebcb221bba5e4b4db2bd3b79'
  and a.layout->'revenue_summary'->'blocks'->'addOns'->'items' is not null
  and jsonb_array_length(a.layout->'revenue_summary'->'blocks'->'addOns'->'items') > 0;
