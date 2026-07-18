-- AI assistant learned memory: a small, model-written text blob per scope that
-- accumulates preferences/decisions surfaced in chat. Read into the agent system
-- prompt; written only by the service-role edge functions (proposal_agent /
-- document_agent). Automatic and hidden (no per-scope UI).
--
-- scope_key convention:
--   'proposal:client:<client_uuid>'  -- per-client proposal memory
--   'document:global'                -- documents have no client link

create table if not exists public.ai_memory (
  scope_key  text primary key,
  memory     text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.ai_memory enable row level security;

-- Staff can read memory; writes happen only through the service role (edge fns).
drop policy if exists "Authenticated staff can read ai_memory" on public.ai_memory;
create policy "Authenticated staff can read ai_memory"
  on public.ai_memory for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid()));
