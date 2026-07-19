-- Per-user saved signature: a staff member draws their signature once and it is
-- reused across documents (pre-filled when they include their signature). Each
-- user manages only their own row.
create table if not exists public.user_signatures (
  user_id uuid primary key references auth.users(id) on delete cascade,
  signer_name text not null default '',
  signature_image text not null check (length(signature_image) < 400000),
  updated_at timestamptz not null default now()
);

alter table public.user_signatures enable row level security;

drop policy if exists "Users manage their own signature" on public.user_signatures;
create policy "Users manage their own signature"
  on public.user_signatures for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
