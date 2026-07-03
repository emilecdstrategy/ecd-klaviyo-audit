-- The "public can read published audits by share token" policies (and their
-- child-table equivalents) only check `status = 'published' AND
-- public_share_token IS NOT NULL` -- they never compare the token to a
-- caller-supplied value. Postgres enforces that condition per row, not per
-- request, so any anon/public caller can list every published audit's full
-- report data (e.g. `select * from audits where status = 'published'`)
-- without ever knowing a real token. This mirrors the exact issue the
-- proposals tables were designed to avoid: public access now goes through
-- the audit_public edge function instead, which validates the token
-- server-side with the service role before returning anything.
--
-- Every one of these tables already has a separate "Authenticated users can
-- read ..." policy for the internal app, so staff/admin access is
-- unaffected by removing these.

drop policy if exists "Public can read published audits by share token" on audits;
drop policy if exists "Public can read sections of published audits" on audit_sections;
drop policy if exists "Public can read assets of published audits" on audit_assets;
drop policy if exists "Public can read annotations of published audits" on annotations;
drop policy if exists "Public can read clients of published audits" on clients;
drop policy if exists "Public can read recommendations of published audits" on recommendations;
drop policy if exists "Public can read flow performance of published audits" on flow_performance;
drop policy if exists "Public can read health scores of published audits" on health_scores;
drop policy if exists "Public can read audit_email_design of published audits" on audit_email_design;
drop policy if exists "Public can read flow snapshots of published audits" on klaviyo_flow_snapshots;
drop policy if exists "Public can read segment snapshots of published audits" on klaviyo_segment_snapshots;
drop policy if exists "Public can read form snapshots of published audits" on klaviyo_form_snapshots;
drop policy if exists "Public can read campaign snapshots of published audits" on klaviyo_campaign_snapshots;
drop policy if exists "Public can read reporting rollups of published audits" on klaviyo_reporting_rollups;
