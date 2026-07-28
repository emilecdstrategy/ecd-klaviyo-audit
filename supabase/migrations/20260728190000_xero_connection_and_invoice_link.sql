-- Single-row store for the agency's own Xero connection. Tokens are encrypted
-- with the same AES-256-GCM scheme as the Klaviyo/Shopify client secrets, so
-- they are never readable from the table itself.
create table if not exists public.xero_connection (
  id text primary key default 'default',
  tenant_id text,
  tenant_name text,
  refresh_token_ciphertext text,
  refresh_token_iv text,
  access_token_ciphertext text,
  access_token_iv text,
  access_token_expires_at timestamptz,
  sales_account_code text,
  tax_type text,
  connected_by uuid references public.profiles(id),
  connected_at timestamptz,
  last_refreshed_at timestamptz,
  last_error text,
  constraint xero_connection_single_row check (id = 'default')
);

alter table public.xero_connection enable row level security;

drop policy if exists "Admins read xero connection" on public.xero_connection;
create policy "Admins read xero connection" on public.xero_connection
  for select using (is_admin());
drop policy if exists "Admins write xero connection" on public.xero_connection;
create policy "Admins write xero connection" on public.xero_connection
  for all using (is_admin()) with check (is_admin());

alter table public.proposals
  add column if not exists xero_invoice_id text,
  add column if not exists xero_invoice_number text,
  add column if not exists xero_invoiced_at timestamptz,
  add column if not exists xero_invoice_error text;

comment on column public.proposals.xero_invoice_id is
  'Xero InvoiceID of the draft invoice created when the client signed. Presence blocks re-posting.';
