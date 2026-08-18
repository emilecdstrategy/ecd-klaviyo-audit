-- Setup cost on a web audit roadmap is priced from hours, not typed in as a
-- figure. The rate lives here so it can be changed in one place, and every
-- roadmap stamps the rate it was built with onto its own section so raising the
-- rate never silently reprices an audit a client has already read.
alter table public.platform_settings
  add column if not exists web_audit_settings jsonb not null default '{"hourly_rate": 175}'::jsonb;

update public.platform_settings
   set web_audit_settings = coalesce(web_audit_settings, '{}'::jsonb) || '{"hourly_rate": 175}'::jsonb
 where id = 'default'
   and not (coalesce(web_audit_settings, '{}'::jsonb) ? 'hourly_rate');
