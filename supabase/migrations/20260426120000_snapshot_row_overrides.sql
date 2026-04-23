-- Add per-row presentation overrides to segment/form/campaign snapshot tables,
-- mirroring the flow_performance pattern introduced in 20260425120000.

alter table public.klaviyo_segment_snapshots
  add column if not exists is_hidden boolean not null default false,
  add column if not exists display_name text,
  add column if not exists display_notes text,
  add column if not exists display_order integer;

alter table public.klaviyo_form_snapshots
  add column if not exists is_hidden boolean not null default false,
  add column if not exists display_name text,
  add column if not exists display_notes text,
  add column if not exists display_order integer;

alter table public.klaviyo_campaign_snapshots
  add column if not exists is_hidden boolean not null default false,
  add column if not exists display_name text,
  add column if not exists display_notes text,
  add column if not exists display_order integer;
