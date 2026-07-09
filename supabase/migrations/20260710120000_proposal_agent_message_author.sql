-- Track who sent each user message in a proposal agent chat, so the shared
-- (staff-wide) chat history can be labeled by author.

alter table public.proposal_agent_messages
  add column if not exists actor_user_id uuid references auth.users(id);
