-- Store the real bounding boxes of the page's elements (captured by the headless
-- browser at the same render as the viewport screenshot). The AI picks an
-- element id instead of guessing pixel coordinates, so highlight pins land
-- exactly on the element. Shape: [{ id, label, x, y, w, h }] as % of the viewport.
alter table public.web_page_snapshots
  add column if not exists elements jsonb not null default '[]'::jsonb;
