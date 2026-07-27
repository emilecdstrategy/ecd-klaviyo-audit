-- Per-proposal contract text overrides. The catalog in contract_documents stays
-- the default for every proposal; this column holds { slug: content } for the
-- proposals where the text was tailored for that deal. Contracts still get
-- frozen into contracts_snapshot at send time, resolving the override first.
alter table public.proposals
  add column if not exists contract_overrides jsonb not null default '{}'::jsonb;

comment on column public.proposals.contract_overrides is
  'Per-proposal contract body overrides keyed by contract_documents.slug. Empty object means use the catalog text.';
