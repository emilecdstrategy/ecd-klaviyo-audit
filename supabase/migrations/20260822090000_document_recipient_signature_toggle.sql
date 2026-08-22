-- Some documents are statements, not agreements.
--
-- An employment verification letter is signed by us and handed to the employee:
-- there is nobody on the other side to countersign, and the recipient signature
-- column made the document look unfinished forever. The sender signature has
-- been optional since July; this is its counterpart.
--
-- Defaults to true so every existing document keeps asking for a signature, and
-- so the common case (an agreement) still needs no thought.

alter table public.documents
  add column if not exists recipient_signature_enabled boolean not null default true;

comment on column public.documents.recipient_signature_enabled is
  'When false the recipient is not asked to sign: the public page shows the document without a signature pad and document_sign refuses. Used for letters and statements that only we sign.';
