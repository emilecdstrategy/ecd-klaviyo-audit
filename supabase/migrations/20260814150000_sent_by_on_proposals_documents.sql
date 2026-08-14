-- Who actually SENT a proposal or document, stamped by the send functions.
--
-- Notifications for viewed/signed went only to the Team notifications list in
-- Settings; whoever pressed Send had no guarantee of hearing back about their
-- own deal unless they happened to be on that list. The sender is now always
-- notified, and this column is how the sign/view functions know who that is.
-- created_by is the fallback for anything sent before the column existed (and
-- for share-link-only flows where no send email ever happened).
alter table public.proposals
  add column if not exists sent_by uuid references auth.users(id) on delete set null;
alter table public.documents
  add column if not exists sent_by uuid references auth.users(id) on delete set null;
