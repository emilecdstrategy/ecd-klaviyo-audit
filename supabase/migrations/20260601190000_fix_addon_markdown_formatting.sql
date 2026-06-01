-- Normalize legacy triple-asterisk bold markers (***Why Upgrade:***) to standard **bold** markdown.

UPDATE public.revenue_opportunity_templates
SET
  content = regexp_replace(content, '\*{3,}([^*]+?)\*{2,3}', '**\1**', 'g'),
  updated_at = now()
WHERE content ~ '\*{3,}';

-- Back-fill add-on content on existing audits from corrected templates.
UPDATE public.audits a
SET layout = jsonb_set(
  a.layout,
  '{revenue_summary,blocks,addOns,items}',
  (
    SELECT coalesce(jsonb_agg(
      CASE
        WHEN t.slug IS NOT NULL THEN
          item || jsonb_build_object(
            'name', t.name,
            'description', t.description,
            'content', t.content,
            'one_time_price', t.one_time_price,
            'one_time_label', t.one_time_label,
            'monthly_price', t.monthly_price,
            'monthly_label', t.monthly_label
          )
        ELSE item
      END
      ORDER BY (item->>'display_order')::int
    ), '[]'::jsonb)
    FROM jsonb_array_elements(a.layout->'revenue_summary'->'blocks'->'addOns'->'items') AS item
    LEFT JOIN public.revenue_opportunity_templates t
      ON t.slug = item->>'template_slug'
  ),
  true
)
WHERE a.layout->'revenue_summary'->'blocks'->'addOns'->'items' IS NOT NULL
  AND jsonb_array_length(a.layout->'revenue_summary'->'blocks'->'addOns'->'items') > 0;

-- Normalize any remaining malformed markdown directly on audit add-on content
-- (covers custom edits or audits saved before template backfill).
UPDATE public.audits a
SET layout = jsonb_set(
  a.layout,
  '{revenue_summary,blocks,addOns,items}',
  (
    SELECT coalesce(jsonb_agg(
      CASE
        WHEN coalesce(item->>'content', '') ~ '\*{3,}' THEN
          item || jsonb_build_object(
            'content', regexp_replace(item->>'content', '\*{3,}([^*]+?)\*{2,3}', '**\1**', 'g')
          )
        ELSE item
      END
      ORDER BY (item->>'display_order')::int
    ), '[]'::jsonb)
    FROM jsonb_array_elements(a.layout->'revenue_summary'->'blocks'->'addOns'->'items') AS item
  ),
  true
)
WHERE a.layout->'revenue_summary'->'blocks'->'addOns'->'items' IS NOT NULL
  AND jsonb_array_length(a.layout->'revenue_summary'->'blocks'->'addOns'->'items') > 0
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(a.layout->'revenue_summary'->'blocks'->'addOns'->'items') AS item
    WHERE coalesce(item->>'content', '') ~ '\*{3,}'
  );
