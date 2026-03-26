/*
  # Initial Schema for ECD Klaviyo Audit Dashboard

  1. New Tables
    - `profiles` - user profiles with roles (admin, auditor, viewer)
      - `id` (uuid, references auth.users)
      - `name` (text)
      - `email` (text)
      - `role` (text: admin, auditor, viewer)
      - `created_at` (timestamptz)
    - `clients` - client/prospect companies
      - `id` (uuid, primary key)
      - `name` (text)
      - `company_name` (text)
      - `website_url` (text)
      - `industry` (text)
      - `esp_platform` (text)
      - `api_key_placeholder` (text)
      - `notes` (text)
      - `created_by` (uuid)
      - `created_at` (timestamptz)
    - `audits` - audit records
      - `id` (uuid, primary key)
      - `client_id` (uuid, references clients)
      - `title` (text)
      - `status` (text: draft, in_progress, review, completed, published)
      - `audit_method` (text: api, screenshot)
      - `list_size` (integer)
      - `aov` (numeric)
      - `monthly_traffic` (integer)
      - `total_revenue_opportunity` (numeric)
      - `executive_summary` (text)
      - `created_by` (uuid)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      - `published_at` (timestamptz)
      - `public_share_token` (text, unique)
    - `audit_sections` - individual sections of an audit
      - `id` (uuid, primary key)
      - `audit_id` (uuid, references audits)
      - `section_key` (text)
      - `current_state_title` (text)
      - `optimized_state_title` (text)
      - `current_state_notes` (text)
      - `optimized_notes` (text)
      - `ai_findings` (text)
      - `human_edited_findings` (text)
      - `summary_text` (text)
      - `revenue_opportunity` (numeric)
      - `confidence` (text)
      - `status` (text: draft, reviewed, approved)
    - `audit_assets` - uploaded screenshots and images
      - `id` (uuid, primary key)
      - `audit_id` (uuid)
      - `client_id` (uuid)
      - `asset_type` (text)
      - `file_url` (text)
      - `file_name` (text)
      - `section_key` (text)
      - `side` (text: current, optimized)
      - `uploaded_at` (timestamptz)
    - `annotations` - callout labels on images
      - `id` (uuid, primary key)
      - `audit_section_id` (uuid)
      - `asset_id` (uuid)
      - `x_position` (numeric)
      - `y_position` (numeric)
      - `label` (text)
      - `side` (text: current, optimized)
      - `created_at` (timestamptz)
    - `industry_examples` - benchmark email examples library
      - `id` (uuid, primary key)
      - `industry` (text)
      - `email_type` (text)
      - `title` (text)
      - `image_url` (text)
      - `tags` (text[])
      - `notes` (text)

  2. Security
    - RLS enabled on all tables
    - Authenticated users can access data based on role
*/

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'auditor', 'viewer')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Admins can read all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Admins can update any profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

CREATE POLICY "Admins can insert profiles"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
    )
    OR auth.uid() = id
  );

-- Clients table
CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  company_name text NOT NULL DEFAULT '',
  website_url text DEFAULT '',
  industry text DEFAULT '',
  esp_platform text DEFAULT 'Klaviyo',
  api_key_placeholder text DEFAULT '',
  notes text DEFAULT '',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read clients"
  ON clients FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "Auditors and admins can insert clients"
  ON clients FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'auditor')
    )
  );

CREATE POLICY "Auditors and admins can update clients"
  ON clients FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'auditor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'auditor')
    )
  );

CREATE POLICY "Admins can delete clients"
  ON clients FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Audits table
CREATE TABLE IF NOT EXISTS audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id),
  title text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'review', 'completed', 'published')),
  audit_method text DEFAULT 'screenshot' CHECK (audit_method IN ('api', 'screenshot')),
  list_size integer DEFAULT 0,
  aov numeric DEFAULT 0,
  monthly_traffic integer DEFAULT 0,
  total_revenue_opportunity numeric DEFAULT 0,
  executive_summary text DEFAULT '',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  published_at timestamptz,
  public_share_token text UNIQUE
);

ALTER TABLE audits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read audits"
  ON audits FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "Auditors and admins can insert audits"
  ON audits FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'auditor')
    )
  );

CREATE POLICY "Auditors and admins can update audits"
  ON audits FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'auditor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'auditor')
    )
  );

CREATE POLICY "Admins can delete audits"
  ON audits FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Public access for shared reports
CREATE POLICY "Public can read published audits by share token"
  ON audits FOR SELECT
  TO anon
  USING (
    status = 'published' AND public_share_token IS NOT NULL
  );

