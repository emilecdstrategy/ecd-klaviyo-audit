-- Track whether a web audit's "after" concept images have finished generating, so
-- the report is only shown once they are all done. Defaults true so existing
-- audits and non-web audits are never gated.
alter table public.audits
  add column if not exists web_afters_ready boolean not null default true;
