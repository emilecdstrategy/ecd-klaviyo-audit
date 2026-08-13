-- Which team member a document's sender signature belongs to.
--
-- The sender signature used to be implicitly "whoever is signed in": the app
-- could only read the current user's own saved signature (user_signatures is
-- RLS-locked to its owner), so sending a document under a colleague's name was
-- impossible. Proposals already name their signer via
-- proposal_signatures.signer_user_id and default to Zak; documents now do the
-- same, reading the signature from the signer's profile.
--
-- Nullable: existing sender signatures predate this and stay valid, they simply
-- do not say who they belonged to beyond the stored name.
alter table public.document_signatures
  add column if not exists signer_user_id uuid references auth.users(id) on delete set null;

-- Staff already manage sender-role rows (see 20260718121000); this only widens
-- what they may write, so no policy change is needed. Recipient rows are still
-- written exclusively by the service-role edge function and never carry a
-- signer_user_id.
create index if not exists document_signatures_signer_user_idx
  on public.document_signatures (signer_user_id)
  where signer_user_id is not null;
