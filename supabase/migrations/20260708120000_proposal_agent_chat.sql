-- Proposal agent chat: persisted conversations + messages for the AI
-- proposal assistant. Conversations may start without a proposal (drafting
-- from the proposals list) and get linked once a draft is applied.

create table if not exists public.proposal_agent_conversations (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid references public.proposals(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  title text not null default 'New proposal chat',
  status text not null default 'active'
    check (status in ('active', 'archived')),
  context_summary text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_proposal_agent_conversations_proposal
  on public.proposal_agent_conversations (proposal_id, updated_at desc);

create table if not exists public.proposal_agent_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.proposal_agent_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null default '',
  payload jsonb,
  payload_kind text
    check (payload_kind in ('question', 'draft', 'edits', 'doc_fetch', 'catalog')),
  applied_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_proposal_agent_messages_conversation
  on public.proposal_agent_messages (conversation_id, created_at);

-- RLS ---------------------------------------------------------------------

alter table public.proposal_agent_conversations enable row level security;
alter table public.proposal_agent_messages enable row level security;

-- conversations: staff read/insert/update; admin delete
drop policy if exists "Staff can read agent conversations" on public.proposal_agent_conversations;
create policy "Staff can read agent conversations"
  on public.proposal_agent_conversations
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'auditor')
    )
  );

drop policy if exists "Staff can insert agent conversations" on public.proposal_agent_conversations;
create policy "Staff can insert agent conversations"
  on public.proposal_agent_conversations
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'auditor')
    )
  );

drop policy if exists "Staff can update agent conversations" on public.proposal_agent_conversations;
create policy "Staff can update agent conversations"
  on public.proposal_agent_conversations
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'auditor')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'auditor')
    )
  );

drop policy if exists "Admins can delete agent conversations" on public.proposal_agent_conversations;
create policy "Admins can delete agent conversations"
  on public.proposal_agent_conversations
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  );

-- messages: staff read/insert/update (applied_at); admin delete
drop policy if exists "Staff can read agent messages" on public.proposal_agent_messages;
create policy "Staff can read agent messages"
  on public.proposal_agent_messages
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'auditor')
    )
  );

drop policy if exists "Staff can insert agent messages" on public.proposal_agent_messages;
create policy "Staff can insert agent messages"
  on public.proposal_agent_messages
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'auditor')
    )
  );

drop policy if exists "Staff can update agent messages" on public.proposal_agent_messages;
create policy "Staff can update agent messages"
  on public.proposal_agent_messages
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'auditor')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'auditor')
    )
  );

drop policy if exists "Admins can delete agent messages" on public.proposal_agent_messages;
create policy "Admins can delete agent messages"
  on public.proposal_agent_messages
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
    )
  );
