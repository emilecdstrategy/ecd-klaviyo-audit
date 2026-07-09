-- Allow staff (admin + auditor), not just admins, to delete their agent chats.
-- Deleting a conversation cascades to its messages via the FK.

drop policy if exists "Admins can delete agent conversations" on public.proposal_agent_conversations;
create policy "Staff can delete agent conversations"
  on public.proposal_agent_conversations
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('admin', 'auditor')
    )
  );
