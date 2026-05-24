-- Composite indexes for common audit report lookups
create index if not exists idx_audit_sections_audit_section_key
  on public.audit_sections (audit_id, section_key);

create index if not exists idx_klaviyo_reporting_rollups_audit_timeframe
  on public.klaviyo_reporting_rollups (audit_id, timeframe_key);