-- Audit Sections table
CREATE TABLE IF NOT EXISTS audit_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid REFERENCES audits(id) ON DELETE CASCADE,
  section_key text NOT NULL DEFAULT '',
  current_state_title text DEFAULT '',
  optimized_state_title text DEFAULT '',
  current_state_notes text DEFAULT '',
  optimized_notes text DEFAULT '',
  ai_findings text DEFAULT '',
  human_edited_findings text DEFAULT '',
  summary_text text DEFAULT '',
  revenue_opportunity numeric DEFAULT 0,
  confidence text DEFAULT 'medium' CHECK (confidence IN ('low', 'medium', 'high')),
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed', 'approved'))
);

ALTER TABLE audit_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read audit sections"
  ON audit_sections FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "Auditors and admins can insert audit sections"
  ON audit_sections FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'auditor')
    )
  );

CREATE POLICY "Auditors and admins can update audit sections"
  ON audit_sections FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'auditor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'auditor')
    )
  );

-- Public access for shared report sections
CREATE POLICY "Public can read sections of published audits"
  ON audit_sections FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM audits a
      WHERE a.id = audit_sections.audit_id
      AND a.status = 'published'
      AND a.public_share_token IS NOT NULL
    )
  );

-- Audit Assets table
CREATE TABLE IF NOT EXISTS audit_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid REFERENCES audits(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id),
  asset_type text DEFAULT '',
  file_url text DEFAULT '',
  file_name text DEFAULT '',
  section_key text DEFAULT '',
  side text DEFAULT 'current' CHECK (side IN ('current', 'optimized')),
  uploaded_at timestamptz DEFAULT now()
);

ALTER TABLE audit_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read audit assets"
  ON audit_assets FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "Auditors and admins can insert audit assets"
  ON audit_assets FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'auditor')
    )
  );

CREATE POLICY "Auditors and admins can update audit assets"
  ON audit_assets FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'auditor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'auditor')
    )
  );

-- Public access for assets of shared reports
CREATE POLICY "Public can read assets of published audits"
  ON audit_assets FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM audits a
      WHERE a.id = audit_assets.audit_id
      AND a.status = 'published'
      AND a.public_share_token IS NOT NULL
    )
  );

-- Annotations table
CREATE TABLE IF NOT EXISTS annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_section_id uuid REFERENCES audit_sections(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES audit_assets(id) ON DELETE CASCADE,
  x_position numeric NOT NULL DEFAULT 0,
  y_position numeric NOT NULL DEFAULT 0,
  label text DEFAULT '',
  side text DEFAULT 'current' CHECK (side IN ('current', 'optimized')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE annotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read annotations"
  ON annotations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "Auditors and admins can insert annotations"
  ON annotations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'auditor')
    )
  );

CREATE POLICY "Auditors and admins can update annotations"
  ON annotations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'auditor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'auditor')
    )
  );

CREATE POLICY "Auditors and admins can delete annotations"
  ON annotations FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
        OR p.id = auth.uid() AND p.role = 'auditor'
    )
  );

-- Public access for annotations of shared reports
CREATE POLICY "Public can read annotations of published audits"
  ON annotations FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM audit_sections s
      JOIN audits a ON a.id = s.audit_id
      WHERE s.id = annotations.audit_section_id
      AND a.status = 'published'
      AND a.public_share_token IS NOT NULL
    )
  );

-- Industry Examples table
CREATE TABLE IF NOT EXISTS industry_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  industry text NOT NULL DEFAULT '',
  email_type text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  image_url text DEFAULT '',
  tags text[] DEFAULT '{}',
  notes text DEFAULT ''
);

ALTER TABLE industry_examples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read industry examples"
  ON industry_examples FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid()
    )
  );

CREATE POLICY "Admins can insert industry examples"
  ON industry_examples FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

CREATE POLICY "Admins can update industry examples"
  ON industry_examples FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

CREATE POLICY "Admins can delete industry examples"
  ON industry_examples FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Public access for industry examples in shared reports
CREATE POLICY "Public can read industry examples"
  ON industry_examples FOR SELECT
  TO anon
  USING (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_audits_client_id ON audits(client_id);
CREATE INDEX IF NOT EXISTS idx_audits_status ON audits(status);
CREATE INDEX IF NOT EXISTS idx_audits_share_token ON audits(public_share_token);
CREATE INDEX IF NOT EXISTS idx_audit_sections_audit_id ON audit_sections(audit_id);
CREATE INDEX IF NOT EXISTS idx_audit_assets_audit_id ON audit_assets(audit_id);
CREATE INDEX IF NOT EXISTS idx_annotations_section_id ON annotations(audit_section_id);
CREATE INDEX IF NOT EXISTS idx_industry_examples_industry ON industry_examples(industry);
