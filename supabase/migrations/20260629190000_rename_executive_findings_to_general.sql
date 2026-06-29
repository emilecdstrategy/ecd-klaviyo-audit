-- Rename account-level executive summary findings block title.

UPDATE public.audits
SET layout = jsonb_set(
  COALESCE(layout, '{}'::jsonb),
  '{executive_summary,blocks,findings,title}',
  '"General Key Findings"'::jsonb,
  true
)
WHERE COALESCE(layout->'executive_summary'->'blocks'->'findings'->>'title', 'Key Findings') = 'Key Findings';
