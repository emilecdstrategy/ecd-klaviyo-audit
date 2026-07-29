-- Revenue account mapping for Xero draft invoices.
--
-- Every invoice line lands in one of a small set of revenue accounts, chosen by
-- TWO things together: the service family, and whether the money is one-time or
-- recurring. The same Klaviyo work splits across two accounts, implementation to
-- the Klaviyo sales account and the ongoing retainer to the MRR account, so a
-- single account per service is not enough.
--
-- Recurring revenue goes to one shared MRR account by default. A service can
-- override that with its own monthly account if it ever needs to.

alter table public.xero_connection
  add column if not exists mrr_account_code text;

comment on column public.xero_connection.mrr_account_code is
  'Revenue account for recurring (monthly) invoice lines, used for every service unless that service sets its own monthly_account_code.';
comment on column public.xero_connection.sales_account_code is
  'Fallback revenue account for one-time lines. Per-service codes in xero_revenue_accounts take precedence.';

create table if not exists public.xero_revenue_accounts (
  id uuid primary key default gen_random_uuid(),
  -- Stable key stored on each proposal line. Matches proposal_line_items.xero_service_key.
  service_key text not null unique,
  name text not null,
  -- Xero account codes (e.g. '4011'). Nullable so a half-configured mapping is
  -- possible; the invoice builder refuses to post rather than guessing.
  one_time_account_code text,
  monthly_account_code text,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.xero_revenue_accounts enable row level security;

-- Staff need read access because the proposal editor shows the service picker;
-- only admins can change what the codes are.
drop policy if exists "Staff read xero revenue accounts" on public.xero_revenue_accounts;
create policy "Staff read xero revenue accounts" on public.xero_revenue_accounts
  for select using (auth.uid() is not null);
drop policy if exists "Admins write xero revenue accounts" on public.xero_revenue_accounts;
create policy "Admins write xero revenue accounts" on public.xero_revenue_accounts
  for all using (is_admin()) with check (is_admin());

-- Which service family a proposal line belongs to. Nullable: existing lines have
-- no value, and template_slug is null on most of them, which is exactly why this
-- is an explicit field shown in the editor rather than something inferred.
alter table public.proposal_line_items
  add column if not exists xero_service_key text;

comment on column public.proposal_line_items.xero_service_key is
  'Service family for Xero revenue coding; references xero_revenue_accounts.service_key. Null blocks invoicing until someone picks one.';

create index if not exists idx_proposal_line_items_xero_service_key
  on public.proposal_line_items (xero_service_key);
