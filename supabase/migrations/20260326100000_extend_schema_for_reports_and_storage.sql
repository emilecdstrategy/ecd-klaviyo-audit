/*
  Extend initial schema to match the UI data model.

  Adds:
  - audits.show_recommendations
  - recommendations
  - flow_performance
  - health_scores
  - storage bucket for audit assets (public read)
*/

-- audits.show_recommendations (used by Public Report UI)
ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS show_recommendations boolean NOT NULL DEFAULT true;

-- Recommendations (used by Public Report UI)
CREATE TABLE IF NOT EXISTS recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid REFERENCES audits(id) ON DELETE CASCADE,
  tier text NOT NULL DEFAULT 'quick_win' CHECK (tier IN ('quick_win', 'medium', 'strategic')),
  title text NOT NULL DEFAULT '',
  impact text NOT NULL DEFAULT '',
  effort text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read recommendations"
  ON recommendations FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()));

CREATE POLICY "Auditors and admins can insert recommendations"
  ON recommendations FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'auditor')));

CREATE POLICY "Auditors and admins can update recommendations"
  ON recommendations FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'auditor')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'auditor')));

CREATE POLICY "Admins can delete recommendations"
  ON recommendations FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- Public access for recommendations of shared reports
CREATE POLICY "Public can read recommendations of published audits"
  ON recommendations FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM audits a
      WHERE a.id = recommendations.audit_id
      AND a.status = 'published'
      AND a.public_share_token IS NOT NULL
    )
  );

-- Flow performance (used by Public Report UI)
CREATE TABLE IF NOT EXISTS flow_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid REFERENCES audits(id) ON DELETE CASCADE,
  flow_name text NOT NULL DEFAULT '',
  flow_status text NOT NULL DEFAULT 'missing' CHECK (flow_status IN ('live', 'draft', 'missing', 'paused')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low', 'quick_win')),
  recipients_per_month integer NOT NULL DEFAULT 0,
  actual_open_rate numeric,
  benchmark_open_rate_low numeric NOT NULL DEFAULT 0,
  benchmark_open_rate_high numeric NOT NULL DEFAULT 0,
  actual_click_rate numeric,
  benchmark_click_rate_low numeric NOT NULL DEFAULT 0,
  benchmark_click_rate_high numeric NOT NULL DEFAULT 0,
  actual_conv_rate numeric,
  benchmark_conv_rate_low numeric NOT NULL DEFAULT 0,
  benchmark_conv_rate_high numeric NOT NULL DEFAULT 0,
  monthly_revenue_current numeric NOT NULL DEFAULT 0,
  monthly_revenue_opportunity numeric NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE flow_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read flow performance"
  ON flow_performance FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()));

CREATE POLICY "Auditors and admins can insert flow performance"
  ON flow_performance FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'auditor')));

CREATE POLICY "Auditors and admins can update flow performance"
  ON flow_performance FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'auditor')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'auditor')));

CREATE POLICY "Admins can delete flow performance"
  ON flow_performance FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- Public access for flow performance of shared reports
CREATE POLICY "Public can read flow performance of published audits"
  ON flow_performance FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM audits a
      WHERE a.id = flow_performance.audit_id
      AND a.status = 'published'
      AND a.public_share_token IS NOT NULL
    )
  );

-- Health scores (used by Public Report UI)
CREATE TABLE IF NOT EXISTS health_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid REFERENCES audits(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT '',
  score integer NOT NULL DEFAULT 0,
  max_score integer NOT NULL DEFAULT 10,
  status text NOT NULL DEFAULT 'warning' CHECK (status IN ('good', 'warning', 'bad')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE health_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read health scores"
  ON health_scores FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()));

CREATE POLICY "Auditors and admins can write health scores"
  ON health_scores FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'auditor')))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'auditor')));

-- Public access for health scores of shared reports
CREATE POLICY "Public can read health scores of published audits"
  ON health_scores FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM audits a
      WHERE a.id = health_scores.audit_id
      AND a.status = 'published'
      AND a.public_share_token IS NOT NULL
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_recommendations_audit_id ON recommendations(audit_id);
CREATE INDEX IF NOT EXISTS idx_flow_performance_audit_id ON flow_performance(audit_id);
CREATE INDEX IF NOT EXISTS idx_health_scores_audit_id ON health_scores(audit_id);

-- Storage bucket for audit assets (public read; write restricted by policies below)
INSERT INTO storage.buckets (id, name, public)
VALUES ('audit-assets', 'audit-assets', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Storage policies
-- Allow anyone to read objects in the public audit-assets bucket
CREATE POLICY "Public read audit assets bucket"
  ON storage.objects FOR SELECT
  TO anon
  USING (bucket_id = 'audit-assets');

-- Allow authenticated auditors/admins to upload to audit-assets bucket
CREATE POLICY "Auditors and admins can upload audit assets"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'audit-assets'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'auditor')
    )
  );

-- Allow authenticated auditors/admins to update objects in audit-assets bucket
CREATE POLICY "Auditors and admins can update audit assets"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'audit-assets'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'auditor')
    )
  )
  WITH CHECK (
    bucket_id = 'audit-assets'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'auditor')
    )
  );

-- Allow authenticated admins to delete objects in audit-assets bucket
CREATE POLICY "Admins can delete audit assets"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'audit-assets'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
      AND p.role = 'admin'
    )
  );

