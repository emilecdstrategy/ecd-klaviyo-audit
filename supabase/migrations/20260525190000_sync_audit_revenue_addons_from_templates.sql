-- Sync existing audit add-on items from current revenue opportunity templates.
-- Preserves per-audit revenue_monthly, is_hidden, and display_order.
update public.audits a
set layout = jsonb_set(
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
)
where a.layout->'revenue_summary'->'blocks'->'addOns'->'items' is not null
  and jsonb_array_length(a.layout->'revenue_summary'->'blocks'->'addOns'->'items') > 0;
