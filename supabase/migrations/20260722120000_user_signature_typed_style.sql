-- Remember HOW a saved signature was made so the type-to-sign style (font +
-- typed name) is reused, not just the rendered image. Existing rows default to
-- 'draw' and keep working unchanged.
alter table public.user_signatures
  add column if not exists signature_type text not null default 'draw',
  add column if not exists typed_name text not null default '',
  add column if not exists signature_font text not null default '';
