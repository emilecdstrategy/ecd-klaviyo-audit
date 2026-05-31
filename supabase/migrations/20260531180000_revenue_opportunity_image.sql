-- Add an optional default screenshot/image to revenue opportunity (add-on) templates.
-- Per-audit overrides are stored on the add-on item inside the audit layout JSON.
alter table public.revenue_opportunity_templates
  add column if not exists image_url text;
