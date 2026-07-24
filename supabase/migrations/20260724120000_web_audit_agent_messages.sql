-- Persisted chat history for the web-audit AI assistant (one thread per audit).
create table if not exists public.web_audit_agent_messages (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  payload jsonb,
  applied boolean not null default false,
  actor_user_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_web_audit_agent_messages_audit
  on public.web_audit_agent_messages(audit_id, created_at);

alter table public.web_audit_agent_messages enable row level security;

-- Staff (admin/auditor) can read + write; only admins can delete.
create policy "web_audit_agent_messages_select" on public.web_audit_agent_messages
  for select using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor')));
create policy "web_audit_agent_messages_insert" on public.web_audit_agent_messages
  for insert with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor')));
create policy "web_audit_agent_messages_update" on public.web_audit_agent_messages
  for update using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor')));
create policy "web_audit_agent_messages_delete" on public.web_audit_agent_messages
  for delete using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
