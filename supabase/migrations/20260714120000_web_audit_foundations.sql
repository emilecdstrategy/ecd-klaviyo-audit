/*
  Web audit foundations: audit_type discriminator, Shopify connection storage,
  and web/shopify snapshot tables. Mirrors the Klaviyo patterns.
*/

-- Audit type discriminator
ALTER TABLE public.audits
  ADD COLUMN IF NOT EXISTS audit_type text NOT NULL DEFAULT 'klaviyo';

DO $$ BEGIN
  ALTER TABLE public.audits
    ADD CONSTRAINT audits_audit_type_check CHECK (audit_type IN ('klaviyo','web'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_audits_audit_type ON public.audits(audit_type);

-- Shopify admin token storage alongside the Klaviyo key (encrypted at rest)
ALTER TABLE public.client_secrets
  ADD COLUMN IF NOT EXISTS shopify_admin_token_ciphertext text,
  ADD COLUMN IF NOT EXISTS shopify_admin_token_iv text,
  ADD COLUMN IF NOT EXISTS shopify_admin_token_alg text NOT NULL DEFAULT 'AES-256-GCM';

-- Connections metadata (safe to read)
CREATE TABLE IF NOT EXISTS public.shopify_connections (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  shop_domain text NOT NULL,
  shop_id text,
  shop_name text,
  currency text,
  timezone text,
  plan_name text,
  auth_method text NOT NULL DEFAULT 'admin_token' CHECK (auth_method IN ('admin_token','oauth')),
  api_version text NOT NULL DEFAULT '2026-04',
  scopes jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shopify_connections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Authenticated users can read shopify connections"
    ON public.shopify_connections FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Auditors and admins can write shopify connections"
    ON public.shopify_connections FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','auditor')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','auditor')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Web page snapshots (screenshots per audit)
CREATE TABLE IF NOT EXISTS public.web_page_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid REFERENCES public.audits(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  page_type text NOT NULL CHECK (page_type IN ('homepage','product','collection','cart')),
  viewport text NOT NULL CHECK (viewport IN ('desktop','mobile')),
  url text NOT NULL,
  screenshot_path text,
  screenshot_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','error')),
  error_message text,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_web_page_snapshots_audit_id ON public.web_page_snapshots(audit_id);
CREATE INDEX IF NOT EXISTS idx_web_page_snapshots_client_id ON public.web_page_snapshots(client_id);

ALTER TABLE public.web_page_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Authenticated users can read web page snapshots"
    ON public.web_page_snapshots FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Auditors and admins can write web page snapshots"
    ON public.web_page_snapshots FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','auditor')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','auditor')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Shopify data snapshots (backend metrics per audit)
CREATE TABLE IF NOT EXISTS public.shopify_data_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid REFERENCES public.audits(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  snapshot_kind text NOT NULL CHECK (snapshot_kind IN ('shop','orders_rollup','products')),
  timeframe_key text,
  computed jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shopify_data_snapshots_audit_id ON public.shopify_data_snapshots(audit_id);
CREATE INDEX IF NOT EXISTS idx_shopify_data_snapshots_client_id ON public.shopify_data_snapshots(client_id);

ALTER TABLE public.shopify_data_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Authenticated users can read shopify data snapshots"
    ON public.shopify_data_snapshots FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Auditors and admins can write shopify data snapshots"
    ON public.shopify_data_snapshots FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','auditor')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','auditor')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Safe indicator column on clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS shopify_connected boolean NOT NULL DEFAULT false;
