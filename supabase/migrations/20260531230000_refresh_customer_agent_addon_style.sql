-- Restyle Klaviyo Customer Agent to match other Klaviyo add-ons (value bullets + ECD Pricing).
update public.revenue_opportunity_templates
set
  description = 'Customer Agent turns your product catalog and support policies into an always-on AI assistant that converts shoppers on web chat, SMS, and email—and resolves post-purchase questions without waiting on your team.',
  content = E'- Customer Agent is:- A branded AI assistant trained on your knowledge base and site voice
- Core skills for order tracking, product recommendations, and discount retrieval
- Escalation rules with web chat plus optional SMS and email response channels
- Post-purchase order edits, cancellations, and tracking within a configurable order window

**ECD Pricing:**
- **Implementation: **$2,500 one-time',
  bullets = '[]'::jsonb,
  updated_at = now()
where slug = 'klaviyo_customer_agent';

-- Backfill customer agent copy on every audit that includes this add-on.
update public.audits a
set
  layout = jsonb_set(
    a.layout,
    '{revenue_summary,blocks,addOns,items}',
    (
      select coalesce(jsonb_agg(
        case
          when item->>'template_slug' = 'klaviyo_customer_agent' then
            item || jsonb_build_object(
              'name', t.name,
              'description', t.description,
              'content', t.content,
              'bullets', '[]'::jsonb
            )
          else item
        end
        order by ord
      ), '[]'::jsonb)
      from jsonb_array_elements(a.layout->'revenue_summary'->'blocks'->'addOns'->'items')
        with ordinality as x(item, ord)
      cross join public.revenue_opportunity_templates t
      where t.slug = 'klaviyo_customer_agent'
    ),
    true
  ),
  updated_at = now()
where a.layout->'revenue_summary'->'blocks'->'addOns'->'items' is not null
  and exists (
    select 1
    from jsonb_array_elements(a.layout->'revenue_summary'->'blocks'->'addOns'->'items') item
    where item->>'template_slug' = 'klaviyo_customer_agent'
  );
