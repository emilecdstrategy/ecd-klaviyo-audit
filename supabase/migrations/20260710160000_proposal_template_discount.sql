-- Templates can now carry a default discount, so "Save as template" preserves
-- everything except client-specific info. Mirrors the discount columns on
-- public.proposals (same types, checks, and default of 'one_time').

alter table public.proposal_templates
  add column if not exists discount_type text not null default 'none'
    check (discount_type in ('none', 'fixed', 'percent')),
  add column if not exists discount_value numeric not null default 0
    check (discount_value >= 0),
  add column if not exists discount_applies_to text not null default 'one_time'
    check (discount_applies_to in ('one_time', 'monthly', 'both')),
  add column if not exists discount_label text;
