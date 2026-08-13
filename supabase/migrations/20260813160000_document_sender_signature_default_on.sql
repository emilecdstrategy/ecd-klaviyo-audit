-- Documents go out signed by us by default.
--
-- The sender signature was opt-in, which meant most documents left without one
-- and someone had to remember the toggle. Practice says the opposite: a
-- document from ECD is normally countersigned (by Zak unless someone picks
-- another signer), so the default now matches what we actually send.
--
-- Only the DEFAULT changes. Existing documents keep whatever they were saved
-- with, and the per-document toggle still turns it off for the cases that need
-- an unsigned document.
alter table public.documents
  alter column sender_signature_enabled set default true;
