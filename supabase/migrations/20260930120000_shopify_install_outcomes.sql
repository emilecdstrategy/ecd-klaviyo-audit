-- What happened to each started Shopify install, so an install that never
-- finished can be explained and resumed instead of silently forgotten.
-- (Two Simple & Dainty installs on Sep 30 left no trace of why they stopped.)
alter table public.shopify_oauth_installs
  add column if not exists failed_reason text,
  add column if not exists failed_at timestamptz,
  -- Set when Shopify opened the app itself (its App URL) instead of returning to
  -- the callback, and the callback sent the merchant through authorize once more.
  -- Guards against bouncing between the two.
  add column if not exists relaunched_at timestamptz;

create index if not exists shopify_oauth_installs_client_created
  on public.shopify_oauth_installs (client_id, created_at desc);
create index if not exists shopify_oauth_installs_shop_created
  on public.shopify_oauth_installs (shop_domain, created_at desc);
