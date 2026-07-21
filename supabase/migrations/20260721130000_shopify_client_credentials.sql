-- Shopify moved off legacy custom apps (retired 2026-01-01): new connections use
-- a Dev Dashboard app's client id + secret exchanged for a short-lived token via
-- the client_credentials grant. Store the app client id (public) on the
-- connection and reuse client_secrets.shopify_admin_token_* to hold the encrypted
-- client secret. Existing rows keep auth_method 'admin_token' and still work.

ALTER TABLE public.shopify_connections
  ADD COLUMN IF NOT EXISTS app_client_id text;

ALTER TABLE public.shopify_connections
  DROP CONSTRAINT IF EXISTS shopify_connections_auth_method_check;

ALTER TABLE public.shopify_connections
  ADD CONSTRAINT shopify_connections_auth_method_check
  CHECK (auth_method IN ('admin_token', 'oauth', 'client_credentials'));
