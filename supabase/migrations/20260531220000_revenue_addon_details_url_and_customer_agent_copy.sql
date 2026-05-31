-- Optional external docs link for add-on cards ("View more details").
alter table public.revenue_opportunity_templates
  add column if not exists details_url text;

-- Condensed Klaviyo Customer Agent pitch (matches SMS add-on length; no optional add-on pricing).
update public.revenue_opportunity_templates
set
  description = 'Deploy an AI shopping assistant trained on your catalog and policies to convert and support customers around the clock.',
  content = E'- Import your knowledge base and tune brand voice, escalation rules, and core skills (order tracking, recommendations, discounts).
- Launch on web chat with optional SMS and email so customers get instant answers on their preferred channel.
- Enable post-purchase support—order edits, cancellations, and tracking—within a configurable order window.',
  bullets = '[]'::jsonb,
  updated_at = now()
where slug = 'klaviyo_customer_agent';

-- Sync customer agent copy (+ details_url when set on template) for the Flamingo Estate audit report.
update public.audits a
set
  layout = jsonb_set(
    a.layout,
    '{revenue_summary,blocks,addOns,items}',
    (
      select coalesce(jsonb_agg(
        case
          when t.slug is not null then
            item || jsonb_build_object(
              'name', t.name,
              'description', t.description,
              'content', t.content,
              'details_url', t.details_url,
              'bullets', '[]'::jsonb
            )
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
