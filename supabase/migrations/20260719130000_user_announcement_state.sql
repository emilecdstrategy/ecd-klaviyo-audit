-- Which "What's new" announcements a user has dismissed. Stored server-side (not
-- localStorage) because the app spans two origins (audit. and proposal.
-- ecdigitalstrategy.com) whose localStorage is not shared, which caused the
-- popup to reappear after being dismissed on the other subdomain.
create table if not exists public.user_announcement_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  seen text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.user_announcement_state enable row level security;

drop policy if exists "Users manage their own announcement state" on public.user_announcement_state;
create policy "Users manage their own announcement state"
  on public.user_announcement_state for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
