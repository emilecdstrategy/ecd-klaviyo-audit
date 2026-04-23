-- Audit report flexibility overrides
--
-- Adds JSONB configuration columns used by the report-config resolver so that
-- every text string and block inside an audit report section can be hidden,
-- renamed, or overridden without changing the underlying data.
--
-- Pilot scope is the Flows section; the shape is reusable for the other six
-- sections without additional migrations because both columns are JSONB.

alter table public.audit_sections
  add column if not exists section_config jsonb not null default '{}'::jsonb;

alter table public.audits
  add column if not exists layout jsonb not null default '{}'::jsonb;

alter table public.flow_performance
  add column if not exists is_hidden boolean not null default false,
  add column if not exists display_name text,
  add column if not exists display_assessment text,
  add column if not exists display_rating text,
  add column if not exists display_order integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'flow_performance_display_rating_check'
      and conrelid = 'public.flow_performance'::regclass
  ) then
    alter table public.flow_performance
      add constraint flow_performance_display_rating_check
      check (display_rating is null or display_rating in ('good','warning','bad','missing'));
  end if;
end$$;
