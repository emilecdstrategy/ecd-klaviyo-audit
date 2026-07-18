-- Document AI assistant: persisted conversations + messages, separate from the
-- proposals assistant so the two never interfere. Mirrors proposal_agent_chat.

create table if not exists public.document_agent_conversations (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.documents(id) on delete cascade,
  title text not null default 'New document chat',
  status text not null default 'active' check (status in ('active', 'archived')),
  context_summary text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_document_agent_conversations_document
  on public.document_agent_conversations (document_id, updated_at desc);

create table if not exists public.document_agent_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.document_agent_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null default '',
  payload jsonb,
  payload_kind text check (payload_kind in ('question', 'draft', 'edits', 'doc_fetch')),
  applied_at timestamptz,
  actor_user_id uuid references auth.users(id),
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_document_agent_messages_conversation
  on public.document_agent_messages (conversation_id, created_at);

alter table public.document_agent_conversations enable row level security;
alter table public.document_agent_messages enable row level security;

-- Staff (admin/auditor) read/insert/update; admin delete.
drop policy if exists "Staff read document agent conversations" on public.document_agent_conversations;
create policy "Staff read document agent conversations"
  on public.document_agent_conversations for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor')));

drop policy if exists "Staff insert document agent conversations" on public.document_agent_conversations;
create policy "Staff insert document agent conversations"
  on public.document_agent_conversations for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor')));

drop policy if exists "Staff update document agent conversations" on public.document_agent_conversations;
create policy "Staff update document agent conversations"
  on public.document_agent_conversations for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor')));

drop policy if exists "Staff delete document agent conversations" on public.document_agent_conversations;
create policy "Staff delete document agent conversations"
  on public.document_agent_conversations for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor')));

drop policy if exists "Staff read document agent messages" on public.document_agent_messages;
create policy "Staff read document agent messages"
  on public.document_agent_messages for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor')));

drop policy if exists "Staff insert document agent messages" on public.document_agent_messages;
create policy "Staff insert document agent messages"
  on public.document_agent_messages for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor')));

drop policy if exists "Staff update document agent messages" on public.document_agent_messages;
create policy "Staff update document agent messages"
  on public.document_agent_messages for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor')));

drop policy if exists "Staff delete document agent messages" on public.document_agent_messages;
create policy "Staff delete document agent messages"
  on public.document_agent_messages for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'auditor')));
