ALTER TABLE public.klaviyo_connections
  ADD COLUMN IF NOT EXISTS website_url text;

