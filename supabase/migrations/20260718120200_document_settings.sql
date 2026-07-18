-- Documents email/settings, stored on the singleton platform_settings row.
alter table public.platform_settings
  add column if not exists document_settings jsonb not null default '{}'::jsonb;
