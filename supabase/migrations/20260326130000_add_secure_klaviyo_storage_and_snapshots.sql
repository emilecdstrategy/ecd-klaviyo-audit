/*
  Secure Klaviyo key storage + snapshot tables for API-based audits.
*/

-- Client secret storage (encrypted at rest)
CREATE TABLE IF NOT EXISTS client_secrets (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  klaviyo_private_key_ciphertext text,
  klaviyo_private_key_iv text,
  klaviyo_private_key_alg text NOT NULL DEFAULT 'AES-256-GCM',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE client_secrets ENABLE ROW LEVEL SECURITY;

-- No direct access from client; Edge Functions use service role.
DO $$ BEGIN
  CREATE POLICY "No direct access to client_secrets"
    ON client_secrets FOR ALL
    TO authenticated
    USING (false)
    WITH CHECK (false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Connections metadata (safe to read)
CREATE TABLE IF NOT EXISTS klaviyo_connections (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  account_id text,
  account_name text,
  timezone text,
  preferred_currency text,
  revision text NOT NULL DEFAULT '2026-01-15',
  scopes jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE klaviyo_connections ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Authenticated users can read klaviyo connections"
    ON klaviyo_connections FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Auditors and admins can write klaviyo connections"
    ON klaviyo_connections FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','auditor')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','auditor')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Snapshot tables (per audit run)
CREATE TABLE IF NOT EXISTS klaviyo_flow_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid REFERENCES public.audits(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  flow_id text NOT NULL,
  name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT '',
  trigger_type text,
  archived boolean,
  created_at_klaviyo timestamptz,
  updated_at_klaviyo timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  raw jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_klaviyo_flow_snapshots_audit_id ON klaviyo_flow_snapshots(audit_id);
CREATE INDEX IF NOT EXISTS idx_klaviyo_flow_snapshots_client_id ON klaviyo_flow_snapshots(client_id);

ALTER TABLE klaviyo_flow_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Authenticated users can read klaviyo flow snapshots"
    ON klaviyo_flow_snapshots FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Auditors and admins can write klaviyo flow snapshots"
    ON klaviyo_flow_snapshots FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','auditor')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','auditor')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS klaviyo_campaign_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid REFERENCES public.audits(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  campaign_id text NOT NULL,
  name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT '',
  send_channel text,
  created_at_klaviyo timestamptz,
  updated_at_klaviyo timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  raw jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_klaviyo_campaign_snapshots_audit_id ON klaviyo_campaign_snapshots(audit_id);
CREATE INDEX IF NOT EXISTS idx_klaviyo_campaign_snapshots_client_id ON klaviyo_campaign_snapshots(client_id);

ALTER TABLE klaviyo_campaign_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Authenticated users can read klaviyo campaign snapshots"
    ON klaviyo_campaign_snapshots FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Auditors and admins can write klaviyo campaign snapshots"
    ON klaviyo_campaign_snapshots FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','auditor')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','auditor')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS klaviyo_form_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid REFERENCES public.audits(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  form_id text NOT NULL,
  name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT '',
  ab_test boolean,
  created_at_klaviyo timestamptz,
  updated_at_klaviyo timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  raw jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_klaviyo_form_snapshots_audit_id ON klaviyo_form_snapshots(audit_id);
CREATE INDEX IF NOT EXISTS idx_klaviyo_form_snapshots_client_id ON klaviyo_form_snapshots(client_id);

ALTER TABLE klaviyo_form_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Authenticated users can read klaviyo form snapshots"
    ON klaviyo_form_snapshots FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Auditors and admins can write klaviyo form snapshots"
    ON klaviyo_form_snapshots FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','auditor')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','auditor')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS klaviyo_segment_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid REFERENCES public.audits(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  segment_id text NOT NULL,
  name text NOT NULL DEFAULT '',
  created_at_klaviyo timestamptz,
  updated_at_klaviyo timestamptz,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  raw jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_klaviyo_segment_snapshots_audit_id ON klaviyo_segment_snapshots(audit_id);
CREATE INDEX IF NOT EXISTS idx_klaviyo_segment_snapshots_client_id ON klaviyo_segment_snapshots(client_id);

ALTER TABLE klaviyo_segment_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Authenticated users can read klaviyo segment snapshots"
    ON klaviyo_segment_snapshots FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Auditors and admins can write klaviyo segment snapshots"
    ON klaviyo_segment_snapshots FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','auditor')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','auditor')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Reporting rollups persisted for traceability
CREATE TABLE IF NOT EXISTS klaviyo_reporting_rollups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid REFERENCES public.audits(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  timeframe_key text NOT NULL,
  conversion_metric_id text,
  campaigns jsonb NOT NULL DEFAULT '[]'::jsonb,
  flows jsonb NOT NULL DEFAULT '[]'::jsonb,
  computed jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_klaviyo_reporting_rollups_audit_id ON klaviyo_reporting_rollups(audit_id);

ALTER TABLE klaviyo_reporting_rollups ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Authenticated users can read klaviyo reporting rollups"
    ON klaviyo_reporting_rollups FOR SELECT
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Auditors and admins can write klaviyo reporting rollups"
    ON klaviyo_reporting_rollups FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','auditor')))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','auditor')));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Safe indicator column on clients (replaces api_key_placeholder usage)
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS klaviyo_connected boolean NOT NULL DEFAULT false;

